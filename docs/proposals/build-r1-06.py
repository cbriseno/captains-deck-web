#!/usr/bin/env python3
"""Bundle the real Deck renderer and an isolated HTTP fixture into an offline proposal.

Usage: python3 build-r1-06.py BOARD_JSON LOCALE_JSON OUTPUT_HTML [REVIEW_URL]
Inputs must come from approved_fixture.py, never a personal Firstmate endpoint.
"""
import copy
import base64
import html
import json
from pathlib import Path
import re
import sys

here = Path(__file__).resolve().parent
static = here.parents[1] / 'web/static'
board, locale = (json.loads(Path(p).read_text()) for p in sys.argv[1:3])
source = board['deck']['sources'][0]
snapshot = source['snapshot']
seed = next(n for n in snapshot['nodes'] if n.get('task') == 'web')
project = next(n for n in snapshot['nodes'] if n['id'] == 'project:deck')
project['title'] = 'Deck · demostración'
snapshot.update(nodes=[project], edges=[], requests=[], sigue=[], pause_controls=[], events=[])
source['capabilities'] = {}
cases = [('measured','Conectar el historial','active'), ('unmeasured','Investigar la conexión','active'),
         ('waiting','Verificar desde el teléfono','waiting'), ('parked','Revisar la propuesta','paused'),
         ('stale','Preparar la siguiente entrega','unknown')]
for index, (case, title, state) in enumerate(cases):
    node = copy.deepcopy(seed)
    node.update(id='task:'+case,task=case,title=title,parent='project:deck',state=state,
                alias='T-DE'+str(index+1),raw={},question={'open':False},demoState=case,
                progress=None,declared_progress=None,phase=None,request=None,
                pause={'own':False,'inherited':[],'can_pause':False,'can_resume':False},
                progress_evidence={'freshness':'missing','current':False})
    if case == 'measured':
        node['progress'] = {'done':2,'completed':2,'total':5,'steps':[{'label':s,'state':'done' if i<2 else 'active' if i==2 else 'todo'} for i,s in enumerate(['Lectura','Diseño','Conexión','Comprobación','Entrega'])]}
        node['progress_evidence'] = {'freshness':'current','current':True}
    if case == 'parked': node['pause'].update(own=True,state='paused',reason='Espera revisión')
    node['request'] = {'id':case,'label':title,'project':'project:deck'}
    snapshot['nodes'].append(node)
    snapshot['requests'].append({'id':case,'label':title,'project':'Deck · demostración','project_key':'project:deck','tasks':[node['id']],'updated_at':node['updated_at']})
for column in board['columns']: column['cards'] = []
board['history'] = []
def js(value): return json.dumps(value,ensure_ascii=False).replace('</','<\/')
boot = '''window.EventSource=class{addEventListener(){}close(){}};
window.fetch=async(path,options={})=>{const p=String(path);let data={};let ok=true;
if(options.method==='POST'){ok=false;data={error:'Demostración: las acciones reales están desactivadas.'};}
else if(p.includes('api/locale'))data=LOCALE;
else if(p.includes('api/board'))data=BOARD;
else if(p.includes('api/receipts'))data={receipts:[]};
else data={events:[],records:[],sources:[]};
return {ok,status:ok?200:403,json:async()=>structuredClone(data)};};
try{localStorage.setItem('deck-closed','[]');localStorage.setItem('deck-animations','false');localStorage.setItem('deck-modo','light');}catch{}
document.documentElement.dataset.concept='a';document.documentElement.dataset.motion='true';
'''.replace('LOCALE',js(locale)).replace('BOARD',js(board))
page = (static/'index.html').read_text()
scripts = re.findall(r'<script src="([^"]+)"[^>]*></script>',page)
page = re.sub(r'<script src="[^"]+"[^>]*></script>','',page)
page = re.sub(r'<link[^>]+href="([^"]+\.css)"[^>]*>',lambda m:'<style>'+ (static/m[1]).read_text()+'</style>',page)
page = re.sub(r'<link[^>]+rel="manifest"[^>]*>','',page)
page = re.sub(r'url\([\'\"]?([^\)\'\"]+\.svg)[\'\"]?\)',lambda m:'url(data:image/svg+xml;base64,'+base64.b64encode((static/m[1].lstrip('/')).read_bytes()).decode()+')',page)
page = page.replace('</head>','<script>'+boot+'</script><style>'+(here/'r1-06-demo.css').read_text()+'</style></head>')
bundle = '<script>'+(here/'r1-06-demo.js').read_text()+'</script>'
for name in scripts:
    content = (static/name).read_text()
    if name == 'app.js': content = re.sub(r"^if \('serviceWorker' in navigator\).*$", '', content, flags=re.M)
    if name == 'deck-ui.js':
        content = content.replace("animations:pref('deck-animations',true)", "animations:pref('deck-animations',false)")
        content = content.replace("function progress(x, detail=false, compact=false) {", "function progress(x, detail=false, compact=false) { return window.proposalProgress(x,detail,compact); /* proposal only */")
    bundle += '<script>'+content.replace('</script','<\/script')+'</script>'
page = page.replace('</body>',bundle+'<script>window.installProposalPatterns();</script></body>')
template = (here/'r1-06-progress.html').read_text()
if len(sys.argv)>4: template=template.replace('<footer>','<footer><a href="'+html.escape(sys.argv[4],quote=True)+'" target="_blank" rel="noopener">Revisar en Lavish</a> · ')
Path(sys.argv[3]).write_text(template.replace('<!--DECK_FRAME-->', '<iframe id="demo" title="Deck real con datos ficticios" srcdoc="'+html.escape(page,quote=True)+'"></iframe>'))
