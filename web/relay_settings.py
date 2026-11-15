"""Consumer of the independent extension settings contract; no relay engine.

All writes go through the extension's revision-guarded, durable request surface.
The browser chooses opaque selections, never executable or filesystem paths.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import threading
import tempfile
import math

from deck_control import ControlError
from deck_platform import endpoint_path


class RelaySettings:
    def __init__(self, child_env, root='', nodes=None, proof_dir=None):
        self.child_env = child_env
        self.root = Path(root).expanduser() if root else None
        self.lock = threading.Lock()
        self.nodes = nodes or (lambda home: [])
        self.proof_dir = Path(proof_dir) if proof_dir else None
        self.key = None

    def signing_key(self):
        # A signed disclosure survives a browser/server restart, allowing the
        # exact same request to ask the owner for its idempotent receipt.
        if self.key is not None:
            return self.key
        if self.proof_dir is None:
            self.key = secrets.token_bytes(32)
            return self.key
        directory = self.proof_dir
        path = directory / 'disclosure-key'
        if any(p.is_symlink() for p in (path, *path.parents)):
            raise ControlError('Review settings before confirming this change.', 503, 'unavailable')
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not path.exists():
            fd, name = tempfile.mkstemp(prefix='.key-', dir=directory)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(secrets.token_bytes(32))
                    stream.flush()
                    os.fsync(stream.fileno())
                try:
                    os.link(name, path)
                except FileExistsError:
                    pass
            finally:
                Path(name).unlink(missing_ok=True)
        self.key = path.read_bytes()
        if len(self.key) != 32:
            self.key = None
            raise ControlError('Review settings before confirming this change.', 503, 'unavailable')
        return self.key

    def encode_preview(self, value):
        payload = base64.urlsafe_b64encode(json.dumps(value, sort_keys=True).encode()).decode()
        return payload + '.' + hmac.new(self.signing_key(), payload.encode(), hashlib.sha256).hexdigest()

    def decode_preview(self, token):
        try:
            if self.key is None and self.proof_dir is not None and not (self.proof_dir / 'disclosure-key').is_file():
                return None
            payload, signature = token.rsplit('.', 1)
            expected = hmac.new(self.signing_key(), payload.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected):
                return None
            value = json.loads(base64.b64decode(payload, altchars=b'-_', validate=True))
            return value if isinstance(value, dict) else None
        except (AttributeError, TypeError, ValueError):
            return None

    def executable(self, home):
        if (not self.root or not self.root.is_absolute() or
                not Path(endpoint_path(home.path, 'fm-tasks-axi.sh')).is_file() or
                not (self.root / 'bin/fm-extension').is_file()):
            raise ControlError('Relay settings are not available for this space.', 503, 'unavailable')
        return self.root / 'bin/fm-extension'

    def choices(self, home):
        """Only Deck-known repositories/tasks and registered preferences.

        Firstmate's repository_project preserves repository identity even when
        the visual hierarchy groups a public repository under its installation.
        Managed projects/<repository> links supply canonical local roots.
        """
        self.executable(home)
        choices, by_repo = {}, {}
        nodes = self.nodes(home)
        for node in nodes:
            if node.get('kind') not in ('project', 'subproject'):
                continue
            raw = node.get('raw') or {}
            repo_key = raw.get('repository_project') or (node.get('id') if node.get('kind') == 'project' else None)
            if not isinstance(repo_key, str) or not re.fullmatch(r'project:[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', repo_key):
                continue
            if repo_key in by_repo:
                continue
            path = Path(home.path) / 'projects' / repo_key.removeprefix('project:')
            try:
                path = path.resolve(strict=True)
            except (OSError, RuntimeError):
                continue
            if not path.is_dir():
                continue
            row = {'scope': 'project', 'project': str(path), 'label': node.get('title') or repo_key,
                   'owner_id': repo_key}
            token = self.selection_id(home, row)
            choices[token] = row
            by_repo[repo_key] = row
        for node in nodes:
            if node.get('kind') != 'task':
                continue
            raw = node.get('raw') or {}
            project = by_repo.get(raw.get('repository_project') or raw.get('project'))
            task = node.get('task')
            if not project or not isinstance(task, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', task):
                continue
            row = {'scope': 'task', 'project': project['project'], 'task': task,
                   'label': (node.get('title') or task) + ' · ' + project['label']}
            choices[self.selection_id(home, row)] = row
        # Existing scoped preferences can be outside today's board. This is a
        # CLI read, never a scan of configuration files or arbitrary projects.
        try:
            result = subprocess.run([str(self.root / 'bin/fm-extension'), 'planning', 'status', '--home', home.path],
                                    env=self.child_env(home), stdin=subprocess.DEVNULL,
                                    capture_output=True, text=True, timeout=8)
            inventory = json.loads(result.stdout) if len(result.stdout) <= 2 * 1024 * 1024 else {}
            for row in inventory.get('project_exceptions', []):
                if row.get('home') not in (None, home.path) or not row.get('project') or row.get('mode') == 'inherit':
                    continue
                path = Path(row['project'])
                if not path.is_absolute():
                    continue
                if not path.is_dir():
                    continue
                selection = {'scope': 'project', 'project': str(path.resolve(strict=True)),
                             'label': path.name + ' · ' + str(row.get('project_id') or '')[:8]}
                choices.setdefault(self.selection_id(home, selection), selection)
        except (OSError, RuntimeError, ValueError, TypeError, AttributeError, subprocess.SubprocessError):
            pass
        return choices

    @staticmethod
    def selection_id(home, selection):
        return hashlib.sha256(json.dumps([home.path, selection['scope'], selection['project'], selection.get('task')],
                                         ensure_ascii=False).encode()).hexdigest()[:32]

    def selection(self, home, token, choices=None):
        if not token:
            return None
        available = choices if choices is not None else self.choices(home)
        if not isinstance(token, str) or token not in available:
            raise ControlError('This settings scope is not available.', 409, 'stale_revision')
        return available[token]

    def invoke(self, home, command, *, selection=None, flags=(), receipt=False):
        script = self.executable(home)
        args = [str(script), 'settings', command, '--home', home.path]
        if selection:
            if selection.get('project'):
                args += ['--project', selection['project']]
            if selection.get('task'):
                args += ['--task-id', selection['task']]
        try:
            result = subprocess.run([*args, *flags], env=self.child_env(home),
                                    stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=12)
        except (OSError, subprocess.SubprocessError) as exc:
            raise ControlError('The extension did not confirm the request. Check its receipt before retrying.',
                               503, 'receipt-uncertain') from exc
        try:
            if len(result.stdout) > 2 * 1024 * 1024:
                raise ValueError('oversized response')
            data = json.loads(result.stdout)
            if not isinstance(data, dict):
                raise ValueError('object required')
        except (TypeError, ValueError) as exc:
            raise ControlError('The extension did not confirm the request. Check its receipt before retrying.' if receipt
                               else 'Relay settings are not available for this space.', 503,
                               'receipt-uncertain' if receipt else 'invalid-response') from exc
        if receipt:
            ident = data.get('identity')
            expected = {'home': str(Path(home.path).resolve()), 'project': (selection or {}).get('project'),
                        'task_id': (selection or {}).get('task')}
            confirmed_identity = isinstance(ident, dict) and all(ident.get(key) == value for key, value in expected.items())
            if (data.get('schema') != 'fm-extension-settings-receipt.v1' or
                    data.get('state') not in ('applied', 'rejected') or
                    data.get('state') == 'applied' and (result.returncode != 0 or not data.get('revision') or
                                                       not confirmed_identity)):
                raise ControlError('The extension did not confirm the request. Check its receipt before retrying.',
                                   502, 'receipt-uncertain')
        elif result.returncode and not (
                command == 'status' and data.get('schema') == 'fm-extension-settings.v1' or
                command == 'preflight' and data.get('schema') == 'fm-extension-settings-preflight.v1'):
            raise ControlError('Relay settings are not available for this space.', 503, 'unavailable')
        return data

    def snapshot(self, home, selection=None):
        data = self.invoke(home, 'status', selection=selection)
        if (data.get('schema') != 'fm-extension-settings.v1' or not isinstance(data.get('revision'), str)
                or not 0 < len(data['revision']) <= 200 or not isinstance(data.get('identity'), dict)
                or not isinstance(data.get('planning'), dict)
                or (data.get('identity') or {}).get('home') != str(Path(home.path).resolve())
                or data['identity'].get('project') != (selection or {}).get('project')
                or data['identity'].get('task_id') != (selection or {}).get('task')):
            raise ControlError('Relay settings are not available for this space.', 503, 'invalid-response')
        return data

    @staticmethod
    def receipt_result(data):
        # Authorization results contain private runtime fingerprints. Only the
        # owner's real outcome and its opaque undo capability belong in the UI.
        return {**{key: data.get(key) for key in ('schema', 'request_id', 'state', 'code', 'revision', 'message')},
                'undo': data.get('undo_token')}

    def source(self, home, token=''):
        with self.lock:
            try:
                choices = self.choices(home)
                selected = self.selection(home, token, choices)
                data = self.snapshot(home, selected)
                planning = data['planning']
                relay = self.read_relay(home)
                scopes = planning.get('scopes', {})
                targets = {'project': [], 'task': []}
                for key, row in choices.items():
                    targets[row['scope']].append({'id': key, 'label': row['label'],
                                                 'mode': scopes.get(row['scope'], {}).get('mode') if key == token else None})
                return {'available': True, 'revision': data['revision'], 'selection': token,
                        'actions': ['threshold', 'planning'],
                        'relay': relay,
                        'planning': {'home_default': scopes.get('home', {}).get('mode'),
                                     'installation_default': scopes.get('installation', {}).get('mode'),
                                     'project_installation_mode': scopes.get('project', {}).get('installation_mode'),
                                     'resolution': planning.get('resolution'), 'targets': targets}}
            except (ControlError, AttributeError, KeyError, TypeError, ValueError):
                return {'available': False, 'actions': []}

    @staticmethod
    def read_relay(home):
        path = Path(home.path) / 'config/relay-lite.json'
        try:
            data = json.loads(path.read_text()) if path.exists() else {}
            thresholds = data.get('thresholds', {})
            rows = []
            for role in ('primary', 'worker'):
                for harness in ('claude', 'codex'):
                    values = thresholds.get(role, {}).get(harness, {})
                    for axis in ('percent', 'tokens'):
                        fallback = role == 'primary' and axis == 'tokens' and axis not in values
                        value = int(data.get('threshold_tokens') or 0) if fallback else values.get(axis, 0)
                        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or axis == 'percent' and value > 100:
                            raise ValueError('invalid relay threshold')
                        rows.append({'role': role, 'harness': harness, 'axis': axis, 'value': value,
                                     'source': 'threshold_tokens' if fallback else 'relay-lite.json' if axis in values else 'default'})
            return {'thresholds': rows}
        except (OSError, ValueError, TypeError, AttributeError):
            raise ControlError('Relay settings are not available for this space.', 503, 'invalid-response')

    def save_threshold(self, home, body):
        role, harness, axis, value = (body.get(key) for key in ('role', 'harness', 'axis', 'value'))
        if (role not in ('primary', 'worker') or harness not in ('claude', 'codex') or
                axis not in ('percent', 'tokens') or isinstance(value, bool) or
                not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or
                axis == 'percent' and value > 100):
            raise ControlError('Choose a valid threshold.', 400, 'invalid_value')
        path = Path(home.path) / 'config/relay-lite.json'
        self.read_relay(home)
        try:
            data = json.loads(path.read_text()) if path.exists() else {}
            data.setdefault('thresholds', {}).setdefault(role, {}).setdefault(harness, {})[axis] = value
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(prefix='.relay-lite-', dir=str(path.parent))
            try:
                with os.fdopen(fd, 'w') as stream:
                    json.dump(data, stream, indent=2, ensure_ascii=False)
                    stream.write('\n')
                os.replace(name, path)
            finally:
                if os.path.exists(name):
                    os.unlink(name)
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            raise ControlError('Could not save the threshold.', 503, 'unavailable') from exc
        return {'state': 'applied', 'message': 'Threshold saved.'}

    @staticmethod
    def validate(body):
        if not isinstance(body, dict):
            raise ControlError('A JSON object is required.', 400, 'invalid_value')
        request_id = body.get('request_id')
        if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{16,80}', request_id):
            raise ControlError('A valid request id is required.', 400, 'invalid_value')
        if not isinstance(body.get('revision'), str) or not 0 < len(body['revision']) <= 200:
            raise ControlError('Refresh settings before applying a change.', 409, 'stale_revision')
        action = body.get('action')
        if action == 'planning':
            if body.get('scope') not in ('installation', 'home', 'project', 'task') or body.get('mode') not in ('native', 'speckit', 'inherit'):
                raise ControlError('Choose a planning mode and scope.', 400, 'invalid_value')
        elif action == 'undo':
            if not isinstance(body.get('undo_operation'), str) or not 0 < len(body['undo_operation']) <= 200:
                raise ControlError('The extension did not supply an undo operation.', 400, 'invalid_value')
        else:
            raise ControlError('This settings action is not supported.', 400, 'unsupported_op')

    def request(self, home, command, body):
        with self.lock:
            if isinstance(body, dict) and body.get('action') == 'threshold' and command == 'apply':
                return self.save_threshold(home, body)
            self.validate(body)
            self.executable(home)
            if command not in ('preview', 'apply'):
                raise ControlError('This settings action is not supported.', 400, 'unsupported_op')
            selected = self.selection(home, body.get('selection'))
            scoped = body.get('action') == 'planning' and body.get('scope') in ('project', 'task')
            if (scoped and (not selected or selected['scope'] != body['scope'] or body.get('target') != body.get('selection'))
                    or not scoped and body.get('target')):
                raise ControlError('This settings scope is not available.', 400, 'unsupported_op')
            if command == 'preview':
                current = self.snapshot(home, selected)
                if current['revision'] != body['revision']:
                    return {'state': 'rejected', 'allowed': False, 'code': 'stale_revision',
                            'message': 'Settings changed. Refresh and review before applying.'}
                return self.preview(home, body, current)
            token = body.get('preview')
            preview = self.decode_preview(token) if isinstance(token, str) else None
            signature = self.signature(home, body)
            if not preview or preview.get('signature') != signature:
                raise ControlError('Review settings before confirming this change.', 409, 'preview-required')
            flags = ['--request-id', body['request_id'], '--expected-revision', body['revision']]
            action = body['action']
            if action == 'planning':
                operation = 'set'
                flags += ['--target', 'planning', '--scope', body['scope'], '--mode', body['mode']]
            else:
                operation = 'undo'
                flags += ['--undo-token', body['undo_operation']]
            result = self.invoke(home, operation, selection=selected, flags=flags, receipt=True)
            if result.get('request_id') != body['request_id']:
                raise ControlError('The extension did not confirm the request. Check its receipt before retrying.', 502, 'receipt-uncertain')
            return self.receipt_result(result)

    @staticmethod
    def signature(home, body):
        return hashlib.sha256(json.dumps([home.path, {k: v for k, v in body.items() if k not in ('preview', 'captain_words')}],
                                         sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def preview(self, home, body, current):
        return {'allowed': True, 'token': self.encode_preview({'signature': self.signature(home, body)})}
