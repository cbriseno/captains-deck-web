/* A cancelled task remains finished without claiming a delivery. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');
test('cancelled closure shows its reason without delivery or stale worker status',{timeout:120000},async()=>{
  const env={...process.env,CHROME_DEVTOOLS_AXI_AUTO_CONNECT:'0',CHROME_DEVTOOLS_AXI_SESSION:'deck-cancelled-'+process.pid};
  const child=spawn('python3',['-B',path.join(__dirname,'detail_navigation_fixture.py')],{env,stdio:['ignore','pipe','pipe']});
  const run=(command,...args)=>{const r=spawnSync('chrome-devtools-axi',[command,...args.map(String)],{env,encoding:'utf8',timeout:60000,maxBuffer:2e6});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{let v=JSON.parse(run('eval',code).match(/^result: (.*)$/m)[1]);while(typeof v==='string'){try{v=JSON.parse(v);}catch{break;}}return v;};
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),10000);child.stdout.on('data',s=>{out+=s;const m=out.match(/Fixture at (http:\/\/127.0.0.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',s=>out+=s);child.once('exit',()=>{clearTimeout(timer);reject(Error(out));});});
    run('open',url);
    for(const [width,height] of [[1970,1250],[390,844]]){
      evaluate(`()=>{localStorage.clear();localStorage.setItem('deck-animations','true');return true;}`);
      run('open',url+'/?locale='+(width===390?'es':'en')+'&width='+width);run('resize',width,height);
      const result=evaluate(`async()=>{
        const sleep=ms=>new Promise(r=>setTimeout(r,ms)),q=document.querySelector('#board-search');
        q.value='Finished task 0';q.dispatchEvent(new Event('input',{bubbles:true}));await sleep(100);
        const finished=document.querySelector('#state-column-done .col-h button');
        if(finished.getAttribute('aria-expanded')==='false')finished.click();
        const request=document.querySelector('[data-node="fixture:req:finished-0"] .request-title');
        if(request.getAttribute('aria-expanded')==='false')request.click();await sleep(100);
        const row=document.querySelector('[data-node="fixture:task:finished-0"]'),card=row.textContent;
        row.querySelector('.card-open').click();await sleep(100);
        const detail=document.querySelector('#detail-content').textContent;
        return {card,detail,kicker:document.querySelector('#detail-kicker').textContent,
          overflow:document.documentElement.scrollWidth-innerWidth,width:innerWidth,height:innerHeight};
      }`);
      assert.match(result.card,width===390?/Cancelada/:/Cancelled/);assert.doesNotMatch(result.card,/Result|reviewed|Validating|Stale worker/);
      assert.match(result.detail,/Cancelled by the captain/);assert.match(result.kicker,width===390?/Cancelada/:/Cancelled/);
      assert.doesNotMatch(result.detail,/Delivered result|Synthetic delivery|Validating|Stale worker/);
      assert.equal(result.overflow,0);assert.equal(result.width,width);assert.equal(result.height,height);
      if(process.env.CD_TEST_EVIDENCE){fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,`cancelled-${width}.json`),JSON.stringify(result,null,2));run('screenshot',path.join(process.env.CD_TEST_EVIDENCE,`cancelled-${width}.png`));}
    }
  }finally{run('stop');child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));}
});
