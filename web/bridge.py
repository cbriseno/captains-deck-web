#!/usr/bin/env python3
"""Dependency-free HTTP projection of the Deck's existing model.

No backlog, supervisor, shell-command API, push sender or model calls.
The single collector always reads All; selecting a crew never changes another
browser's view. Mutations go only through the owning home's public intakes; the
one message the bridge sends is the Deck's fixed pointer to a recorded answer.
"""
from __future__ import annotations

import argparse
import copy
from answer_files import AnswerFiles, MAX_FILE
import hashlib
import http.cookies
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import threading
import time
try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11, such as macOS's own 3.9
    tomllib = None
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import TCPServer
from urllib.parse import parse_qs, unquote, urlencode, urlsplit

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'scripts'))
from localization import Localization
from presentation import USER_PATH_STARTS, URL_RE, card_field, drop_links, excerpt, project, report_parts
import flow_tui as fm  # noqa: E402
from deck_platform import LOOPBACK, local_origin, endpoint_path, private_directory, safe_file_reads, shell_command

from deck_control import CHANGE_GAP, FULL_READ, DeckControls, ControlError
from relay_settings import RelaySettings
import timeline
from html import escape
import fm_diagnostics as diagnostics

STATIC = HERE / 'static'
# What needs the captain leads; the board reads left to right toward done.
COLUMNS = [('captains_call', 'Needs you'), ('underway', 'Underway'),
           ('charted', 'Up next'), ('landed', 'Delivered')]
MAX_BODY = 16384
# The fixed line the Deck's message-Firstmate path sends after a main-owned
# answer is recorded. It points at the record and never carries the answer.
PRIMARY_WAKE = ("Captain's Deck: the captain answered {task} from the web board. "
                "Read the recorded answer for this task.")
CANONICAL_TEXT = Localization('en').t

# Structural diagnostics are intentionally limited to the allowlisted schema.
DIAG_LOCK = threading.Lock()
READ_LOCK = threading.Lock()
FAILURES = 0
TRACE_TIMES = []
try:
    REVISION = subprocess.run(['git', '-C', str(HERE.parent), 'rev-parse', '--short=12', 'HEAD'],
                              capture_output=True, text=True, timeout=2, check=True).stdout.strip()
except (OSError, subprocess.SubprocessError):
    REVISION = 'unknown'

def diagnostic(event, **fields):
    with DIAG_LOCK:
        try:
            logger = diagnostics.Logger('deck', diagnostics.PRODUCT_VERSION, REVISION)
            logger.emit(event, **fields)
            logger.flush()
        except OSError:
            pass


class Refusal(Exception):
    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


def digest(*values):
    return hashlib.sha256(json.dumps(values, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode()).hexdigest()


def home_id(home):
    return hashlib.sha256(fm.delivery_home_identity(home).encode('utf-8')).hexdigest()[:32]


def event_json(event, translate=None):
    if not isinstance(event, fm.CardTime):
        event = fm.CardTime('Updated')
    return {'label': 'Last report' if event.label == 'Updated' else event.label, 'epoch': event.epoch,
            'date': event.day.isoformat() if event.day else None,
            'source': event.source, 'problem': event.problem,
            'detail': fm.card_time_detail(event, translate=translate)}


def human_title(value, translate=lambda text: text):
    # Canonical titles sometimes retain a report link or a PR address as a
    # trailing token. Keep the original in Details; a filesystem location or a
    # URL is not the headline, and title_links offers the address instead.
    # Nor is a short commit hash. A file the title is about keeps its name
    # without the folders it lives in.
    text = fm.readable_markdown(str(value or ''))
    text = re.sub(r'(?<!\S)(?:data/|/[^\s]*/data/)[^\s]+\.(?:md|json|txt)(?=\s|$)', '', text)
    text = drop_links(text)
    text = re.sub(rf'(?<![\w/~.-]){re.escape(str(Path.home()))}/(?:[^\s/]+/)*([^\s/]+)', r'\1', text)
    text = re.sub(rf'(?<![\w/~.-])(?:{USER_PATH_STARTS})(?:[^\s/]+/)*([^\s/]+)', r'\1', text)
    return re.sub(r'\s+', ' ', text).strip(' ·–—-:,;') or translate('Task without a readable title')


# Firstmate files the follow-up that brings landed work into the captain's
# own installation under this fixed English title (fm-install-followup.sh).
INSTALL_TITLE = re.compile(r'Install (\S+) into (\S+)')


def card_title(card, titles, translate):
    """The title a card shows: Firstmate's short card title when it wrote one,
    else the readable full title. The full one stays in Details."""
    flow = getattr(card, 'flow', None) or {}
    human = flow.get('presentation') if isinstance(flow.get('presentation'), dict) else {}
    return (card_field(human.get('card_title'), 'card_title')
            or readable_title(card.title, titles, translate))


def readable_title(value, titles, translate):
    """A recorded title as the board reads it: the fixed install title names
    the work it installs, by that task's title when it is known."""
    stock = INSTALL_TITLE.fullmatch(str(value or '').strip())
    if stock:
        source = titles.get(stock[1])
        return (translate('Install “{title}”').format(title=source) if source
                else translate('Install {task}').format(task=stock[1]))
    return human_title(value, translate)


def record_title(record, translate, titles=None):
    """A history row's title, preferring Firstmate's short card title."""
    human = record.get('presentation') if isinstance(record.get('presentation'), dict) else {}
    return (card_field(human.get('card_title'), 'card_title')
            or readable_title(record.get('title') or record.get('id'), titles or {}, translate))


def task_presentation(home, task):
    """The card text Firstmate saved for one task (fm-tasks-axi.sh presentation:
    card_title, card_status, group, summary…), or {} when there is none."""
    try:
        value = json.loads(fm.delivery_read(home.path, fm.delivery_task_prefix(task) + 'presentation.json', 32768))
    except (OSError, ValueError):
        return {}
    if (not isinstance(value, dict) or value.get('schema') != 'fm-task-presentation.v1'
            or value.get('id') != task or value.get('source') != 'task.owner.declaration'
            or not isinstance(value.get('presentation'), dict)
            or os.path.realpath(str(value.get('home') or '')) != os.path.realpath(home.path)):
        return {}
    return value['presentation']


def record_presentation(home, record):
    """A history row's card text: what Firstmate saved for that task wins over
    what the history record carried. The history script doesn't copy it, so a
    delivered task keeps the project it declared, archived or not."""
    own = record.get('presentation') if isinstance(record.get('presentation'), dict) else {}
    return {**own, **task_presentation(home, record['id'])}


def linked_repos(home):
    """Each project's installation link (install=<project>) in Firstmate's
    registry, so a public fork counts as the project it installs into."""
    try:
        registry = fm.delivery_read(home.path, 'data/projects.md', 65536)
    except (OSError, ValueError):
        return {}
    links = {}
    for line in re.finditer(r'^- (\S+) \[([^\]]*)\]', registry, re.M):
        link = re.search(r'(?:^|\s)install=(\S+)', line[2])
        if link:
            links[line[1]] = link[1]
    return links


def repo_names(home, rows):
    """The project name each repository's tasks declared most, so a delivery
    that declared none shares their tag and color. Ties read alphabetically."""
    links, counts = linked_repos(home), {}
    for row in rows:
        repo = str(row.get('repo') or '')
        tag = project_tag(row.get('project') or record_presentation(home, row).get('group'))
        if repo and tag:
            names = counts.setdefault(links.get(repo, repo), {})
            names[tag['label']] = names.get(tag['label'], 0) + 1
    return links, {repo: min(names, key=lambda name: (-names[name], name.casefold()))
                   for repo, names in counts.items()}


def title_links(value):
    """The web addresses a title carried, in order: a PR keeps its number."""
    links = []
    for url in dict.fromkeys(URL_RE.findall(str(value or ''))):
        pull = re.search(r'^https://github\.com/[^/]+/[^/]+/pull/(\d+)(?:[/#?]|$)', url)
        links.append({'url': url, 'pr': int(pull[1]) if pull else None})
    return links


def project_tag(value):
    """The project or initiative Firstmate recorded for a task, or None.

    Firstmate writes a name or {id, label}. Cards that share an id share a
    color and wait in one stack of questions. The Deck never guesses a
    project from a task id: without the field a card simply has no tag.
    """
    if isinstance(value, str):
        value = {'id': value}
    if not isinstance(value, dict):
        return None
    clean = lambda text: ' '.join(text.split()) if isinstance(text, str) else ''
    ident = clean(value.get('id')) or clean(value.get('label'))
    label = clean(value.get('label')) or ident
    if not ident or len(ident) > 80 or len(label) > 80:
        return None
    return {'id': ident.casefold(), 'label': label}


def newest_first(event):
    """Sort key for the time a row shows, newest first under reverse=True.

    A day without a time sorts after that day's timed events; a row with no
    recorded time sorts last.
    """
    if event.get('epoch') is not None:
        return 1, tuple(time.localtime(event['epoch'])[:3]), 1, event['epoch']
    if event.get('date'):
        return 1, tuple(map(int, event['date'].split('-'))), 0, 0
    return 0, (0, 0, 0), 0, 0


def file_mark(path):
    """What changes when a file is edited in place or replaced; None if absent."""
    try:
        info = os.stat(path)
    except OSError:
        return None
    return info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


TOML_TABLE = re.compile(r'\[([A-Za-z0-9_-]+)\]\s*(?:#.*)?')
TOML_PAIR = re.compile(r"""([A-Za-z0-9_-]+)\s*=\s*(?:"([^"\\]*)"|'([^']*)'|([+-]?[0-9]+)|(true|false))\s*(?:#.*)?""")


def read_toml(text):
    """The parsed TOML, or None when it can't be read. Without tomllib only
    plain tables and string, integer and boolean keys are read."""
    if tomllib:
        try:
            return tomllib.loads(text)
        except tomllib.TOMLDecodeError:
            return None
    cfg = table = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if match := TOML_TABLE.fullmatch(line):
            table = cfg.setdefault(match[1], {})
        elif match := TOML_PAIR.fullmatch(line):
            key, basic, literal, number, flag = match.groups()
            table[key] = (int(number) if number else flag == 'true' if flag
                          else basic if basic is not None else literal)
        else:
            return None
    return cfg


def backlog_sources(home):
    """The home's task config and its Markdown backlog and archive, as Firstmate
    reads them (an absent .tasks.toml means the defaults). None when the home is
    remote, uses another backend or its config can't be read: then nothing is
    cached and every read asks Firstmate."""
    if fm.is_remote_home(home) or fm.is_aggregate_home(home):
        return None
    root = Path(home.path)
    try:
        config = (root / '.tasks.toml').read_text(encoding='utf-8')
    except FileNotFoundError:
        config = ''
    except (OSError, ValueError):
        return None
    cfg = read_toml(config)
    if cfg is None:
        return None
    markdown = cfg.get('markdown') if isinstance(cfg.get('markdown'), dict) else {}
    if cfg.get('backend', 'markdown') != 'markdown':
        return None
    backlog = str(markdown.get('path') or 'data/backlog.md')
    archive = str(markdown.get('archive') or Path(backlog).parent / 'done-archive.md')
    return config, backlog, archive


def call_row(home, task):
    """The one backlog row a call's identity comes from, with its fingerprint.

    Firstmate's lifecycle identity is the row's hold-set stamp and its count of
    recorded answers, both inside that row. The row runs from its checkbox line
    to the next row or heading. Returns (mark, row lines, section heading), or
    None when the row isn't found exactly once.
    """
    sources = backlog_sources(home)
    if not sources:
        return None
    config, backlog, _ = sources
    try:
        text = fm.delivery_read(home.path, backlog, fm.DELIVERY_INDEX_LIMIT)
    except (OSError, ValueError):
        return None
    lines = text.splitlines(keepends=True)
    head = re.compile(r'- \[[ xX]\] ' + re.escape(task) + r'(?=\s|$)')
    found = [i for i, line in enumerate(lines) if head.match(line)]
    if len(found) != 1:
        return None
    end = found[0] + 1
    while end < len(lines) and not re.match(r'- \[|#', lines[end]):
        end += 1
    section = next((line for line in reversed(lines[:found[0]]) if line.startswith('## ')), '')
    return digest(config, backlog, ''.join(lines[found[0]:end])), lines[found[0]:end], section


def call_mark(home, task):
    row = call_row(home, task)
    return row[0] if row else None


def row_identity(row, section):
    """The identity `fm-captain-hold.sh open --identity` prints, read from its row.

    Mirrors Firstmate: the body is the indented or blank lines under an open
    captain row, the stamp is its first line, and the count is its resolution
    record lines. None when any of that isn't plain, so Firstmate is asked.
    """
    if (not row[0].startswith('- [ ] ') or not re.search(r'\(hold-kind:\s*captain\)', row[0])
            or re.match(r'##\s+done', section, re.I)):
        return None
    body = []
    for line in (line.rstrip('\n').removesuffix('\r') for line in row[1:]):
        if line.strip() and not line.startswith('  '):
            break
        body.append(line[2:] if line.strip() else '')
    stamp = re.fullmatch(r'Captain hold set: ([0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)?)', body[0]) if body else None
    if not stamp:
        return None
    count = sum(bool(re.fullmatch(r'Resolution recorded by fm-(?:captain|decision)-hold\.', line)) for line in body)
    return f'{stamp[1]}#{count}'


def conversation_page(t, task, chat, locale="en"):
    """Read-only text of one agent conversation; tool calls are left out."""
    def when(epoch):
        return time.strftime('%d/%m %H:%M', time.localtime(epoch)) if epoch else ''
    turns = ''.join(
        f'<article class="turn {escape(x["role"])}"><p class="who">{escape(t("You (Firstmate)") if x["role"] == "user" else t("Agent"))}'
        f' <time>{escape(when(x["at"]))}</time></p><pre>{escape(x["text"])}</pre></article>' for x in chat['turns'])
    return (f'<!doctype html><html lang="{escape(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{escape(t("Conversation"))} · {escape(task)}</title><script src="theme.js"></script>'
            '<link rel="stylesheet" href="themes.css"><link rel="stylesheet" href="conversation.css"></head><body>'
            f'<header><h1>{escape(task)}</h1><p>{escape(chat["harness"])} · {escape(t("{count} messages", count=len(chat["turns"])))}'
            f' · {escape(t("Tool calls are not shown."))}</p></header><main>{turns}</main></body></html>')

def history_mark(home):
    """The files Firstmate's delivery history reads, besides each task's
    completion receipt; None when they can't be known."""
    sources = backlog_sources(home)
    if not sources:
        return None
    config, backlog, archive = sources
    root = Path(home.path)
    return (config, file_mark(root / backlog), file_mark(root / archive),
            file_mark(endpoint_path(home.path, 'fm-delivery-history.sh')),
            file_mark(endpoint_path(home.path, 'fm_delivery.py')))


MARKS, MARKS_LOCK = {}, threading.Lock()


def state_mark(home):
    """What changes when Firstmate records anything the Deck shows: each task's
    status and meta, and each entry of data/ (Firstmate replaces files, which
    changes their folder). Read once per 2 s; None for a remote home."""
    if fm.is_remote_home(home) or fm.is_aggregate_home(home):
        return None
    with MARKS_LOCK:
        at, mark = MARKS.get(home.path, (0, None))
        if time.monotonic() - at < 2:
            return mark
        entries = [file_mark(Path(home.path, '.tasks.toml'))]
        for folder in ('state', 'data'):
            try:
                with os.scandir(Path(home.path, folder)) as listing:
                    entries += sorted((x.name, file_mark(x.path)) for x in listing if not x.name.startswith('.')
                                      and (folder == 'data' or x.name.endswith(('.status', '.meta'))))
            except OSError:
                entries.append((folder, None))
        mark = digest(json.dumps(entries))
        MARKS[home.path] = time.monotonic(), mark
        return mark


# Set by the managed launcher when stderr is its server.log; rotated like fm_diagnostics.
LOG_PATH, LOG_LIMIT = None, 2 * 1024 * 1024


def log(text):
    """One timed line in the server log; callers pass no ids, paths or captain text."""
    print(time.strftime('%Y-%m-%dT%H:%M:%SZ ', time.gmtime()) + text, file=sys.stderr, flush=True)
    if LOG_PATH is None or os.fstat(2).st_size <= LOG_LIMIT // 2:
        return
    try:
        os.replace(LOG_PATH, LOG_PATH.with_name('server.1.log'))
        fd = os.open(LOG_PATH, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        os.dup2(fd, 2)
        os.close(fd)
    except OSError:
        pass


def log_read(kind, started, ok=True, cause=''):
    """One line per Firstmate read: which, how long, and why it failed."""
    log(f'deck read {kind} {round((time.monotonic() - started) * 1000)}ms ' + ('ok' if ok else 'error ' + (cause or 'unknown')))


def changed_since(path, started):
    # One second covers filesystems with coarse change times.
    mark = file_mark(path)
    return mark is not None and mark[3] >= (started - 1) * 1e9


class Collector(fm.Collector):
    """Track source-read failures separately from cheap card repaint times."""
    def __init__(self):
        super().__init__(fm.ALL_CREW_LABEL)
        self.source_errors = {}
        # Per home: the state mark of the last read, and when it was last seen unchanged.
        self.marks, self.checked = {}, {}

    def _bearings_stale(self, home, now):
        raw, received, path = self._raw.get(home.label, ({}, 0.0, ''))
        mark = state_mark(home)
        if self._force or not raw or path != home.path or mark is None:
            return super()._bearings_stale(home, now)
        if mark == self.marks.get(home.label):
            self.checked[home.label] = time.time()
            return now - received > FULL_READ
        return now - received > CHANGE_GAP

    def _load_bearings(self, home, now, agents, panes, homes):
        stale = self._bearings_stale(home, now)
        before = self._raw.get(home.label, ({}, 0, ''))[1]
        mark, started = state_mark(home), time.monotonic()
        result = super()._load_bearings(home, now, agents, panes, homes)
        after = self._raw.get(home.label, ({}, 0, ''))[1]
        if stale:
            self.source_errors[home.label] = '' if after > before else 'Could not refresh Firstmate.'
            log_read('bearings', started, after > before, 'no-reply')
            if after > before:
                self.marks[home.label] = mark
        return result


class Board:
    def __init__(self, data_dir, herdr_origin='', collector=None, language=None):
        self.i18n = Localization(language if language is not None else os.environ.get('CD_WEB_LANGUAGE', 'en'))
        self.t = self.i18n.t
        self.collector = collector or Collector()
        self.data_dir = Path(data_dir).expanduser().absolute()
        self.herdr_origin = herdr_origin
        self.deck_controls = DeckControls(self.child_env, state_mark, log_read)
        self.answer_capabilities = {}
        self.answer_files = AnswerFiles(self, Refusal, fm, shell_command, endpoint_path, home_id)
        self.relay_settings = RelaySettings(self.child_env, os.environ.get('CD_WEB_EXTENSIONS_ROOT', ''),
            nodes=lambda home: self.deck_controls.source(home).get('snapshot', {}).get('nodes', []),
            proof_dir=self.data_dir / 'settings')
        self.mutation_lock = threading.Lock()
        self.history_lock = threading.Lock()
        self.history_cache = {}
        self.repo_cache = {}
        # Last built history per home selection; reads serve it while one rebuild runs.
        self.histories, self.history_rebuilding = {}, set()
        self.history_build_lock = threading.Lock()
        # Firstmate's identity for a call is kept until its backlog row
        # changes; until then an open reads the row, and answering always asks
        # Firstmate again.
        self.identity_lock = threading.Lock()
        self.identities = {}
        self.identity_gates = {}
        self.warm_failed = {}
        self.rows_contradicted = set()
        # The read-ahead keeps whether each home's intake takes web answers,
        # per install of its script; an answer always asks again.
        self.capabilities = {}
        self.warming = threading.Event()
        self.stopping = threading.Event()

    def event_json(self, event):
        return event_json(event, self.t)

    def start(self):
        self.collector.start()
        threading.Thread(target=self.warm_loop, daemon=True, name='deck-warm').start()
        self.warming.set()

    def stop(self):
        self.stopping.set()
        self.warming.set()
        self.collector.stop()

    def warm_loop(self):
        """Keep open calls and delivery history read ahead of the captain.

        Every board read wakes it; it does work only for what changed, one
        Firstmate call at a time.
        """
        while not self.stopping.is_set():
            self.warming.wait()
            self.warming.clear()
            if self.stopping.is_set():
                return
            try:
                self.prefetch()
            except Exception:  # A failed read-ahead only means the next open asks Firstmate itself.
                time.sleep(5)

    def prefetch(self):
        current, checked = set(), set()
        for card in self.view_cards().get('captains_call', []):
            if (getattr(card, 'call', None) or {}).get('kind') == 'action':
                continue  # No answer capabilities/identity intake for a chat action.
            try:
                home = self.owner(card)
            except Refusal:
                continue
            key = home_id(home), card.task
            current.add(key)
            if key[0] not in checked and not fm.is_remote_home(home):
                checked.add(key[0])
                mark = file_mark(endpoint_path(home.path, 'fm-captain-hold.sh'))
                self.capabilities[key[0]] = mark, self.guarded_intake(home)
            # A call Firstmate couldn't confirm is retried only once its row
            # changes; opening it still asks Firstmate.
            mark = None if fm.is_remote_home(home) else call_mark(home, card.task)
            if not mark or self.warm_failed.get(key) == mark:
                continue
            try:
                self.call_identity(home, card.task, confirm=True)
            except Refusal:
                pass
        with self.identity_lock:
            for key in (set(self.identities) | set(self.warm_failed)) - current:
                self.identities.pop(key, None)
                self.identity_gates.pop(key, None)
                self.warm_failed.pop(key, None)
        for home in self.homes():
            if not fm.is_remote_home(home):
                self.records(home, max_age=None)

    def homes(self):
        return fm.real_homes(self.collector.snapshot().homes)

    def inputs(self):
        """What a board is built from, cheaply compared: Firstmate's state and
        the last reads of it."""
        homes = self.homes()
        return (tuple(state_mark(h) for h in homes), tuple(self.collector._raw.get(h.label, ({}, 0))[1] for h in homes),
                tuple(id(self.deck_controls.peek(h)) for h in homes))

    def health(self):
        snap = self.collector.snapshot()
        ready = bool(snap.collected_at)
        return {'ok': ready and not snap.loading and not snap.error,
                'mode': 'connected' if fm.real_homes(snap.homes) else 'standalone',
                'collector_at': snap.collected_at, 'loading': bool(snap.loading),
                'error': snap.error}

    def event_view(self, identity):
        """Explicitly read published events, without a canonical snapshot."""
        owner = self.home(identity)
        if fm.is_remote_home(owner):
            raise Refusal('This view requires a local owner.', 403)
        try:
            text = fm.delivery_read(owner.path, 'state/fleet-ledger.jsonl', fm.DELIVERY_INDEX_LIMIT)
        except FileNotFoundError:
            text = ''
        calls, presentations, agents, tasks, messages = {}, {}, {}, {}, []
        for line in text.splitlines(keepends=True):
            if not line.endswith('\n'):
                break
            event = json.loads(line)
            if event.get('home') != fm.delivery_home_identity(owner):
                continue
            name, task, value = event.get('event'), event.get('task'), event.get('value')
            if name in ('call.opened', 'call.resolved'):
                calls[(task, value['call']['hold_set'])] = dict(value, task=task,
                    state='open' if name == 'call.opened' else 'resolved')
            elif name == 'call.application':
                key = (task, value['call']['hold_set'])
                if key in calls:
                    calls[key]['answer'] = value['answer']
            elif name == 'primary.final':
                messages.append(value)
            elif name == 'agent.activity':
                agents[task] = value
            elif name == 'agent.retired':
                if agents.get(task, {}).get('gen') == value['gen']:
                    agents.pop(task, None)
            elif name == 'task.changed':
                tasks[task] = value['task']
            elif name in ('task.presentation', 'task.review'):
                presentations[task] = value
        return dict(calls=list(calls.values()), presentations=presentations,
                    primary_finals=messages, agents=agents, tasks=tasks,
                    scope='Published events only; no canonical bootstrap or continuity guarantee.')

    def home(self, identity):
        matches = [h for h in self.homes() if home_id(h) == identity]
        if len(matches) != 1:
            raise Refusal('Deck can’t find this crew right now. Refresh the board.', 404)
        return matches[0]

    def owner(self, card):
        homes = self.homes()
        if card.bucket == 'landed':
            identity = getattr(card, 'delivery_identity', '')
            matches = [h for h in homes if fm.delivery_home_identity(h) == identity]
        elif card.owner and card.owner != '(main)':
            matches = [h for h in homes if card.owner in (h.label, h.mate_id)]
        else:
            matches = [h for h in homes if h.path == card.home_path]
        if len(matches) != 1:
            raise Refusal('Deck isn’t sure which crew this task belongs to yet.')
        return matches[0]

    def key(self, card):
        try:
            identity = home_id(self.owner(card))
        except Refusal:
            identity = digest(card.home_path, card.owner)
        return digest(identity, card.task, card.bucket)[:40]

    def view_cards(self, snap=None, work_sources=None):
        """Join actual open questions to the existing guarded question intake.

        Legacy bearings can classify a captain hold behind a dependency as a
        gate. FM-WORK's explicit question state owns whether it still asks for
        an answer; the existing card builder and occurrence guard own content
        and submission. Never infer a question from blocked prose.
        """
        snap = snap or self.collector.snapshot()
        homes = self.homes()
        sources = work_sources if work_sources is not None else [
            dict(self.deck_controls.peek(h), home=home_id(h))
            for h in homes if not fm.is_remote_home(h)]
        states, calls = {}, []
        for source in sources:
            if not source.get('snapshot'):
                continue
            home = next((h for h in homes if home_id(h) == source['home']), None)
            if home is None:
                continue
            entries = []
            for node in source['snapshot'].get('nodes', []):
                question = node.get('question')
                if node.get('kind') != 'task' or not isinstance(question, dict):
                    continue
                if not source.get('available') and not (question.get('open') is True and
                        isinstance(question.get('call'), dict) and question['call'].get('kind') == 'action'):
                    continue  # Unknown refresh cannot resolve/retype a known open action.
                states[(source['home'], node['task'])] = question.get('open') is True
                if question.get('open') is True:
                    entry = {'id': node['task'], 'title': node.get('title') or '',
                             'reason': node.get('reason') or '', 'call': question.get('call') or {}}
                    asked = question.get('asked')
                    if isinstance(asked, dict) and asked.get('precision') in ('instant', 'date'):
                        entry['card_time'] = dict(asked, kind='asked',
                                                  precision='second' if asked['precision'] == 'instant' else 'date')
                    entries.append(entry)
            if entries:
                built, _ = fm.make_cards(home, {'decisions_open': entries}, {}, {}, {}, homes=homes)
                calls.extend(built['captains_call'])
        cols = {column: [] for column, _ in COLUMNS}
        for column, _ in COLUMNS:
            for card in snap.cols.get(column, []):
                try:
                    state = states.get((home_id(self.owner(card)), card.task))
                except Refusal:
                    state = None
                if state is True or (state is False and column == 'captains_call'):
                    continue
                cols[column].append(card)
        cols['captains_call'].extend(calls)
        return cols

    def card(self, key):
        matches = [c for cards in self.view_cards().values() for c in cards
                   if self.key(c) == key]
        if len(matches) != 1:
            raise Refusal('This task changed or is no longer in view. Refresh the board.', 404)
        return matches[0]

    def titles(self):
        """Each task's card title on the board, by task id."""
        cards = [c for cards in self.view_cards().values() for c in cards]
        found = {}
        for card in cards:
            found.setdefault(card.task, card_title(card, {}, self.t))
        # Delivery history already read ahead; never a new Firstmate call.
        # An install row names its source task, so that one comes first.
        rows = [row for rows, *_ in list(self.history_cache.values()) for row in rows
                if isinstance(row, dict) and row.get('id')]
        for row in sorted(rows, key=lambda row: bool(INSTALL_TITLE.fullmatch(str(row.get('title') or '').strip()))):
            found.setdefault(row['id'], record_title(row, self.t, found))
        for card in cards:
            for dep in getattr(card, 'dependencies', []) or []:
                if isinstance(dep, dict) and dep.get('id') and dep.get('title'):
                    found.setdefault(dep['id'], readable_title(dep['title'], found, self.t))
        return found

    def card_json(self, card, titles=None, saved_answers=None):
        owner = None
        try:
            owner = self.owner(card)
        except Refusal:
            pass
        # The card text Firstmate saved now, without waiting for its next slow board read.
        fresh = task_presentation(owner, card.task) if owner and card.task and not fm.is_remote_home(owner) else {}
        if fresh:
            card = copy.copy(card)
            card.flow = dict(getattr(card, 'flow', None) or {}, presentation=fresh)
        context = fm.flow_context(card, translate=self.t)
        activity = fm.card_activity(card)
        if card.bucket != 'captains_call' and (activity['kind'] == 'decision' or context['phase'] == 'human'):
            # A worker asking its supervisor is coordination, not a captain
            # hold. Actual questions arrive through decisions_open or the
            # owner's explicit question.open join above.
            if activity['kind'] == 'decision':
                activity = dict(activity, kind='technical')
            context = dict(context, phase='technical', label=self.t('Coordination pending'),
                           next_action=self.t('Firstmate reviews the declared condition and coordinates the next step.'))
        flow = getattr(card, 'flow', None) or {}
        human = flow.get('presentation') if isinstance(flow.get('presentation'), dict) else {}
        report_state, report_text, report_time = fm.durable_report(card)
        pane = str(getattr(card, 'pane_key', '') or '')
        # The installed Herdr Web supports ?machine=local&pane=…&view=chat.
        # Remote machine mapping is deliberately not guessed from a route label.
        link = ''
        if self.herdr_origin and owner and not fm.is_remote_home(owner) and pane:
            link = self.herdr_origin + '/?' + urlencode({'machine': 'local', 'pane': pane, 'view': 'chat'})
        titles = self.titles() if titles is None else titles
        title = card_title(card, titles, self.t)
        # A dependency reads as its card does on the board, without the
        # address its recorded title may carry.
        dependencies = [{**d, 'title': titles.get(d.get('id')) or readable_title(d['title'], titles, self.t),
                         'original_title': d['title']}
                        if isinstance(d, dict) and d.get('title') else d
                        for d in getattr(card, 'dependencies', []) or []]
        question_summary = None
        answered = bool(getattr(card, 'answered_hidden', False))
        owner_call = getattr(card, 'call', None) or {}
        is_action = card.bucket == 'captains_call' and owner_call.get('kind') == 'action'
        action = None
        if is_action:
            answered = False  # A saved answer/read/ack never completes a chat action.
            action = {'instruction': owner_call['instruction'], 'where': owner_call['where'],
                      'context': owner_call['context'], 'link': owner_call['link'],
                      'error': self.t('Action instructions need confirmation.') if owner_call.get('invalid') else ''}
        elif card.bucket == 'captains_call' and owner:
            try:
                content = self.content(card, owner)
                question_summary = {'question': content['presentation']['decide'],
                                    'context': content['presentation']['about'],
                                    'options': [o for o in content['presentation']['options']
                                                if o['value'] != 'reconcile']}
                answered = answered or self.answer_saved(card, owner, content, saved_answers)
            except Refusal as exc:
                question_summary = {'question': '', 'context': str(exc), 'options': []}
        return {'key': self.key(card), 'task': card.task, 'title': title,
                'original_title': card.title,
                'bucket': card.bucket, 'owner': owner.label if owner else self.t('Unknown crew'),
                'home': home_id(owner) if owner else '', 'context': context,
                'presentation': project(card, context),
                'activity': activity,
                'report': {'state': report_state, 'text': report_text, 'time': self.event_json(report_time)},
                'native': {'state': getattr(card, 'snapshot_state', '') or 'unknown',
                           'detail': getattr(card, 'doing', '') or self.t('No observation recorded.'),
                           'herdr': getattr(card, 'live_status', '') or 'unknown',
                           'source': getattr(card, 'state_source', '') or flow.get('source', ''),
                           'unconfirmed': getattr(card, 'activity_unconfirmed', True),
                           'retained_at': getattr(card, 'retained_at', 0.0)},
                'dependencies': dependencies,
                'project': project_tag(flow.get('project') or human.get('group')),
                'supervisor': getattr(card, 'supervisor', {}) or {},
                'time': self.event_json(getattr(card, 'event_time', None)),
                # Delivered work leads with what the worker said changed.
                'request': human.get('request'), 'outcome': human.get('outcome'),
                'validation_pending': human.get('waiting_for'),
                'summary': (excerpt(human['summary']) if isinstance(human.get('summary'), str) else '')
                           or excerpt(getattr(card, 'delivery_summary', '') or ''),
                'answered': answered,
                'attention_kind': 'action' if is_action else 'question' if card.bucket == 'captains_call' else None,
                'action': action,
                # A structured Captain's Call leads its card with the short question.
                'question': (getattr(card, 'call', None) or {}).get('question', ''),
                'question_summary': question_summary,
                'agent': fm.UI.card_agent_line(card, self.t), 'herdr_url': link}

    def board(self, selected=''):
        snap = self.collector.snapshot()
        chosen = self.home(selected) if selected else None
        homes = self.homes()
        self.warming.set()
        titles = self.titles()
        local = [h for h in homes if not fm.is_remote_home(h)]
        work_sources = [dict(self.deck_controls.current(h), home=home_id(h)) for h in local]
        for h, source in zip(local, work_sources):
            self.answer_files.label_answers(h, source.get('snapshot', {}).get('nodes', []))
        view = self.view_cards(snap, work_sources)
        saved_answers = self.receipts(None, limit=1000)
        built = {}
        for key, _ in COLUMNS:
            cards = [self.card_json(c, titles, saved_answers) for c in view.get(key, [])]
            built[key] = [c for c in cards if c['home'] == selected] if chosen else cards
        # Native/worker coordination never manufactures a captain question.
        # view_cards joins the authoritative dedicated question records.
        columns = [{'id': key, 'title': self.t(title), 'cards': built[key]} for key, title in COLUMNS]
        # This sentinel is an owner integrity gate, never a backlog task. Keep
        # the failure visible without inventing an identity or task controls.
        diagnostics = []
        for column in columns:
            diagnostics.extend({'kind': 'main-inventory', 'home': c['home'],
                                'owner': c['owner'], 'message': c['title'],
                                'detail': c['native']['detail']}
                               for c in column['cards'] if c['task'] == '(main-inventory)')
            column['cards'] = [c for c in column['cards'] if c['task'] != '(main-inventory)']
        sources = []
        for h in homes:
            if chosen and home_id(h) != selected:
                continue
            raw, received, _ = self.collector._raw.get(h.label, ({}, 0, ''))
            error = getattr(self.collector, 'source_errors', {}).get(h.label, '')
            sources.append({'home': home_id(h), 'label': h.label,
                            'received_at': received, 'generated': raw.get('generated', ''),
                            # Last time the Deck confirmed this read is still current.
                            'checked_at': max(received, getattr(self.collector, 'checked', {}).get(h.label, 0)),
                            'error': self.t(error), 'remote': fm.is_remote_home(h),
                            'supervisor': raw.get('supervisor') or {}})
        return {'seq': snap.seq, 'collected_at': snap.collected_at,
                'server_at': time.time(), 'loading': bool(snap.loading),
                'error': self.t(snap.error), 'sources': sources,
                'homes': [{'id': home_id(h), 'label': h.label} for h in homes],
                'columns': columns, 'diagnostics': diagnostics, 'home': selected,
                'deck': {'sources': [source for source in work_sources if not selected or source['home'] == selected]},
                'source_ttl': fm._bearings_ttl()}

    def receipts(self, actor, limit=10):
        directory = self.data_dir / 'answers'
        if not directory.exists():
            return []
        if directory.is_symlink():
            raise Refusal('Deck’s answer folder isn’t safe to use.')
        result = []
        for path in sorted(directory.glob('*.json'))[:1000]:
            if not re.fullmatch(r'[a-f0-9]{64}\.json', path.name):
                continue
            try:
                data = json.loads(fm.delivery_read(str(self.data_dir), str(path), 65536))
                if actor is None or data.get('actor') == actor:
                    result.append({k: v for k, v in data.items() if k not in ('actor', 'payload_hash')})
            except (OSError, ValueError):
                continue
        return sorted((self.present_receipt(r) for r in result), key=lambda r: r.get('at', 0), reverse=True)[:limit]

    @staticmethod
    def question_signature(content):
        # Lifecycle identity distinguishes re-held questions; authored content
        # also distinguishes changed choices within an existing hold.
        return digest({k: content[k] for k in ('title', 'about', 'decide', 'detail', 'background', 'link',
                                             'options', 'recommend', 'freeform', 'freeform_hint', 'close')})

    def answer_saved(self, card, home, content, records=None):
        records = self.receipts(None, limit=1000) if records is None else records
        candidates = [r for r in records if r.get('home') == home_id(home) and r.get('task') == card.task
                      and r.get('saved') is True and (r.get('operation') == 'answer' or
                      (not r.get('operation') and r.get('message') == self.t('Answer saved by Firstmate.')))]
        if not candidates or fm.is_remote_home(home):
            return False
        row = call_row(home, card.task)
        if not row:
            return False  # Unreadable/absent evidence cannot hide a new question.
        identity = row_identity(*row[1:])
        explicitly_closed = (not row[1][0].startswith('- [ ] ') or
                             not re.search(r'\(hold-kind:\s*captain\)', row[1][0]) or
                             re.match(r'##\s+done', row[2], re.I))
        signature = self.question_signature(content)
        for record in candidates:
            if explicitly_closed:
                return True  # Saved answer plus authoritative closed row; operation may still wait.
            if identity and record.get('question_identity') == identity and record.get('question_signature') == signature:
                return True
            # Existing receipts already bind the precise occurrence. No new
            # intake/runtime invocation is needed to compare an old receipt.
            if identity and record.get('occurrence') == self.call_binding(card, home, content, identity)['occurrence']:
                return True
        return False

    def resolve(self, identity, task, view, actor, item=''):
        if not fm.KEY_RE.fullmatch(task) or view not in ('call', 'delivery'):
            raise Refusal('Invalid task link.', 400)
        home = self.home(identity)
        if view == 'delivery':
            try:
                return {'view': 'delivery', 'delivery': self.delivery(identity, task),
                        'notice': self.t('This is the delivery for this task. Deck can’t confirm it’s the one from your notification.') if item else ''}
            except Refusal as exc:
                return {'view': 'unavailable', 'task': task, 'owner': home.label, 'message': self.t(str(exc)), 'receipts': []}
        matches = []
        for card in self.view_cards().get('captains_call', []):
            try:
                if card.task == task and home_id(self.owner(card)) == identity:
                    matches.append(card)
            except Refusal:
                continue
        message = 'This question isn’t waiting anymore. It may be done or changed; check the board.'
        current_key = self.key(matches[0]) if len(matches) == 1 else ''
        occurrence = re.fullmatch(r'hold:([1-9][0-9]{0,8})', item)
        if current_key:
            if not item:
                return {'view': 'call', 'key': current_key}
            try:
                current = self.call_identity(home, task)
                ordinal = int(current.rsplit('#', 1)[1]) + 1
                if occurrence and int(occurrence[1]) == ordinal:
                    return {'view': 'call', 'key': current_key}
                message = 'This link may be for an earlier version of the question. You can open the current one below.'
            except Refusal:
                pass
        if occurrence and not fm.is_remote_home(home):
            try:
                result = subprocess.run(shell_command(endpoint_path(home.path, 'fm-captain-hold.sh'),
                                         'resolved', task, occurrence[1]), env=self.child_env(home),
                                        capture_output=True, text=True, timeout=15,
                                        stdin=subprocess.DEVNULL)
                if result.returncode == 0:
                    message = 'This question is already closed. Opening this link doesn’t send anything again.'
            except (OSError, subprocess.SubprocessError):
                pass
        return {'view': 'unavailable', 'task': task, 'owner': home.label,
                'message': self.t(message), 'current_key': current_key,
                'receipts': [r for r in self.receipts(actor) if r.get('home') == identity and r.get('task') == task]}

    def records(self, home, task='', force=False, max_age=CHANGE_GAP):
        """Delivery rows, read again when Firstmate's records changed.

        The history list also reads again when Firstmate's state changed, at
        most every max_age seconds, and every FULL_READ seconds. Opening one
        delivery reads again only when its sources or its completion receipt
        changed, or always when the sources can't be known.
        """
        identity = home_id(home)
        with self.history_lock:
            rows, note, started, mark, seen = self.history_cache.get(identity, ([], '', 0, None, None))
            current, state = history_mark(home), state_mark(home)
            age = time.time() - started
            if (force or not started or current != mark or (task and current is None)
                    or (max_age is not None and (age > FULL_READ or (state != seen and age > max_age)))
                    or (task and changed_since(Path(home.path, 'data', task, 'completion.json'), started))):
                started, clock = time.time(), time.monotonic()
                rows, note, complete = fm.delivery_records(home, translate=self.t)
                log_read('history', clock, bool(rows) or complete, 'incomplete')
                self.history_cache[identity] = rows, note, started, current, state
            return rows, note

    def delivered_project(self, home, rows, record, human):
        """A delivery's tag: the project it declared, else its repository's.
        Both are recorded fields; a task id never names a project."""
        # The board's last Firstmate read; history never asks Firstmate again.
        source = self.deck_controls.peek(home) if not fm.is_remote_home(home) else {}
        if source.get('available'):
            nodes = source['snapshot']['nodes']
            repo = str(record.get('repo') or '')
            declared_key = record.get('project')
            declared_key = declared_key.get('id') if isinstance(declared_key, dict) else declared_key
            keys = {str(declared_key or ''), 'project:' + repo if repo else ''}
            task = next((x for x in nodes if x['kind'] == 'task' and x.get('task') == record.get('id')), None)
            visited = set()
            while task and task['kind'] != 'project' and task['id'] not in visited:
                visited.add(task['id'])
                task = next((x for x in nodes if x['id'] == task.get('parent')), None)
            canonical = (task if task and task['kind'] == 'project' else None) or next((x for x in nodes if x['kind'] == 'project' and x['id'] in keys), None)
            if canonical:
                return {'id': canonical['id'], 'label': canonical['title']}
        declared = project_tag(record.get('project') or human.get('group'))
        if declared:
            return declared
        identity = home_id(home)
        with self.history_lock:
            seen, links, names = self.repo_cache.get(identity, (None, {}, {}))
        if seen is not rows:
            links, names = repo_names(home, rows)
            with self.history_lock:
                self.repo_cache[identity] = rows, links, names
        repo = str(record.get('repo') or '')
        repo = links.get(repo, repo)
        return project_tag(names.get(repo, repo))

    def history(self, selected='', query=''):
        """The last history built for this selection at once; only a read with
        none waits for a build. A search filters that history."""
        with self.history_lock:
            built = self.histories.get(selected)
            rebuild = built is not None and selected not in self.history_rebuilding
            if rebuild:
                self.history_rebuilding.add(selected)
        if rebuild:
            threading.Thread(target=self.rebuild_history, args=(selected,), daemon=True).start()
        if built is None:
            with self.history_build_lock:
                # A read that waited here takes the history the previous one built.
                with self.history_lock:
                    built = self.histories.get(selected)
                if built is None:
                    built = self.build_history(selected)
        rows, details = built
        result = [row for row, text in rows if query.casefold() in text]
        return {'records': result[:1000], 'omitted': max(0, len(result) - 1000),
                'details': details, 'scope': self.t('Includes everything Firstmate still keeps, not just recent ones.')}

    def rebuild_history(self, selected):
        try:
            with self.history_build_lock:
                self.build_history(selected)
        except Exception:  # A failed rebuild keeps serving the last history.
            pass
        finally:
            with self.history_lock:
                self.history_rebuilding.discard(selected)

    def build_history(self, selected):
        """Build and keep one selection's history with each row's search text;
        the caller holds history_build_lock."""
        # Before the collector loads there are no homes yet; that empty history is never kept.
        loading = self.collector.snapshot().loading
        homes = [self.home(selected)] if selected else self.homes()
        result, details = [], []
        listed = [(home, *self.records(home)) for home in homes]
        titles = self.titles()
        for home, rows, note in listed:
            details.append({'home': home.label, 'source': note})
            # The short ID the board shows (T-…), from the board's last Firstmate snapshot, even a stale one.
            source = self.deck_controls.peek(home) if not fm.is_remote_home(home) else {}
            aliases = {x.get('task'): x.get('alias') for x in (source.get('snapshot') or {}).get('nodes', [])
                       if x.get('kind') == 'task' and x.get('alias')}
            for row in rows:
                human = record_presentation(home, row)
                project = self.delivered_project(home, rows, row, human)
                title = card_field(human.get('card_title'), 'card_title') or record_title(row, self.t, titles)
                text = ' '.join([str(row.get(k) or '') for k in ('id', 'title', 'body', 'artifact')]
                                + [title, aliases.get(row['id'], ''), project['label'] if project else '', (human.get('request') or {}).get('label', '')]).casefold()
                event = fm.producer_card_time(row.get('card_time'), 'landed',
                                              fm.CardTime('Delivered', row.get('closed')))
                result.append(({'task': row['id'], 'title': title, 'alias': aliases.get(row['id']),
                               'home': home_id(home), 'owner': home.label, 'project': project,
                               'request': human.get('request'), 'outcome': human.get('outcome'),
                               'summary': excerpt(human.get('summary') or ''),
                               'time': self.event_json(event), 'closed': row.get('closed') or ''}, text))
        # The order follows the time each row shows, not the raw closing text.
        result.sort(key=lambda item: (newest_first(item[0]['time']), item[0]['task'], item[0]['home']), reverse=True)
        if not loading:
            with self.history_lock:
                self.histories[selected] = result, details
        return result, details

    def delivery(self, identity, task):
        home = self.home(identity)
        if not fm.KEY_RE.fullmatch(task):
            raise Refusal('Invalid task identity.', 400)
        rows, note = self.records(home, task=task, max_age=None)
        matches = [r for r in rows if r['id'] == task]
        if len(matches) != 1:
            raise Refusal('This delivery isn’t in history anymore, or the task was reopened.', 404)
        record = matches[0]
        content = fm.delivery_content(record, home, split_views=True, translate=self.t, report_heading=False)
        if not isinstance(content, dict):
            content = {'summary': '', 'report': '', 'details': content}
        human = record_presentation(home, record)
        title = card_field(human.get('card_title'), 'card_title') or record_title(record, self.t, self.titles())
        # What changed, in the one or two sentences the worker wrote at done;
        # else the delivery's own recap. A generated "no summary yet" says
        # nothing, so the reader opens on the report instead.
        reopened = self.t('The task was reopened; this delivery is historical.')
        notice = reopened if record.get('state') and record['state'] != 'done' else ''
        summary = content['summary'].removeprefix(reopened).strip()
        if any(summary.endswith(self.t(stock)) for stock in (
                'No summary yet. Read the report or ask Firstmate to explain.',
                'There’s only a technical report here, no short summary. See Details or ask Firstmate to explain.')):
            summary = ''
        # A summary that opens by repeating the title repeats the readable one;
        # a PR address in it opens from links instead.
        echoed = fm.readable_markdown(str(record.get('title') or ''))
        if echoed and title_links(echoed) and summary.startswith(echoed):
            summary = title + summary[len(echoed):]
        if isinstance(human.get('summary'), str):
            summary = excerpt(human['summary'], 2000) or summary
        # The report opens on what changed; a receipt it led with folds away.
        source = content.pop('report_source', '')
        report, report_lead = report_parts(source)
        return {'task': task, 'home': identity, 'owner': home.label, 'title': title,
                'original_title': str(record.get('title') or ''),
                'links': title_links(record.get('title')),
                'project': self.delivered_project(home, rows, record, human),
                **content, 'summary': summary, 'notice': notice,
                'report': content['report'] if source else '',
                'report_text': report, 'report_lead': report_lead, 'sources': note,
                'time': self.event_json(fm.producer_card_time(record.get('card_time'), 'landed',
                                                       fm.CardTime('Delivered', record.get('closed'))))}

    def explanation(self, identity, task, status=True):
        home = self.home(identity)
        if not fm.KEY_RE.fullmatch(task):
            raise Refusal('Invalid task identity.', 400)
        rows, _ = self.records(home, force=not status)
        if len([row for row in rows if row['id'] == task]) != 1:
            raise Refusal('This delivery isn’t in history anymore, or the task was reopened.', 404)
        return fm.explanation_request(home, task, status=status, translate=self.t)

    def call_identity(self, home, task, fresh=False, confirm=False):
        """The call's lifecycle identity, reused while its backlog row is unchanged.

        Without Firstmate's value for the current row, an open reads it from
        that row the way Firstmate does, never waiting for a Firstmate call.
        confirm skips that reading and asks Firstmate unless it gave the kept
        value. fresh always asks Firstmate and replaces what was kept, so an
        answer is checked against the live call and a missed change can't
        stick. Once Firstmate contradicts a row reading, or can't confirm the
        call, opening it asks Firstmate again.
        """
        if fm.is_remote_home(home) or not fm.KEY_RE.fullmatch(task):
            raise Refusal('You can’t answer this one from the web. Answer it in Firstmate.')
        key = (home_id(home), task)
        if not fresh and not confirm:
            row = call_row(home, task)
            kept = self.identities.get(key)
            if row and kept and kept[0] == row[0]:
                return kept[1]
            if row and key[0] not in self.rows_contradicted and self.warm_failed.get(key) != row[0]:
                read = row_identity(*row[1:])
                if read:
                    return read
        with self.identity_lock:
            gate = self.identity_gates.setdefault(key, threading.Lock())
        # One Firstmate call per task at a time; a second reader waits for it.
        with gate:
            row = call_row(home, task)
            mark = row[0] if row else None
            kept = self.identities.get(key)
            if not fresh and mark and kept and kept[0] == mark:
                return kept[1]
            try:
                identity = self.open_identity(home, task)
            except Refusal:
                self.identities.pop(key, None)
                if mark:
                    self.warm_failed[key] = mark
                raise
            self.warm_failed.pop(key, None)
            read = row_identity(*row[1:]) if row else None
            if read and read != identity and call_mark(home, task) == mark:
                self.rows_contradicted.add(key[0])
            if mark:
                self.identities[key] = mark, identity
            else:
                self.identities.pop(key, None)
            return identity

    def open_identity(self, home, task):
        script = Path(endpoint_path(home.path, 'fm-captain-hold.sh'))
        try:
            result = subprocess.run(shell_command(script, 'open', task, '--identity'),
                                    env=self.child_env(home), capture_output=True, text=True,
                                    stdin=subprocess.DEVNULL, timeout=15)
        except (OSError, subprocess.SubprocessError):
            raise Refusal('Couldn’t check this question right now. Try again in a moment.')
        identity = result.stdout.strip()
        if result.returncode != 0 or not re.fullmatch(r'[^\s#]+#\d+', identity):
            raise Refusal('This question isn’t open anymore, or it changed. Refresh the board to check.')
        return identity

    @staticmethod
    def child_env(home):
        env = fm._child_env()
        # External intake, never impersonate Root or inherit a worker namespace.
        for key in list(env):
            if key.startswith('FM_') or key in ('CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID',
                                               'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID',
                                               'HERDR_PANE_ID', 'HERDR_TAB_ID', 'HERDR_WORKSPACE_ID'):
                env.pop(key, None)
        env['FM_HOME'] = home.path
        return env

    def content(self, card, home):
        # The confirmed owning home is the active context, never aggregate All.
        snap = self.collector.snapshot()
        content = fm.decision_card_content(card, snap.homes, home, translate=self.t, bearings=snap.bearings)
        if os.path.realpath(content['home_path']) != fm.delivery_home_identity(home):
            raise Refusal('This question belongs to a different crew than expected. Refresh the board.')
        context = fm.flow_context(card, translate=CANONICAL_TEXT)
        if context['phase'] == 'human' and not content.get('about'):
            content['about'] = context['reason']
            content['presentation']['about'] = fm.flow_context(card, translate=self.t)['reason']
        return content

    def ticket(self, key):
        card = self.card(key)
        result = self.card_json(card)
        if card.bucket != 'captains_call' or (getattr(card, 'call', None) or {}).get('kind') == 'action':
            return result
        home = self.owner(card)
        content = self.content(card, home)
        result['call'] = self.call_json(card, home, content)
        return result

    def call_report(self, key):
        """The call's linked report, read under the same rules as a delivery.

        Only a local text file under the owning home's data/<task>/ is read; a
        web link is opened by the browser itself.
        """
        card = self.card(key)
        if card.bucket != 'captains_call':
            raise Refusal('This task has no question waiting.', 404)
        home = self.owner(card)
        link = str(self.content(card, home).get('link') or '').strip()
        if fm.is_remote_home(home):
            raise Refusal('This crew is remote, so its report isn’t here.', 404)
        relative = os.path.relpath(link, os.path.realpath(home.path)) if os.path.isabs(link) else link
        if not link or not re.fullmatch(r'data/[A-Za-z0-9][A-Za-z0-9._-]{0,127}/[^\0\\]+\.(?:md|txt)', relative):
            raise Refusal('This question has no report to open here.', 404)
        try:
            text = fm.delivery_read(home.path, relative, fm.DELIVERY_FILE_LIMIT)
        except FileNotFoundError:
            raise Refusal('The report file isn’t there anymore.', 404)
        except (OSError, ValueError):
            raise Refusal('Couldn’t open this report.', 404)
        return {'path': relative, 'text': fm.delivery_text(text)}

    def call_json(self, card, home, content, fresh=False):
        try:
            identity = self.call_identity(home, card.task, fresh=fresh)
            guarded = self.intake_ready(home, fresh=fresh)
            error = '' if guarded else 'This Firstmate can’t take answers from the web yet. Update Firstmate or answer there.'
        except Refusal as exc:
            identity, error = '', str(exc)
        call = self.call_binding(card, home, content, identity)
        call['presentation'] = content['presentation']
        call['error'] = self.t(error)
        call['answer_limit'] = min(fm.ANSWER_LIMIT, 512)
        call['attachments'] = self.file_answers_ready(home)
        return call

    @staticmethod
    def call_binding(card, home, content, identity):
        call = {k: content[k] for k in ('title', 'about', 'decide', 'detail', 'background', 'link',
                                      'options', 'recommend', 'freeform', 'freeform_hint', 'close')}
        call['identity'] = identity
        call['occurrence'] = digest(home_id(home), card.task, identity, content['stamp'],
                                    fm.flow_context(card, translate=CANONICAL_TEXT)['reason'], call)
        return call

    def intake_ready(self, home, fresh=False):
        mark = file_mark(endpoint_path(home.path, 'fm-captain-hold.sh'))
        kept = self.capabilities.get(home_id(home))
        if not fresh and mark and kept and kept[0] == mark:
            return kept[1]
        return self.guarded_intake(home)

    def guarded_intake(self, home):
        try:
            response = subprocess.run(shell_command(endpoint_path(home.path, 'fm-captain-hold.sh'),
                                       'capabilities', '--json'), env=Board.child_env(home),
                                      capture_output=True, text=True, timeout=10,
                                      stdin=subprocess.DEVNULL)
            data = json.loads(response.stdout)
            self.answer_capabilities[home_id(home)] = data
            return (response.returncode == 0 and data.get('schema') == 'fm-captain-hold.capabilities.v1'
                    and data.get('guarded_input') == 'single-row' and
                    all(command in data.get('expected_identity', []) for command in ('answers', 'reconcile-requests')))
        except (OSError, ValueError, subprocess.SubprocessError):
            return False

    def file_answers_ready(self, home):
        return not fm.is_remote_home(home) and self.answer_capabilities.get(home_id(home), {}).get('attachments') is True

    def corrections_ready(self, home, fresh=False):
        if fm.is_remote_home(home) or not self.intake_ready(home, fresh=fresh):
            return False
        capabilities = self.answer_capabilities.get(home_id(home), {})
        return capabilities.get('correction') is True and 'correct' in capabilities.get('expected_identity', [])

    def submit(self, key, body, actor):
        if not all(isinstance(body.get(k, ''), str) for k in ('value', 'note', 'occurrence', 'request_id')):
            raise Refusal('Invalid answer format.', 400)
        request_id = body.get('request_id', '')
        if not re.fullmatch(r'[a-zA-Z0-9_-]{16,80}', request_id):
            raise Refusal('Something’s missing from this send. Refresh the page and try again.', 400)
        occurrence = body.get('occurrence', '')
        if not re.fullmatch(r'[a-f0-9]{64}', occurrence):
            raise Refusal('This page is missing the question version. Refresh it and try again.', 400)
        # One immutable receipt per occurrence, across clients and server restarts.
        # Lock is held across validation/intake; Firstmate additionally owns CAS.
        if not safe_file_reads():
            raise Refusal('Answering from the web needs Linux or macOS. On Windows, run Deck and Firstmate in WSL.', 503)
        with self.mutation_lock:
            receipt_dir = self.data_dir / 'answers'
            if receipt_dir.is_symlink():
                raise Refusal('Deck’s answer folder isn’t safe to use.')
            path = receipt_dir / (digest(key, occurrence) + '.json')
            payload = [key, occurrence, body.get('value', ''), body.get('note', '')]
            if body.get('attachments'):
                payload.append(body['attachments'])
            payload_hash = digest(*payload)
            if path.exists() or path.is_symlink():
                try:
                    previous = json.loads(fm.delivery_read(str(self.data_dir), str(path), 65536))
                except (OSError, ValueError):
                    raise Refusal('Deck can’t read its record of this answer. Ask Firstmate to check it.')
                if previous.get('payload_hash') != payload_hash or previous.get('actor') != actor:
                    raise Refusal('Another answer was already sent for this question.')
                return self.present_receipt(dict(previous, replay=True))
            card = self.card(key)
            if card.bucket != 'captains_call':
                raise Refusal('The task is no longer waiting for a human answer.')
            if (getattr(card, 'call', None) or {}).get('kind') == 'action':
                raise Refusal('This action must be completed in chat. Reading the card does not resolve it.')
            home = self.owner(card)
            content = self.content(card, home)
            if self.answer_saved(card, home, content):
                raise Refusal('This question already has a saved answer. Check the answer status.')
            call = self.call_json(card, home, content, fresh=True)
            if call['error']:
                raise Refusal(call['error'])
            if not secrets.compare_digest(call['occurrence'], occurrence):
                raise Refusal('The question changed. Look at the new version first.')
            paths = self.answer_files.paths(body.get('attachments', []), actor, key)
            if paths and not call['attachments']:
                raise Refusal('This Firstmate cannot receive attachments yet.', 409)
            value, note = body.get('value', '').strip(), body.get('note', '').strip()
            # The installed keyed intake bounds each field to 512 bytes. Reject
            # rather than silently truncate the captain's words.
            if '\x00' in value + note or (not call['attachments'] and any(ch in value + note for ch in ('\t', '\n', '\r'))):
                raise Refusal('Keep the answer on one line. Nothing was sent.', 400)
            if len(note.encode()) > (4096 if call['attachments'] else min(fm.ANSWER_LIMIT, 512)):
                raise Refusal('That answer is too long. Shorten it and send again.', 400)
            options = content['options']
            if value and value not in [o['value'] for o in options]:
                raise Refusal('That option is no longer available.')
            if (not value and (not call['freeform'] or not (note or paths))):
                raise Refusal('Choose an option or write an answer.', 400)
            if self.content(card, home) != content:
                raise Refusal('The question changed. Look at the new version first.')
            dialog = fm.DecisionDialog(content)
            dialog.selected = next((i for i, opt in enumerate(options) if opt['value'] == value), -1)
            dialog.note = note
            line = dialog.reconcile_line() if value == 'reconcile' else dialog.keyed_line()
            if value != 'reconcile':
                fields = line.split('\t')
                # The optional label is context, not the captain's answer.
                # Preserve every answer byte even with an unusually long title.
                fields[2] = fm._flatten_field(card.title)[:80]
                line = '\t'.join(fields)
            if not call['attachments'] and any(len(field.encode()) > 512 for field in line.split('\t')):
                raise Refusal('Your choice plus note is too long. Shorten the note and send again.', 400)
            # No write until all checks pass. The pending marker is deliberately
            # durable: after an interrupted call retry cannot submit twice.
            receipt_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            receipt = {'request_id': request_id, 'payload_hash': payload_hash, 'actor': actor,
                       'home': home_id(home), 'task': card.task, 'title': card.title, 'occurrence': occurrence,
                       'operation': 'reconcile' if value == 'reconcile' else 'answer',
                       'question_identity': call['identity'], 'question_signature': self.question_signature(content),
                       'note': note, 'attachments': body.get('attachments', []),
                       'at': time.time(), 'saved': None, 'notice': 'unknown',
                       'ack': 'unknown', 'consumed': 'unknown', 'state': 'uncertain',
                       'message': 'Sending started. If the connection dropped, check the answer status before sending again.'}
            self.store_receipt(path, receipt, exclusive=True)
            try:
                args = ['reconcile-requests', '--source-id', fm.DECISION_SOURCE_ID,
                        '--source', fm.DECISION_SOURCE] if value == 'reconcile' else [
                            'answers', '--source', fm.DECISION_SOURCE]
                if value == 'reconcile':
                    script = endpoint_path(home.path, 'fm-captain-hold.sh')
                    binding = subprocess.run(shell_command(script, 'binding', fm.DECISION_SOURCE_ID),
                                             env=self.child_env(home), capture_output=True, text=True,
                                             stdin=subprocess.DEVNULL, timeout=15)
                    if binding.returncode or not binding.stdout.strip():
                        binding = subprocess.run(shell_command(script, 'bind', fm.DECISION_SOURCE_ID),
                                                 env=self.child_env(home), capture_output=True, text=True,
                                                 stdin=subprocess.DEVNULL, timeout=15)
                        if binding.returncode:
                            raise Refusal('Couldn’t register Deck for re-check requests.')
                args += ['--expected-identity', call['identity']]
                if call['attachments'] and value != 'reconcile':
                    text = dialog.display_answer()
                    process = self.answer_files.run(home, card.task, 'answer', text, paths, call['identity'], call['close'])
                else:
                    process = subprocess.run(shell_command(endpoint_path(home.path, 'fm-captain-hold.sh'), *args),
                                             input=line + '\n', text=True, capture_output=True,
                                             env=self.child_env(home), timeout=90)
                output = (process.stdout + '\n' + process.stderr).strip()
                receipt.update(state='saved' if process.returncode == 0 else 'uncertain',
                               saved=True if process.returncode == 0 else None,
                               message=('Saved. Firstmate will check again.' if value == 'reconcile' else
                                        'Answer saved by Firstmate.') if process.returncode == 0 else
                                       'Firstmate didn’t confirm it got your answer. Check the answer status; your draft is safe.',
                               detail=fm.delivery_text(output)[-4000:])
                if process.returncode == 3:
                    try:
                        conflict = json.loads(process.stderr.strip())
                    except ValueError:
                        conflict = {}
                    if conflict.get('error') == 'identity-conflict':
                        receipt.update(state='conflict', saved=False, notice='none',
                                       message='The question changed before saving, so nothing was sent. Your draft is safe.')
                if process.returncode == 0 and value != 'reconcile':
                    # The answer is durable before anything points Firstmate at it.
                    self.store_receipt(path, receipt)
                    primary = self.wake_primary(home, card)
                    if primary:
                        receipt['primary'] = primary
                # Success is durable intake acceptance, never native execution,
                # wake acknowledgement or consumption by the owning agent.
                self.collector.refresh_now()
            except (OSError, subprocess.SubprocessError, Refusal) as exc:
                if receipt.get('saved') is True:
                    receipt['detail'] = str(exc)
                    if value != 'reconcile':
                        receipt.setdefault('primary', 'unreachable')
                else:
                    receipt.update(message='Couldn’t confirm your answer was sent. Check the answer status; your draft is safe.', detail=str(exc))
            self.store_receipt(path, receipt)
            return self.present_receipt(receipt)

    def wake_primary(self, home, card):
        """Point the owning home's Firstmate at an answer its intake recorded.

        The intake queues a wake that only an active supervision cycle reads,
        so an idle primary would not react until its next turn. A mate-owned
        call belongs to its own home's supervision and is never sent here.
        Returns '' when not applicable, else sent or unreachable.
        """
        if (card.owner or '(main)') != '(main)':
            return ''
        _, pane = fm.supervisor_target(home, self.homes(), self.collector.snapshot().agents)
        if not pane:
            return 'unreachable'
        sent, _ = fm.send_to_firstmate(pane, PRIMARY_WAKE.format(task=card.task))
        return 'sent' if sent else 'unreachable'

    def present_receipt(self, receipt):
        # Old receipt messages are bridge-owned text. Only this field is migrated
        # for display; receipt files, authored titles and intake output stay intact.
        return dict(receipt, message=self.i18n.receipt_message(receipt.get("message", "")))

    def store_receipt(self, path, receipt, exclusive=False):
        flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW
        flags |= os.O_EXCL if exclusive else os.O_TRUNC
        fd = os.open(path, flags, 0o600)
        try:
            data = json.dumps(receipt, ensure_ascii=False).encode()
            with os.fdopen(fd, 'wb', closefd=False) as stream:
                stream.write(data)
                stream.flush()
                os.fsync(fd)
        finally:
            os.close(fd)


class Security:
    def __init__(self, port, origin='', users=(), identity_header=''):
        self.local = local_origin(port)
        self.origin = origin.rstrip('/')
        self.users = set(users)
        self.identity_header = identity_header
        self.sessions = {}
        self.lock = threading.Lock()
        if bool(self.origin) != bool(self.identity_header) or bool(self.origin) != bool(self.users):
            raise ValueError('proxy authentication requires CD_WEB_ORIGIN, CD_WEB_IDENTITY_HEADER and CD_WEB_USERS together')
        if self.identity_header and (not re.fullmatch(r'X-[A-Za-z0-9-]+', self.identity_header, re.I | re.ASCII)
                                     or self.identity_header.lower() == 'x-deck-csrf'):
            raise ValueError('CD_WEB_IDENTITY_HEADER must be an X- prefixed header distinct from X-Deck-CSRF')
        if any(not user.strip() or any(ord(c) < 33 or ord(c) > 126 for c in user) for user in self.users):
            raise ValueError('CD_WEB_USERS must contain nonempty ASCII identities without whitespace')
        if self.origin:
            parsed = urlsplit(self.origin)
            if (parsed.scheme != 'https' or not parsed.hostname or parsed.path or
                    parsed.query or parsed.fragment or parsed.username):
                raise ValueError('CD_WEB_ORIGIN must be an exact HTTPS origin without path')

    def check(self, handler, unsafe=False):
        host = handler.headers.get('Host', '')
        origin = handler.headers.get('Origin', '')
        identities = handler.headers.get_all(self.identity_header, []) if self.identity_header else []
        if len(identities) > 1:
            raise Refusal('Ambiguous identity.', 403)
        forwarded = identities[0] if identities else ''
        if host == urlsplit(self.local).netloc and not forwarded:
            expected, actor = self.local, 'local'
        elif self.origin and host == urlsplit(self.origin).netloc and forwarded in self.users:
            expected, actor = self.origin, forwarded
        else:
            raise Refusal('Unauthorized identity or origin.', 403)
        if origin and origin != expected:
            raise Refusal('Unauthorized origin.', 403)
        # A clicked dashboard/notification link may cross sites or schemes,
        # including through a redirect. Permit only the user-activated GET
        # document entry; API reads, subresources, frames and all POSTs keep
        # the cross-site refusal. Host, identity and Origin were checked above.
        document_entry = (
            not unsafe and handler.command == 'GET' and
            urlsplit(handler.path).path in ('/', '/index.html') and
            handler.headers.get('Sec-Fetch-Mode', '') == 'navigate' and
            handler.headers.get('Sec-Fetch-Dest', '') == 'document' and
            handler.headers.get('Sec-Fetch-User', '') == '?1'
        )
        if handler.headers.get('Sec-Fetch-Site', '') == 'cross-site' and not document_entry:
            raise Refusal('Cross-site request rejected.', 403)
        if unsafe and (origin != expected or handler.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
            raise Refusal('The action requires the exact origin and JSON.', 403)
        cookie = http.cookies.SimpleCookie()
        try:
            cookie.load(handler.headers.get('Cookie', ''))
        except http.cookies.CookieError:
            raise Refusal('Invalid session.', 403)
        sid = cookie['deck_session'].value if 'deck_session' in cookie else ''
        with self.lock:
            now = time.time()
            self.sessions = {k: v for k, v in self.sessions.items() if now - v[2] < 43200}
            session = self.sessions.get(sid)
            if not session or session[0] != actor:
                if unsafe:
                    raise Refusal('Your session expired. Refresh the page.', 403)
                sid = secrets.token_urlsafe(32)
                session = (actor, secrets.token_urlsafe(32), now)
                self.sessions[sid] = session
            if unsafe and not secrets.compare_digest(handler.headers.get('X-Deck-CSRF', ''), session[1]):
                raise Refusal('This page is out of date. Refresh it.', 403)
        return actor, session[1], sid, expected.startswith('https:')


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def server_bind(self):
        # HTTPServer resolves its bound address through reverse DNS. This
        # loopback-only service uses an explicit authority in Security and
        # must be ready even when the system hostname resolver is unavailable.
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]

    def __init__(self, address, board, security):
        super().__init__(address, Handler)
        self.board, self.security = board, security
        self.i18n = board.i18n if board is not None else Localization('en')
        # Last built board per home selection; reads serve it while one rebuild runs.
        # A POST changes what the board shows, so it drops them (generation).
        self.boards, self.rebuilding, self.generation = {}, set(), 0
        # What each board was built from, and when: a read rebuilds only when that
        # changed, or every 15 s for live agent activity.
        self.built = {}
        self.boards_lock = threading.Lock()

    def last_board(self, selected):
        """The last built board at once; only a read with none waits for a build."""
        current = self.board.inputs() if hasattr(self.board, 'inputs') else None
        with self.boards_lock:
            data = self.boards.get(selected)
            inputs, at = self.built.get(selected, (None, 0))
            rebuild = (data is not None and selected not in self.rebuilding
                       and (current is None or current != inputs or time.monotonic() - at > 15))
            if rebuild:
                self.rebuilding.add(selected)
        if rebuild:
            threading.Thread(target=self.rebuild_board, args=(selected,), daemon=True).start()
        if data is not None:
            return data
        with READ_LOCK:
            # A read that waited here takes the board the previous one built.
            with self.boards_lock:
                data = self.boards.get(selected)
            return data if data is not None else self.build_board(selected)

    def rebuild_board(self, selected):
        try:
            with READ_LOCK:
                self.build_board(selected)
        except Exception:
            diagnostic('snapshot.error', cause='parse', duration_ms=0, streak=FAILURES)
        finally:
            with self.boards_lock:
                self.rebuilding.discard(selected)

    def forget_boards(self):
        with self.boards_lock:
            self.boards.clear()
            self.generation += 1

    def build_board(self, selected):
        """Build and keep one board; the caller holds READ_LOCK."""
        global FAILURES
        started = time.monotonic()
        generation = self.generation
        inputs = self.board.inputs() if hasattr(self.board, 'inputs') else None
        data = self.board.board(selected)
        with self.boards_lock:
            # A board still loading is cheap and never kept past the first read.
            if generation == self.generation and not data.get('loading'):
                self.boards[selected] = data
                self.built[selected] = inputs, time.monotonic()
        sources = data.get('deck', {}).get('sources', [])
        errors = [x for x in sources if not x.get('available')]
        duration = round((time.monotonic() - started) * 1000)
        log(f'deck build board {duration}ms')
        if errors or data.get('error') or any(x.get('error') for x in data.get('sources', [])):
            FAILURES += 1
            code = errors[0].get('code') if errors else 'parse'
            cause = code if code in ('timeout', 'missing-source', 'busy') else 'parse'
            diagnostic('snapshot.error', cause=cause, duration_ms=duration, streak=FAILURES)
        else:
            FAILURES = 0
            columns = {x['id']: len(x.get('cards', [])) for x in data.get('columns', [])}
            nodes = [n for x in sources for n in x.get('snapshot', {}).get('nodes', [])]
            projects = sum(n.get('kind') == 'project' for n in nodes)
            diagnostic('snapshot.read', tasks=sum(columns.values()), duration_ms=duration,
                       underway=columns.get('underway', 0), awaiting_closure=sum(n.get('state') == 'awaiting-closure' for n in nodes),
                       needs_you=columns.get('captains_call', 0), done=columns.get('landed', 0),
                       projects_received=projects, projects_shown=projects)
        return data


# Route segments a request line may name; ids, files and text print as '*'.
ROUTE_WORDS = {'', 'api', 'health', 'locale', 'board', 'history', 'diagnostics', 'preview', 'trace', 'export',
               'settings', 'apply', 'control', 'upload', 'review', 'receipt', 'receipts', 'resolve', 'ticket',
               'report', 'attachments', 'answers', 'correct', 'file', 'answer', 'delivery', 'explanation',
               'icons'} | {x.name for x in STATIC.iterdir()}


class Handler(BaseHTTPRequestHandler):
    server_version = 'CaptainsDeck/1'
    protocol_version = 'HTTP/1.0'

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def do_GET(self):
        self.handle_request(False)

    def do_POST(self):
        self.handle_request(True)

    def handle_request(self, unsafe):
        self.started, self.age = time.monotonic(), None
        try:
            actor, csrf, sid, secure = self.server.security.check(self, unsafe)
            parsed = urlsplit(self.path)
            path = unquote(parsed.path)
            if '\\' in path or '\x00' in path or any(p in ('.', '..') for p in path.split('/')):
                raise Refusal('Invalid route.', 400)
            query = parse_qs(parsed.query)
            value = lambda key: query.get(key, [''])[0]
            parts = path.strip('/').split('/')
            board = self.server.board
            body = {}
            status = 200
            if unsafe:
                if self.headers.get('Transfer-Encoding'):
                    raise Refusal('Transfer-Encoding is not allowed.', 400)
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= (MAX_FILE * 4 // 3 + 4096 if path.endswith('/upload') else MAX_BODY):
                    raise Refusal('Request is too large or empty.', 413)
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise Refusal('A JSON object is required.', 400)
            if not unsafe and path == '/health':
                data = board.health()
                status = 200 if data['ok'] else 503
            elif not unsafe and path == '/api/locale':
                data = self.server.i18n.client()
            elif not unsafe and path == '/api/events':
                data = board.event_view(value('home'))
            elif not unsafe and path == '/api/board':
                data = dict(self.server.last_board(value('home')))
                data['csrf'] = csrf
                checked = [x.get('checked_at') or 0 for x in data.get('sources', [])]
                self.age = round(time.time() - min(checked)) if checked and min(checked) else None
            elif not unsafe and path == '/api/diagnostics/preview':
                data = {'preview': diagnostics.export(['deck'], preview=True)}
            elif unsafe and path == '/api/diagnostics/trace':
                events = body.get('events')
                allowed = {'card.move', 'card.render', 'anim.start', 'anim.end', 'anim.cancel', 'overlay.show', 'overlay.hide', 'layout', 'reconcile.mismatch'}
                if set(body) != {'events', 'exporting'} or type(body['exporting']) is not bool or not isinstance(events, list) or len(events) > 100:
                    raise Refusal('Invalid trace.', 400)
                clean = []
                for event in events:
                    if not isinstance(event, dict) or event.get('e') not in allowed:
                        raise Refusal('Invalid trace.', 400)
                    schema = diagnostics.EVENTS[event['e']]
                    if set(event) != {'e'} | set(schema):
                        raise Refusal('Invalid trace.', 400)
                    fields = {k: diagnostics._clean(k, kind, event[k], b'validation') for k, kind in schema.items()}
                    if any(v is None for v in fields.values()) or event.get('age', 0) > 600 or ('task' in event and (not isinstance(event['task'], str) or not event['task'].isdigit() or len(event['task']) > 10)):
                        raise Refusal('Invalid trace.', 400)
                    clean.append((event['e'], {k: event[k] for k in schema}))
                with DIAG_LOCK:
                    now = time.monotonic()
                    TRACE_TIMES[:] = [t for t in TRACE_TIMES if t > now - 60]
                    if len(TRACE_TIMES) + len(clean) > 200:
                        raise Refusal('Trace limit reached.', 429)
                    logger = diagnostics.Logger('deck', diagnostics.PRODUCT_VERSION, REVISION)
                    for event, fields in clean:
                        logger.emit(event, **fields)
                    logger.flush()
                    TRACE_TIMES.extend([now] * len(clean))
                data = {'accepted': len(clean)}
            elif unsafe and path == '/api/diagnostics/export':
                data = {'file': str(diagnostics.export(['deck']))}
            elif not unsafe and path == '/api/history':
                data = board.history(value('home'), value('q')[:300])
            elif len(parts) == 3 and parts[:2] == ['api', 'settings'] and not unsafe:
                owner = board.home(parts[2])
                data = {'available': False, 'actions': []} if fm.is_remote_home(owner) else board.relay_settings.source(owner, value('selection'))
            elif len(parts) == 4 and parts[:2] == ['api', 'settings']:
                owner = board.home(parts[2])
                if fm.is_remote_home(owner):
                    raise Refusal('Controls require a local owner.', 403)
                if unsafe and parts[3] in ('preview', 'apply'):
                    data = board.relay_settings.request(owner, parts[3], body)
                else:
                    raise Refusal('Route unavailable.', 404)
            elif len(parts) == 4 and parts[:2] == ['api', 'control']:
                owner = board.home(parts[2])
                if fm.is_remote_home(owner):
                    raise Refusal('Controls require a local owner.', 403)
                operation = parts[3]
                if unsafe and operation == 'upload':
                    data = board.answer_files.upload('control/' + parts[2], body, actor)
                elif (unsafe and operation in ('preview', 'apply', 'review')) or (not unsafe and operation == 'receipt'):
                    if unsafe and body.get('action') == 'scope-removal' and 'attachments' in body and isinstance(body.get('reason', ''), str):
                        # Firstmate's removal note is text: name each attached file on its own line.
                        paths = board.answer_files.paths(body.pop('attachments'), actor, 'control/' + parts[2])
                        body['reason'] = body.get('reason', '').strip() + ''.join('\nAdjunto: ' + str(p) for p in paths)
                    data = board.deck_controls.request(owner, operation,
                        body if unsafe else {'request_id': value('request_id')}, actor)
                else:
                    raise Refusal('Route unavailable.', 404)
            elif not unsafe and path == '/api/receipts':
                data = {'receipts': board.receipts(actor)}
            elif not unsafe and path == '/api/resolve':
                data = board.resolve(value('home'), value('task'), value('view'), actor, value('item')[:160])
            elif len(parts) == 3 and parts[:2] == ['api', 'ticket'] and not unsafe:
                data = board.ticket(parts[2])
            elif len(parts) == 4 and parts[:2] == ['api', 'ticket'] and parts[3] == 'report' and not unsafe:
                data = board.call_report(parts[2])
            elif len(parts) == 4 and parts[:2] == ['api', 'ticket'] and parts[3] == 'upload' and unsafe:
                card = board.card(parts[2])
                if (card.bucket != 'captains_call' or (getattr(card, 'call', None) or {}).get('kind') == 'action'
                        or not board.intake_ready(board.owner(card), fresh=True)
                        or not board.file_answers_ready(board.owner(card))):
                    raise Refusal('This question cannot receive attachments.', 409)
                data = board.answer_files.upload(parts[2], body, actor)
            elif len(parts) == 3 and parts[:2] == ['api', 'attachments'] and not unsafe:
                item, _, content = board.answer_files.uploaded(parts[2], actor)
                self.respond(200, content, item['type'], sid, secure)
                return
            elif len(parts) >= 4 and parts[:2] == ['api', 'answers']:
                home, task = board.home(parts[2]), parts[3]
                if not fm.KEY_RE.fullmatch(task) or fm.is_remote_home(home):
                    raise Refusal('Answer unavailable.', 404)
                if len(parts) == 4 and not unsafe:
                    data = board.answer_files.saved(home, task)
                elif len(parts) == 5 and parts[4] == 'upload' and unsafe:
                    data = board.answer_files.upload(parts[2] + '/' + task, body, actor)
                elif len(parts) == 5 and parts[4] == 'correct' and unsafe:
                    data = board.answer_files.correct(home, task, body, actor)
                elif len(parts) == 6 and parts[4] == 'file' and parts[5].isdigit() and not unsafe:
                    content, mime = board.answer_files.canonical_file(home, task, parts[5])
                    self.respond(200, content, mime, sid, secure)
                    return
                else:
                    raise Refusal('Route unavailable.', 404)
            elif len(parts) == 4 and parts[:2] == ['api', 'ticket'] and parts[3] == 'answer' and unsafe:
                data = board.submit(parts[2], body, actor)
            elif len(parts) in (4, 5) and parts[:2] == ['api', 'delivery']:
                if len(parts) == 4 and not unsafe:
                    data = board.delivery(parts[2], parts[3])
                elif len(parts) == 5 and parts[4] == 'explanation':
                    data = board.explanation(parts[2], parts[3], status=not unsafe)
                else:
                    raise Refusal('Route unavailable.', 404)
            elif not unsafe and path == '/api/timeline':
                owner = board.home(value('home'))
                if fm.is_remote_home(owner):
                    raise Refusal('The activity log needs a local crew.', 403)
                data = timeline.timeline(owner.path, value('tasks').split(',')[:300])
            elif not unsafe and path == '/conversation':
                owner, task = board.home(value('home')), value('task')
                if fm.is_remote_home(owner) or (task in ('.', '..') or not fm.KEY_RE.fullmatch(task)) or not value('n').isdigit():
                    raise Refusal('Invalid conversation link.', 400)
                chat = timeline.conversation(owner.path, task, int(value('n')))
                if not chat:
                    raise Refusal('This conversation isn’t recorded on this computer.', 404)
                self.respond(200, conversation_page(self.server.i18n.t, task, chat, self.server.i18n.locale).encode(), 'text/html; charset=utf-8', sid, secure)
                return
            elif not unsafe and not path.startswith('/api/'):
                rel = path.lstrip('/') or 'index.html'
                try:
                    content = fm.delivery_read(str(STATIC), rel, 2 * 1024 * 1024).encode() if not rel.endswith('.png') else self.read_binary(rel)
                except (OSError, ValueError):
                    raise Refusal('File unavailable.', 404)
                self.respond(200, content, mimetypes.guess_type(rel)[0] or 'application/octet-stream', sid, secure)
                return
            else:
                raise Refusal('Route unavailable.', 404)
            if unsafe and not path.startswith('/api/diagnostics/'):
                self.server.forget_boards()
            self.respond(status, json.dumps(data, ensure_ascii=False).encode(), 'application/json; charset=utf-8', sid, secure)
        except ControlError as exc:
            self.respond(exc.status, json.dumps({'error': self.server.i18n.t(str(exc)), 'code': exc.code,
                                                 'details': exc.details}, ensure_ascii=False).encode())
        except (Refusal, ValueError, json.JSONDecodeError) as exc:
            self.respond(getattr(exc, 'status', 400), json.dumps({'error': self.server.i18n.t(str(exc))}).encode())
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            print(f'bridge request failed: {type(exc).__name__}: {exc}', file=sys.stderr)
            self.respond(500, json.dumps({'error': self.server.i18n.t('Deck hit a problem and couldn’t finish.')}).encode())

    def read_binary(self, relative):
        # Icons are repo-owned static files, never a report path from a client.
        if not re.fullmatch(r'icons/[a-zA-Z0-9-]+\.png', relative):
            raise ValueError('unsafe asset')
        path = STATIC / relative
        if path.is_symlink() or path.parent.is_symlink():
            raise ValueError('symlink asset')
        return path.read_bytes()

    def respond(self, status, content, mime='application/json; charset=utf-8', sid='', secure=False):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if sid:
            self.send_header('Set-Cookie', f'deck_session={sid}; HttpOnly; SameSite=Strict; Path=/' + ('; Secure' if secure else ''))
        self.end_headers()
        try:
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass
        # One line per request: its route without ids or query, status and duration.
        route = '/'.join(x if x in ROUTE_WORDS else '*' for x in urlsplit(self.path).path.split('/'))
        took, age = round((time.monotonic() - getattr(self, 'started', time.monotonic())) * 1000), getattr(self, 'age', None)
        log(f'deck request {self.command} {route} {status} {took}ms' + (f' source_age={age}s' if age is not None else ''))

    def log_message(self, fmt, *args):
        pass  # respond() logs each request without its ids, query or captain text.


def main(argv=None, *, stop_event=None, on_ready=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bind', default=os.environ.get('CD_WEB_BIND', LOOPBACK))
    parser.add_argument('--port', type=int, default=int(os.environ.get('CD_WEB_PORT', '8787')))
    args = parser.parse_args(argv)
    if args.bind != LOOPBACK:
        parser.error('only the numeric loopback address is supported; configure a trusted reverse proxy for remote HTTPS access')
    if not 1024 <= args.port <= 65535:
        parser.error('port must be 1024..65535')
    data = os.environ.get('CD_WEB_DATA', str(private_directory('data')))
    herdr = os.environ.get('CD_WEB_HERDR_ORIGIN', '').rstrip('/')
    if herdr and (urlsplit(herdr).scheme != 'https' or not urlsplit(herdr).hostname or
                  urlsplit(herdr).path or urlsplit(herdr).username or
                  urlsplit(herdr).query or urlsplit(herdr).fragment):
        parser.error('CD_WEB_HERDR_ORIGIN must be an exact HTTPS origin')
    security = Security(args.port, os.environ.get('CD_WEB_ORIGIN', ''),
                        filter(None, os.environ.get('CD_WEB_USERS', '').split(',')),
                        os.environ.get('CD_WEB_IDENTITY_HEADER', ''))
    board = Board(data, herdr)
    try:
        server = Server((args.bind, args.port), board, security)
    except OSError:
        diagnostic('board.start', cause='port')
        raise
    diagnostic('board.start', cause='ok')
    heartbeat_stop = threading.Event()
    def heartbeat():
        while not heartbeat_stop.wait(60):
            diagnostic('board.heartbeat')
    threading.Thread(target=heartbeat, daemon=True).start()
    board.start()
    def prepare():
        # The first page read after a start finds a board already built.
        while board.collector.snapshot().loading:
            if board.stopping.wait(0.5):
                return
        server.rebuild_board('')
    threading.Thread(target=prepare, daemon=True).start()
    stop_reason = {'cause': 'shutdown'}
    def stop(signum, frame):
        stop_reason['cause'] = 'signal'
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    if stop_event is not None:
        def watch_stop():
            stop_event.wait()
            server.shutdown()
        threading.Thread(target=watch_stop, daemon=True).start()
    if on_ready:
        on_ready()
    print(f'Captain’s Deck listening at {security.local}', flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        heartbeat_stop.set()
        board.stop()
        server.server_close()
        diagnostic('board.stop', cause=stop_reason['cause'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
