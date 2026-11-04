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
