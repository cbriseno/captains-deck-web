"""Browser trace accepts only bounded structural data through the session guard."""
import json
import os
import unittest
from unittest.mock import patch

import test_bridge
from fixtures import bridge


class TraceTests(unittest.TestCase):
    setUp = test_bridge.WebTests.setUp
    stop = test_bridge.WebTests.stop
    req = test_bridge.WebTests.req
    init = test_bridge.WebTests.init

    def test_trace_guard_schema_limits_and_export(self):
        bridge.TRACE_TIMES.clear()
        self.init()
        event = {'e': 'card.move', 'task': '12', 'from_column': 'now',
                 'to_column': 'waiting', 'move_cause': 'snapshot', 'age': 0}
        body = {'events': [event], 'exporting': False}
        with patch.dict(os.environ, FM_DIAGNOSTICS_HOME=str(self.root / 'diagnostics')):
            self.assertEqual(self.req('/api/diagnostics/trace', body, {'X-Deck-CSRF': 'wrong'})[0], 403)
            self.assertEqual(self.req('/api/diagnostics/trace', {'events': [dict(event, title='canary-private')], 'exporting': False})[0], 400)
            self.assertEqual(self.req('/api/diagnostics/trace', {'events': [dict(event, move_cause='canary-private')], 'exporting': False})[0], 400)
            self.assertEqual(self.req('/api/diagnostics/trace', body)[0], 200)
            self.assertEqual(self.req('/api/diagnostics/trace', {'events': [event] * 100, 'exporting': False})[0], 200)
            self.assertEqual(self.req('/api/diagnostics/trace', {'events': [event] * 100, 'exporting': False})[0], 429)
            path = bridge.diagnostics.export(['deck'], self.root / 'downloads')
            self.assertTrue(bridge.diagnostics._verify_zip(path))
            import zipfile
            with zipfile.ZipFile(path) as archive:
                raw = archive.read('events.jsonl')
            self.assertNotIn(b'canary-private', raw)
            records = [json.loads(line) for line in raw.splitlines()]
            self.assertTrue(all(row['task'].startswith('t-') for row in records))

    def test_usage_records_only_fixed_names_and_survives_export(self):
        bridge.TRACE_TIMES.clear()
        self.init()
        event = {'e': 'ui.use', 'action': 'search', 'target': 'board', 'age': 0}
        with patch.dict(os.environ, FM_DIAGNOSTICS_HOME=str(self.root / 'diagnostics')):
            for changes in ({'query': 'private-canary'}, {'target': 'private-canary'}, {'action': 'private-canary'}):
                status, _ = self.req('/api/diagnostics/trace', {'events': [dict(event, **changes)], 'exporting': False})
                self.assertEqual(status, 400)
            status, result = self.req('/api/diagnostics/trace', {'events': [event], 'exporting': False})
            self.assertEqual((status, result['accepted']), (200, 1))
            self.assertIn('ui.use: 1', self.req('/api/diagnostics/preview')[1]['preview'])
            path = bridge.diagnostics.export(['deck'], self.root / 'downloads')
            import zipfile
            with zipfile.ZipFile(path) as archive:
                raw = archive.read('events.jsonl')
            self.assertNotIn(b'private-canary', raw)
            records = [json.loads(line) for line in raw.splitlines()]
            self.assertEqual(len(records), 1)
            self.assertEqual({k: records[0][k] for k in event}, event)
            self.assertEqual(set(records[0]), {'t', 'c', 'v', 'r'} | set(event))
