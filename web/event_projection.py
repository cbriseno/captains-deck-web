"""One continuously maintained work projection; HTTP reads never scan sources."""
import copy
import importlib
import json
import os
import stat as file_stat
from pathlib import Path
import sys
import threading
import time

from deck_control import project_snapshot


def delta(before, after):
    if before == after:
        return None
    if isinstance(before, dict) and isinstance(after, dict) and before.keys() == after.keys():
        return {'fields': {k: patch for k in after if (patch := delta(before[k], after[k])) is not None}}
    if isinstance(before, list) and isinstance(after, list):
        def key(row):
            if not isinstance(row, dict):
                return None
            return row.get('id') or row.get('key') or (row.get('home', '') + ':' + row['task'] if 'task' in row else row.get('home'))
        if all(key(row) is not None for row in before + after):
            old = {key(row): row for row in before}
            return {'rows': [key(row) for row in after],
                    'values': {key(row): patch for row in after if (patch := delta(old.get(key(row)), row)) is not None}}
    return {'value': after}


class EventProjection:
    def __init__(self, board, homes):
        self.board, self.homes = board, homes
        self.condition = threading.Condition(threading.RLock())
        self.stop_event = threading.Event()
        self.cursor, self.sources, self.readers = time.time_ns(), {}, {}
        self.error, self.loading = '', True
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self.run, daemon=True, name='deck-events')
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        with self.condition:
            self.condition.notify_all()
        if self.thread:
            self.thread.join(10)

    def run(self):
        try:
            for home in self.homes:
                base = self.board.deck_controls.invoke(home, 'bootstrap')
                self.install(home, base)
            with self.condition:
                self.loading = False
                self.publish()
            while not self.stop_event.wait(.1):
                with self.condition:
                    for identity, reader in self.readers.items():
                        if self.read_suffix(reader):
                            self.sources[identity] = self.present(reader)
                            self.publish()
        except Exception as exc:
            with self.condition:
                self.error, self.loading = str(exc), False
                for source in self.sources.values():
                    source['available'], source['error'] = False, self.error
                self.publish()

    def install(self, home, base):
        if base.get('schema') != 'fm-work-bootstrap.v1':
            raise ValueError('Firstmate does not expose the event bootstrap.')
        sys.path.insert(0, str(Path(self.board.endpoint(home)).parent))
        module = importlib.import_module('fm_work_projection')
        reader = dict(home=home, root=str(Path(home.path).resolve()), model=module.Projection(base), offset=base['position'][2],
                      file_id=base['position'][:2], enabled=base['enabled'])
        reader['answerable'] = self.board.guarded_intake(home)
        self.read_suffix(reader)
        identity = self.board.home_identity(home)
        self.readers[identity] = reader
        self.sources[identity] = self.present(reader)

    def read_suffix(self, reader):
        path = Path(reader['home'].path) / 'state/fleet-ledger.jsonl'
        try:
            root = os.open(reader['root'], os.O_RDONLY | os.O_DIRECTORY)
            try:
                state = os.open('state', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
                try:
                    leaf = os.open('fleet-ledger.jsonl', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=state)
                finally:
                    os.close(state)
            finally:
                os.close(root)
            with os.fdopen(leaf, 'rb') as stream:
                stat = os.fstat(stream.fileno())
                if not file_stat.S_ISREG(stat.st_mode):
                    raise ValueError('Event source is not a regular file.')
                file_id = [stat.st_dev, stat.st_ino]
                if reader['file_id'] == [None, None]:
                    reader['file_id'] = file_id
                if reader['file_id'] != file_id or stat.st_size < reader['offset']:
                    raise ValueError('Event continuity was lost. Restart from a canonical base.')
                stream.seek(reader['offset'])
                changed = False
                while True:
                    line = stream.readline()
                    if not line.endswith(b'\n'):
                        break
                    event = json.loads(line)
                    if event.get('home') == reader['root']:
                        changed |= reader['model'].apply(event)
                    reader['offset'] += len(line)
                return changed
        except FileNotFoundError:
            if reader['offset']:
                raise ValueError('Event source disappeared. Restart from a canonical base.')
            return False

    def present(self, reader):
        home, model = reader['home'], reader['model']
        snapshot = project_snapshot(model.value)
        identity = self.board.home_identity(home)
        return dict(home=identity, available=reader['enabled'], snapshot=snapshot, answerable=reader['answerable'],
                    code=None if reader['enabled'] else 'events-disabled',
                    error='' if reader['enabled'] else 'Firstmate event publication is disabled.',
                    capabilities=self.board.deck_controls.invoke(home, 'capabilities') if not hasattr(model, 'capabilities') else model.capabilities)

    def publish(self):
        for identity, source in self.sources.items():
            self.readers[identity]['model'].capabilities = source['capabilities']
            source['capabilities']['actions'] = self.board.deck_controls.actions(source['capabilities'])
            self.board.deck_controls.cache[self.readers[identity]['home'].path] = (0, source)
        self.cursor += 1
        self.condition.notify_all()

    def base(self, selected=''):
        with self.condition:
            self.board.home(selected) if selected else None
            sources = [s for key, s in self.sources.items() if not selected or key == selected]
            columns = {key: [] for key, _ in self.board.columns}
            history = []
            titles = self.board.titles()
            for source in sources:
                model = self.readers[source['home']]['model']
                projects = {n['id']: dict(id=n['id'], label=n['title']) for n in source['snapshot']['nodes'] if n['kind']=='project'}
                for item in source['snapshot']['nodes']:
                    if item['kind'] != 'task':
                        continue
                    task = item['task']
                    human = model.presentations[task]['presentation']
                    bucket = ('captains_call' if (item.get('question') or {}).get('open') else
                              'landed' if item['state'] == 'done' else 'underway' if item['state'] in ('active', 'stopping') else 'charted')
                    columns[bucket].append(self.board.projected_card(source, item, human, bucket, titles, projects))
                    if task in model.history:
                        card = columns[bucket][-1]
                        history.append(dict(task=task, home=source['home'], owner=card['owner'],
                            title=card['title'], alias=item['alias'], project=card['project'],
                            request=item['request'], outcome=item['outcome'], summary=human.get('summary') or '',
                            closed=model.rows[task].get('closed'), time=self.board.projected_time(item['completed_at'])))
            history.sort(key=lambda row: self.board.history_order(row['time'] or {}), reverse=True)
            return dict(cursor=str(self.cursor), csrf='', seq=self.cursor, home=selected,
                loading=self.loading, error=self.error, collected_at=time.time(), server_at=time.time(),
                homes=[dict(id=self.board.home_identity(h), label=h.label) for h in self.homes],
                sources=[dict(home=s['home'], label=next(h.label for h in self.homes if self.board.home_identity(h)==s['home']),
                    checked_at=time.time() if s['available'] and not self.error else 0, error=self.error or s['error']) for s in sources],
                columns=[dict(id=key, title=self.board.t(title), cards=columns[key]) for key,title in self.board.columns],
                deck=dict(sources=copy.deepcopy(sources)), diagnostics=[], history=history)

    def changes(self, cursor, selected):
        # A reconnect receives the current base from the same projection. No
        # second event log or per-browser queue is necessary for replacement values.
        with self.condition:
            self.condition.wait_for(lambda: self.stop_event.is_set() or str(self.cursor) != cursor, timeout=10)
            return self.base(selected) if str(self.cursor) != cursor else None
