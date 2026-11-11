"""Regressions for fixtures silently serving an empty event projection."""
import json
from pathlib import Path
import tempfile
import unittest

from fixtures import fixture, start_fixture


class FixtureStartupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.board, self.home = fixture(Path(self.tmp.name))
        self.addCleanup(self.board.stop)

    def test_bootstrap_and_journal_keep_fixture_tasks_visible(self):
        start_fixture(self.board, self.home)
        data = self.board.projection.read()
        self.assertEqual(sum(len(c['cards']) for c in data['columns']), 7)
        self.assertFalse(data['error'])
        root = Path(self.home.path)
        raw = json.loads((root / 'work-snapshot.json').read_text())
        task = next(row for row in raw['tasks'] if row['key'] == 'task:web')
        task['priority'] = {'own': 2}
        (root / 'work-snapshot.json').write_text(json.dumps(raw))
        result = self.board.deck_controls.invoke(self.home, 'apply', dict(
            op='set_priority', target='task:web', value=0, expected_rev='r1',
            request_id='fixture-priority'))
        self.assertEqual(result['state'], 'applied')
        projection = self.board.projection
        with projection.condition:
            def changed():
                nodes = projection.read()['deck']['sources'][0]['snapshot']['nodes']
                return next(n for n in nodes if n['id'] == 'task:web')['priority'] == 'P0'
            self.assertTrue(projection.condition.wait_for(changed, timeout=3))

    def test_empty_fixture_fails_instead_of_advertising_ready(self):
        for cards in self.board.collector.snap.cols.values():
            cards.clear()
        with self.assertRaisesRegex(RuntimeError, 'empty board'):
            start_fixture(self.board, self.home)
