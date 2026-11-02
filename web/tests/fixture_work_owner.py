"""Test owner only. Does not implement or validate the Firstmate engine."""
import json
import os
from pathlib import Path
import sys

root = Path(os.environ['FM_HOME'])
command = sys.argv[2]
# Simulate a refused/failed observational owner read through the real adapter.
if command in ('capabilities', 'snapshot') and (root / 'work-source-failed').exists():
    sys.exit('fixture owner read unavailable')
raw = json.loads((root / 'work-snapshot.json').read_text())
if command == 'capabilities':
    print(json.dumps({'schema': 'fm-work-capabilities.v1', 'contract_major': 1,
                      'ops': ['set_priority', 'set_pause', 'clear_pause', 'add_dep', 'remove_dep', 'move', 'request_removal'],
                      'features': ['progress', 'safe_point', 'group_dependencies', 'manual_order']}));sys.exit()
if command == 'snapshot':
    print(json.dumps(raw));sys.exit()
if command == 'request-status':
    print((root / ('request-' + sys.argv[4] + '.json')).read_text());sys.exit()
operation = json.load(sys.stdin)
with (root / 'work-calls.jsonl').open('a') as out:
    out.write(json.dumps({'command': command, 'operation': operation}) + '\n')
impact = {'affected': {'running': [], 'queued': [operation['target']], 'waiting_behind': []}, 'still_paused': ['task:integration'], 'sigue_after': raw['sigue']}
if command == 'preview':
    # Explicit typed fixture rejection, not an implementation of cycle checks.
    if operation.get('on') == operation['target']:
        print(json.dumps({'state': 'rejected', 'code': 'self_dependency', 'message': 'Fixture: no puede esperarse a sí misma.', 'impact': dict(impact, cycle_path=[operation['target'], operation['target']])}))
    else:
        print(json.dumps({'impact': impact}))
    sys.exit()
rows = raw['projects'] + raw['subprojects'] + raw['tasks']
row = next(x for x in rows if x['key'] == operation['target'])
if row['rev'] != operation['expected_rev']:
    print(json.dumps({'state': 'conflict', 'code': 'stale_revision', 'message': 'Fixture: la revisión cambió.'}));sys.exit()
result = {'request_id': operation['request_id'], 'state': 'applied', 'message': 'Fixture: confirmado por el propietario desechable.', 'impact': impact}
if operation['op'] == 'set_priority':
    before = row['priority']['own']; row['priority']['own'] = 4 if operation['value'] == 'NA' else operation['value']
    result['undo'] = {'op': 'set_priority', 'target': row['key'], 'value': before, 'expected_rev': 'r2'}
if operation['op'] == 'move':
    order = raw['sigue'];order.remove(row['key']);target = operation.get('before') or operation.get('after');at = order.index(target) + (1 if operation.get('after') else 0);order.insert(at, row['key'])
    if operation.get('adopt_priority') is not None: row['priority']['own'] = operation['adopt_priority']
if operation['op'] == 'request_removal':
    result['state'] = 'received';result['message'] = 'Fixture: recibida; conserva el trabajo.'
if operation['op'] == 'set_pause':
    result['state'] = 'received';result['message'] = 'Fixture: llegando a punto seguro.';row['pause'] = {'own': {'reason': operation['reason']}, 'inherited': None, 'safe_point': 'pending'};row['state'] = 'stopping'
if operation['op'] != 'request_removal':
    row['rev'] = 'r2'
    (root / 'work-snapshot.json').write_text(json.dumps(raw))
(root / ('request-' + operation['request_id'] + '.json')).write_text(json.dumps(result))
print(json.dumps(result))
