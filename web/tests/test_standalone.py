"""Start the real foreground web entry point with an explicitly empty home map."""
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest


LOOPBACK = socket.inet_ntoa(socket.INADDR_LOOPBACK.to_bytes(4, "big"))


class StandaloneTests(unittest.TestCase):
    def test_empty_installation_is_ready_and_has_no_controls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with socket.socket() as sock:
                sock.bind((LOOPBACK, 0))
                port = sock.getsockname()[1]
            env = {key: value for key, value in os.environ.items()
                   if not key.startswith(('FM_', 'HERDR_', 'CD_WEB_'))}
            env.update(FM_FLOW_HOMES_JSON='{}', FM_FLOW_HOMES_ONLY='1',
                       CD_WEB_DATA=str(root / 'data'), CD_WEB_RUNTIME=str(root / 'runtime'),
                       HERDR_PLUGIN_CONFIG_DIR=str(root / 'config'),
                       HERDR_PLUGIN_STATE_DIR=str(root / 'state'))
            with (root / 'server.log').open('w+') as log:
                process = subprocess.Popen([sys.executable, str(Path(__file__).resolve().parents[1] / 'launch.py'),
                                            'run', '--port', str(port)], env=env, stdout=log, stderr=log)
                try:
                    def get(path):
                        connection = http.client.HTTPConnection(LOOPBACK, port, timeout=2)
                        connection.request('GET', path)
                        response = connection.getresponse()
                        status, data = response.status, response.read()
                        connection.close()
                        return status, json.loads(data)

                    deadline = time.monotonic() + 15
                    while True:
                        try:
                            status, health = get('/health')
                            if status == 200:
                                break
                        except OSError:
                            pass
                        if time.monotonic() > deadline or process.poll() is not None:
                            log.seek(0)
                            self.fail('Standalone startup failed: ' + log.read())
                        time.sleep(0.05)
                    self.assertEqual(health['mode'], 'standalone')
                    self.assertEqual(health['error'], '')
                    status, board = get('/api/board')
                    self.assertEqual(status, 200)
                    self.assertEqual(board['homes'], [])
                    self.assertEqual(board['deck']['sources'], [])
                    self.assertEqual(board['error'], '')
                    self.assertTrue(all(not column['cards'] for column in board['columns']))
                    self.assertEqual(get('/api/history')[1]['records'], [])
                    self.assertEqual(get('/api/locale')[1]['locale'], 'en')
                finally:
                    process.terminate()
                    process.wait(timeout=10)
                log.seek(0)
                self.assertNotIn('bridge request failed', log.read())


if __name__ == '__main__':
    unittest.main()
