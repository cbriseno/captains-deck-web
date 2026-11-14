/* Exercise meaningful ordering through the real renderer and disposable owner. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),test=require('node:test');
const cli=process.env.CD_TEST_BROWSER||'chrome-devtools-axi';
test('recent order ignores observations, breaks ties by identity, and traces rendered cursor',{timeout:120000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-order-'));
  const env={...process.env,CD_WEB_LANGUAGE:'es',CD_TEST_RELATIONS:'1',FM_DIAGNOSTICS_HOME:path.join(proof,'diagnostics'),CHROME_DEVTOOLS_AXI_SESSION:'deck-order-'+process.pid};
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[])=>{const r=spawnSync(cli,[cmd,...args],{env,encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evalJS=code=>{let x=JSON.parse(run('eval',[code]).match(/^result: (.*)$/m)[1]);while(typeof x==='string'){try{x=JSON.parse(x);}catch{break;}}return x;};
  try {
    const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('fixture startup')),15000);child.stdout.on('data',c=>{output+=c;const m=output.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.on('exit',code=>{clearTimeout(timer);reject(Error('fixture exit '+code));});});
    const file=path.join(proof,'home/work-snapshot.json'),snapshot=JSON.parse(fs.readFileSync(file));
    const tasks=snapshot.tasks.filter(x=>['task:dependent','task:next','task:second'].includes(x.key));
    const stamp=value=>({value,precision:'instant',source:'fleet.entity:task.changed'});
    snapshot.requests=snapshot.requests.filter(r=>!['waiting','paused','isolated'].includes(r.id));
    for(const [i,x] of tasks.entries()){x.state='waiting_dep';x.pause={own:null,inherited:null};x.updated=stamp('2026-11-10T10:00:00Z');x.request={id:'order-'+i,label:'Order '+i,project:'project:deck'};snapshot.requests.unshift({id:x.request.id,key:'request:'+x.request.id,label:x.request.label,project:x.request.project,tasks:[x.key]});}
    const publish=()=>{fs.writeFileSync(file,JSON.stringify(snapshot));fs.appendFileSync(path.join(proof,'home/state/fleet-ledger.jsonl'),JSON.stringify({home:path.join(proof,'home'),event:'fixture.snapshot',value:snapshot})+'\n');};
    publish();run('open',[url]);
    const read=()=>evalJS(`() => [...document.querySelectorAll('.request-group[data-k=waiting] .request-row')].map(x=>x.dataset.node.split(':req:').pop()).filter(x=>x.startsWith('order-'))`);
    const wait=async expected=>{for(let i=0;i<60;i++){if(JSON.stringify(read())===JSON.stringify(expected))return;await new Promise(r=>setTimeout(r,200));}assert.deepEqual(read(),expected);};
    await wait(['order-0','order-1','order-2']);
    evalJS(`() => {window.orderEvents=[];window.DeckTrace.setSender(async e=>window.orderEvents.push(...e));return true;}`);
    tasks[2].observed=stamp('2026-11-12T10:00:00Z');tasks[2].usage={tokens:500};publish();
    await new Promise(r=>setTimeout(r,2500));assert.deepEqual(read(),['order-0','order-1','order-2']);
    tasks[2].updated=stamp('2026-11-13T10:00:00Z');publish();await wait(['order-2','order-0','order-1']);
    for(const width of [1970,390]){run('resize',[String(width),'1250']);assert.equal(evalJS('() => document.documentElement.scrollWidth-innerWidth'),0);}
    const trace=evalJS(`async () => {await window.DeckTrace.flush(true);return window.orderEvents.filter(e=>e.e==='request.order');}`);
    assert(trace.some(e=>e.old_position===3&&e.new_position===1&&e.new_key>e.old_key&&e.order_source==='fleet.entity:task.changed'&&e.cursor));
    assert(trace.some(e=>e.old_position===e.new_position&&e.old_key===e.new_key));
  } finally {try{run('stop');}finally{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});fs.rmSync(proof,{recursive:true,force:true});}}
});
