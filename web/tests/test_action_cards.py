"""The explicit owner facet is read-only; no-options still means question."""
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_bridge as existing
from test_deck_control import owner
from deck_control import ControlError


class ActionCardTests(unittest.TestCase):
    setUp = existing.WebTests.setUp
    stop = existing.WebTests.stop
    req = existing.WebTests.req
    init = existing.WebTests.init

    def source(self):
        responses = owner(self.home)
        responses['snapshot']['tasks'] = [
            {'key': 'task:ask', 'title': 'Perform the action in chat', 'alias': 'T-AC2',
             'state': 'captain', 'rev': 'r1', 'question': {'open': True, 'origin_task': 'task:web',
             'answer': {'value': 'allow', 'application': {'state': 'pending'}},
             'call': {'kind': 'action', 'instruction': 'State the concrete action in the chat.', 'where': 'chat',
                      'question': None, 'options': [], 'recommended': None, 'context': 'Reading is not completion.'}}},
            {'key': 'task:next', 'title': 'Genuine freeform question', 'alias': 'T-FR2',
             'state': 'captain', 'rev': 'r1', 'question': {'open': True,
             'call': {'question': 'Which destination?', 'context': 'Explain in your own words.', 'options': []}}},
            {'key': 'task:web', 'title': 'Origin work', 'state': 'waiting_dep', 'rev': 'r1',
             'created': {'value': None, 'precision': 'unknown', 'source': None}, 'question': {'open': False},
             'blocked_by': [{'ref': 'task:ask', 'open': True}]}]
        path = Path(self.home.path) / 'work-responses.json'
        path.write_text(json.dumps(responses)); self.board.deck_controls.cache.clear()
        return responses, path

    def test_action_has_no_answer_form_and_reading_or_old_answer_never_completes_it(self):
        responses, path = self.source()
        for _ in range(2):
            data = self.init()
            cards = [c for col in data['columns'] for c in col['cards']]
            action, = [c for c in cards if c['task'] == 'ask']
            self.assertEqual(action['attention_kind'], 'action')
            self.assertEqual(action['action']['where'], 'chat')
            self.assertFalse(action['answered'])
            self.assertIsNone(action['question_summary'])
            status, detail = self.req('/api/ticket/' + action['key'])
            self.assertEqual(status, 200)
            self.assertNotIn('call', detail)
            self.assertEqual(detail['attention_kind'], 'action')
        _, cached = self.board.deck_controls.cache[self.home.path]
        self.board.deck_controls.cache[self.home.path] = (0, cached)
        with patch.object(self.board.deck_controls, 'invoke', side_effect=ControlError('Owner read unavailable')):
            retained = self.init()
            self.assertFalse(retained['deck']['sources'][0]['available'])
            pending, = [c for col in retained['columns'] if col['id'] == 'captains_call'
                        for c in col['cards'] if c['task'] == 'ask']
            self.assertEqual(pending['attention_kind'], 'action')
        self.board.deck_controls.cache.clear(); self.init()
        status, _ = self.req('/api/ticket/' + action['key'] + '/answer',
                             {'value': 'allow', 'note': '', 'occurrence': 'a' * 64, 'request_id': 'b' * 32})
        self.assertEqual(status, 409)
        self.assertFalse((Path(self.home.path) / 'mutations.jsonl').exists())
        freeform, = [c for c in cards if c['task'] == 'next']
        self.assertEqual(freeform['attention_kind'], 'question')
        self.assertEqual(freeform['question_summary']['options'], [])
        self.assertTrue(self.req('/api/ticket/' + freeform['key'])[1]['call']['freeform'])
        # The consumer observes the owner's explicit closure. It never calls
        # complete-action, reads an ack as completion, or releases origin work.
        responses['snapshot']['tasks'][0]['question']['open'] = False
        responses['snapshot']['tasks'][0]['state'] = 'done'
        path.write_text(json.dumps(responses)); self.board.deck_controls.cache.clear()
        final = self.init()
        self.assertFalse(any(c['task'] == 'ask' for col in final['columns'] if col['id'] == 'captains_call' for c in col['cards']))
        origin, = [n for n in final['deck']['sources'][0]['snapshot']['nodes'] if n['task'] == 'web']
        self.assertEqual(origin['state'], 'waiting')

    def test_creation_precision_is_owned_and_survives_update_state_and_call_kind_changes(self):
        responses, path = self.source()
        instant = {'value': '2026-11-01T14:00:00Z', 'precision': 'instant', 'source': 'owner.creation'}
        legacy = {'value': '2026-11-01', 'precision': 'date', 'source': 'backlog.created'}
        responses['snapshot']['tasks'][0]['created'] = instant
        responses['snapshot']['tasks'][1]['created'] = legacy
        responses['snapshot']['tasks'][2]['created'] = {'value': None, 'precision': 'unknown', 'source': None}
        responses['snapshot']['tasks'][2]['question']['asked'] = {'value': '2026-11-01T15:00:00Z', 'precision': 'instant', 'source': 'hold'}
        for state in ('captain', 'waiting_dep'):
            responses['snapshot']['tasks'][0]['state'] = state
            if state == 'waiting_dep':
                responses['snapshot']['tasks'][0]['question']['call'] = {'question': 'A real new question', 'options': []}
            responses['snapshot']['tasks'][0]['updated'] = {'value': '2026-11-01T15:00:00Z', 'precision': 'instant', 'source': 'update'}
            path.write_text(json.dumps(responses)); self.board.deck_controls.cache.clear()
            nodes = {n['task']: n for n in self.init()['deck']['sources'][0]['snapshot']['nodes']}
            self.assertEqual(nodes['ask']['created_at'], instant)
            self.assertEqual(nodes['next']['created_at'], legacy)
            self.assertEqual(nodes['web']['created_at']['precision'], 'unknown')
