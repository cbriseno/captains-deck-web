"""Per-request activity log (bitácora) read from records Firstmate already keeps.

Manual procedure this follows, step by step, for each task of a request:
1. When it was created: data/<task>/creation.json.
2. When its agents started: the Claude or Codex transcript whose first lines
   name this task's inbox (state/<task>.inbox), as every Firstmate brief does.
3. What its agent reported: state/<task>.status while it lives, and
   data/<task>/status*.log once teardown archived it (config/status-archive).
4. How it ended: data/<task>/completion.json and presentation.json's summary.
Nothing here writes; missing records simply produce fewer entries.
"""
from __future__ import annotations

import glob
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

STATUS_RE = re.compile(r'^(working|needs-decision|blocked|paused|done|failed|resolved)\b(.*?)\[at=(\d+)\][^:]*:\s?(.*)$')
INBOX_RE = re.compile(r"(?:steering inbox is|durable message files in) [`']?[^`'\s]*/state/([A-Za-z0-9._-]+)\.inbox")
HEAD_LINES = 40
_owners = {}  # transcript path -> task id named in its first lines ('' if none)
_heads = {}  # transcript path -> (first timestamp, model)


def _epoch(text):
    try:
        return datetime.fromisoformat(str(text).replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def _json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _transcripts():
    claude = Path(os.environ.get('CLAUDE_CONFIG_DIR') or Path.home() / '.claude') / 'projects'
    codex = Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex') / 'sessions'
    for path in glob.glob(str(claude / '*' / '*.jsonl')):
        yield 'claude', path
    for path in glob.glob(str(codex / '*' / '*' / '*' / '*.jsonl')):
        yield 'codex', path


def _owner(path):
    if path not in _owners:
        owner = ''
        try:
            with open(path, encoding='utf-8', errors='replace') as handle:
                for number, line in enumerate(handle):
                    if number >= HEAD_LINES:
                        break
                    match = INBOX_RE.search(line)
                    if match:
                        owner = match.group(1)
                        break
        except OSError:
            pass
        _owners[path] = owner
    return _owners[path]


def conversations(tasks, since=0):
    """{task: [(harness, path, started_epoch), ...]} oldest first."""
    found = {}
    for harness, path in _transcripts():
        if since and path not in _owners and os.path.getmtime(path) < since:
            continue
        task = _owner(path)
        if task in tasks:
            found.setdefault(task, []).append((harness, path, os.path.getmtime(path)))
    for rows in found.values():
        rows.sort(key=lambda row: _first(row[1])[0] or row[2])
    return found


def _first(path):
    """(first timestamp, model) of a transcript."""
    if path in _heads:
        return _heads[path]
    stamp = model = None
    try:
        with open(path, encoding='utf-8', errors='replace') as handle:
            for number, line in enumerate(handle):
                if number > 400 or (stamp and model):
                    break
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                stamp = stamp or _epoch(row.get('timestamp'))
                payload = row.get('payload') or {}
                model = model or (row.get('message') or {}).get('model') or payload.get('model') \
                    or (payload.get('thread_settings') or {}).get('model')
    except OSError:
        pass
    _heads[path] = stamp, model
    return _heads[path]


def _status_lines(path, task, source):
    try:
        text = Path(path).read_text(encoding='utf-8', errors='replace')
    except OSError:
        return []
    events = []
    for line in text.splitlines():
        match = STATUS_RE.match(line.strip())
        if match:
            events.append({'at': int(match.group(3)), 'task': task, 'kind': match.group(1),
                           'text': match.group(4).strip(), 'source': source})
    return events


def timeline(home_path, tasks):
    home = Path(home_path)
    tasks = [t for t in dict.fromkeys(tasks) if t not in ('.', '..') and re.fullmatch(r'[A-Za-z0-9._-]{1,120}', t)]
    created = {t: _epoch(_json(home / 'data' / t / 'creation.json').get('created_at')) for t in tasks}
    chats = conversations(set(tasks), min([c for c in created.values() if c] or [0]))
    events, agents = [], {}
    for task in tasks:
        data = home / 'data' / task
        if created[task]:
            events.append({'at': created[task], 'task': task, 'kind': 'created', 'text': '', 'source': 'creation.json'})
        for number, (harness, path, _) in enumerate(chats.get(task, [])):
            stamp, model = _first(path)
            agents.setdefault(task, []).append({'n': number, 'harness': harness, 'model': model or ''})
            if stamp:
                events.append({'at': stamp, 'task': task, 'kind': 'started', 'text': '', 'chat': number,
                               'agent': ' · '.join(x for x in (harness, model) if x), 'source': 'transcript'})
        events += _status_lines(home / 'state' / f'{task}.status', task, 'status')
        for archived in sorted(data.glob('status*.log')):
            events += _status_lines(archived, task, archived.name)
        completion = _json(data / 'completion.json')
        verb = (completion.get('completion') or {}).get('verb')
        at = _epoch(completion.get('at'))
        if verb and at:
            summary = ((_json(data / 'presentation.json').get('presentation') or {}).get('summary') or '').strip()
            events.append({'at': at, 'task': task, 'kind': 'closed', 'text': verb, 'summary': summary,
                           'source': 'completion.json'})
    seen, unique = set(), []
    for event in sorted(events, key=lambda e: e['at']):
        key = (event['task'], event['kind'], int(event['at']), event['text'])
        if key not in seen:
            seen.add(key)
            unique.append(event)
    return {'events': unique, 'agents': agents}


def conversation(home_path, task, number):
    """Text turns of one recorded conversation: [{'role','text','at'}]."""
    created = _epoch(_json(Path(home_path) / 'data' / task / 'creation.json').get('created_at')) or 0
    rows = conversations({task}, created).get(task, [])
    if not 0 <= number < len(rows):
        return None
    harness, path, _ = rows[number]
    turns = []
    with open(path, encoding='utf-8', errors='replace') as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            role, parts = None, []
            if harness == 'claude' and row.get('type') in ('user', 'assistant') and not row.get('isMeta'):
                message = row.get('message') or {}
                role, content = message.get('role'), message.get('content')
                parts = [content] if isinstance(content, str) else \
                    [c.get('text', '') for c in content or [] if isinstance(c, dict) and c.get('type') == 'text']
            elif harness == 'codex' and row.get('type') == 'response_item':
                payload = row.get('payload') or {}
                if payload.get('type') == 'message' and payload.get('role') in ('user', 'assistant'):
                    role = payload['role']
                    parts = [c.get('text', '') for c in payload.get('content') or [] if isinstance(c, dict)]
            text = '\n'.join(p for p in parts if p).strip()
            if role and text and not text.startswith(('<environment_context>', '# AGENTS.md', '<system-reminder>',
                                                      '<command-', '<local-command')):
                turns.append({'role': role, 'text': text, 'at': _epoch(row.get('timestamp'))})
    return {'harness': harness, 'turns': turns}


if __name__ == '__main__':  # python3 web/timeline.py <home> <task>...
    import sys
    result = timeline(sys.argv[1], sys.argv[2:])
    for event in result['events']:
        when = datetime.fromtimestamp(event['at'], timezone.utc).astimezone().strftime('%d %b %H:%M')
        print(when, event['task'][:34].ljust(34), event['kind'].ljust(14), (event.get('agent') or event['text'])[:90])
