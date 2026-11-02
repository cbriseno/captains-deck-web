"""Disposable extension CLI double. Authorization always refuses; auto stays OFF."""
import json
from pathlib import Path

CLI = '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:];command=args[1]
def flag(name,default=None):
 return args[args.index(name)+1] if name in args else default
home=Path(flag('--home'));root=home.parent
state_path=home/'extension-state.json';state=json.loads(state_path.read_text())
request=flag('--request-id');revision=flag('--expected-revision')
with (home/'extension-calls.jsonl').open('a') as out:out.write(json.dumps({'args':args,'home':os.environ.get('FM_HOME'),'xdg':os.environ.get('XDG_CONFIG_HOME')})+'\\n')
if command=='status':
 print(json.dumps({'schema':'fm-extension-settings.v1','ok':True,'revision':str(state['generation']),
 'identity':{'home':str(home),'project':flag('--project'),'task_id':flag('--task-id')},
 'relay':{'mode':'assisted','automatic_enabled':False,'thresholds':{h:{'text':v,'source':'fixture'} for h,v in state['thresholds'].items()},'attempts':[],'requests':[]},
 'planning':{'scopes':{s:{'mode':state['planning'].get(s,'inherit')} for s in ('installation','home','project','task')}}}));sys.exit()
if command=='preflight':
 print(json.dumps({'schema':'fm-extension-settings-preflight.v1','can_authorize':state['can_authorize'] and flag('--harness')!=state.get('blocked_harness'),'eligible':False,'reasons':[], 'limits':{'window_seconds':1800,'daily_cap':4,'min_work_seconds':300,'safe_wait_seconds':600}}));sys.exit()
if command in ('receipt','request-status'):
 print(json.dumps(state['receipts'].get(request,{'schema':'fm-extension-settings-receipt.v1','request_id':request,'state':'absent'})));sys.exit()
if request in state['receipts']:
 print(json.dumps(state['receipts'][request]));sys.exit()
response={'schema':'fm-extension-settings-receipt.v1','request_id':request,'state':'rejected','code':'invalid_request','revision':str(state['generation']),'identity':{'installation':str(root/'xdg/fm-planning'),'home':str(home),'project':flag('--project'),'task_id':flag('--task-id')}}
if revision!=str(state['generation']):response.update(code='stale_revision',message='Fixture revision changed')
elif command=='authorize':response.update(code='authorization_required',message='Fixture deliberately refuses authorization')
elif command=='off':response.update(state='applied',code='applied')
elif command=='set':
 state['previous']={'thresholds':dict(state['thresholds']),'planning':dict(state['planning'])}
 if flag('--target')=='threshold':state['thresholds'][flag('--harness')]=flag('--spec')
 elif flag('--target')=='planning':state['planning'][flag('--scope')]=flag('--mode')
 response.update(state='applied',code='applied',undo_token='fixture-undo')
elif command=='undo' and state.get('previous'):
 state.update(state.pop('previous'));response.update(state='applied',code='applied')
if response['state']=='applied':state['generation']+=1;response['revision']=str(state['generation'])
state['receipts'][request]=response;state_path.write_text(json.dumps(state))
print(json.dumps(response));sys.exit(0 if response['state']=='applied' else 1)
'''


def extension_fixture(root, home):
    root=Path(root); home=Path(home)
    (root/'bin').mkdir(parents=True, exist_ok=True)
    path=root/'bin/fm-extension';path.write_text(CLI);path.chmod(0o755)
    (home/'config').mkdir(exist_ok=True)
    owner=home/'bin/fm-tasks-axi.sh'
    if not owner.exists():
        owner.write_text('#!/bin/sh\nexit 0\n');owner.chmod(0o755)
    (home/'extension-state.json').write_text(json.dumps({'generation':1,'can_authorize':True,
        'thresholds':{'claude':'compactaciones:2 umbral:80%','codex':'umbral:600K o compactaciones:5'},
        'planning':{'installation':'native','home':'inherit'},'receipts':{}}))
    return root
