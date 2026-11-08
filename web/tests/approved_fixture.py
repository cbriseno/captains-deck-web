#!/usr/bin/env python3
"""Disposable visual/adapter fixture, never a Firstmate acceptance substitute."""
import json
import os
from pathlib import Path
import sys
import time

from fixtures import fixture, bridge

root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
os.environ['HERDR_PLUGIN_STATE_DIR'] = str(root / 'plugin-state')
board, home = fixture(root)
base = Path(home.path)
now = time.time()
known = {'value': '2026-10-30', 'precision': 'date', 'source': 'fixture date'}
updated = {'value': now - 3600, 'precision': 'instant', 'source': 'fixture status'}
unknown = {'value': None, 'precision': 'unknown', 'source': 'not reported'}
projects = [{'key': 'project:deck', 'label': 'Deck privado · fixture', 'visibility': 'private', 'priority': {'own': 0}, 'updated': updated, 'rev': 'r1'},
            {'key': 'project:public', 'label': 'Deck público · fixture', 'visibility': 'public', 'installs': 'project:deck', 'priority': {'own': None}, 'updated': unknown, 'rev': 'r1'}]
subs = [{'key': 'subproject:deck/ux', 'project': 'project:deck', 'label': 'Implementación · fixture', 'priority': {'own': 1}, 'created': known, 'updated': updated, 'rev': 'r1'}]
states = {'ask': 'captain', 'web': 'running', 'dependent': 'waiting_dep', 'integration': 'paused_own', 'next': 'ready', 'demo-research': 'done', 'phone': 'done'}
tasks = []
for column in board.collector.snap.cols.values():
    for card in column:
        state = states[card.task]
        row = {'key': 'task:' + card.task, 'project': 'project:deck', 'subproject': 'subproject:deck/ux', 'title': card.title,
               'state': state, 'priority': {'own': 2}, 'created': known, 'updated': updated, 'rev': 'r1',
               'pause': {'own': {'reason': 'Fixture own pause', 'kind': 'parked'} if state == 'paused_own' else None, 'inherited': None, 'safe_point': 'none'},
               'blocked_by': [], 'frees': {'direct': [], 'chain_count': 0}, 'question': {'open': card.task == 'ask', 'origin_task': 'task:demo-research' if card.task == 'ask' else None}, 'progress': None}
        if state == 'done': row['completed'] = known
        if card.task == 'web': row['progress'] = {'done': 1, 'total': 3, 'steps': [{'label': 'Medido', 'state': 'done'}, {'label': 'Conectar', 'state': 'active'}, {'label': 'Verificar', 'state': 'todo'}]}
        if card.task == 'dependent': row['blocked_by'] = [{'ref': 'task:next', 'by': 'firstmate', 'open': True}, {'ref': 'task:demo-research', 'by': 'captain', 'open': False}];row['root_blocker'] = 'task:next'
        tasks.append(row)
        card.flow = dict(card.flow or {}, project={'id': 'project:deck', 'label': projects[0]['label']})
# A second ready task makes order and cross-priority movement testable.
tasks.append({'key': 'task:second', 'project': 'project:public', 'title': 'Segundo turno · fixture', 'state': 'ready', 'priority': {'own': 3}, 'created': unknown, 'updated': unknown, 'rev': 'r1'})
# The fixture projects the additive owner contract; it does not allocate real aliases.
projects[0]['alias'] = 'P-7K4'
public = projects.pop();public.update(alias='S-9M2', project='project:deck', kind='subproject', parent='project:deck')
subs.append(public);subs[0]['alias'] = 'S-3R8'
for index, row in enumerate(tasks):
    row['alias'] = 'T-7' + '23456789'[index // 8] + '23456789'[index % 8]
    if row.get('project') == 'project:public': row.update(project='project:deck', subproject='project:public')
for row in tasks:
    current = row.get('progress') is not None
    row.update(progress_evidence={'freshness': 'current' if current else 'missing',
                                 'current': current, 'reported_at': '2026-11-01T05:00:00Z' if current else None,
                                 'reasons': [], 'source': 'task.progress.checkpoint', 'applicable_gates': []},
               declared_progress=dict(row['progress'], updated='2026-11-01T05:00:00Z') if current else None,
               phase='implementation' if current else None, verified_gates={})
if os.environ.get('CD_TEST_PROGRESS') == '1':
    by_task = {row['key']: row for row in tasks}
    prior = {'done': 4, 'total': 7, 'updated': '2026-10-31T20:00:00Z',
             'steps': [{'label': 'Earlier scope', 'state': 'done'}, {'label': 'Old follow-up', 'state': 'active'}]}
    for key, freshness, phase in [('dependent', 'stale', 'rebase'),
                                  ('integration', 'missing', 'branch-ready'),
                                  ('next', 'unknown', 'activation'),
                                  ('second', 'invalid', 'integration')]:
        row = by_task['task:' + key]
        row.update(progress=None, declared_progress=prior if freshness in ('stale', 'invalid') else None,
                   phase=phase, progress_evidence={'freshness': freshness, 'current': False,
                   'reported_at': None, 'reasons': ['fixture_' + freshness], 'source': 'task.progress.checkpoint',
                   'applicable_gates': []}, verified_gates={'validation': {'head': 'old-fixture-head', 'source': 'fixture'}})
if os.environ.get('CD_TEST_PAUSE') == '1':
    projects.extend([{'key': 'project:stopping', 'label': 'Stopping project', 'rev': 'r1'},
                     {'key': 'project:stopping-inherited', 'label': 'Group pause pending', 'rev': 'r1', 'pause': {'reason': 'Group pause'}},
                     {'key': 'project:empty', 'label': 'Empty project', 'rev': 'r1'},
                     {'key': 'project:queue', 'label': 'Pending project', 'rev': 'r1'},
                     {'key': 'project:waiting', 'label': 'Waiting project', 'rev': 'r1'},
                     {'key': 'project:unknown', 'label': 'Unknown project', 'rev': 'r1'},
                     {'key': 'project:own-empty', 'label': 'Paused empty project', 'rev': 'r1',
                      'pause': {'reason': 'Own group pause'}}])
    subs.extend([{'key': 'subproject:stopping', 'parent': 'project:stopping', 'label': 'Stopping subproject', 'rev': 'r1'},
                 {'key': 'subproject:empty', 'parent': 'project:deck', 'label': 'Empty subproject', 'rev': 'r1'},
                 {'key': 'subproject:stopped', 'parent': 'project:deck', 'label': 'Stopped subproject', 'rev': 'r1'},
                 {'key': 'subproject:queue', 'parent': 'project:queue', 'label': 'Pending subproject', 'rev': 'r1'}])
    tasks.extend([
        {'key': 'task:stopping-inherited', 'parent': 'project:stopping-inherited', 'title': 'Inherited pending pause', 'state': 'stopping', 'rev': 'r1',
         'pause': {'own': None, 'inherited': {'from': 'project:stopping-inherited'}, 'safe_point': 'pending'}},
        {'key': 'task:stopping', 'parent': 'subproject:stopping', 'title': 'Stopping task', 'state': 'stopping', 'rev': 'r1',
         'pause': {'own': {'kind': 'parked', 'reason': 'Requested pause'}, 'inherited': None, 'safe_point': 'pending'}},
        {'key': 'task:queued-only', 'parent': 'subproject:queue', 'title': 'Queued without running work', 'state': 'ready', 'rev': 'r1'},
        {'key': 'task:dependency-only', 'parent': 'subproject:queue', 'title': 'Dependency wait', 'state': 'waiting_dep', 'rev': 'r1'},
        {'key': 'task:external-only', 'parent': 'project:waiting', 'title': 'External wait', 'state': 'waiting_external', 'rev': 'r1',
         'pause': {'own': {'kind': 'external', 'reason': 'Existing external wait'}, 'inherited': None}},
        {'key': 'task:unknown-only', 'parent': 'project:unknown', 'title': 'Unknown observation', 'state': 'unknown', 'rev': 'r1'},
        {'key': 'task:paused-unknown', 'parent': 'subproject:stopped', 'title': 'Pause origin missing', 'state': 'paused', 'rev': 'r1'}])
    for key, own, inherited, condition in [
            ('inherited-wait', False, 'subproject:stopped', 'external'),
            ('freeze-wait', False, 'freeze', 'future'),
            ('own-wait', True, 'subproject:stopped', 'captain'),
            ('own-freeze', True, 'freeze', None)]:
        wait = {'kind': condition, 'reason': 'Existing ' + condition} if condition else None
        tasks.append({'key': 'task:' + key, 'parent': 'subproject:stopped', 'title': key,
                      'state': 'paused_own' if own else 'paused_inherited', 'rev': 'r1',
                      'pause': {'own': {'kind': 'parked', 'reason': 'Independent pause'} if own else wait,
                                'inherited': {'from': inherited}, 'condition': wait if own else None}})
snapshot = {'schema': 'fm-work-snapshot.v1', 'projects': projects, 'subprojects': subs, 'tasks': tasks, 'sigue': ['task:next', 'task:second']}
if os.environ.get('CD_TEST_ACTIONS') == '1':
    def creation(age):
        return {'value': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now - age)),
                'precision': 'instant', 'source': 'fixture.creation'}
    by_task = {row['key']: row for row in tasks}
    by_task['task:web']['created'] = creation(12 * 60)
    by_task['task:web']['updated'] = {'value': now - 60, 'precision': 'instant', 'source': 'fixture.update'}
    projects[0]['created'] = creation(3 * 3600)
    subs[0]['created'] = creation(2 * 86400)
    tasks.extend([
        {'key': 'task:chat-action', 'title': 'Autoridad pendiente en el chat', 'alias': 'T-AC2',
         'project': 'project:deck', 'state': 'captain', 'rev': 'r1', 'created': creation(10 * 60),
         'question': {'open': True, 'origin_task': 'task:dependent', 'call': {
             'kind': 'action', 'instruction': 'Indica en el chat la acción concreta que autorizas.',
             'where': 'chat', 'question': None, 'options': [], 'recommended': None,
             'context': 'La lectura de la tarjeta no modifica la autoridad.'}}},
        {'key': 'task:freeform-question', 'title': 'Pregunta abierta real', 'alias': 'T-FR2',
         'project': 'project:deck', 'state': 'captain', 'rev': 'r1',
         'question': {'open': True, 'origin_task': 'task:demo-research', 'call': {
             'question': '¿Qué destino prefieres?', 'options': [], 'context': 'La elección es libre.'}}}])
    by_task['task:dependent']['blocked_by'] = [{'ref': 'task:chat-action', 'by': 'firstmate', 'open': True}]
if os.environ.get('CD_TEST_QUESTIONS') == '1':
    (base / '.tasks.toml').write_text('backend = "markdown"\n[markdown]\npath = "data/backlog.md"\narchive = "data/done-archive.md"\n')
    (base / 'data/backlog.md').write_text('# Fixture backlog\n\n## In flight\n'
        '- [ ] ask - Approval (kind: captain) (hold-kind: captain)\n'
        '  Captain hold set: 2026-10-25T15:00:00Z\n'
        '- [ ] completed-question - Destination (kind: captain) (hold-kind: captain)\n'
        '  Captain hold set: 2026-10-25T15:00:00Z\n')
    by_task = {row['key']: row for row in tasks}
    by_task['task:ask']['question'].update(origin_task='task:dependent', call={
        'question': '¿Autorizas liberar este trabajo?', 'context': 'La tarea conserva su dependencia hasta recibir la respuesta.',
        'options': [{'id': 'yes', 'label': 'Autorizar', 'detail': 'Continúa el trabajo'},
                    {'id': 'later', 'label': 'Esperar', 'detail': 'Conserva la dependencia'}]})
    by_task['task:dependent']['blocked_by'] = [{'ref': 'task:ask', 'by': 'firstmate', 'open': True}]
    # Existing owner primitives: a real independent question with a completed
    # origin, and a worker coordination status with no captain hold.
    tasks.append({'key': 'task:completed-question', 'title': 'Destino pendiente', 'alias': 'T-QR2',
                  'project': 'project:deck', 'state': 'captain', 'rev': 'r1',
                  'question': {'open': True, 'origin_task': 'task:demo-research', 'call': {
                      'question': '¿Qué destino eliges?', 'context': 'Escribe el destino porque la elección es abierta.', 'options': []}}})
    tasks.append({'key': 'task:coordination', 'title': 'Consulta técnica al supervisor', 'alias': 'T-QR3',
                  'project': 'project:deck', 'state': 'running', 'rev': 'r1', 'question': {'open': False}})
    coordination, _ = bridge.fm.make_cards(home, {'in_flight': [{'id': 'coordination',
        'name': 'Consulta técnica al supervisor', 'state': 'parked', 'state_source': 'status-log',
        'flow': {'phase': 'human', 'state': 'waiting', 'reason': 'Primary: confirma la respuesta diagnóstica.'}}]}, {}, {}, {})
    board.collector.snap.cols['underway'].extend(coordination['underway'])
if os.environ.get('CD_TEST_GROUP_ACTIVITY') == '1':
    projects.extend([
        {'key': 'project:activity', 'label': 'Activity fixture', 'rev': 'r1'},
        {'key': 'project:paused-hot', 'label': 'Paused with stale running work', 'rev': 'r1',
         'pause': {'reason': 'Own project pause'}}])
    for key in ('attention', 'action', 'now', 'ready', 'waiting', 'unknown', 'paused', 'finished', 'empty', 'hold'):
        subs.append({'key': 'subproject:activity/' + key, 'parent': 'project:activity',
                     'label': key + ' scope', 'rev': 'r1',
                     **({'pause': {'reason': 'Own subproject pause'}} if key == 'hold' else {})})
    subs.append({'key': 'subproject:paused-hot/child', 'parent': 'project:paused-hot', 'label': 'Inherited pause', 'rev': 'r1'})
    membership = {'ask': 'attention', 'demo-research': 'attention', 'freeform-question': 'attention',
                  'chat-action': 'action', 'web': 'now', 'next': 'ready', 'dependent': 'waiting',
                  'integration': 'paused', 'phone': 'finished'}
    for row in tasks:
        if row['key'].removeprefix('task:') in membership:
            row['parent'] = 'subproject:activity/' + membership[row['key'].removeprefix('task:')]
        if row['key'] == 'task:chat-action':
            row['question']['origin_task'] = 'task:activity-action-origin'
            row['question']['origin'] = {'key': 'task:activity-action-origin',
                                        'title': 'Archived action origin', 'backlog_state': 'done'}
    for key, parent, state in [('activity-unknown', 'subproject:activity/unknown', 'unknown'),
                               ('activity-held', 'subproject:activity/hold', 'running'),
                               ('activity-inherited', 'subproject:paused-hot/child', 'running')]:
        tasks.append({'key': 'task:' + key, 'parent': parent, 'title': key, 'state': state, 'rev': 'r1'})
if os.environ.get('CD_TEST_PAUSE_SIGNALS') == '1':
    tasks.append({'key': 'task:inherited-signal', 'title': 'Pausa heredada · ficticio', 'project': 'project:deck',
                  'state': 'stopping', 'rev': 'r1', 'pause': {'own': None, 'safe_point': 'pending',
                  'inherited': {'from': 'req:demo'}}})
    snapshot.update(rev='r1', crew={'agents_running': 3, 'agents_cap': 6}, pause_controls=[], events=[],
                    requests=[{'id': 'demo', 'scope': 'req:demo', 'key': 'request:demo',
                               'label': 'Preparar entrega · ficticio', 'project': 'project:deck',
                               'tasks': ['task:web', 'task:next'], 'pause': None}])
(base / 'work-snapshot.json').write_text(json.dumps(snapshot))
(base / 'bin/work-owner.py').write_text(Path(__file__).with_name('fixture_work_owner.py').read_text())
p = base / 'bin/fm-tasks-axi.sh'; p.write_text('#!/bin/sh\nexec python3 "$(dirname "$0")/work-owner.py" "$@"\n'); p.chmod(0o755)
if os.environ.get('CD_TEST_INVENTORY') == '1':
    gates, _ = bridge.fm.make_cards(home, {'gates': [{'id': '(main-inventory)',
        'title': 'in-flight backlog item has no child metadata: fixture-missing',
        'reason': 'main inventory', 'owner': '(main)'}]}, {}, {}, {})
    board.collector.snap.cols['charted'].extend(gates['charted'])
    unknown, _ = bridge.fm.make_cards(home, {'in_flight': [{'id': 'unverified-worker',
        'name': 'Unverified observation', 'state': 'unknown', 'state_source': 'none'}]}, {}, {}, {})
    board.collector.snap.cols['underway'].extend(unknown['underway'])
port = int(os.environ.get('CD_TEST_PORT', '0'))
server = bridge.Server((bridge.LOOPBACK, port), board, bridge.Security(port or 8788))
server.security = bridge.Security(server.server_port)
print(f'Fixture at {bridge.local_origin(server.server_port)}', flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
