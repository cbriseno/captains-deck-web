import unittest
from unittest.mock import patch
import test_bridge
from fixtures import bridge

class StateDiagnosticsRegression(unittest.TestCase):
    setUp = test_bridge.WebTests.setUp
    stop = test_bridge.WebTests.stop
    req = test_bridge.WebTests.req
    init = test_bridge.WebTests.init
    def test_board_accepts_visible_label(self):
        board = self.init()
        label = board['homes'][0]['label']
        from urllib.parse import quote
        status, selected = self.req('/api/board?home=' + quote(label))
        self.assertEqual(status, 200)
        self.assertEqual(selected['home'], board['homes'][0]['id'])

    def test_projection_logs_structural_snapshot(self):
        with patch.object(self.board, 'diagnostic') as diag:
            with self.board.projection.condition:
                self.board.projection.publish()
            events = [call.args[0] for call in diag.call_args_list]
            self.assertIn('snapshot.read', events)
            fields = next(call.kwargs for call in diag.call_args_list if call.args[0] == 'snapshot.read')
            self.assertGreater(fields['tasks'], 0)
            self.assertNotIn('title', fields)

    def test_finished_and_missing_are_logged_as_counts_only(self):
        body = {'columns': [{'id': 'underway', 'cards': [
            {'bucket': 'underway', 'activity': {'kind': 'finished', 'worker_missing': True}, 'title': 'private'},
            {'bucket': 'underway', 'activity': {'kind': 'missing'}, 'title': 'private'}]}]}
        with patch.object(self.board, 'diagnostic') as diag, patch.object(self.board.projection, 'base', return_value=body):
            with self.board.projection.condition:
                self.board.projection.publish()
            mismatch = next(call.kwargs for call in diag.call_args_list if call.args[0] == 'state.mismatch')
            self.assertEqual(mismatch, {'worker_missing': 2, 'awaiting_closure': 1})
