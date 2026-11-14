/* Seeded Mac report cases through the real HTTP projection and Deck UI. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),test=require('node:test');
test('Mac regression walkthrough: attention, final, missing worker, activity and project',{timeout:180000},async t=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-mac-'));
  const env={...process.env,CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-mac-'+process.pid};
  for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[key];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[],input)=>{const r=spawnSync(process.env.CD_TEST_BROWSER||'chrome-devtools-axi',[cmd,...args],{env,input,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(${code})));`).trim());
  const journal=path.join(proof,'home/state/fleet-ledger.jsonl');
  const event=value=>fs.appendFileSync(journal,JSON.stringify({home:path.join(proof,'home'),...value})+'\n');
  const wait='const wait=async f=>{for(let i=0;i<160;i++){if(await f())return;await new Promise(r=>setTimeout(r,50));}throw new Error("Timed out");};';
  let browser=false;
  try{
    const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(output)),15000);child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',chunk=>output+=chunk);child.on('exit',code=>reject(new Error('Fixture '+code+' '+output)));});
    const snapshot=JSON.parse(fs.readFileSync(path.join(proof,'home/work-snapshot.json'))),now=Date.now();
    const stamp=age=>({value:new Date(now-age).toISOString(),precision:'instant',source:'fixture.completion'});
    const row=(id,extra={})=>({key:'task:'+id,title:id,state:'done',backlog_state:'done',project:'project:deck',request:{id:'mac-'+id,label:id,project:extra.project||'project:deck'},rev:'mac-seeded',outcome:{role:'final',review:'needed'},completed:stamp(3600000),...extra});
    snapshot.tasks=[...snapshot.tasks.filter(x=>x.key==='task:ask'),
      row('recent'),row('historical',{completed:stamp(3*86400000),updated:stamp(0)}),
      row('undated',{completed:null,updated:stamp(0)}),row('reviewed',{outcome:{role:'final',review:'done'}}),
      row('cancelled',{closure:{kind:'cancelled'}}),
      row('final-open',{state:'running',backlog_state:'in_flight',completed:null,worker_liveness:{state:'alive'}}),
      row('missing',{state:'ready',backlog_state:'in_flight',outcome:null,worker_liveness:{state:'dead'}}),
      ...['launch','native'].map(id=>row(id,{state:'running',backlog_state:'in_flight',outcome:null,worker_liveness:{state:'alive'}})),
      row('unresolved',{state:'ready',backlog_state:'queued',project:'project:unlisted',outcome:null})];
    event({event:'fixture.snapshot',value:snapshot});
    for(const [task,source,kind] of [['final-open','codex','turn-start'],['launch','fm-spawn','launch-brief'],['native','codex','turn-start']])event({event:'agent.activity',task,value:{gen:'fixture',seq:1,state:'busy',source,event:kind}});
    browser=true;run('open',[url]);
    const read=()=>evaluate(`async()=>{${wait}await wait(()=>document.querySelector('.review-card[data-node$="task:recent"]'));const expand=()=>{for(const b of document.querySelectorAll('.request-group-head button[aria-expanded=false],.request-title[aria-expanded=false]'))b.click();};expand();expand();const board=await(await fetch('api/board')).json();document.querySelector('#projects-view').click();const project=document.querySelector('#project-tree [data-node$="project:unlisted"]')?.textContent;document.querySelector('#board-view').click();expand();expand();return {reviews:[...document.querySelectorAll('#board > .attention-list article.review-card')].map(x=>x.dataset.node.split('task:').pop()).sort(),cards:Object.fromEntries(['historical','undated','final-open','missing','unresolved','launch','native'].map(id=>{const c=document.querySelector('#board .request-table .task-card[data-node$="task:'+id+'"]');return [id,{state:c?.dataset.state,column:c?.closest('.request-group')?.id,text:c?.textContent}];})),activity:Object.fromEntries(board.columns.flatMap(x=>x.cards).map(c=>[c.task,c.activity.kind])),project,decisions:document.querySelectorAll('#board .qcard').length,overflow:document.documentElement.scrollWidth>innerWidth};}`);
    const evidence={};
    for(const [width,height] of [[1970,1250],[390,844]]){
      run('resize',[String(width),String(height)]);const result=read();evidence[width]=result;
      await t.test('recent-or-open filter at '+width,()=>{assert.deepEqual(result.reviews,['final-open','recent']);assert.equal(result.decisions,1);for(const id of ['historical','undated'])assert.equal(result.cards[id].column,'state-column-done');assert.equal(result.overflow,false);});
      await t.test('N1 final result awaits closure at '+width,()=>{assert.equal(result.cards['final-open'].column,'state-column-waiting');assert.equal(result.activity['final-open'],'finished');assert.match(result.cards['final-open'].text,/Lista, sin cerrar/);});
      await t.test('N3 missing worker is outside active work and queue at '+width,()=>{assert.equal(result.cards.missing.column,'state-column-waiting');assert.equal(result.cards.missing.state,'waiting');assert.equal(result.activity.missing,'missing');assert.match(result.cards.missing.text,/Sin agente, la tarea sigue abierta/);});
      await t.test('N5 native activity differs from launch at '+width,()=>{assert.equal(result.activity.launch,'unknown');assert.equal(result.activity.native,'working');assert.ok(!result.cards.launch.text.includes('Trabajando ahora'));assert.ok(result.cards.native.text.includes('Trabajando ahora'));});
      await t.test('N6 unresolved project has an explicit label at '+width,()=>assert.match(result.project,/Proyecto sin resolver: unlisted/));
      if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,'seeded-'+width+'.png')]);}
    }
    // A new native turn replaces launch uncertainty through normal polling.
    event({event:'agent.activity',task:'launch',value:{gen:'fixture',seq:2,state:'busy',source:'codex',event:'turn-start'}});
    assert.equal(evaluate(`async()=>{${wait}await wait(async()=>{const b=await(await fetch('api/board')).json();return b.columns.flatMap(x=>x.cards).some(c=>c.task==='launch'&&c.activity.kind==='working');});return true;}`),true);
    assert.equal(fs.existsSync(path.join(proof,'home/mutations.jsonl')),false);
    if(process.env.CD_TEST_EVIDENCE)fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'seeded.json'),JSON.stringify(evidence,null,2));
  }finally{if(browser)run('stop');child.kill('SIGTERM');if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));fs.rmSync(proof,{recursive:true,force:true});}
});
