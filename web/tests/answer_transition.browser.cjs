/* Owner answer application, rather than the presence of an old answer, controls the reading signal. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),test=require('node:test');
test('reading signal follows owner answer application',{timeout:120000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck-answer-state-'));
  const env={...process.env,CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-answer-state-'+process.pid};
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),root],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[])=>{const r=spawnSync('chrome-devtools-axi',[cmd,...args],{env,encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{const m=run('eval',[code]).match(/^result: (.*)$/m);assert.ok(m);let v=JSON.parse(m[1]);while(typeof v==='string'){try{v=JSON.parse(v);}catch{break;}}return v;};
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),15000);child.stdout.on('data',c=>{out+=c;const m=out.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',c=>out+=c);child.on('exit',c=>reject(Error(out+' '+c)));});
    const file=path.join(root,'home/work-snapshot.json'),snapshot=JSON.parse(fs.readFileSync(file));
    const row=snapshot.tasks.find(x=>x.key==='task:web'),publish=()=>{fs.writeFileSync(file,JSON.stringify(snapshot));fs.appendFileSync(path.join(root,'home/state/fleet-ledger.jsonl'),JSON.stringify({home:path.join(root,'home'),event:'fixture.snapshot',value:snapshot})+'\n');};
    run('open',[url]);row.recorded_answers=[{application:{state:'pending'}}];publish();
    const wait=expected=>evaluate(`async()=>{for(let i=0;i<180;i++){if(!!document.querySelector('.reading-note')===${expected})return true;await new Promise(r=>setTimeout(r,100));}return false;}`);
    assert.equal(wait(true),true,'pending answer is being read');
    row.recorded_answers[0].application.state='responded';publish();
    assert.equal(wait(false),true,'responded answer clears the signal');
  }finally{child.kill('SIGTERM');run('stop');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));fs.rmSync(root,{recursive:true,force:true});}
});
