"""A saved answer closes its question, independently of operation execution."""
from pathlib import Path
import json
import unittest
from unittest.mock import patch

from fixtures import bridge
import test_bridge as existing


class SavedQuestionTests(unittest.TestCase):
    setUp = existing.WebTests.setUp
    stop = existing.WebTests.stop
    req = existing.WebTests.req
    init = existing.WebTests.init
    call = existing.WebTests.call
    markdown = existing.WebTests.markdown
    rehold = existing.WebTests.rehold

    def stale_question(self, cards):
        # The disposable producer deliberately continues publishing its old
        # open question while the native operation/announcement is pending.
        (Path(self.home.path) / 'open').touch()
        self.board.collector.snap.cols['captains_call'] = cards

    def test_saved_answer_remains_closed_when_primary_delivery_fails_and_work_waits(self):
        root = self.markdown()
        key, body = self.call()
        cards = list(self.board.collector.snap.cols['captains_call'])
        with patch.object(self.board, 'wake_primary', side_effect=OSError('permission blocked')):
            status, receipt = self.req('/api/ticket/' + key + '/answer', body)
        self.assertEqual(status, 200)
        self.assertIs(receipt['saved'], True)
        self.assertEqual(receipt['state'], 'saved')
        self.assertEqual(receipt['primary'], 'unreachable')
        self.assertEqual(receipt['message'], 'Answer saved by Firstmate.')
        self.stale_question(cards)
        composed = root / 'state/decision-cards/ask.json'
        source = json.loads(composed.read_text())
        source['generated'] = '2026-10-25T16:00:00Z'
        composed.write_text(json.dumps(source))
        work = self.board.collector.snap.cols['underway'][0]
        work.flow = {'phase': 'technical', 'state': 'waiting', 'reason': 'Application awaits permission.'}
        for _ in range(2):
            data = self.init()
            question, = [c for col in data['columns'] if col['id'] == 'captains_call' for c in col['cards']]
            self.assertTrue(question['answered'])
            self.assertTrue(self.req('/api/ticket/' + key)[1]['answered'])
        body.update(occurrence='b' * 64, request_id='b' * 32)
        self.assertEqual(self.req('/api/ticket/' + key + '/answer', body)[0], 409)
        self.assertEqual(len((root / 'mutations.jsonl').read_text().splitlines()), 1)
        # A true new hold must remain answerable even with identical wording.
        self.rehold(root, 'ask', '2026-10-26T15:00:00Z', 0)
        (root / 'identity').write_text('2026-10-26T15:00:00Z#0')
        self.assertFalse(self.req('/api/ticket/' + key)[1]['answered'])

    def test_reconcile_and_uncertain_receipts_do_not_close_a_question(self):
        self.markdown()
        key, body = self.call()
        card = self.board.card(key)
        content = self.board.content(card, self.home)
        base = {'home': bridge.home_id(self.home), 'task': card.task,
                'question_identity': '2026-10-25T15:00:00Z#0',
                'question_signature': self.board.question_signature(content)}
        accepted = dict(base, saved=True, operation='answer')
        changed = dict(content, link='https://example.test/new-evidence')
        self.assertFalse(self.board.answer_saved(card, self.home, changed, [accepted]))
        self.assertFalse(self.board.answer_saved(card, self.home, content, [dict(base, saved=None, operation='answer')]))
        self.assertFalse(self.board.answer_saved(card, self.home, content, [dict(base, saved=True, operation='reconcile')]))
        # Existing exact-occurrence receipts remain compatible, without
        # deriving acceptance from wake/consumption or changing any owner row.
        old = dict(base, saved=True, message='Answer saved by Firstmate.', occurrence=body['occurrence'])
        old.pop('question_identity'); old.pop('question_signature')
        self.assertTrue(self.board.answer_saved(card, self.home, content, [old]))
        old['occurrence'] = '0' * 64
        self.assertFalse(self.board.answer_saved(card, self.home, content, [old]))

    def test_failed_refresh_cannot_undo_saved_answer_or_confirmed_announcement(self):
        self.markdown()
        key, body = self.call()
        with patch.object(self.board, 'wake_primary', return_value='sent'), \
                patch.object(self.board.collector, 'refresh_now', side_effect=OSError('refresh unavailable')):
            status, receipt = self.req('/api/ticket/' + key + '/answer', body)
        self.assertEqual(status, 200)
        self.assertIs(receipt['saved'], True)
        self.assertEqual(receipt['primary'], 'sent')
        self.assertEqual(receipt['message'], 'Answer saved by Firstmate.')


if __name__ == '__main__':
    unittest.main()
