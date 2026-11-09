/* B3 through HTTP and an isolated browser. The synthetic owner never runs agents. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');

test('pause preview, scope signals, confirmation, queue and owner events',{timeout:180000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck-pause-signals-'));
  const env={...process.env,CD_TEST_PAUSE_SIGNALS:'1',CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-pause-signals-'+process.pid};
  for(const k of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[k];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),root],{env,stdio:['ignore','pipe','pipe']});
  const run=(...args)=>{const r=spawnSync('chrome-devtools-axi',args,{env,encoding:'utf8',timeout:60000,maxBuffer:2e6});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;};
  const evaluate=code=>{const out=run('eval',`async()=>JSON.stringify(await (${code})())`),m=out.match(/^result: (.*)$/m);assert.ok(m,out);let v=JSON.parse(m[1]);for(let i=0;i<4&&typeof v==='string';i++){try{v=JSON.parse(v);}catch{break;}}return v;};
  const wait='const wait=async f=>{for(let i=0;i<160;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw Error("Timed out");};';
  const calls=()=>fs.existsSync(path.join(root,'home/work-calls.jsonl'))?fs.readFileSync(path.join(root,'home/work-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
  const button=id=>`[...document.querySelectorAll('[data-node]')].find(e=>e.dataset.node.endsWith('${id}')&&e.getClientRects().length)?.querySelector('.pause-control button')`;
  const click=async(id,text)=>evaluate(`async()=>{${wait}document.querySelector('#${id.startsWith('project:')?'projects-view':'board-view'}').click();await wait(()=>${button(id)}?.textContent==='${text}'&&!${button(id)}.disabled);${button(id)}.click();return true;}`);
  const confirm=verb=>evaluate(`async()=>{${wait}await wait(()=>[...document.querySelectorAll('.pause-preview button')].some(b=>b.textContent==='${verb}'&&!b.disabled));[...document.querySelectorAll('.pause-preview button')].find(b=>b.textContent==='${verb}').click();return true;}`);
  const snapshot=path.join(root,'home/work-snapshot.json');
  const change=fn=>{const raw=JSON.parse(fs.readFileSync(snapshot));fn(raw);fs.writeFileSync(snapshot+'.tmp',JSON.stringify(raw));fs.renameSync(snapshot+'.tmp',snapshot);};
  let browser=false;
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),12000);child.stdout.on('data',c=>{out+=c;const m=out.match(/Fixture at (\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',c=>out+=c);child.on('exit',c=>reject(Error('Fixture '+c+' '+out)));});
    browser=true;run('open',url);run('resize','1440','1000');
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#agents-capacity').textContent==='Agentes 2 de 6');return document.querySelector('#agents-capacity .agents-count').title.includes('Firstmate cuenta 3 carriles ocupados');}`),true,'Agents count the live tasks shown in progress; Firstmate lanes stay visible on hover');
    evaluate(`async()=>{document.querySelector('#columns-nav button:last-child').click();return true;}`);
    const inherited=evaluate(`async()=>{const b=${button('task:inherited-signal')};return {text:b.textContent,scopeLink:b.classList.contains('pause-owner'),disabled:b.disabled};}`);
    assert.match(inherited.text,/Preparar entrega/);assert.equal(inherited.scopeLink,true);assert.equal(inherited.disabled,false,'Inherited pauses point to their owning scope');
    evaluate(`async()=>{${button('task:inherited-signal')}.click();return true;}`);
    assert.equal(calls().filter(c=>c.command==='pause.cancel').length,0,'Following an inherited pause never cancels it');
    change(raw=>{raw.crew=null;});
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#agents-capacity').textContent==='Agentes · sin dato');return true;}`),true);
    change(raw=>{raw.crew={agents_running:3,agents_cap:6};});
    evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#agents-capacity').textContent==='Agentes 2 de 6');return true;}`);
    assert.equal(evaluate(`async()=>{document.querySelector('#columns-nav button:nth-child(2)').click();const mine=document.querySelector('#columns-nav button:nth-child(2)').getAttribute('aria-pressed');document.querySelector('#columns-nav button:first-child').click();return mine==='true'&&document.querySelector('#columns-nav button:first-child').getAttribute('aria-pressed')==='true'&&document.querySelector('#board .request-title').getAttribute('aria-expanded')==='true';}`),true,'Request order mode preserves expanded pause scopes');
    for(const id of ['task:web','req:demo','project:deck']){
      await click(id,'Pausar');
      assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelector('.pause-preview')?.textContent.includes('Firstmate cerrará sus agentes'));return document.querySelector('#detail').hidden&&document.querySelector('.pause-preview').previousElementSibling.classList.contains('${id.startsWith('req:')?'request-head':id.startsWith('project:')?'mix':'task-card'}');}`),true);
      assert.equal(calls().filter(c=>c.command==='pause.request').length,0,'Preview never mutates');
      evaluate(`async()=>{[...document.querySelectorAll('.pause-preview button')].find(b=>b.textContent==='Cancelar').click();return true;}`);
    }
    assert.deepEqual(calls().map(c=>[c.command,c.operation.target]),[['pause.preview','task:web'],['pause.preview','req:demo'],['pause.preview','project:deck']]);
    await click('task:web','Pausar');confirm('Pausar');await click('task:web','Cancelar pausa');
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>${button('task:web')}?.textContent==='Pausar');return true;}`),true);
    assert.ok(calls().some(c=>c.command==='pause.cancel'));
    await click('req:demo','Pausar');confirm('Pausar');
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelector('[data-node$="req:demo"] [data-pause-state=pending]'));return document.querySelector('[data-node$="req:demo"] [data-pause-state=pending]').textContent;}`),'Pausando… 0 de 2 en punto seguro');
    assert.equal(evaluate(`async()=>document.querySelector('#board .request-row[data-node$="req:demo"]').closest('.request-group').dataset.k`),'paused');
    change(raw=>{const p=raw.pause_controls.find(p=>p.scope==='req:demo');p.agents_at_safe_point=1;});
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelector('[data-node$="req:demo"] [data-pause-state=pending]')?.textContent.includes('1 de 2'));return ${button('req:demo')}.disabled;}`),true,'Cannot cancel after a safe point');
    change(raw=>{const p=raw.pause_controls.find(p=>p.scope==='req:demo');Object.assign(p,{state:'paused',agents_at_safe_point:2,agents_closed:2});raw.events.push({event:'pause.confirmed',scope:'req:demo',at:'2026-11-08T19:00:00Z',agents_closed:2});});
    await click('req:demo','Reanudar');
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelector('.pause-preview')?.textContent.includes('Necesita 2 agentes; hay 3 de 6 en curso.'));return document.querySelector('#pause-events').textContent;}`),'Firstmate confirmó la pausa de Preparar entrega · ficticio: 2 agentes cerrados.');
    confirm('Reanudar');await click('req:demo','Dejar en pausa');
    assert.ok(calls().some(c=>c.command==='resume.request'));
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>${button('req:demo')}?.textContent==='Reanudar');return document.querySelectorAll('#pause-events p').length;}`),2);
    assert.ok(calls().some(c=>c.command==='resume.dequeue'));
    change(raw=>{raw.pause_controls.find(p=>p.scope==='req:demo').state='unconfirmed';});
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelector('[data-pause-state=unconfirmed]'));return ${button('req:demo')}.disabled;}`),true);
    change(raw=>{raw.pause_controls.find(p=>p.scope==='req:demo').state='resuming';});
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelector('[data-pause-state=resuming]'));return ${button('req:demo')}.disabled;}`),true);
    change(raw=>{raw.pause_controls.find(p=>p.scope==='req:demo').state='paused';raw.events.push({event:'resume.started_from_queue',scope:'req:demo',at:'2026-11-08T19:10:00Z'});});
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#pause-events').textContent.includes('desde la cola'));return document.querySelectorAll('#pause-events p').length;}`),3);
    await click('project:deck','Pausar');
    evaluate(`async()=>{${wait}await wait(()=>document.querySelector('.pause-preview')?.textContent.includes('Firstmate cerrará sus agentes'));return true;}`);
    change(raw=>{raw.rev='r2';for(const row of [...raw.projects,...raw.tasks])row.rev='r2';});
    confirm('Pausar');
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>[...document.querySelectorAll('.pause-preview button')].some(b=>b.textContent==='Revisar los datos actuales'));return true;}`),true);
    assert.equal(JSON.parse(fs.readFileSync(snapshot)).pause_controls.some(p=>p.scope==='project:deck'),false,'Stale preview never pauses work');
    evaluate(`async()=>{[...document.querySelectorAll('.pause-preview button')].find(b=>b.textContent==='Cancelar').click();return true;}`);
    run('resize','390','844');
    await click('req:demo','Reanudar');
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelector('.pause-preview')?.textContent.includes('Necesita 2 agentes'));const r=document.querySelector('.pause-preview').getBoundingClientRect();return document.documentElement.scrollWidth===innerWidth&&r.left>=0&&r.right<=innerWidth;}`),true);

    for(const c of calls())assert.ok(c.operation.expected_rev&&c.operation.actor==='captain');
    if(process.env.CD_TEST_EVIDENCE)fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'pause-signals.json'),JSON.stringify({calls:calls(),noPreviewMutations:true,mobileOverflow:0},null,2));
  }finally{child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(root,{recursive:true,force:true});}
});
