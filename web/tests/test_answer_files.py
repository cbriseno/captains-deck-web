"""Answer uploads stay bounded, authenticated, and separate from task state."""
import base64
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from fixtures import bridge
import test_bridge as existing
from answer_files import MAX_FILE


class AnswerFileTests(unittest.TestCase):
    # Reuse the disposable HTTP server, without re-running unrelated tests.
    setUp = existing.WebTests.setUp
    stop = existing.WebTests.stop
    req = existing.WebTests.req
    init = existing.WebTests.init
    call = existing.WebTests.call

    def upload(self, key, name='notes.txt', data=b'fixture notes', headers=None):
        with patch.object(self.board, 'file_answers_ready', return_value=True):
            return self.req('/api/ticket/' + key + '/upload',
                            dict(name=name, data=base64.b64encode(data).decode()), headers)

    def test_upload_bounds_type_and_session_ownership(self):
        key, _ = self.call()
        status, item = self.upload(key)
        self.assertEqual(status, 200)
        self.assertEqual(self.req(item['url']), (200, b'fixture notes'))
        self.assertEqual(self.upload(key, '../secret.txt')[0], 400)
        self.assertEqual(self.upload(key, 'capture.png', b'not a PNG')[0], 415)
        self.assertEqual(self.upload(key, 'script.html', b'<html>')[0], 415)
        self.assertEqual(self.upload(key, data=b'')[0], 413)
        self.assertEqual(self.upload(key, data=b'x' * (MAX_FILE + 1))[0], 413)
        self.assertEqual(self.upload(key, headers={'X-Deck-CSRF': 'invalid'})[0], 403)
        item, path, _ = self.board.answer_files.uploaded(item['id'], 'local', key)
        with self.assertRaises(bridge.Refusal):
            self.board.answer_files.uploaded(item['id'], 'other', key)
        with self.assertRaises(bridge.Refusal):
            self.board.answer_files.uploaded(item['id'], 'local', 'other-question')
        path.unlink();path.symlink_to(Path(self.home.path) / 'identity')
        with self.assertRaises(bridge.Refusal):
            self.board.answer_files.uploaded(item['id'], 'local', key)

    def test_attachment_only_answer_uses_guarded_native_file_intake(self):
        key, body = self.call()
        status, item = self.upload(key, 'metadata.json')
        self.assertEqual(status, 200)
        body.update(value='', note='', attachments=[item['id']])
        with patch.object(self.board, 'file_answers_ready', return_value=True):
            status, receipt = self.req('/api/ticket/' + key + '/answer', body)
        self.assertEqual(status, 200)
        self.assertTrue(receipt['saved'])
        mutation = json.loads((Path(self.home.path) / 'mutations.jsonl').read_text())
        self.assertEqual(mutation['args'][:2], ['answer', 'ask'])
        self.assertIn('--attach', mutation['args'])
        self.assertIn('--expected-identity', mutation['args'])
        self.assertIn('--release', mutation['args'])
        self.assertEqual(Path(mutation['args'][mutation['args'].index('--attach') + 1]).read_bytes(), b'fixture notes')
        with patch.object(self.board, 'file_answers_ready', return_value=True):
            self.assertTrue(self.req('/api/ticket/' + key + '/answer', body)[1]['replay'])
        self.assertEqual(len((Path(self.home.path) / 'mutations.jsonl').read_text().splitlines()), 1)

    def test_file_capable_intake_preserves_multiline_text_beyond_keyed_limit(self):
        key, body = self.call()
        root = Path(self.home.path)
        script = root / 'bin/intake.py'
        script.write_text(script.read_text().replace("with (root/'mutations.jsonl').open('a') as out:",
            "if args[0]=='answer': (root/'received-text').write_bytes(Path(args[args.index('--decision-file')+1]).read_bytes())\nwith (root/'mutations.jsonl').open('a') as out:"))
        body.update(value='', note='Primera línea\n' + 'Segunda línea. ' * 60)
        with patch.object(self.board, 'file_answers_ready', return_value=True):
            status, receipt = self.req('/api/ticket/' + key + '/answer', body)
        self.assertEqual(status, 200)
        self.assertTrue(receipt['saved'])
        self.assertEqual((root / 'received-text').read_text(), body['note'].strip())

    def test_canonical_files_and_correction_preserve_closed_answer_identity(self):
        self.init()
        home_id = bridge.home_id(self.home)
        root = Path(self.home.path)
        folder = root / 'data/ask/answer-attachments/files.demo';folder.mkdir(parents=True)
        file = folder / '1-notes.txt';file.write_text('original attachment')
        answer = dict(task_id='ask', origin='origin-work', text='original answer', occurrence=1,
                      correction_identity='2026-10-25T15:00:00Z#1', recorded=True,
                      attachments=[dict(path=str(file), name='notes.txt')])
        node = dict(task='ask', state='done', question=dict(open=False, answer=answer), raw={})
        origin = dict(task='origin-work', state='waiting')
        source = dict(available=True, snapshot=dict(nodes=[node, origin]))
        route = '/api/answers/' + home_id + '/ask'
        with patch.object(self.board.deck_controls, 'source', return_value=source):
            status, saved = self.req(route)
            self.assertEqual(status, 200)
            public, = saved['answers']
            self.assertTrue(public['can_correct'])
            self.assertNotIn('path', json.dumps(public))
            self.assertEqual(self.req(public['files'][0]['url']), (200, b'original attachment'))
            body = dict(note='correction', identity='wrong', request_id='c' * 32)
            self.assertEqual(self.req(route + '/correct', body)[0], 409)
            body['identity'] = public['identity']
            origin['state'] = 'active'
            self.assertTrue(self.req(route)[1]['answers'][0]['chat_required'])
            self.assertEqual(self.req(route + '/correct', body)[0], 409)
            origin['state'] = 'waiting'
            # The existing fixture expects its own native identity. The call
            # still passes through the real HTTP and subprocess boundaries.
            (root / 'identity').write_text(public['identity'])
            status, receipt = self.req(route + '/correct', body)
            self.assertEqual(status, 200)
            self.assertTrue(receipt['saved'])
            self.assertEqual(self.req(route + '/correct', body)[1]['saved'], True)
            self.assertEqual(file.read_text(), 'original attachment')
            file.unlink();file.symlink_to(root / 'identity')
            self.assertEqual(self.req(public['files'][0]['url'])[0], 404)


if __name__ == '__main__':
    unittest.main()
