"""HTTP consumer of fm-work-contract.v1; Firstmate owns every work mutation.

No scheduling engine, task queue or direct backlog writes live here. The adapter
projects versioned owner snapshots and invokes only fm-tasks-axi.sh work verbs.
"""
import json
from datetime import datetime
from pathlib import Path
import re
import subprocess
import threading
import time

from deck_platform import endpoint_path, shell_command

ENDPOINT = 'fm-tasks-axi.sh'
OPERATIONS = frozenset(('set_priority', 'set_pause', 'clear_pause', 'add_dep',
                        'remove_dep', 'move', 'request_removal'))
ACTION_OP = {'priority': 'set_priority', 'pause': 'set_pause', 'resume': 'clear_pause',
             'dependency-add': 'add_dep', 'dependency-remove': 'remove_dep',
             'move': 'move', 'scope-removal': 'request_removal',
             'cancel-pause': 'clear_pause', 'dequeue-resume': 'clear_pause'}
SIGNAL_ACTIONS = {'pause': ('pause.preview', 'pause.request'),
                  'resume': ('resume.preview', 'resume.request'),
                  'cancel-pause': (None, 'pause.cancel'),
                  'dequeue-resume': (None, 'resume.dequeue')}


class ControlError(Exception):
    def __init__(self, message, status=409, code='owner_failed', details=None):
        super().__init__(message)
        self.status, self.code, self.details = status, code, details or {}


def consistent_creation(created, updated):
    # Receipts can be written after older work-control updates. Only compare
    # instants: date-only values do not establish an ordering within a day.
    try:
        if created.get('precision') == updated.get('precision') == 'instant':
            c = datetime.fromisoformat(created['value'].replace('Z', '+00:00'))
            u = datetime.fromisoformat(updated['value'].replace('Z', '+00:00'))
            if c > u:
                return dict(updated, source='work.control (creation upper bound)')
    except (AttributeError, KeyError, TypeError, ValueError):
        pass
    return created


def retain_unconfirmed(snapshot, previous, now):
    """Keep the last confirmed running observation across uncertain reads."""
    old = {n['id']: n for n in (previous or {}).get('nodes', [])}
    for node in snapshot['nodes']:
        prior = old.get(node['id'])
        if node['kind'] != 'task' or node['state'] != 'unknown' or not prior or prior['state'] != 'active':
            continue
        node.update(state='active', progress=prior.get('progress'),
                    progress_evidence=prior.get('progress_evidence'),
                    declared_progress=prior.get('declared_progress'), phase=prior.get('phase'),
                    observation_uncertain_since=prior.get('observation_uncertain_since') or now)
    return snapshot


def project_snapshot(raw):
    """Translate field names, preserving unknowns and the owner's ordering.

    This is a presentation projection, not another authority for any state.
    In particular null priority is retained, and never converted to rank 4.
    """
    nodes, edges = [], []
    installed = {row.get('installs') for collection in ('projects', 'subprojects')
                 for row in raw.get(collection, []) if row.get('installs')}
    turns = {key: index + 1 for index, key in enumerate(raw.get('sigue', []))}
    for collection, kind in (('projects', 'project'), ('subprojects', 'subproject'), ('tasks', 'task')):
        for row in raw.get(collection, []):
            key = row['key']
            priority = row.get('priority')
            own_priority = priority.get('own') if isinstance(priority, dict) else None
            pause = row.get('pause')
            structured_pause = isinstance(pause, dict) and ('own' in pause or 'inherited' in pause)
            inherited = pause.get('inherited') if structured_pause else None
            own_pause = pause.get('own') if structured_pause else pause
            if inherited is True:
                inherited = {'from': pause.get('from_', pause.get('from')), 'reason': pause.get('reason')}
            user_pause = bool(own_pause) and (kind != 'task' or own_pause.get('kind') == 'parked')
            foreign_hold = kind == 'task' and bool(own_pause) and not user_pause
            progress = row.get('progress')
            state = row.get('state', 'unknown')
            state = {'running': 'active', 'paused_own': 'paused', 'paused_inherited': 'paused'}.get(state, state)
            if kind == 'task' and state != 'done' and isinstance(pause, dict) and pause.get('safe_point') == 'pending':
                state = 'stopping'
            if state == 'set_aside':
                state = 'paused'
            if state not in ('active', 'stopping', 'paused', 'ready', 'done'):
                state = 'waiting' if state.startswith('waiting') or state == 'captain' else 'unknown'
            node = {'id': key, 'kind': kind, 'parent': (row.get('parent') or row.get('subproject') or row.get('project') or '') if kind != 'project' else '',
                    'task': key.removeprefix('task:') if kind == 'task' else None,
                    'title': row.get('title') or row.get('label'), 'alias': row.get('alias'), 'state': state,
                    'reason': row.get('reason'), 'priority': f'P{own_priority}' if own_priority is not None else None,
                    'priority_reported': isinstance(priority, dict) and 'own' in priority,
                    'rev': row.get('rev'), 'turn': turns.get(key),
                    'role': None if kind == 'subproject' else 'public-fork' if row.get('visibility') == 'public' else 'installed-private' if row.get('visibility') == 'private' and key in installed else row.get('visibility'),
                    'installs': row.get('installs'),
                    'created_at': consistent_creation(row.get('created'), row.get('updated')) if kind == 'task' else row.get('created'), 'updated_at': row.get('updated'), 'completed_at': row.get('completed'),
                    'pause': {'own': user_pause, 'can_resume': user_pause, 'can_pause': not foreign_hold or structured_pause and 'condition' in pause,
                              'condition': (pause.get('condition') if structured_pause else None) or (own_pause if foreign_hold else None), 'inherited': [inherited['from']] if isinstance(inherited, dict) and inherited.get('from') else [],
                              'state': pause.get('safe_point') if isinstance(pause, dict) else None,
                              'reason': own_pause.get('reason') if isinstance(own_pause, dict) else None,
                              'inherited_reason': inherited.get('reason') if isinstance(inherited, dict) else None},
                    'progress': dict(progress, completed=progress.get('done')) if isinstance(progress, dict) else None,
                    'progress_evidence': row.get('progress_evidence'), 'declared_progress': row.get('declared_progress'),
                    'request': row.get('request'), 'outcome': row.get('outcome'),
                    'phase': row.get('phase'), 'verified_gates': row.get('verified_gates'),
                    'question': row.get('question'), 'root_blocker': row.get('root_blocker'), 'frees': row.get('frees'),
                    'raw': row}
            nodes.append(node)
            for edge in row.get('blocked_by', []):
                edges.append({'from': key, 'to': edge['ref'], 'origin': edge.get('by', 'firstmate'), 'completed': edge.get('open') is False})
    # Scope controls describe actual descendant work, never container existence.
    # These are presentation restrictions only; owner guards remain authoritative.
    by_id = {node['id']: node for node in nodes}
    def belongs(task, scope):
        seen = set()
        parent = task.get('parent')
        while parent and parent not in seen:
            if parent == scope:
                return True
            seen.add(parent)
            parent = by_id.get(parent, {}).get('parent')
        return False

    for node in nodes:
        if node['kind'] != 'task':
            continue
        pause = node['pause']
        reason = ('completed' if node['state'] == 'done' else
                  'freeze-removal' if pause['own'] and 'freeze' in pause['inherited'] and not pause['condition'] else
                  None if pause['own'] else
                  'inherited' if pause['inherited'] else
                  'waiting' if pause['condition'] else
                  None if node['state'] in ('active', 'ready', 'stopping') or node['raw'].get('state') == 'waiting_dep' else
                  'unknown')
        pause.update(can_resume=pause['own'] and reason is None,
                     can_pause=pause['can_pause'] and not pause['own'] and node['state'] != 'stopping' and reason is None,
                     disabled_reason=reason)
    for node in nodes:
        if node['kind'] == 'task':
            continue
        tasks = [task for task in nodes if task['kind'] == 'task' and belongs(task, node['id'])]
        pause = node['pause']
        parent, seen = node['parent'], set()
        while not pause['own'] and not pause['inherited'] and parent in by_id and parent not in seen:
            seen.add(parent)
            ancestor = by_id[parent]
            if ancestor['pause']['own']:
                pause['inherited'] = [parent]
            elif ancestor['pause']['inherited']:
                pause['inherited'] = list(ancestor['pause']['inherited'])
            parent = ancestor['parent']
        reason = (None if pause['own'] else
                  'no-tasks' if not tasks else
                  'inherited' if pause['inherited'] else
                  None if any(task['pause']['can_pause'] for task in tasks) else
                  'all-stopped')
        pause.update(can_resume=pause['own'] and reason is None,
                     can_pause=not pause['own'] and reason is None,
                     disabled_reason=reason)
    controls = {p['scope']: p for p in raw.get('pause_controls', [])}
    for node in nodes:
        if node['id'] in controls:
            node['pause'].update(controls[node['id']])
    return {'nodes': nodes, 'edges': edges, 'generated_at': raw.get('generated_at'), 'sigue': raw.get('sigue', []),
            'rev': raw.get('rev'), 'requests': raw.get('requests', []), 'pause_controls': raw.get('pause_controls', []),
            'crew': raw.get('crew'), 'events': raw.get('events', [])}


class DeckControls:
    def __init__(self, child_env):
        self.child_env = child_env
        self.cache = {}
        self.lock = threading.Lock()

    def invoke(self, home, command, payload=None):
        script = endpoint_path(home.path, ENDPOINT)
        if not Path(script).is_file():
            raise ControlError('Firstmate does not expose Deck controls yet.', 503, 'missing-source')
        args = ['work', command]
        if command == 'snapshot':
            args += ['--order', 'manual']
        if command == 'request-status':
            args += ['--request-id', payload['request_id']]
            payload = None
        try:
            result = subprocess.run(shell_command(script, *args),
                                    input=json.dumps(payload, ensure_ascii=False) if payload is not None else None,
                                    env=self.child_env(home), capture_output=True, text=True, timeout=15 if command == 'snapshot' else 8)
        except subprocess.TimeoutExpired as exc:
            raise ControlError('Firstmate took too long.', 503, 'timeout') from exc
        except (OSError, subprocess.SubprocessError) as exc:
            raise ControlError('Firstmate did not confirm the request. Check its receipt before retrying.',
                               503, 'receipt-uncertain') from exc
        if command == 'snapshot' and result.returncode:
            detail = (result.stderr or '').lower()
            if 'busy' in detail:
                raise ControlError('Firstmate is busy.', 503, 'busy')
            if 'no such file' in detail or 'not found' in detail:
                raise ControlError('A Firstmate source is missing.', 503, 'missing-source')
        if len(result.stdout) > 2 * 1024 * 1024:
            raise ControlError('Firstmate returned an oversized Deck response.', 502, 'invalid-response')
        try:
            data = json.loads(result.stdout)
        except (TypeError, ValueError) as exc:
            raise ControlError('Firstmate returned an unreadable Deck response.', 502, 'invalid-response') from exc
        if not isinstance(data, dict) or result.returncode:
            raise ControlError('Firstmate could not complete the request.', 502, 'owner_failed')
        expected_schema = {'capabilities': 'fm-work-capabilities.v1', 'snapshot': 'fm-work-snapshot.v1'}.get(command)
        if expected_schema and data.get('schema') != expected_schema:
            raise ControlError('Firstmate Deck contract version is not supported.', 503, 'version-mismatch')
        if command == 'capabilities' and data.get('contract_major') != 1:
            raise ControlError('Firstmate Deck contract version is not supported.', 503, 'version-mismatch')
        return data

    def peek(self, home):
        # Snapshots are replaced atomically, never mutated in place. Detail
        # reads use the board's last read instead of blocking on its next
        # global owner scan; native question occurrence guards stay live.
        return self.cache.get(home.path, (0, {}))[1]

    def source(self, home):
        with self.lock:
            stamp, data = self.cache.get(home.path, (0, None))
            if data is not None and time.monotonic() - stamp < 3:
                return data
            try:
                capabilities = self.invoke(home, 'capabilities')
                if not isinstance(capabilities.get('ops'), list):
                    raise ControlError('Firstmate capabilities are incomplete.', 503, 'invalid-response')
                raw = self.invoke(home, 'snapshot')
                if any(not isinstance(raw.get(key), list) for key in ('projects', 'subprojects', 'tasks', 'sigue')):
                    raise ControlError('Firstmate snapshot is incomplete.', 503, 'invalid-response')
                # Unsupported operations disable their controls individually.
                actions = [action for action, op in ACTION_OP.items()
                           if (SIGNAL_ACTIONS[action][1] in capabilities.get('signals', [])
                               if action in ('cancel-pause', 'dequeue-resume') else op in capabilities['ops'])]
                data = {'available': True, 'capabilities': dict(capabilities, actions=actions), 'snapshot': retain_unconfirmed(project_snapshot(raw), (data or {}).get('snapshot'), time.time())}
            except (KeyError, TypeError, ValueError, ControlError) as exc:
                data = {'available': False, 'error': str(exc) if isinstance(exc, ControlError) else 'Firstmate snapshot is incomplete.', 'code': exc.code if isinstance(exc, ControlError) else 'invalid-response'}
                previous = self.cache.get(home.path, (0, {}))[1]
                if previous.get('snapshot'):
                    data['snapshot'] = previous['snapshot']
                    data['retained_at'] = previous.get('retained_at') or time.time()
            self.cache[home.path] = time.monotonic(), data
            return data

    @staticmethod
    def operation(body, actor):
        if body.get('action') == 'undo':
            op = body.get('undo_operation')
            if not isinstance(op, dict):
                raise ControlError('Firstmate did not supply an undo operation.', 400, 'invalid_value')
            op = dict(op)
        else:
            action = body.get('action')
            if action not in ACTION_OP:
                raise ControlError('This Deck action is not supported.', 400, 'unsupported_op')
            op = {'op': ACTION_OP[action], 'target': body.get('node'), 'expected_rev': body.get('revision')}
            if action == 'priority':
                value = body.get('priority')
                if value not in ('P0', 'P1', 'P2', 'P3', 'P4'):
                    raise ControlError('Choose a priority.', 400, 'invalid_value')
                op['value'] = 'NA' if value == 'P4' else int(value[1])
            elif action == 'pause':
                reason = body.get('reason', 'Pause requested from Captain’s Deck')
                if not isinstance(reason, str) or not reason.strip() or len(reason) > 512 or any(ord(c) < 32 for c in reason):
                    raise ControlError('Choose a short pause reason.', 400, 'invalid_value')
                op['reason'] = reason.strip()
            elif action in ('dependency-add', 'dependency-remove'):
                op['on'] = body.get('target')
            elif action == 'move':
                if body.get('position') not in ('before', 'after'):
                    raise ControlError('Choose a target turn.', 400, 'invalid_value')
                op[body['position']] = body.get('target')
                priority = body.get('adopt_priority')
                if priority is not None and (type(priority) is not int or not 0 <= priority <= 4):
                    raise ControlError('Choose a valid target priority.', 400, 'invalid_value')
                op['adopt_priority'] = priority
            elif action == 'scope-removal':
                note = body.get('reason', '')
                if not isinstance(note, str) or len(note) > 2000 or '\x00' in note:
                    raise ControlError('Choose a removal consultation reason of up to 2000 characters.', 400, 'invalid_value')
                op['note'] = note.strip() or 'Considering removal from Captain’s Deck; advise before any work is removed.'
        if op.get('op') not in OPERATIONS:
            raise ControlError('This Deck action is not supported.', 400, 'unsupported_op')
        allowed = {'op', 'target', 'expected_rev', 'value', 'reason', 'on', 'before', 'after', 'adopt_priority', 'note'}
        if body.get('action') != 'undo' and set(op) - allowed:
            raise ControlError('Unexpected control fields.', 400, 'invalid_value')
        for key in ('target', 'expected_rev'):
            if not isinstance(op.get(key), str) or not 0 < len(op[key]) <= 200:
                raise ControlError('Refresh the owner snapshot before changing work.', 409, 'stale_revision')
        op.pop('request_id', None)
        # The authenticated web identity has the captain role. The owner
        # records authorship as captain/firstmate, not a login or session id.
        op['actor'] = 'captain'
        return op

    def request(self, home, command, body, actor):
        # Serialize this server's snapshot reads with its controls. The owner
        # still takes its authoritative lock and checks revisions/idempotency.
        with self.lock:
            return self._request(home, command, body, actor)

    def _request(self, home, command, body, actor):
        if command not in ('preview', 'apply', 'receipt') or not isinstance(body, dict):
            raise ControlError('Unknown Deck control operation.', 400, 'invalid_value')
        request_id = body.get('request_id', '')
        if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{16,80}', request_id):
            raise ControlError('A valid request id is required.', 400, 'invalid_value')
        if command == 'receipt':
            self.invoke(home, 'capabilities')
            return self.invoke(home, 'request-status', {'request_id': request_id})
        operation = self.operation(body, actor)
        capabilities = self.invoke(home, 'capabilities')
        if operation['op'] not in capabilities.get('ops', []):
            raise ControlError('This Deck action is not supported.', 400, 'unsupported_op')
        if command == 'apply':
            operation['request_id'] = request_id
        signal = SIGNAL_ACTIONS.get(body.get('action'))
        verb = signal[0 if command == 'preview' else 1] if signal else None
        if verb and verb in capabilities.get('signals', []):
            operation = {k: v for k, v in operation.items() if k != 'op'}
            operation['scope'] = operation['target']
            result = self.invoke(home, verb, operation)
        else:
            if body.get('action') in ('cancel-pause', 'dequeue-resume'):
                raise ControlError('This Deck action is not supported.', 400, 'unsupported_op')
            result = self.invoke(home, command, operation)
        if result.get('code') == 'stale_revision':
            self.cache.pop(home.path, None)
        if command == 'apply':
            if (result.get('state') not in ('received', 'applied', 'rejected', 'conflict', 'failed')
                    or (result.get('state') in ('received', 'applied') and result.get('request_id') != request_id)):
                raise ControlError('Firstmate did not confirm the request. Check its receipt before retrying.', 502, 'receipt-uncertain')
            self.cache.pop(home.path, None)
        return result
