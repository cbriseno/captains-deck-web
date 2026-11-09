"""Read the manual activity records, including both transcript formats."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fixtures import bridge
import timeline


class TimelineTests(unittest.TestCase):
    def test_records_transcripts_and_missing_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            def write(name, content):
                path = home / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
                return str(path)
            write('data/task/creation.json', '{"created_at":"2026-11-08T00:00:00Z"}')
            write('state/task.status', 'garbage\nworking [at=1794096010]: live\nblocked [key=test] [at=1794096020]: help\n')
            write('data/task/status.log', 'working [at=1794096010]: live\npaused [at=1794096030]: wait\n')
            write('data/task/completion.json', '{"at":"2026-11-08T01:00:00Z","completion":{"verb":"merged"}}')
            write('data/task/presentation.json', '{"presentation":{"summary":"Delivered fixture"}}')
            chats = []
            for harness in ('claude', 'codex'):
                row = {'timestamp':'2026-11-08T00:00:01Z', 'message':{'model':'claude-test'}} if harness == 'claude' else {'timestamp':'2026-11-08T00:00:02Z', 'payload':{'model':'codex-test'}}
                content = json.dumps(row)+'\n'+json.dumps({'text':f"steering inbox is `{home}/state/task.inbox`"})+'\n'
                chats.append((harness, write(harness+'.jsonl', content)))
            with patch.object(timeline, '_transcripts', return_value=iter(chats)):
                result = timeline.timeline(home, ['task', 'task', 'missing', '../bad', '.', '..'])
            events = result['events']
            self.assertEqual([e['kind'] for e in events], ['created','started','started','working','blocked','paused','closed'])
            self.assertEqual(events[-1]['summary'], 'Delivered fixture')
            self.assertEqual([a['model'] for a in result['agents']['task']], ['claude-test','codex-test'])
            self.assertEqual(len([e for e in events if e['text']=='live']), 1)
            with patch.object(timeline, '_transcripts', return_value=iter([])):
                self.assertEqual(timeline.timeline(home, ['absent']), {'events':[], 'agents':{}})
