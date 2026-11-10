"""Answer wake uses current agent inventory and never selects a worker."""
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import bridge


class AnswerWakeTests(unittest.TestCase):
    def test_current_inventory_selects_only_the_owning_supervisor(self):
        with tempfile.TemporaryDirectory(prefix='prueba-answer-wake-') as tmp:
            root = Path(tmp)
            home = bridge.fm.Home('Firstmate', str(root), 'captain')
            (root / 'state').mkdir()
            (root / 'state/prueba-worker.meta').write_text('herdr_pane_id=worker\n')
            board = SimpleNamespace(homes=lambda: [home])
            card = SimpleNamespace(owner='(main)', task='prueba-answer')
            script, calls, inventory = root / 'herdr', root / 'calls.jsonl', root / 'agents.json'
            script.write_text('#!/usr/bin/env python3\n'
                'import json,pathlib,sys\n'
                'root=pathlib.Path(__file__).parent\n'
                'with (root/"calls.jsonl").open("a") as f:f.write(json.dumps(sys.argv[1:])+"\\n")\n'
                'if sys.argv[1:]==["agent","list"]:\n'
                ' print(json.dumps({"result":{"agents":json.loads((root/"agents.json").read_text())}}))\n'
                'elif sys.argv[1:3]!=["agent","prompt"]:sys.exit(1)\n')
            script.chmod(0o755)
            worker = dict(pane_id='worker', cwd=str(root))
            supervisor = dict(pane_id='supervisor', cwd=str(root))
            with patch.object(bridge.fm, 'HERDR_BIN', str(script)):
                for agents, expected in [([worker, supervisor], 'sent'),
                                         ([worker], 'unreachable'),
                                         ([supervisor, dict(pane_id='other', cwd=str(root))], 'unreachable')]:
                    with self.subTest(expected=expected, agents=len(agents)):
                        inventory.write_text(json.dumps(agents))
                        calls.write_text('')
                        self.assertEqual(bridge.Board.wake_primary(board, home, card), expected)
                        sent = [json.loads(line) for line in calls.read_text().splitlines()]
                        self.assertTrue(sent, 'Answer wake must read the current agent inventory')
                        self.assertEqual(sent[0], ['agent', 'list'])
                        if expected == 'sent':
                            self.assertEqual(sent[1][:3], ['agent', 'prompt', 'supervisor'])
                            self.assertEqual(len(sent), 2)
                        else:
                            self.assertEqual(len(sent), 1)
