"""Disposable HTTP owner for slow pause/resume and lost-reply checks."""
import json
import os
from pathlib import Path
import sys
import threading
import time
from types import SimpleNamespace

from fixtures import bridge
from deck_control import project_snapshot

root = Path(sys.argv[1])
home = root / 'home'
(home / 'bin').mkdir(parents=True)
owner = '''import json,os,sys,time
from pathlib import Path
p=Path(os.environ['FM_HOME']);verb=sys.argv[2]
if verb=='capabilities':
 print(json.dumps({'schema':'fm-work-capabilities.v1','contract_major':1,'ops':['set_pause','clear_pause'],'signals':['pause.preview','pause.request','resume.preview','resume.request']}));sys.exit()
if verb=='request-status':
 print((p/('request-'+sys.argv[4]+'.json')).read_text());sys.exit()
b=json.load(sys.stdin)
impact={'affected':{'running':['task:slow'],'queued':[],'waiting_behind':[]}}
if verb.endswith('.preview'):
 print(json.dumps(dict(impact=impact,can_pause=True,agents_needed=1,agents_running=0,agents_cap=2)));sys.exit()
with (p/'writes').open('a') as f:f.write(verb+'\\n')
time.sleep(9)
raw=json.loads((p/'snapshot.json').read_text());paused=verb=='pause.request'
raw['tasks'][0].update(state='paused_own' if paused else 'running',pause={'own':{'kind':'parked'} if paused else None,'safe_point':'paused' if paused else 'none'})
result=dict(request_id=b['request_id'],state='applied')
(p/('request-'+b['request_id']+'.json')).write_text(json.dumps(result))
(p/'snapshot.tmp').write_text(json.dumps(raw));(p/'snapshot.tmp').replace(p/'snapshot.json')
print(json.dumps(result))
'''
(home / 'bin/owner.py').write_text(owner)
script = home / 'bin/fm-tasks-axi.sh'
script.write_text('#!/bin/sh\nexec python3 "$(dirname "$0")/owner.py" "$@"\n')
script.chmod(0o755)
raw = dict(projects=[dict(key='project:test', label='Prueba', rev='r1')], tasks=[
    dict(key='task:slow', title='Encargo de prueba', project='project:test', rev='r1', state='running')])
(home / 'snapshot.json').write_text(json.dumps(raw))
h = bridge.fm.Home('Prueba', str(home), 'captain')
board = bridge.Board(root / 'web', collector=SimpleNamespace(snapshot=lambda: SimpleNamespace(homes=[h])), language='es')
projection = board.projection
identity = board.home_identity(h)
model = SimpleNamespace(rows={'slow': {'title': 'Encargo de prueba'}}, activity={'slow': {'state': 'busy'}},
                        presentations={'slow': {'presentation': {}}}, history={})
projection.readers[identity] = dict(home=h, model=model)
capabilities = board.deck_controls.invoke(h, 'capabilities')
stop = threading.Event()
def update():
    previous = None
    while not stop.is_set():
        text = (home / 'snapshot.json').read_text()
        if text != previous:
            with projection.condition:
                projection.sources[identity] = dict(home=identity, available=True, error='', answerable=False,
                    snapshot=project_snapshot(json.loads(text)), capabilities=capabilities)
                projection.loading = False
                projection.publish()
            previous = text
        stop.wait(.05)
thread = threading.Thread(target=update)
thread.start()
server = bridge.Server((bridge.LOOPBACK, 0), board, bridge.Security(8788))
server.security = bridge.Security(server.server_port)
print('Fixture at ' + bridge.local_origin(server.server_port), flush=True)
try:
    server.serve_forever()
finally:
    stop.set()
    thread.join()
    server.server_close()
