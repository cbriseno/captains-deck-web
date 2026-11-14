/* Full request and title remain readable on attention cards. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),test=require('node:test');
test('attention request and title are visible without hover',{timeout:120000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-attention-text-'));
  const env={...process.env,CHROME_DEVTOOLS_AXI_AUTO_CONNECT:'0',CHROME_DEVTOOLS_AXI_SESSION:'deck-text-'+process.pid};
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[])=>{const r=spawnSync(process.env.CD_TEST_BROWSER||'chrome-devtools-axi',[cmd,...args],{env,encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{let v=JSON.parse(run('eval',[code]).match(/^result: (.*)$/m)[1]);while(typeof v==='string'){try{v=JSON.parse(v);}catch{break;}}return v;};
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),15000);child.stdout.on('data',c=>{out+=c;const m=out.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.on('exit',code=>reject(Error('fixture exit '+code)));});
    run('open',[url]);
    for(const width of [1970,390]){
      run('resize',[String(width),'1250']);
      const result=evaluate(`async()=>{for(let i=0;i<100&&!document.querySelector('.attention-list .cmeta');i++)await new Promise(r=>setTimeout(r,50));const card=document.querySelector('.attention-list .card');const meta=card.querySelector('.cmeta');let req=meta.querySelector('.req');if(!req){req=document.createElement('span');req.className='req';meta.append(req);}req.textContent='Solicitud extensa para verificar que todo el texto permanezca visible incluso en una pantalla pequeña y sin depender del hover';const title=card.querySelector('.card-open .title');title.textContent='Título largo de la tarea para comprobar que se puede leer completo con teclado y también mediante toque en una pantalla estrecha';return {request:{display:getComputedStyle(req).display,overflow:getComputedStyle(req).overflow,whiteSpace:getComputedStyle(req).whiteSpace,height:req.clientHeight,scroll:req.scrollHeight,width:req.clientWidth,scrollWidth:req.scrollWidth},title:{height:title.clientHeight,scroll:title.scrollHeight,width:title.clientWidth,scrollWidth:title.scrollWidth},overflow:document.documentElement.scrollWidth-innerWidth};}`);
      assert.notEqual(result.request.display,'none');assert.equal(result.request.height,result.request.scroll);assert.equal(result.request.width,result.request.scrollWidth);assert.equal(result.title.height,result.title.scroll);assert.equal(result.title.width,result.title.scrollWidth);assert.equal(result.overflow,0);
    }
  }finally{run('stop');child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});fs.rmSync(proof,{recursive:true,force:true});}
});
