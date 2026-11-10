"""Regressions for the event reader and the main-card activity join."""
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from fixtures import bridge
from event_projection import EventProjection, delta


class EventProjectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'state').mkdir()
        self.home = SimpleNamespace(path=str(self.root), label='Test')
        self.board = bridge.Board.__new__(bridge.Board)
        self.board.home = lambda identity: self.home
        self.board.t = lambda text: text
        self.board.file_answers_ready = lambda home: False
        self.model = SimpleNamespace(rows={'task': {}}, activity={})
        self.board.projection = EventProjection(self.board, [self.home])
        self.board.projection.readers['home'] = {'model': self.model}
        self.item = dict(task='task', title='Task', state='active', request=None,
                         outcome=None, raw={'worker_liveness': {'state': 'alive'}},
                         updated_at=None, question={})

    def card(self):
        return self.board.projected_card({'home': 'home'}, self.item, {},
                                         'underway', {}, {})

    def test_turn_end_preserves_task_and_worker_facts(self):
        self.model.activity['task'] = dict(state='busy', source='claude-hook', seq=1)
        self.assertEqual(self.card()['activity']['kind'], 'working')
        self.model.activity['task'] = dict(state='idle', source='claude-hook', seq=2)
        card = self.card()
        self.assertEqual(card['activity']['turn']['state'], 'idle')
        self.assertEqual(card['activity']['agent'], 'present')
        self.assertEqual(card['bucket'], 'underway')
        self.assertEqual(self.item['state'], 'active')

    def test_missing_activity_and_dead_worker_never_claim_working(self):
        self.assertEqual(self.card()['activity']['kind'], 'unknown')
        self.model.activity['task'] = dict(state='busy')
        self.item['raw']['worker_liveness']['state'] = 'dead'
        self.assertEqual(self.card()['activity']['agent'], 'none')
        self.assertNotEqual(self.card()['activity']['kind'], 'working')

    def test_question_pause_and_delivery_keep_their_meanings_during_busy_turn(self):
        self.model.activity['task'] = dict(state='busy')
        for state, kind in [('paused', 'paused'), ('stopping', 'paused'), ('done', 'delivered')]:
            self.item['state'] = state
            self.assertEqual(self.card()['activity']['kind'], kind)
        self.item['question'] = {'open': True}
        self.assertEqual(self.card()['activity']['kind'], 'decision')

    def test_only_complete_lines_for_this_home_are_applied(self):
        applied = []
        reader = dict(home=self.home, root=str(self.root), file_id=[None, None],
                      offset=0, model=SimpleNamespace(apply=lambda event: applied.append(event) or True))
        path = self.root / 'state/fleet-ledger.jsonl'
        event = dict(home=str(self.root), event='agent.activity', value={'state': 'idle'})
        line = json.dumps(event).encode() + b'\n'
        path.write_bytes(line[:-1])
        self.assertFalse(self.board.projection.read_suffix(reader))
        self.assertEqual(reader['offset'], 0)
        with path.open('ab') as out:
            out.write(b'\n' + json.dumps(dict(event, home='/other')).encode() + b'\n')
        self.assertTrue(self.board.projection.read_suffix(reader))
        self.assertEqual(applied, [event])
        self.assertFalse(self.board.projection.read_suffix(reader))
        path.write_bytes(b'')
        with self.assertRaisesRegex(ValueError, 'continuity'):
            self.board.projection.read_suffix(reader)

    def test_reconnect_receives_current_base_without_replaying_a_second_log(self):
        projection = self.board.projection
        projection.cursor = 42
        projection.body = dict(cursor='42', sources=[], columns=[], history=[], deck={'sources': []})
        self.assertEqual(projection.changes('41', '')['cursor'], '42')
        self.assertEqual(delta({'cursor': '41'}, {'cursor': '42'}),
                         {'fields': {'cursor': {'value': '42'}}})

    def test_reader_failure_does_not_change_a_previously_served_base(self):
        projection = self.board.projection
        self.board.titles = lambda: {}
        self.board.columns = [('charted', 'Up next')]
        self.board.home_identity = lambda home: 'home'
        projection.sources['home'] = dict(home='home', available=True, error='',
                                          snapshot={'nodes': []})
        previous = projection.base()
        projection.sources['home'].update(available=False, error='Reader stopped')
        current = projection.base()
        self.assertTrue(previous['deck']['sources'][0]['available'])
        self.assertEqual(previous['deck']['sources'][0]['error'], '')
        self.assertFalse(current['deck']['sources'][0]['available'])
        self.assertEqual(current['deck']['sources'][0]['error'], 'Reader stopped')


if __name__ == '__main__':
    unittest.main()
