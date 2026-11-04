import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('state_consistency', ROOT / 'scripts/check_state_consistency.py')
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


class StateConsistencyTests(unittest.TestCase):
    def test_finds_cross_source_disagreements_in_synthetic_snapshot(self):
        fixture = ROOT / 'web/tests/fixtures/state-consistency-synthetic.json'
        findings = checker.audit(json.loads(fixture.read_text()))
        self.assertEqual({item['task'] for item in findings}, {'task:running', 'task:orphan'})
        self.assertTrue(any('100%' in item['shown'] for item in findings))
        self.assertTrue(any('pane' in item['shown'] for item in findings))
        self.assertTrue(any('dangling hierarchy' in item['cause'] for item in findings))

    def test_consistent_snapshot_passes_and_cli_is_machine_readable(self):
        bundle = {'observed_epoch': 1000, 'tasks': [{'id': 'task:ok',
            'backlog': {'state': 'in_flight'}, 'status': {'state': 'working'},
            'worker': {'observed': True, 'alive': True, 'pane_id': 'p1'},
            'meta': {'pane_id': 'p1'}, 'snapshot': {'state': 'active'},
            'deck': {'column': 'now'}}]}
        self.assertEqual(checker.audit(bundle), [])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'snapshot.json'
            path.write_text(json.dumps(bundle))
            import subprocess
            result = subprocess.run(['python3', str(ROOT / 'scripts/check_state_consistency.py'),
                                     '--snapshot', str(path)], text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('"ok": true', result.stdout)


if __name__ == '__main__':
    unittest.main()
