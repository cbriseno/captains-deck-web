"""Poll the event projection during a delayed, isolated first source read."""
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from fixtures import bridge, fixture, start_fixture


class StartupTests(unittest.TestCase):
    def test_loading_and_health_follow_the_first_source_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            board, home = fixture(Path(directory))
            source_started, release_source = threading.Event(), threading.Event()
            invoke = board.deck_controls.invoke

            def delayed(selected, command, *args):
                if command == 'bootstrap':
                    source_started.set()
                    if not release_source.wait(timeout=5):
                        raise RuntimeError('test source was not released')
                return invoke(selected, command, *args)

            server = bridge.Server((bridge.LOOPBACK, 0), board, bridge.Security(8787))
            port = server.server_port
            server.security = bridge.Security(port)
            http_thread = threading.Thread(target=server.serve_forever, daemon=True)
            http_thread.start()
            failures = []

            def start():
                try:
                    start_fixture(board, home)
                except Exception as exc:
                    failures.append(exc)

            def get(path):
                connection = http.client.HTTPConnection(bridge.LOOPBACK, port, timeout=5)
                connection.request('GET', path, headers={'Host': f'{bridge.LOOPBACK}:{port}'})
                response = connection.getresponse()
                result = response.status, json.loads(response.read())
                connection.close()
                return result

            worker = threading.Thread(target=start)
            try:
                with patch.object(board.deck_controls, 'invoke', side_effect=delayed):
                    worker.start()
                    self.assertTrue(source_started.wait(timeout=5))
                    status, health = get('/health')
                    self.assertEqual(status, 503)
                    self.assertFalse(health['ok'])
                    self.assertTrue(health['loading'])
                    self.assertEqual(health['error'], '')
                    status, loading = get('/api/board')
                    self.assertEqual(status, 200)
                    self.assertTrue(loading['loading'])
                    self.assertFalse(any(c['cards'] for c in loading['columns']))
                    release_source.set()
                    worker.join(timeout=10)
                    self.assertFalse(worker.is_alive())
                    self.assertEqual(failures, [])
                    status, health = get('/health')
                    self.assertEqual(status, 200)
                    self.assertTrue(health['ok'])
                    self.assertFalse(health['loading'])
                    _, ready = get('/api/board')
                    self.assertEqual(len(ready['homes']), 1)
                    self.assertTrue(any(c['cards'] for c in ready['columns']))
                    self.assertEqual(ready['error'], '')
                    _, history = get('/api/history?q=Demo%20research')
                    self.assertEqual(len(history['records']), 1)
                    with (Path(home.path) / 'state/fleet-ledger.jsonl').open('a') as journal:
                        journal.write('invalid event\n')
                    with board.projection.condition:
                        self.assertTrue(board.projection.condition.wait_for(lambda: bool(board.projection.error), timeout=5))
                    status, health = get('/health')
                    self.assertEqual(status, 503)
                    self.assertFalse(health['ok'])
                    self.assertTrue(health['error'])
            finally:
                release_source.set()
                worker.join(timeout=10)
                board.stop()
                server.shutdown()
                server.server_close()
                http_thread.join(timeout=2)
            self.assertFalse((Path(home.path) / 'mutations.jsonl').exists())


if __name__ == '__main__':
    unittest.main()
