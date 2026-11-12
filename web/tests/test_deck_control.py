"""Contract adapter/security checks. Stub owner evidence is not real acceptance."""
import base64
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_bridge as existing
from fixtures import fixture, publish_fixture, bridge
from event_projection import EventProjection
from deck_control import ControlError, DeckControls, project_snapshot, retain_unconfirmed

OWNER = '''import json,os,sys
from pathlib import Path
root=Path(os.environ['FM_HOME']);args=sys.argv[1:];text=sys.stdin.read() if args[1] in ('preview','apply') else ''
with (root/'work-calls.jsonl').open('a') as out:out.write(json.dumps({'args':args,'body':json.loads(text) if text else None,'env':{k:v for k,v in os.environ.items() if k.startswith('FM_') or k=='CODEX_THREAD_ID'}})+'\\n')
responses=json.loads((root/'work-responses.json').read_text())
if args[1]=='bootstrap':
 stat=(root/'state/fleet-ledger.jsonl').stat()
 print(json.dumps({'schema':'fm-work-bootstrap.v1','home':str(root),'position':[stat.st_dev,stat.st_ino,stat.st_size],
                   'enabled':True,'snapshot':responses['snapshot']}))
else:print(json.dumps(responses[args[1]]))
'''


def owner(home):
    root = Path(home.path)
    (root / 'bin/work-owner.py').write_text(OWNER)
    path = root / 'bin/fm-tasks-axi.sh'
    path.write_text('#!/bin/sh\nexec python3 "$(dirname "$0")/work-owner.py" "$@"\n')
    path.chmod(0o755)
    responses = {
        'capabilities': {'schema': 'fm-work-capabilities.v1', 'contract_major': 1,
                         'ops': ['set_priority', 'set_pause'], 'features': ['safe_point']},
        'snapshot': {'schema': 'fm-work-snapshot.v1', 'projects': [], 'subprojects': [], 'tasks': [], 'sigue': []},
        'preview': {'impact': {'affected': {'running': [], 'queued': [], 'waiting_behind': []}}},
        'apply': {'request_id': 'a' * 32, 'state': 'received', 'pending_reason': 'safe point'},
        'request-status': {'request_id': 'a' * 32, 'state': 'applied'},
    }
    (root / 'work-responses.json').write_text(json.dumps(responses))
    return responses


class ProjectionTests(unittest.TestCase):
    def test_external_relaunch_reconciles_stale_resume_for_each_scope(self):
        import copy
        raw = {'projects': [{'key': 'project:deck'}], 'tasks': [
            {'key': 'task:live', 'project': 'project:deck', 'state': 'running',
             'worker_liveness': {'state': 'alive'}}],
            'requests': [{'id': 'work', 'tasks': ['task:live'], 'pause': None}],
            'pause_controls': [{'scope': scope, 'state': 'resuming'} for scope in
                               ('task:live', 'project:deck', 'req:work')]}
        original = copy.deepcopy(raw)
        projected = project_snapshot(raw)
        self.assertEqual(projected['pause_controls'], [])
        for node in projected['nodes']:
            self.assertTrue(node['pause']['can_pause'])
            self.assertNotEqual(node['pause']['state'], 'resuming')
        self.assertEqual(raw, original, 'Projection must preserve owner receipts')

        for state, liveness in [('running', None), ('running', {'state': 'unknown'}),
                                ('ready', {'state': 'dead'}), ('paused_own', {'state': 'alive'})]:
            pending = copy.deepcopy(raw)
            pending['tasks'][0].update(state=state, worker_liveness=liveness)
            self.assertEqual(project_snapshot(pending)['pause_controls'], raw['pause_controls'])
        for extra in [{'key': 'task:missing'}, {'key': 'task:queued', 'state': 'ready'}]:
            pending = copy.deepcopy(raw)
            pending['tasks'].append(dict(extra, project='project:deck'))
            pending['requests'][0]['tasks'].append(extra['key'])
            self.assertEqual(len(project_snapshot(pending)['pause_controls']), 2)
        pending = copy.deepcopy(raw)
        pending['requests'][0]['pause'] = {'reason': 'Still paused'}
        self.assertEqual(project_snapshot(pending)['pause_controls'], [raw['pause_controls'][2]])
        pending['pause_controls'][2]['state'] = 'queued'
        self.assertEqual(project_snapshot(pending)['pause_controls'], [pending['pause_controls'][2]])

    def test_requests_keep_explicit_membership_activity_and_manual_order(self):
        requests = [{'id': 'old', 'tasks': ['task:work'], 'updated_at': '2026-11-01T00:00:00Z'},
                    {'id': 'new', 'tasks': [], 'updated_at': '2026-11-08T00:00:00Z'}]
        request = {'id': 'old', 'label': 'One request', 'project': 'deck'}
        outcome = {'role': 'partial', 'review': 'needed'}
        snapshot = project_snapshot({'requests': requests, 'rev': 'r9', 'tasks': [
            {'key': 'task:work', 'state': 'done', 'request': request, 'outcome': outcome, 'outcome_occurrence': 'result-v1'}]})
        self.assertEqual(snapshot['rev'], 'r9')
        self.assertEqual(snapshot['requests'], requests)
        self.assertEqual(snapshot['nodes'][0]['request'], request)
        self.assertEqual(snapshot['nodes'][0]['outcome'], outcome)
        self.assertEqual(snapshot['nodes'][0]['outcome_occurrence'], 'result-v1')
        self.assertEqual(project_snapshot({'tasks': [{'key': 'task:legacy'}]})['requests'], [])

    def test_shared_review_uses_exact_occurrence_contract_without_work_receipt(self):
        controls = DeckControls(lambda home: {})
        home = type('Home', (), {'path': 'synthetic'})()
        payload = dict(target='task:result', occurrence='result-v1', review='done', expected_review='needed')
        response = dict(ok=True, state='applied', occurrence='result-v1',
                        undo=dict(payload, review='needed', expected_review='done'))
        controls.cache[home.path] = (0, {})
        with patch.object(controls, 'invoke', side_effect=[{'outcome_controls': ['outcome.review']}, response]) as invoke:
            self.assertEqual(controls.request(home, 'review', payload, 'captain'), response)
        self.assertEqual(invoke.call_args_list[1].args, (home, 'outcome.review', payload))
        self.assertNotIn('request_id', payload)
        self.assertEqual(controls.cache[home.path], (0, {}))
        with patch.object(controls, 'invoke', return_value={'ops': []}) as invoke:
            with self.assertRaises(ControlError) as refused:
                controls.request(home, 'review', payload, 'captain')
            self.assertEqual(refused.exception.code, 'unsupported_op')
            self.assertEqual(invoke.call_count, 1)

    def test_pause_signal_projection_preserves_owner_confirmation_and_capacity(self):
        raw = {'projects': [], 'subprojects': [], 'sigue': [], 'tasks': [
            {'key': 'task:held', 'state': 'set_aside'}],
            'pause_controls': [{'scope': 'task:held', 'state': 'queued', 'agents_total': 2,
                                'agents_at_safe_point': 2, 'agents_closed': 2,
                                'reason': 'cap', 'queue_position': 1}],
            'crew': {'agents_running': 6, 'agents_cap': 6},
            'events': [{'event': 'resume.refused', 'scope': 'task:held'}],
            'requests': [{'id': 'delivery', 'scope': 'req:delivery', 'tasks': ['task:held']}]}
        projected = project_snapshot(raw)
        self.assertEqual(projected['nodes'][0]['state'], 'paused')
        self.assertEqual(projected['nodes'][0]['pause']['state'], 'queued')
        for key in ('crew', 'events', 'requests', 'pause_controls'):
            self.assertEqual(projected[key], raw[key])
        self.assertNotIn('can_resume', raw['tasks'][0])

    def test_advertised_signals_use_owner_verbs_and_keep_revision_and_scope(self):
        controls = DeckControls(lambda home: {})
        for action, verbs in {'pause': ('pause.preview', 'pause.request'),
                              'resume': ('resume.preview', 'resume.request'),
                              'cancel-pause': (None, 'pause.cancel'),
                              'dequeue-resume': (None, 'resume.dequeue')}.items():
            for command, verb in zip(('preview', 'apply'), verbs):
                if verb is None:
                    continue
                calls = []
                def invoke(home, command, payload=None):
                    calls.append((command, payload))
                    return ({'ops': ['set_pause', 'clear_pause'], 'signals': list(verbs)}
                            if command == 'capabilities' else
                            {'state': 'received', 'request_id': 'a' * 32})
                with patch.object(controls, 'invoke', side_effect=invoke):
                    controls.request(type('Home', (), {'path': 'synthetic'})(), command,
                                     {'action': action, 'node': 'req:delivery', 'revision': 'r3',
                                      'request_id': 'a' * 32}, 'captain')
                self.assertEqual(calls[-1][0], verb)
                self.assertEqual(calls[-1][1]['scope'], 'req:delivery')
                self.assertEqual(calls[-1][1]['expected_rev'], 'r3')
                self.assertNotIn('op', calls[-1][1])

    def test_unconfirmed_observation_retains_progress_until_confirmed_transition(self):
        def snapshot(state, progress=None):
            return project_snapshot({'projects': [], 'subprojects': [], 'sigue': [], 'tasks': [
                {'key': 'task:t', 'state': state, 'progress': progress,
                 'progress_evidence': {'freshness': 'current', 'current': True} if progress else None}]})
        initial = snapshot('running', {'done': 1, 'total': 5})
        first = retain_unconfirmed(snapshot('unknown'), initial, 100)
        second = retain_unconfirmed(snapshot('unknown'), first, 150)
        self.assertEqual(second['nodes'][0]['state'], 'active')
        self.assertEqual(second['nodes'][0]['progress']['completed'], 1)
        self.assertEqual(second['nodes'][0]['observation_uncertain_since'], 100)
        waiting = retain_unconfirmed(snapshot('waiting_dep'), second, 160)
        self.assertEqual(waiting['nodes'][0]['state'], 'waiting')
        self.assertIsNone(waiting['nodes'][0]['progress'])
        recovered = retain_unconfirmed(snapshot('running', {'done': 2, 'total': 5}), second, 170)
        self.assertNotIn('observation_uncertain_since', recovered['nodes'][0])
        self.assertEqual(recovered['nodes'][0]['progress']['completed'], 2)

    def test_creation_receipt_never_follows_an_earlier_update(self):
        created = {'value': '2026-11-01T14:00:00Z', 'precision': 'instant', 'source': 'task.creation-receipt'}
        updated = {'value': '2026-11-01T03:00:00Z', 'precision': 'instant', 'source': 'work.control'}
        raw = {'projects': [], 'subprojects': [], 'sigue': [], 'tasks': [
            {'key': 'task:t', 'created': created, 'updated': updated}]}
        row = project_snapshot(raw)['nodes'][0]
        self.assertEqual(row['created_at']['value'], updated['value'])
        self.assertEqual(row['updated_at'], updated)
        self.assertEqual(created['value'], '2026-11-01T14:00:00Z')

    def test_pending_pause_classifies_task_and_scope_consistently(self):
        raw = {'projects': [{'key': 'project:p'}],
               'subprojects': [{'key': 'subproject:s', 'parent': 'project:p'}],
               'tasks': [{'key': 'task:t', 'parent': 'subproject:s', 'state': 'running',
                          'pause': {'own': {'kind': 'parked', 'reason': 'Pause'},
                                    'inherited': None, 'safe_point': 'pending'}}], 'sigue': []}
        nodes = {n['id']: n for n in project_snapshot(raw)['nodes']}
        self.assertEqual(nodes['task:t']['state'], 'stopping')
        self.assertTrue(nodes['task:t']['pause']['can_resume'])
        self.assertFalse(nodes['task:t']['pause']['can_pause'])
        for key in ('project:p', 'subproject:s'):
            self.assertFalse(nodes[key]['pause']['can_pause'])
            self.assertEqual(nodes[key]['pause']['disabled_reason'], 'all-stopped')


    def test_progress_checkpoint_evidence_is_preserved_without_historical_fallback(self):
        declared = {'done': 4, 'total': 7, 'steps': [{'label': 'Previous scope', 'state': 'done'}],
                    'updated': '2026-10-31T20:00:00Z'}
        gates = {'validation': {'head': 'old-head', 'source': 'owner.gate'}}
        tasks = []
        for freshness in ('current', 'stale', 'missing', 'unknown', 'invalid'):
            tasks.append({'key': 'task:' + freshness, 'state': 'running', 'alias': 'T-7K4',
                          'progress': {'done': 1, 'total': 3} if freshness == 'current' else None,
                          'declared_progress': declared if freshness == 'stale' else None,
                          'phase': 'branch-ready', 'verified_gates': gates,
                          'progress_evidence': {'freshness': freshness, 'current': freshness == 'current',
                                                'reported_at': None, 'reasons': [],
                                                'source': 'task.progress.checkpoint', 'applicable_gates': []}})
        nodes = project_snapshot({'projects': [], 'subprojects': [], 'tasks': tasks, 'sigue': []})['nodes']
        for node, row in zip(nodes, tasks):
            self.assertEqual(node['progress_evidence'], row['progress_evidence'])
            self.assertEqual(node['declared_progress'], row['declared_progress'])
            self.assertEqual(node['phase'], 'branch-ready')
            self.assertEqual(node['verified_gates'], gates)
            self.assertEqual(node['state'], 'active', 'Ready phase never closes or moves actual work')
            self.assertEqual(node['alias'], 'T-7K4')
            if row['progress'] is None:
                self.assertIsNone(node['progress'])
            else:
                self.assertEqual(node['progress']['completed'], 1)

    def test_alias_and_normalized_parent_preserve_owner_identity(self):
        raw = {'projects': [{'key': 'project:deck', 'alias': 'P-7K4', 'visibility': 'private'}],
               'subprojects': [{'key': 'project:public', 'project': 'project:deck',
                                'alias': 'S-9M2', 'title': 'Public version',
                                'visibility': 'public', 'installs': 'project:deck'}],
               'tasks': [{'key': 'task:work', 'subproject': 'project:public',
                          'alias': 'T-2W8', 'state': 'captain',
                          'question': {'open': True, 'origin_task': 'task:delivered',
                                       'origin': {'key': 'task:delivered', 'completed': True}}}],
               'sigue': []}
        nodes = {row['id']: row for row in project_snapshot(raw)['nodes']}
        self.assertEqual(nodes['project:public']['kind'], 'subproject')
        self.assertIsNone(nodes['project:public']['role'])
        self.assertEqual(nodes['project:deck']['role'], 'installed-private')
        self.assertEqual(nodes['project:public']['parent'], 'project:deck')
        self.assertEqual(nodes['task:work']['parent'], 'project:public')
        self.assertEqual(nodes['task:work']['alias'], 'T-2W8')
        self.assertEqual(nodes['task:work']['task'], 'work')
        self.assertTrue(nodes['task:work']['question']['open'])
        self.assertTrue(nodes['task:work']['question']['origin']['completed'])

    def test_unknown_is_not_na_or_fake_progress_and_order_is_owner_order(self):
        raw = {'projects': [{'key': 'project:pub', 'label': 'Public', 'visibility': 'public', 'installs': 'project:private', 'priority': {'own': None}, 'rev': 'r1'},
                            {'key': 'project:private', 'label': 'Private', 'visibility': 'private', 'rev': 'r2'}],
               'subprojects': [{'key': 'subproject:private/ui', 'project': 'project:private', 'label': 'UI', 'priority': {'own': 4}, 'rev': 'r3'}],
               'tasks': [{'key': 'task:a', 'project': 'project:private', 'subproject': 'subproject:private/ui', 'state': 'paused_own',
                          'pause': {'own': {'reason': 'own', 'kind': 'parked'}, 'inherited': {'from': 'project:private'}, 'safe_point': 'none'},
                          'blocked_by': [{'ref': 'task:finished', 'by': 'captain', 'open': False}], 'rev': 'r4'},
                         {'key': 'task:b', 'project': 'project:private', 'state': 'ready', 'progress': {'done': 1, 'total': 2, 'steps': [{'label': 'Measured', 'state': 'done'}]}}],
               'sigue': ['task:b']}
        projected = project_snapshot(raw); nodes = {x['id']: x for x in projected['nodes']}
        self.assertIsNone(nodes['project:pub']['priority'])
        self.assertTrue(nodes['project:pub']['priority_reported'])
        self.assertFalse(nodes['project:private']['priority_reported'])
        self.assertEqual(nodes['subproject:private/ui']['priority'], 'P4')
        self.assertEqual(nodes['task:a']['parent'], 'subproject:private/ui')
        self.assertEqual(nodes['task:a']['pause']['inherited'], ['project:private'])
        self.assertTrue(nodes['task:a']['pause']['own'])
        self.assertIsNone(nodes['task:a']['progress'])
        self.assertEqual(nodes['task:b']['progress']['completed'], 1)
        self.assertEqual(nodes['task:b']['turn'], 1)
        self.assertTrue(projected['edges'][0]['completed'])
        self.assertNotEqual(nodes['project:pub']['id'], nodes['project:private']['id'])

    def test_inherited_freeze_never_offers_a_silent_scope_resume(self):
        data = {'projects': [{'key':'project:a','pause':{'inherited':True,'from_':'freeze','reason':'Frozen'}}],
                'subprojects': [], 'sigue': [], 'tasks': [
                    {'key':'task:frozen','state':'paused_inherited','pause':{'own':None,'inherited':{'from':'freeze','reason':'Frozen'}}},
                    {'key':'task:external','state':'waiting_external','pause':{'own':{'kind':'external','reason':'External'},'inherited':None}},
                    {'key':'task:child','state':'paused_inherited','pause':{'own':None,'inherited':{'from':'project:a','reason':'Parent'}}}]}
        nodes = {row['id']:row for row in project_snapshot(data)['nodes']}
        self.assertFalse(nodes['project:a']['pause']['own'])
        self.assertEqual(nodes['project:a']['pause']['inherited'],['freeze'])
        self.assertFalse(nodes['project:a']['pause']['can_resume'])
        self.assertFalse(nodes['task:frozen']['pause']['can_resume'])
        self.assertFalse(nodes['task:frozen']['pause']['can_pause'])
        self.assertFalse(nodes['task:external']['pause']['own'])
        self.assertFalse(nodes['task:external']['pause']['can_pause'])
        self.assertFalse(nodes['task:external']['pause']['can_resume'])
        self.assertFalse(nodes['task:child']['pause']['can_resume'])

    def test_independent_pause_keeps_the_open_decision_and_original_condition(self):
        condition = {'kind': 'captain', 'reason': 'Waiting for the existing answer'}
        raw = {'projects': [], 'subprojects': [], 'sigue': [], 'tasks': [
            {'key': 'task:decision', 'state': 'paused_own',
             'pause': {'own': {'kind': 'parked', 'reason': 'Pause separately'},
                       'inherited': None, 'condition': condition},
             'question': {'open': True, 'origin_task': 'task:done'}},
            {'key': 'task:waiting', 'state': 'captain',
             'pause': {'own': {'kind': 'captain'}, 'inherited': None,
                       'condition': condition}, 'question': {'open': True}}]}
        nodes = {row['id']: row for row in project_snapshot(raw)['nodes']}
        self.assertEqual(nodes['task:decision']['state'], 'paused')
        self.assertTrue(nodes['task:decision']['question']['open'])
        self.assertTrue(nodes['task:decision']['pause']['can_resume'])
        self.assertEqual(nodes['task:decision']['pause']['condition'], condition)
        self.assertFalse(nodes['task:waiting']['pause']['can_pause'])
        self.assertFalse(nodes['task:waiting']['pause']['can_resume'])

    def test_pause_scope_uses_descendant_actions_and_preserves_queued_work(self):
        raw = {'projects': [{'key': 'project:empty'}, {'key': 'project:stopped'},
                            {'key': 'project:queue'}, {'key': 'project:own', 'pause': {'reason': 'Own'}}],
               'subprojects': [{'key': 'subproject:empty', 'parent': 'project:empty'},
                               {'key': 'subproject:stopped', 'parent': 'project:stopped'},
                               {'key': 'subproject:queue', 'parent': 'project:queue'},
                               {'key': 'subproject:inherited', 'parent': 'project:own'}],
               'sigue': ['task:queued'], 'tasks': [
                   {'key': 'task:stopped', 'parent': 'subproject:stopped', 'state': 'paused_own',
                    'pause': {'own': {'kind': 'parked'}, 'inherited': None}},
                   {'key': 'task:finished', 'parent': 'subproject:stopped', 'state': 'done'},
                   {'key': 'task:queued', 'parent': 'subproject:queue', 'state': 'ready'},
                   {'key': 'task:dependency', 'parent': 'subproject:queue', 'state': 'waiting_dep'},
                   {'key': 'task:inherited', 'parent': 'subproject:inherited', 'state': 'paused_inherited',
                    'pause': {'own': None, 'inherited': {'from': 'project:own'}}}]}
        nodes = {row['id']: row for row in project_snapshot(raw)['nodes']}
        for key in ('project:empty', 'subproject:empty'):
            self.assertFalse(nodes[key]['pause']['can_pause'])
            self.assertFalse(nodes[key]['pause']['can_resume'])
            self.assertEqual(nodes[key]['pause']['disabled_reason'], 'no-tasks')
        for key in ('project:stopped', 'subproject:stopped'):
            self.assertFalse(nodes[key]['pause']['can_pause'])
            self.assertEqual(nodes[key]['pause']['disabled_reason'], 'all-stopped')
        for key in ('project:queue', 'subproject:queue', 'task:queued', 'task:dependency'):
            self.assertTrue(nodes[key]['pause']['can_pause'], key)
        self.assertTrue(nodes['project:own']['pause']['can_resume'])
        self.assertEqual(nodes['subproject:inherited']['pause']['inherited'], ['project:own'])
        self.assertFalse(nodes['subproject:inherited']['pause']['can_pause'])

    def test_own_group_pause_can_be_removed_even_without_descendant_work(self):
        raw = {'projects': [{'key': 'project:own', 'pause': {'reason': 'Own pause'}}],
               'subprojects': [{'key': 'subproject:own', 'parent': 'project:own',
                                'pause': {'reason': 'Independent pause'}}],
               'tasks': [], 'sigue': []}
        for node in project_snapshot(raw)['nodes']:
            self.assertTrue(node['pause']['can_resume'])
            self.assertFalse(node['pause']['can_pause'])
            self.assertIsNone(node['pause']['disabled_reason'])

    def test_wait_and_inherited_pause_never_enable_a_rejected_clear(self):
        tasks = []
        for kind in ('external', 'captain', 'future', 'dependency'):
            condition = {'kind': kind, 'reason': 'Keep ' + kind}
            for source in ('freeze', 'subproject:resources'):
                for own in (False, True):
                    tasks.append({'key': f'task:{kind}-{source}-{own}', 'state': 'paused_own' if own else 'paused_inherited',
                                  'pause': {'own': {'kind': 'parked'} if own else condition,
                                            'inherited': {'from': source}, 'condition': condition if own else None},
                                  'question': {'open': kind == 'captain'}})
        tasks.append({'key': 'task:own-freeze', 'state': 'paused_own',
                      'pause': {'own': {'kind': 'parked'}, 'inherited': {'from': 'freeze'}, 'condition': None}})
        raw = {'projects': [], 'subprojects': [], 'sigue': [], 'tasks': tasks}
        for node in project_snapshot(raw)['nodes']:
            pause = node['pause']
            self.assertFalse(pause['can_pause'])
            if node['id'] == 'task:own-freeze':
                self.assertFalse(pause['can_resume'])
                self.assertEqual(pause['disabled_reason'], 'freeze-removal')
            else:
                self.assertEqual(pause['can_resume'], pause['own'])
                self.assertEqual(pause['condition']['reason'], 'Keep ' + pause['condition']['kind'])
                self.assertEqual(node['question']['open'], pause['condition']['kind'] == 'captain')
        self.assertNotIn('can_resume', tasks[0]['pause'], 'Never normalize or mutate owner records')


class AdapterHTTPTests(unittest.TestCase):
    setUp = existing.WebTests.setUp
    stop = existing.WebTests.stop
    req = existing.WebTests.req
    init = existing.WebTests.init

    def change(self, action='pause', **fields):
        return {'request_id': 'a' * 32, 'node': 'task:web', 'revision': 'r1', 'action': action, **fields}

    def calls(self):
        p = Path(self.home.path) / 'work-calls.jsonl'
        return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

    def restart_source(self):
        homes=self.board.homes()
        self.board.stop();self.board.deck_controls.cache.clear()
        self.board.projection=EventProjection(self.board,homes)
        self.board.start()
        with self.board.projection.condition:
            self.assertTrue(self.board.projection.condition.wait_for(lambda:not self.board.projection.loading,timeout=10))

    def test_inventory_gate_is_diagnostic_without_suppressing_real_blocked_tasks(self):
        snapshot=json.loads((Path(self.home.path)/'work-snapshot.json').read_text())
        snapshot['main_inventory']={'valid':False,'reason':'in-flight backlog item has no child metadata: missing'}
        snapshot['tasks'].append({'key':'task:real-blocked','title':'Real missing input','state':'waiting_dep',
            'rev':'r1','question':{'open':False},'blocked_by':[{'ref':'task:missing','open':True}]})
        publish_fixture(self.board,self.home,snapshot)
        data = self.init()
        diagnostic, = data['diagnostics']
        self.assertEqual(diagnostic['kind'], 'main-inventory')
        self.assertIn('missing', diagnostic['message'])
        self.assertFalse({'task', 'key', 'alias', 'rev'} & diagnostic.keys())
        cards = [c for column in data['columns'] for c in column['cards']]
        self.assertFalse(any(c['task'] == '(main-inventory)' for c in cards))
        blocked, = [c for c in cards if c['task'] == 'real-blocked']
        self.assertEqual(blocked['activity']['kind'], 'blocked')
        self.assertEqual(blocked['bucket'], 'charted')
        snapshot['main_inventory']={'valid':True,'reason':None}
        publish_fixture(self.board,self.home,snapshot)
        self.assertEqual(self.init()['diagnostics'],[])

    def test_removal_consultation_reason_uses_existing_owner_without_delete(self):
        responses = owner(self.home)
        responses['capabilities']['ops'].append('request_removal')
        (Path(self.home.path) / 'work-responses.json').write_text(json.dumps(responses))
        self.board.deck_controls.cache.clear()
        home = self.init()['homes'][0]['id']
        reason = 'Considering this scope.\nPlease check dependencies first.'
        status, _ = self.req(f'/api/control/{home}/preview', self.change('scope-removal', reason=reason))
        self.assertEqual(status, 200)
        operation = self.calls()[-1]['body']
        self.assertEqual(operation, {'op': 'request_removal', 'target': 'task:web',
                                     'expected_rev': 'r1', 'note': reason, 'actor': 'captain'})
        # Files attached to the consultation reach Firstmate as named paths in the note.
        status, item = self.req(f'/api/control/{home}/upload', {'name': 'captura.txt', 'data': base64.b64encode(b'evidence').decode()})
        self.assertEqual(status, 200)
        status, _ = self.req(f'/api/control/{home}/preview', self.change('scope-removal', reason='Mira esto', attachments=[item['id']]))
        self.assertEqual(status, 200)
        note = self.calls()[-1]['body']['note']
        self.assertTrue(note.startswith('Mira esto\nAdjunto: '))
        self.assertEqual(Path(note.split('Adjunto: ', 1)[1]).read_bytes(), b'evidence')
        self.assertEqual(self.req(f'/api/control/{home}/preview', self.change('scope-removal', attachments=['0' * 32]))[0], 404)
        before = len(self.calls())
        for invalid in ('x' * 2001, 'invalid\x00reason', {'unexpected': 'object'}):
            status, _ = self.req(f'/api/control/{home}/apply', self.change('scope-removal', reason=invalid))
            self.assertEqual(status, 400)
        self.assertEqual(len(self.calls()), before)

    def test_missing_capabilities_keeps_cards_readable_and_controls_disabled(self):
        responses=owner(self.home)
        responses['snapshot']=json.loads((Path(self.home.path)/'work-snapshot.json').read_text())
        responses['capabilities']['ops']=[]
        (Path(self.home.path)/'work-responses.json').write_text(json.dumps(responses))
        self.restart_source()
        data = self.init()
        self.assertTrue(any(c['cards'] for c in data['columns']))
        self.assertEqual(data['deck']['sources'][0]['capabilities']['actions'], [])
        home=data['homes'][0]['id']
        self.assertEqual(self.req(f'/api/control/{home}/apply', self.change())[0], 400)
        self.assertFalse(any(c['args'][1]=='apply' for c in self.calls()))

    def test_authoritative_question_behind_dependency_uses_guarded_native_ticket(self):
        responses = owner(self.home)
        call = {'question':'Real owner question', 'context': 'A genuine approval is required.', 'options':[
            {'id':'yes','label':'Continue','detail':'Keeps the existing intake'},
            {'id':'later','label':'Later','detail':''}], 'recommended':'yes'}
        responses['snapshot']['tasks'] = [{'key':'task:next','title':'Existing blocked task',
            'state':'captain','question':{'open':True,'origin_task':'task:web','call':call,'asked':{'value':'2026-10-31T19:20:00Z','precision':'instant','source':'captain_hold'}}, 'rev':'q1'}]
        responses['snapshot']['tasks'].append({'key': 'task:web', 'title': 'Work stays separate',
            'state': 'waiting_dep', 'question': {'open': False},
            'blocked_by': [{'ref': 'task:next', 'open': True}], 'rev': 'w1'})
        path = Path(self.home.path) / 'work-responses.json'
        path.write_text(json.dumps(responses))
        publish_fixture(self.board,self.home,responses['snapshot'])
        data = self.init()
        cards = next(c['cards'] for c in data['columns'] if c['id']=='captains_call')
        projected = next(c for c in cards if c['task']=='next')
        self.assertEqual(projected['question'],call['question'])
        self.assertEqual([o['value'] for o in projected['inline_call']['options']], ['yes', 'later'])
        self.assertFalse(any(c['task'] == 'web' for c in cards))
        work, = [c for col in data['columns'] if col['id'] == 'charted' for c in col['cards'] if c['task'] == 'web']
        self.assertNotEqual(work['activity']['kind'], 'decision')
        edge, = data['deck']['sources'][0]['snapshot']['edges']
        self.assertEqual((edge['from'], edge['to']), ('task:web', 'task:next'))
        self.assertEqual(projected['time']['source'],'captain_hold')
        before_calls = len(self.calls())
        stamp, cached = self.board.deck_controls.cache[self.home.path]
        self.board.deck_controls.cache[self.home.path] = (0, cached)
        status,ticket = self.req('/api/ticket/'+projected['key'])
        self.assertEqual(len(self.calls()), before_calls, 'Opening a ticket must not trigger a global work scan')
        self.assertEqual(status,200)
        self.assertEqual(ticket['call']['recommend'],'yes')
        self.assertEqual(ticket['call']['about'],call['context'])
        self.assertTrue(ticket['call']['occurrence'])
        responses['snapshot']['tasks'][0]['question']['open'] = False
        path.write_text(json.dumps(responses)); publish_fixture(self.board,self.home,responses['snapshot'])
        cards = next(c['cards'] for c in self.init()['columns'] if c['id']=='captains_call')
        self.assertFalse(any(c['task']=='next' for c in cards))
        self.assertEqual(self.req('/api/ticket/'+projected['key'])[0],404)

    def test_work_commands_sanitized_actor_and_exact_receipt_path(self):
        owner(self.home)
        self.restart_source()
        with patch.dict(os.environ, FM_TASK_ID='never-inherit', FM_SCOPE='worker', CODEX_THREAD_ID='secret'):
            data = self.init()
            source = data['deck']['sources'][0]
            self.assertEqual(source['capabilities']['actions'], ['priority', 'pause'])
            home = source['home']
            status, preview = self.req(f'/api/control/{home}/preview', self.change(reason='Acceptance safe point'))
            self.assertEqual(status, 200)
            status, result = self.req(f'/api/control/{home}/apply', self.change())
            self.assertEqual((status, result['state']), (200, 'received'))
            status, result = self.req(f'/api/control/{home}/receipt?request_id=' + 'a' * 32)
            self.assertEqual((status, result['state']), (200, 'applied'))
        calls = self.calls()
        self.assertEqual(calls[-1]['args'], ['work', 'request-status', '--request-id', 'a' * 32])
        writes = [c for c in calls if c['args'][1] in ('preview', 'apply')]
        self.assertEqual(writes[-1]['body']['op'], 'set_pause')
        self.assertNotIn('request_id', writes[0]['body'])
        self.assertEqual(writes[0]['body']['reason'], 'Acceptance safe point')
        self.assertNotIn('FM_TASK_ID', writes[-1]['env'])
        self.assertNotIn('CODEX_THREAD_ID', writes[-1]['env'])
        self.assertEqual(writes[-1]['env'], {'FM_HOME': self.home.path})
        self.assertEqual(writes[-1]['body']['actor'], 'captain')

    def test_mutations_keep_http_security_and_reject_invalid_commands_before_owner(self):
        owner(self.home); self.board.deck_controls.cache.clear(); home = self.init()['homes'][0]['id']
        count = len(self.calls())
        status, _ = self.req(f'/api/control/{home}/apply', self.change(), headers={'Origin': 'https://attacker.test'})
        self.assertEqual(status, 403)
        status, _ = self.req(f'/api/control/{home}/apply', self.change(), headers={'X-Deck-CSRF': 'wrong'})
        self.assertEqual(status, 403)
        status, _ = self.req(f'/api/control/{home}/apply', self.change('shell'))
        self.assertEqual(status, 400)
        status, _ = self.req(f'/api/control/{home}/apply', self.change('priority', priority='unset'))
        self.assertEqual(status, 400)
        status, _ = self.req(f'/api/control/{home}/apply', self.change(revision=''))
        self.assertEqual(status, 409)
        self.assertEqual(count, len(self.calls()))

    def test_typed_rejections_and_undo_remain_owned(self):
        responses = owner(self.home)
        responses['capabilities']['ops'] += ['clear_pause', 'move']
        responses['apply'] = {'request_id': 'a' * 32, 'state': 'conflict', 'code': 'stale_revision', 'message': 'Changed'}
        (Path(self.home.path) / 'work-responses.json').write_text(json.dumps(responses))
        self.board.deck_controls.cache.clear(); home = self.init()['homes'][0]['id']
        status, result = self.req(f'/api/control/{home}/apply', self.change())
        self.assertEqual((status, result['state'], result['code']), (200, 'conflict', 'stale_revision'))
        undo = {'op': 'clear_pause', 'target': 'task:web', 'expected_rev': 'r2'}
        self.req(f'/api/control/{home}/preview', self.change('undo', undo_operation=undo))
        self.assertEqual(self.calls()[-1]['body']['expected_rev'], 'r2')
        self.assertEqual(self.calls()[-1]['body']['op'], 'clear_pause')
        undo = {'op': 'move', 'target': 'task:web', 'expected_rev': 'r3', 'restore_order': ['task:web', 'task:next'], 'restore_unset': True, 'adopt_priority': None}
        self.req(f'/api/control/{home}/preview', self.change('undo', undo_operation=undo))
        self.assertEqual({k:v for k,v in self.calls()[-1]['body'].items() if k != 'actor'}, undo)
        undo = {'op': 'set_priority', 'target': 'task:web', 'expected_rev': 'r4', 'value': None}
        self.req(f'/api/control/{home}/preview', self.change('undo', undo_operation=undo))
        self.assertIsNone(self.calls()[-1]['body']['value'])

    def test_unknown_major_does_not_enable_controls(self):
        responses = owner(self.home); responses['capabilities']['contract_major'] = 2
        (Path(self.home.path) / 'work-responses.json').write_text(json.dumps(responses))
        self.restart_source()
        self.assertFalse(self.board.health()['ok'])
        self.assertEqual([c['args'][1] for c in self.calls()], ['bootstrap','capabilities'])
        self.init()
        home = self.board.board()['homes'][0]['id']
        status, result = self.req(f'/api/control/{home}/apply', self.change())
        self.assertEqual(status, 503)
        self.assertFalse(any(c['args'][1] == 'apply' for c in self.calls()))


if __name__ == '__main__':
    unittest.main()
