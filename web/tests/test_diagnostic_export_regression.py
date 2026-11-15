import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import fm_diagnostics as d

class DiagnosticExportRegression(unittest.TestCase):
    def test_request_geometry_survives_export_without_task_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            logger = d.Logger('deck', '0.7.0', 'unknown', directory=tmp)
            logger.emit('request.order', task='private task', cursor='10',
                        old_y=179, new_y=179, old_height=164, new_height=164,
                        title='private title')
            logger.flush()
            record = d._export_record(json.loads((Path(tmp) / 'events.jsonl').read_text()), b'x')
            self.assertEqual((record['old_height'], record['new_height']), (164, 164))
            self.assertEqual((record['old_y'], record['new_y']), (179, 179))
            self.assertNotIn('private', json.dumps(record))

    def test_firstmate_and_manifest_and_private_revision(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, FM_DIAGNOSTICS_HOME=tmp):
            source = Path(tmp) / 'firstmate'
            source.mkdir()
            (source / 'events.jsonl').write_text(json.dumps(dict(t='2026-11-14T00:00:00Z', c='firstmate', e='worker.procs', v='unknown', r='unknown', task='live-0123456789abcdef', procs=2))+'\n')
            deck = Path(tmp) / 'deck'
            deck.mkdir()
            (deck / 'events.jsonl').write_text(json.dumps(dict(t='2026-11-14T00:00:00Z', c='deck', e='board.start', v='0.7.0', r='abcdef012345', cause='ok'))+'\n')
            path = d.export(['firstmate','deck'], Path(tmp) / 'out')
            with zipfile.ZipFile(path) as z:
                records = [json.loads(line) for line in z.read('events.jsonl').splitlines()]
                manifest = json.loads(z.read('manifest.json'))
            self.assertEqual(len(records), 2)
            self.assertTrue(records[0]['task'].startswith('t-'))
            self.assertEqual(records[1]['r'], 'unknown')
            self.assertIn('installed_version', manifest)

    def test_revision_is_opt_in(self):
        record = dict(t='2026-11-14T00:00:00Z', c='deck', e='relay.attempt', v='0.7.0', r='abcdef012345', revision='abcdef012345')
        self.assertEqual(d._export_record(record, b'x')['revision'], 'unknown')
        self.assertEqual(d._export_record(record, b'x', True)['revision'], 'abcdef012345')
