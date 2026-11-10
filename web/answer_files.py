"""Bounded answer uploads and projection of Firstmate's canonical answers."""
import base64
import binascii
import json
import hashlib
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time

MAX_FILE = 5 * 1024 * 1024
MAX_FILES = 8
TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
         '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
         '.txt': 'text/plain', '.md': 'text/plain', '.csv': 'text/plain',
         '.json': 'text/plain', '.zip': 'application/zip'}


def file_type(name, data):
    mime = TYPES.get(Path(name).suffix.lower())
    signatures = {'image/png': data.startswith(b'\x89PNG\r\n\x1a\n'),
                  'image/jpeg': data.startswith(b'\xff\xd8\xff'),
                  'image/gif': data.startswith((b'GIF87a', b'GIF89a')),
                  'image/webp': data.startswith(b'RIFF') and data[8:12] == b'WEBP',
                  'application/pdf': data.startswith(b'%PDF-'),
                  'application/zip': data.startswith(b'PK\x03\x04')}
    if mime == 'text/plain':
        try:
            text = data.decode('utf-8')
            return mime if '\x00' not in text else None
        except UnicodeError:
            return None
    return mime if signatures.get(mime) else None


class AnswerFiles:
    def __init__(self, board, refusal, fm, shell_command, endpoint_path, home_id):
        self.board, self.refusal, self.fm = board, refusal, fm
        self.shell_command, self.endpoint_path, self.home_id = shell_command, endpoint_path, home_id

    def upload(self, key, body, actor):
        name = body.get('name', '')
        if not isinstance(name, str) or not re.fullmatch(r'[^/\\\x00-\x1f\x7f]{1,160}', name) or name in ('.', '..'):
            raise self.refusal('Invalid attachment name.', 400)
        try:
            data = base64.b64decode(body.get('data', ''), validate=True)
        except (ValueError, TypeError, binascii.Error):
            raise self.refusal('Invalid attachment data.', 400)
        if not 0 < len(data) <= MAX_FILE:
            raise self.refusal('Each attachment must be between 1 byte and 5 MB.', 413)
        mime = file_type(name, data)
        if not mime:
            raise self.refusal('Unsupported attachment type. Use images, PDF, text or ZIP.', 415)
        directory = self.board.data_dir / 'attachments'
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if directory.is_symlink():
            raise self.refusal('Unsafe attachment directory.', 400)
        identity = secrets.token_hex(16)
        folder = directory / identity
        folder.mkdir(mode=0o700)
        (folder / 'files').mkdir(mode=0o700)
        path = folder / 'files' / name
        with path.open('xb') as stream:
            stream.write(data)
        item = dict(id=identity, name=name, size=len(data), type=mime,
                    url='/api/attachments/' + identity, key=key, actor=actor)
        self.board.store_receipt(folder / 'metadata.json', item, exclusive=True)
        return {k: v for k, v in item.items() if k not in ('key', 'actor')}

    def uploaded(self, identity, actor, key=None):
        if not isinstance(identity, str) or not re.fullmatch(r'[a-f0-9]{32}', identity):
            raise self.refusal('Attachment not found.', 404)
        folder = self.board.data_dir / 'attachments' / identity
        try:
            item = json.loads(self.fm.delivery_read(str(self.board.data_dir), str(folder / 'metadata.json'), 4096))
            if item['actor'] != actor or (key is not None and item['key'] != key):
                raise ValueError('attachment owner mismatch')
            data = self.fm.delivery_read(str(self.board.data_dir), str(folder / 'files' / item['name']), MAX_FILE, binary=True)
        except (OSError, ValueError, KeyError):
            raise self.refusal('Attachment not found.', 404)
        return item, folder / 'files' / item['name'], data

    def paths(self, identities, actor, key):
        if not isinstance(identities, list) or len(identities) > MAX_FILES or len(set(map(str, identities))) != len(identities):
            raise self.refusal('Use at most eight attachments.', 400)
        return [self.uploaded(identity, actor, key)[1] for identity in identities]

    def canonical(self, home, task):
        source = self.board.deck_controls.source(home)
        if not source.get('available'):
            raise self.refusal('Couldn’t check the saved answer. Try again.', 503)
        nodes = source.get('snapshot', {}).get('nodes', [])
        node = next((n for n in nodes if n.get('task') == task), {})
        answers = list(node.get('raw', {}).get('recorded_answers') or [])
        own = (node.get('question') or {}).get('answer')
        if own:
            answers.append(own)
        return nodes, answers

    def shown(self, home, answer, nodes=()):
        """The answer as the question showed it: the chosen option's label, never its id."""
        said = answer.get('value') or answer.get('text') or ''
        question = next((n.get('question') or {} for n in nodes if n.get('task') == answer.get('task_id')), {})
        call = question.get('call') or self.fm.decision_card_for(str(answer.get('task_id') or ''), home)
        for option in call.get('options') or []:
            value = (option.get('value') or option.get('id')) if isinstance(option, dict) else None
            if not isinstance(value, str) or not isinstance(option.get('label', ''), str):
                continue
            label = option.get('label') or value
            if value and said == value:
                return label
            if value and said.startswith(value + ' - '):
                return label + ' · ' + said[len(value) + 3:]
        return said or answer.get('text') or ''

    def label_answers(self, home, nodes):
        for node in nodes:
            for answer in (node.get('raw') or {}).get('recorded_answers') or []:
                answer['shown'] = self.shown(home, answer, nodes)

    def saved(self, home, task):
        nodes, answers = self.canonical(home, task)
        result = []
        supported = bool(answers) and self.board.corrections_ready(home)
        for answer in answers:
            question = next((n for n in nodes if n.get('task') == answer.get('task_id')), {})
            public = {k: answer.get(k) for k in ('task_id', 'origin', 'text', 'value', 'correction', 'application', 'occurrence')}
            public['shown'] = self.shown(home, answer, nodes)
            # A3 closed-row CAS is #<resolution count>; no open hold stamp remains.
            public['identity'] = '#' + str(answer['occurrence'])
            origin = next((n for n in nodes if n.get('task') == answer.get('origin')), {})
            public['chat_required'] = origin.get('state') == 'active'
            public['files'] = []
            for i, item in enumerate(answer.get('attachments') or []):
                try:
                    size = len(self.canonical_file(home, answer['task_id'], i)[0])
                except self.refusal:
                    size = None
                public['files'].append(dict(name=item['name'], size=size, type=TYPES.get(Path(item['name']).suffix.lower(), 'application/octet-stream'),
                    url=f'/api/answers/{self.home_id(home)}/{answer["task_id"]}/file/{i}'))
            public['can_correct'] = supported and bool(public['identity']) and (question.get('question') or {}).get('open') is False
            result.append(public)
        return {'answers': result}

    def canonical_file(self, home, task, index):
        _, answers = self.canonical(home, task)
        try:
            item = next(a for a in answers if a['task_id'] == task)['attachments'][int(index)]
            path = item['path']
            relative = str(Path(path).relative_to(home.path)) if Path(path).is_absolute() else path
            if not re.fullmatch(r'data/' + re.escape(task) + r'/answer-attachments/files\.[A-Za-z0-9]+/[^/\\]+', relative):
                raise ValueError('unsafe attachment path')
            data = self.fm.delivery_read(home.path, relative, MAX_FILE, binary=True)
            mime = file_type(item['name'], data)
            if not mime:
                raise ValueError('unsupported attachment')
            return data, mime
        except (StopIteration, IndexError, KeyError, OSError, ValueError):
            raise self.refusal('Attachment not found.', 404)

    def run(self, home, task, command, text, paths, identity, close=""):
        # Firstmate copies files before accepting; the decision file is transient.
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.board.data_dir) as decision:
            decision.write(text)
            decision.flush()
            args = [command, task, '--decision-file', decision.name, '--expected-identity', identity]
            if command == 'answer' and close != 'done':
                args.append('--release' if close == 'release' else '--release-in-flight')
            for path in paths:
                args.extend(['--attach', str(path)])
            return subprocess.run(self.shell_command(self.endpoint_path(home.path, 'fm-captain-hold.sh'), *args),
                stdin=subprocess.DEVNULL, text=True, capture_output=True, env=self.board.child_env(home), timeout=90)

    def correct(self, home, task, body, actor):
        if not self.board.corrections_ready(home, fresh=True):
            raise self.refusal('This Firstmate cannot receive corrections yet.', 409)
        if not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', str(body.get('request_id', ''))):
            raise self.refusal('Invalid correction request.', 400)
        text = body.get('note', '')
        if not isinstance(text, str) or len(text.encode()) > 4096 or '\x00' in text:
            raise self.refusal('That answer is too long. Shorten it and send again.', 400)
        paths = self.paths(body.get('attachments', []), actor, self.home_id(home) + '/' + task)
        if not text.strip() and not paths:
            raise self.refusal('Choose an option or write an answer.', 400)
        with self.board.mutation_lock:
            directory = self.board.data_dir / 'answers'
            if directory.is_symlink():
                raise self.refusal('Deck’s answer folder isn’t safe to use.')
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            identity = body.get('identity')
            filename = hashlib.sha256((actor + home.path + task + body['request_id']).encode()).hexdigest()
            path = directory / (filename + '.json')
            if path.exists():
                return json.loads(self.fm.delivery_read(str(self.board.data_dir), str(path), 65536))
            current = self.saved(home, task)['answers']
            if not any(a['task_id'] == task and a['can_correct'] and not a['chat_required'] and a['identity'] == identity for a in current):
                raise self.refusal('The answer changed. Refresh it before sending a correction.', 409)
            receipt = dict(request_id=body['request_id'], actor=actor, home=self.home_id(home), task=task,
                           operation='correction', at=time.time(), saved=None, state='uncertain', note=text,
                           message='Sending started. Check the answer status before sending again.')
            self.board.store_receipt(path, receipt, exclusive=True)
            try:
                process = self.run(home, task, 'correct', text, paths, identity)
                receipt.update(saved=True if process.returncode == 0 else None,
                               state='saved' if process.returncode == 0 else 'uncertain',
                               message='Correction sent to Firstmate.' if process.returncode == 0 else
                                       'Firstmate didn’t confirm the correction. Check the answer status.',
                               detail=(process.stdout + process.stderr)[-4000:])
            except (OSError, subprocess.SubprocessError) as exc:
                receipt['detail'] = str(exc)
            self.board.store_receipt(path, receipt)
            return {k: v for k, v in receipt.items() if k != 'actor'}
