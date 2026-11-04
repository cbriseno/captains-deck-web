/* Owner read failure/recovery through HTTP and the real polling consumer. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');
const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';

test('unknown observation is distinct from an explicit wait and inventory is diagnostic', {timeout:120000}, async () => {
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-observation-'));
  const env={...process.env,CD_WEB_LANGUAGE:'es',CD_TEST_INVENTORY:'1',CHROME_DEVTOOLS_AXI_SESSION:'deck-observation-'+process.pid};
  for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[key];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[],input)=>{const r=spawnSync(cli,[cmd,...args],{env,input,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{const out=run('run',[],`console.log(JSON.stringify(await page.eval(${code})));`);return JSON.parse(out.trim());};
  let browser=false;
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error(out)),12000);child.stdout.on('data',s=>{out+=s;const m=out.match(/(?:Fixture at|URL) ([^\s,]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',s=>out+=s);child.on('exit',c=>reject(new Error('Fixture '+c+' '+out)));});
    browser=true;run('open',[url]);
    const reading=async(expected,available=true)=>evaluate(`async()=>{let c;for(let i=0;i<160;i++){c=document.querySelector('#board [data-node$="task:web"]');const s=(await(await fetch('api/board')).json()).deck.sources[0];if(c?.dataset.state==='${expected}'&&s.available===${available}&&(${available}||document.querySelector('#notice').textContent))break;await new Promise(r=>setTimeout(r,100));}const api=await(await fetch('api/board')).json(),s=api.deck.sources[0];return {state:c?.dataset.state,column:c?.closest('section')?.id,text:c?.querySelector('.card-line')?.textContent || '',bar:!!c?.querySelector('[role=progressbar]'),alias:c?.querySelector('.node-id')?.textContent,available:s.available,owner:s.snapshot.nodes.find(x=>x.task==='web').state,diagnostics:api.diagnostics,synthetic:api.columns.flatMap(c=>c.cards).some(c=>c.task==='(main-inventory)'),diagnosticText:document.querySelector('#deck-diagnostics')?.textContent,diagnosticControls:document.querySelectorAll('#deck-diagnostics button,#deck-diagnostics select,#deck-diagnostics .node-id').length,unknown:[...document.querySelectorAll('#board .task-card')].filter(x=>x.dataset.node.endsWith('task:unverified-worker')).map(x=>[x.dataset.state,x.closest('section')?.id]),notice:document.querySelector('#notice').textContent,draft:document.querySelector('#detail-content textarea[name=removal-reason]')?.value,sameDraft:window.observationDraft===document.querySelector('#detail-content textarea[name=removal-reason]'),dependent:document.querySelector('#board [data-node$="task:dependent"]')?.closest('section')?.id,paused:document.querySelector('#board [data-node$="task:integration"]')?.closest('section')?.id};}`);
    const initial=await reading('active');const counts=evaluate(`()=>{const section=document.querySelector('#state-column-now');const subs=[...section.querySelectorAll('.subcol')];return {now:Number(section.querySelector('.col-h .n').textContent),running:Number(subs[0].querySelector('.sub-h .n').textContent),queue:Number(subs.find(x=>x.querySelector('h3').textContent==='Siguen')?.querySelector('.sub-h .n')?.textContent||0)};}`);assert.equal(counts.now,counts.running);assert.equal(initial.column,'state-column-now');assert.equal(initial.available,true);if(process.env.CD_TEST_EXPECT_BUG!=='1')assert.deepEqual(initial.unknown,[['unknown','state-column-now']]);
    run('run',[],`await page.click('#board [data-node$="task:web"] .card-open');await page.wait('#detail-content textarea[name=removal-reason]');await page.fill('#detail-content textarea[name=removal-reason]','Unsent observation draft');await page.eval(()=>{window.observationDraft=document.querySelector('#detail-content textarea[name=removal-reason]');});`);
    fs.writeFileSync(path.join(proof,'home/work-source-failed'),'busy');
    const failed=await reading('active',false);assert.equal(failed.available,false);assert.equal(failed.owner,'active');
    if(process.env.CD_TEST_EXPECT_BUG==='1'){
      assert.equal(failed.column,'state-column-waiting');assert.match(failed.text,/última vez/);
      console.log(JSON.stringify({reproduced:true,initial,failed}));return;
    }
    assert.equal(failed.column,'state-column-now');assert.equal(failed.bar,true);assert.ok(failed.notice);assert.equal(failed.alias,initial.alias);assert.equal(failed.sameDraft,true);assert.equal(failed.draft,'Unsent observation draft');
    for(const state of [initial,failed]){assert.equal(state.synthetic,false);assert.match(state.diagnosticText,/fixture-missing/);assert.equal(state.diagnosticControls,0);assert.equal(state.dependent,'state-column-waiting');assert.equal(state.paused,'state-column-paused');}
    const aged=evaluate(`async()=>{const real=Date.now;Date.now=()=>real()+31000;for(let i=0;i<100;i++){if(document.querySelector('#board [data-node$="task:web"] .prog[data-freshness=stale]'))break;await new Promise(r=>setTimeout(r,100));}const p=document.querySelector('#board [data-node$="task:web"] .prog');return {bar:!!p.querySelector('[role=progressbar]'),text:p.textContent,freshness:p.dataset.freshness};}`);assert.equal(aged.freshness,'stale');assert.equal(aged.bar,true);assert.match(aged.text,/desactualizad/i);
    fs.unlinkSync(path.join(proof,'home/work-source-failed'));
    const restored=await reading('active');assert.equal(restored.available,true);assert.equal(restored.bar,true);assert.equal(restored.sameDraft,true);assert.equal(restored.draft,'Unsent observation draft');
    // A successful fresh response with an actual dependency must still move immediately.
    const p=path.join(proof,'home/work-snapshot.json'),raw=JSON.parse(fs.readFileSync(p));const web=raw.tasks.find(x=>x.key==='task:web');web.state='waiting_dep';web.reason='Explicit dependency';web.blocked_by=[{ref:'task:next',open:true}];fs.writeFileSync(p,JSON.stringify(raw));
    const waiting=await reading('waiting');assert.equal(waiting.column,'state-column-waiting');assert.equal(waiting.available,true);
    raw.tasks=raw.tasks.filter(x=>x.key!=='task:web');fs.writeFileSync(p,JSON.stringify(raw));
    const missing=evaluate(`async()=>{for(let i=0;i<160;i++){const b=await(await fetch('api/board')).json();if(!b.deck.sources[0].snapshot.nodes.some(n=>n.task==='web'))return true;await new Promise(r=>setTimeout(r,100));}return false;}`);assert.equal(missing,true,'Successful absence must replace the retained inventory');
    assert.equal(fs.existsSync(path.join(proof,'home/work-calls.jsonl')),false);
    const evidence={initial,failed,restored,waiting,missing,mutations:false};
    if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'state-observation.json'),JSON.stringify(evidence,null,2));}
    console.log(JSON.stringify(evidence));
  }finally{child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(proof,{recursive:true,force:true});}
});
