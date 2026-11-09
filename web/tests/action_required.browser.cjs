/* Explicit action facet + newly affected creation labels over real HTTP. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');
const cli=process.env.CD_TEST_BROWSER||'chrome-devtools-axi';

test('action persists until owner closure; precise creation ages stay separate from updates',{timeout:150000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-action-'));
  const env={...process.env,CD_TEST_ACTIONS:'1',CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-action-'+process.pid};
  for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[key];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[],input)=>{const r=spawnSync(cli,[cmd,...args],{env,input,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(${code})));`).trim());
  let browser=false;
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error(out)),12000);child.stdout.on('data',s=>{out+=s;const m=out.match(/(?:Fixture at|URL) ([^\s,]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',s=>out+=s);child.on('exit',c=>reject(new Error('Fixture '+c+' '+out)));});
    const snapshot=path.join(proof,'home/work-snapshot.json'),original=fs.readFileSync(snapshot,'utf8');
    browser=true;run('open',[url]);run('resize',['1440','1000']);
    const initial=evaluate(`async()=>{for(let i=0;i<120&&!document.querySelector('#board .action-card');i++)await new Promise(r=>setTimeout(r,100));const b=await(await fetch('api/board')).json(),a=b.columns.flatMap(c=>c.cards).find(c=>c.task==='chat-action'),free=b.columns.flatMap(c=>c.cards).find(c=>c.task==='freeform-question'),card=document.querySelector('#board .action-card'),get=id=>document.querySelector('[data-node$="'+id+'"] [data-age-label="Created group"]')?.textContent;const created=document.querySelector('#board [data-node$="task:web"] [data-age-label=Created]'),legacy=document.querySelector('#board [data-node$="task:next"] [data-age-label=Created]');return {action:a,freeform:free.attention_kind,column:card.closest('section').id,text:card.textContent,forbidden:card.querySelectorAll('textarea,select,.option-list,.option-choice,.prog,.prog-phase,.pause-control,.card-ctl').length,creation:created.textContent,creationTitle:created.title,legacy:legacy.textContent,legacyTitle:legacy.title,project:get('project:deck'),sub:get('subproject:deck/ux'),work:document.querySelector('#board [data-node$="task:dependent"]').closest('section').id};}`);
    assert.equal(initial.action.attention_kind,'action');assert.equal(initial.column,'state-column-needs');assert.equal(initial.freeform,'question');assert.equal(initial.forbidden,0);
    assert.match(initial.text,/Acción requerida/);assert.match(initial.text,/Indica en el chat/);assert.match(initial.text,/Hazlo en el chat/);assert.match(initial.text,/T-AC2/);assert.equal(initial.work,'state-column-waiting');
    assert.match(initial.creation,/Creada hace 12 minutos/);assert.match(initial.creationTitle,/2026/);assert.match(initial.project,/hace 3 horas/);assert.match(initial.sub,/hace 2 días/);assert.doesNotMatch(initial.legacy,/hoy|hace/);assert.match(initial.legacyTitle,/hora/);
    run('run',[],`await page.click('#board .action-card .card-open');`);
    const opened=evaluate(`()=>({text:document.querySelector('#detail-content').textContent,forbidden:document.querySelectorAll('#detail-content textarea,#detail-content select,#detail-content .option-choice,#detail-content .prog,#detail-content .deck-controls').length,origin:[...document.querySelectorAll('#detail-content button')].some(b=>b.textContent==='Ir a la tarea de origen'&&!b.disabled)})`);
    assert.equal(opened.forbidden,0);assert.equal(opened.origin,true);assert.match(opened.text,/verifique que la acción se resolvió/);
    run('run',[],`await page.press('Escape');`);
    assert.equal(fs.readFileSync(snapshot,'utf8'),original,'Viewing/reading/closing never changes owner state');
    run('open',[url]);
    const persisted=evaluate(`async()=>{for(let i=0;i<100&&!document.querySelector('#board .action-card');i++)await new Promise(r=>setTimeout(r,100));return !!document.querySelector('#board .action-card');}`);assert.equal(persisted,true);
    const raw=JSON.parse(original),web=raw.tasks.find(x=>x.key==='task:web'),action=raw.tasks.find(x=>x.key==='task:chat-action');
    const created=JSON.stringify(web.created);web.updated={value:new Date().toISOString(),precision:'instant',source:'fixture.update'};
    action.question.answer={value:'allow',application:{state:'pending'}};fs.writeFileSync(snapshot,JSON.stringify(raw));
    const updated=evaluate(`async()=>{for(let i=0;i<150;i++){const text=document.querySelector('#board [data-node$="task:web"] [data-age-label=Updated]')?.textContent;if(text?.includes('ahora'))break;await new Promise(r=>setTimeout(r,100));}const b=await(await fetch('api/board')).json();return {creation:document.querySelector('#board [data-node$="task:web"] [data-age-label=Created]').textContent,updated:document.querySelector('#board [data-node$="task:web"] [data-age-label=Updated]').textContent,action:!!document.querySelector('#board .action-card'),created:b.deck.sources[0].snapshot.nodes.find(n=>n.task==='web').created_at};}`);
    assert.match(updated.creation,/hace 12 minutos/);assert.match(updated.updated,/ahora/);assert.equal(updated.action,true);assert.equal(JSON.stringify(updated.created),created);
    run('run',[],`await page.click('#board [data-node$="task:web"] .card-open');await page.wait('#detail-content [data-age-label=Created]');`);
    assert.match(evaluate(`()=>document.querySelector('#detail-content [data-age-label=Created]').textContent`),/hace 12 minutos/);
    run('run',[],`await page.press('Escape');await page.click('#board .action-card .card-open');`);
    fs.writeFileSync(path.join(proof,'home/work-source-failed'),'read unavailable');
    const unavailable=evaluate(`async()=>{let b;for(let i=0;i<150;i++){b=await(await fetch('api/board')).json();if(!b.deck.sources[0].available)break;await new Promise(r=>setTimeout(r,100));}return {available:b.deck.sources[0].available,card:!!document.querySelector('#board .action-card'),kind:b.columns.flatMap(c=>c.cards).find(c=>c.task==='chat-action')?.attention_kind};}`);
    assert.equal(unavailable.available,false);assert.equal(unavailable.kind,'action');assert.equal(unavailable.card,true);
    // Only a later explicit owner-resolved observation removes the action.
    action.question.open=false;action.state='done';fs.writeFileSync(snapshot,JSON.stringify(raw));fs.unlinkSync(path.join(proof,'home/work-source-failed'));
    const resolved=evaluate(`async()=>{let b;for(let i=0;i<150;i++){b=await(await fetch('api/board')).json();if(b.deck.sources[0].available&&!document.querySelector('#board .action-card'))break;await new Promise(r=>setTimeout(r,100));}return {action:!!document.querySelector('#board .action-card'),open:document.querySelector('#detail').hidden===false,freeform:b.columns.flatMap(c=>c.cards).find(c=>c.task==='freeform-question')?.attention_kind,origin:document.querySelector('#board [data-node$="task:dependent"]')?.closest('section').id};}`);
    assert.equal(resolved.action,false);assert.equal(resolved.open,false);assert.equal(resolved.freeform,'question');assert.equal(resolved.origin,'state-column-waiting');
    assert.equal(fs.existsSync(path.join(proof,'home/work-calls.jsonl')),false);assert.equal(fs.existsSync(path.join(proof,'home/mutations.jsonl')),false);
    if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'action-required.json'),JSON.stringify({initial,opened,persisted,updated,unavailable,resolved,ownerControlMutations:false},null,2));}
  }finally{child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(proof,{recursive:true,force:true});}
});
