/* Comparable progress bars keep their position despite different labels. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),test=require('node:test');
test('progress bars align without mixing tasks and steps',{timeout:120000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-bars-'));
  const env={...process.env,CHROME_DEVTOOLS_AXI_AUTO_CONNECT:'0',CHROME_DEVTOOLS_AXI_SESSION:'deck-bars-'+process.pid};
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[])=>{const r=spawnSync(process.env.CD_TEST_BROWSER||'chrome-devtools-axi',[cmd,...args],{env,encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{let v=JSON.parse(run('eval',[code]).match(/^result: (.*)$/m)[1]);while(typeof v==='string'){try{v=JSON.parse(v);}catch{break;}}return v;};
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),15000);child.stdout.on('data',c=>{out+=c;const m=out.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.on('exit',code=>reject(Error('fixture exit '+code)));});
    run('open',[url]);
    evaluate(`async()=>{for(let i=0;i<100&&!document.querySelector('.request-name');i++)await new Promise(r=>setTimeout(r,50));document.querySelector('.request-name').click();return true;}`);
    for(const width of [1970,390]){
      run('resize',[String(width),'1250']);
      const result=evaluate(`()=>{const row=document.querySelector('.task-row:has(.prog-bar)');const copy=row.cloneNode(true);copy.querySelector('.prog-txt').textContent='100% · 10/10 pasos · todos los pasos declarados; tarea sin terminar';row.parentNode.append(copy);return {overflow:document.documentElement.scrollWidth-innerWidth,bars:[...document.querySelectorAll('.task-row .prog-bar')].map(b=>({x:Math.round(b.getBoundingClientRect().x),width:b.getBoundingClientRect().width})),requestWidth:document.querySelector('.request-bar').getBoundingClientRect().width}}`);
      assert.equal(result.overflow,0);assert.equal(result.bars.length,2);assert.deepEqual(result.bars[0],result.bars[1]);assert.equal(result.bars[0].width,64);assert.equal(result.requestWidth,40);
      if(process.env.CD_TEST_EVIDENCE)run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,`progress-alignment-${width}.png`)]);
    }
  }finally{run('stop');child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});fs.rmSync(proof,{recursive:true,force:true});}
});
