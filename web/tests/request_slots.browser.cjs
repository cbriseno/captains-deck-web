/* Common request metadata slots, measured in the rendered board. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),test=require('node:test');
const cli=process.env.CD_TEST_BROWSER||'chrome-devtools-axi';
test('request metadata keeps its columns for long and missing values',{timeout:120000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-slots-'));
  const env={...process.env,CHROME_DEVTOOLS_AXI_AUTO_CONNECT:'0',CHROME_DEVTOOLS_AXI_SESSION:'deck-slots-'+process.pid};
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[])=>{const r=spawnSync(cli,[cmd,...args],{env,encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{let v=JSON.parse(run('eval',[code]).match(/^result: (.*)$/m)[1]);while(typeof v==='string'){try{v=JSON.parse(v);}catch{break;}}return v;};
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),15000);child.stdout.on('data',c=>{out+=c;const m=out.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.on('exit',code=>reject(Error('fixture exit '+code)));});
    run('open',[url]);
    for(const width of [1970,390]){
      run('resize',[String(width),'1250']);
      const result=evaluate(`async()=>{for(let i=0;i<100&&!document.querySelector('.request-meta');i++)await new Promise(r=>setTimeout(r,50));const row=document.querySelector('.request-row');for(const project of ['Proyecto con un nombre extraordinariamente largo que se extiende sin desplazar otros datos','']){const copy=row.cloneNode(true);copy.querySelector('.request-project').textContent=project;copy.querySelector('.request-signals')?.remove();row.parentNode.append(copy);}const rows=[...document.querySelectorAll('.request-meta')];return {overflow:document.documentElement.scrollWidth-innerWidth,rows:rows.map(r=>Object.fromEntries(['request-project','request-progress','request-date'].map(c=>[c,Math.round((r.querySelector('.'+c)||r.querySelector('.dates')).getBoundingClientRect().left-r.getBoundingClientRect().left)])))};}`);
      assert.equal(result.overflow,0);assert.equal(result.rows.length,3);assert.deepEqual(result.rows[1],result.rows[0]);assert.deepEqual(result.rows[2],result.rows[0]);
    }
  }finally{run('stop');child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});fs.rmSync(proof,{recursive:true,force:true});}
});
