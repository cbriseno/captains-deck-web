/* Inferred attention survives refresh; resolving the wait closes its detail. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');
test('captain waits and unheld decisions stay visible without an answer form',{timeout:180000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-attention-'));
  const env={...process.env,CD_WEB_LANGUAGE:'en',CHROME_DEVTOOLS_AXI_AUTO_CONNECT:'0',CHROME_DEVTOOLS_AXI_SESSION:'deck-attention-'+process.pid};
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[])=>{const r=spawnSync('chrome-devtools-axi',[cmd,...args],{env,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{let value=JSON.parse(run('eval',[`async()=>JSON.stringify(await (${code})())`]).match(/^result: (.*)$/m)[1]);while(typeof value==='string'){try{value=JSON.parse(value);}catch{break;}}return value;};
  const wait='const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw new Error("Timed out");};';
  const event=value=>fs.appendFileSync(path.join(proof,'home/state/fleet-ledger.jsonl'),JSON.stringify({home:path.join(proof,'home'),ts:1794650000,...value})+'\n');
  try{
    const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(output)),15000);child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',chunk=>output+=chunk);child.on('exit',code=>reject(new Error('fixture exited '+code+' '+output)));});
    const snapshot=JSON.parse(fs.readFileSync(path.join(proof,'home/work-snapshot.json')));
    snapshot.tasks.find(x=>x.key==='task:next').kind='captain';
    event({event:'fixture.snapshot',value:snapshot});
    event({event:'task.status',task:'web',state:'paused',text:'Waiting for captain feedback on the visual review board.'});
    event({event:'task.status',task:'dependent',state:'paused',text:'Supervisor requested safe point reached.'});
    run('open',[url]);
    for(const [width,height] of [[1970,1250],[390,844]]){
      run('resize',[String(width),String(height)]);
      const result=evaluate(`async()=>{${wait}await wait(()=>document.querySelectorAll('.action-card').length===2);
        if(document.getElementById('detail').hidden)document.querySelector('.action-card[data-node$="task:web"] .card-open').click();
        await new Promise(r=>setTimeout(r,1200));
        return {open:!document.getElementById('detail').hidden,overflow:document.documentElement.scrollWidth>innerWidth,
          forms:document.querySelectorAll('#detail-content textarea,#detail-content input').length,
          repair:document.body.innerText.includes('not filed correctly'),text:document.getElementById('detail-content').innerText};}`);
      assert.equal(result.open,true);assert.equal(result.overflow,false);assert.equal(result.forms,0);assert.equal(result.repair,true);assert.ok(result.text.includes('review board'));
    }
    event({event:'task.status',task:'web',state:'working',text:'Feedback received; resumed.'});
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelectorAll('.action-card').length===1&&document.getElementById('detail').hidden);return true;}`),true);
  }finally{
    run('stop');child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));fs.rmSync(proof,{recursive:true,force:true});
  }
});
