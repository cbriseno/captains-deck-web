"""Static synthetic API for detail navigation; no owner or personal data."""
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bridge
from deck_control import project_snapshot

tasks = [dict(key='task:origin', title='Origin task', state='running',
              blocked_by=[dict(ref='task:destination', open=False)]),
         dict(key='task:destination', title='Destination task', state='done',
              question=dict(open=False, call=dict(question='Closed question')))]
requests = []
for task, name in zip(tasks, ['origin', 'destination']):
    task.update(project='project:demo', request=dict(id=name))
    requests.append(dict(id=name, label=name.title() + ' request',
                         project='project:demo', tasks=[task['key']]))
requests[0]['usage'] = dict(tasks={}, by=[], unknown=[])
snapshot = project_snapshot(dict(projects=[dict(key='project:demo', label='Demo')],
                                 tasks=tasks, requests=requests))
source = dict(home='fixture', available=True, snapshot=snapshot, capabilities={})
body = dict(cursor='1', csrf='fixture', loading=False, server_at=time.time(),
            homes=[dict(id='fixture', label='Synthetic')],
            sources=[dict(home='fixture', checked_at=time.time(), error='')],
            columns=[dict(id=k, cards=[]) for k, _ in bridge.COLUMNS],
            deck=dict(sources=[source]), diagnostics=[], history=[])


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(bridge.STATIC), **kwargs)

    def do_GET(self):
        if self.path.startswith('/api/'):
            if self.path.startswith('/api/stream'):
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.end_headers()
                self.wfile.write(b': synthetic fixture\n\n')
                return
            value = (body if self.path.startswith('/api/board') else
                     dict(locale='en', messages={}) if self.path.startswith('/api/locale') else
                     dict(events=[], agents={}) if self.path.startswith('/api/timeline') else {})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(value).encode())
            return
        super().do_GET()

    def do_POST(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{}')


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    print(f'Fixture at http://127.0.0.1:{server.server_port}', flush=True)
    server.serve_forever()
