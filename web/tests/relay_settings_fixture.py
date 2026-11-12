#!/usr/bin/env python3
"""Browser fixture, always isolated and automatic OFF; optional real extension."""
import json
import os
from pathlib import Path
import sys
from fixtures import fixture, start_fixture, bridge
from relay_fixture import extension_fixture
from relay_settings import RelaySettings
from test_deck_control import owner

root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
os.environ.update(HOME=str(root),XDG_CONFIG_HOME=str(root/'xdg'),XDG_STATE_HOME=str(root/'state'),
                  XDG_DATA_HOME=str(root/'data'),CODEX_HOME=str(root/'codex'),
                  CLAUDE_CONFIG_DIR=str(root/'claude'),HERDR_PLUGIN_STATE_DIR=str(root/'plugin-state'))
board,home=fixture(root)
base=Path(home.path);project=base/'projects/demo';project.mkdir(parents=True)
responses=owner(home)
responses['snapshot'].update(projects=[{'key':'project:demo','label':'Demo project','repository_project':'project:demo','rev':'r1'}],
    tasks=[{'key':'task:pending','title':'Pending task','state':'ready','project':'project:demo','repository_project':'project:demo','rev':'r1'}],sigue=['task:pending'])
(base/'work-snapshot.json').write_text(json.dumps(responses['snapshot']))
start_fixture(board,home)
if os.environ.get('CD_TEST_REAL_EXTENSION')=='1':
    extension=Path(os.environ['CD_TEST_EXTENSIONS_ROOT'])
    (base/'config').mkdir(exist_ok=True)
    (base/'config/context-relay.json').write_text(json.dumps({'relay_mode':'assisted'}))
    (base/'config/umbrales-relevo').write_text('claude: compactaciones:2 umbral:80%\ncodex: umbral:600K o compactaciones:5\n')
else:
    extension=extension_fixture(root/'extension',home.path)
board.relay_settings=RelaySettings(board.child_env,str(extension),
    nodes=lambda home:board.deck_controls.source(home).get('snapshot',{}).get('nodes',[]),proof_dir=root/'proof')
server=bridge.Server(('127.0.0.1',0),board,bridge.Security(8787));server.security=bridge.Security(server.server_port)
print('Fixture at http://127.0.0.1:'+str(server.server_port),flush=True)
try:server.serve_forever()
finally:server.server_close();board.stop()
