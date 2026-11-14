"""Unheld captain decisions and explicit human waits must remain visible."""
import json
from pathlib import Path

from fixtures import bridge, publish_fixture
import test_bridge as existing


import unittest


class AttentionWaitTests(unittest.TestCase):
    setUp = existing.WebTests.setUp
    stop = existing.WebTests.stop
    req = existing.WebTests.req
    init = existing.WebTests.init
    # Reuse HTTP setup/helpers without collecting the inherited test methods.
    def prepare(self, kind='ship', status='', state='running'):
        self.revision = getattr(self, 'revision', 0) + 1
        snapshot = json.loads((Path(self.home.path) / 'work-snapshot.json').read_text())
        snapshot['tasks'] = [dict(key='task:wait', title='Review the result', state=state,
                                  rev=str(self.revision), question={'open': False})]
        publish_fixture(self.board, self.home, snapshot)
        with self.board.projection.condition:
            model = self.board.projection.readers[bridge.home_id(self.home)]['model']
            model.rows['wait']['kind'] = kind
            model.status['wait'] = status
            model.activity['wait'] = {'state': 'idle'}
            self.board.projection.publish()
        return self.init()['columns']

    def only_card(self, columns):
        return next(c for col in columns for c in col['cards'])

    def test_user_review_wait_is_attention_without_answer_form(self):
        for text in ('Waiting for captain feedback on the visual review board.',
                     'Esperando comentarios del capitán en Lavish.',
                     'Waiting for user approval.'):
            card = self.only_card(self.prepare(status='paused [at=1794650000]: ' + text))
            self.assertEqual(card['bucket'], 'captains_call')
            self.assertEqual(card['attention_kind'], 'action')
            self.assertIn(text, card['action']['instruction'])
            self.assertIsNone(card['inline_call'])
            code, detail = self.req('/api/ticket/' + card['key'])
            self.assertEqual(code, 200)
            self.assertEqual(detail['action'], card['action'])
            self.assertNotIn('call', detail)

    def test_supervisor_safe_point_and_technical_waits_do_not_ask_captain(self):
        for text in ('Supervisor requested safe point reached; waiting for resume.',
                     'Firstmate pidió un punto seguro; esperando reanudación.',
                     'Waiting for test results.', 'Waiting for another worker review.'):
            card = self.only_card(self.prepare(status='paused [at=1794650000]: ' + text))
            self.assertNotEqual(card['bucket'], 'captains_call')
            self.assertEqual(card['activity']['kind'], 'paused')
        self.assertEqual(self.only_card(self.prepare(status='paused: Supervisor safe point reached'))['activity']['paused_by'], 'firstmate')

    def test_unheld_captain_row_has_repair_hint_and_no_answer_endpoint(self):
        card = self.only_card(self.prepare(kind='captain', state='ready'))
        self.assertEqual(card['bucket'], 'captains_call')
        self.assertEqual(card['attention_kind'], 'action')
        self.assertIn('not filed correctly', card['action']['context'])
        self.assertIsNone(card['inline_call'])
        code, _ = self.req('/api/ticket/' + card['key'] + '/answer',
                           dict(value='yes', note='', occurrence='a'*64, request_id='b'*32))
        self.assertIn(code, (404, 409))
        self.assertFalse((Path(self.home.path) / 'mutations.jsonl').exists())

    def test_working_and_done_clear_wait_attention_and_done_captain_stays_closed(self):
        for state, status, kind in [('running', 'paused: Waiting for captain feedback\nworking: Resumed', 'ship'),
                                    ('done', 'paused: Waiting for captain feedback', 'ship'),
                                    ('done', '', 'captain')]:
            card = self.only_card(self.prepare(kind=kind, state=state, status=status))
            self.assertNotEqual(card['bucket'], 'captains_call')
