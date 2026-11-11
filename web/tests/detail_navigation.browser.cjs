/* Observed regressions: large-board reveal, search-only expansion, spend folds. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');
test('large-board relationships and filters preserve visible detail; activity log preserves spend',{timeout:120000},async()=>{
  const env={...process.env,CHROME_DEVTOOLS_AXI_AUTO_CONNECT:'0',CHROME_DEVTOOLS_AXI_SESSION:'deck-detail-'+process.pid};
  const child=spawn('python3',['-B',path.join(__dirname,'detail_navigation_fixture.py')],{env,stdio:['ignore','pipe','pipe']});
  const run=(command,...args)=>{const r=spawnSync('chrome-devtools-axi',[command,...args.map(String)],{env,encoding:'utf8',timeout:60000,maxBuffer:2e6});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{let v=JSON.parse(run('eval',code).match(/^result: (.*)$/m)[1]);while(typeof v==='string'){try{v=JSON.parse(v);}catch{break;}}return v;};
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),10000);child.stdout.on('data',s=>{out+=s;const m=out.match(/Fixture at (http:\/\/127.0.0.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',s=>out+=s);child.once('exit',()=>{clearTimeout(timer);reject(Error(out));});});
    run('open',url);
    for(const [width,height] of [[1970,1250],[390,844]]){
      evaluate(`()=>{localStorage.clear();localStorage.setItem('deck-animations','true');return true;}`);
      run('open',url+'/?width='+width);run('resize',width,height);
      const result=evaluate(`async()=>{
        const sleep=ms=>new Promise(r=>setTimeout(r,ms)),q=document.querySelector('#board-search');
        window.errors=[];window.onerror=e=>errors.push(e);
        const search=async text=>{q.value=text;q.dispatchEvent(new Event('input',{bubbles:true}));await sleep(100);};
        const close=()=>document.querySelector('#detail-close').click();
        const origin=()=>document.querySelector('[data-node="fixture:task:origin"] .card-open');
        const detail=()=>document.querySelector('#detail');
        const visit=async()=>{
          const start=performance.now();[...document.querySelectorAll('.deck-relationships .link')].find(x=>x.textContent==='Destination task').click();
          while(document.querySelector('#detail-title').textContent!=='Destination task'&&performance.now()-start<5000)await sleep(10);
          await sleep(50);return {ms:performance.now()-start,title:document.querySelector('#detail-title').textContent,query:q.value,
            rows:document.querySelectorAll('#state-column-done .request-row').length,y:detail().getBoundingClientRect().top};
        };
        // No manual expansion: the search alone opened the origin request.
        await search('Origin task');origin().click();await sleep(100);
        await search('missing task');const parked=detail().parentElement.id;
        await search('');const restored=detail().closest('.task-card')?.dataset.node,restoredY=detail().getBoundingClientRect().top;
        close();await search('Origin task');origin().click();await sleep(100);
        const folded=await visit();close();
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        document.querySelector('#state-column-done .col-h button').click();
        [...document.querySelectorAll('#columns-nav button')].find(x=>x.textContent==='Expand requests').click();await sleep(100);
        const count=document.querySelectorAll('#state-column-done .request-row').length;
        let start=performance.now();origin().click();await sleep(10);const openMs=performance.now()-start;
        const expanded=await visit();close();
        // A search hides the target even if Finished was previously expanded.
        await search('Origin task');origin().click();await sleep(100);const filtered=await visit();close();
        const spend=()=>document.querySelector('[data-node="fixture:req:origin"] .usage-detail');
        const log=()=>document.querySelector('[data-node="fixture:req:origin"] .log-fold');
        const initial=spend().open;spend().querySelector('summary').click();log().click();await sleep(300);const opened=spend().open;
        log().click();await sleep(100);const closed=spend().open;spend().querySelector('summary').click();log().click();await sleep(100);
        return {folded,expanded,filtered,count,openMs,parked,restored,restoredY,initial,opened,closed,explicitClosed:spend().open,
          focus:document.querySelector('#focus-effects').checked,animations:document.documentElement.dataset.animations,errors,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth};
      }`);
      assert.equal(result.count,481);assert.equal(result.parked,'detail-panel');assert.equal(result.restored,'fixture:task:origin');
      assert.ok(result.restoredY>=-5&&result.restoredY<height*.6,JSON.stringify(result));
      for(const name of ['folded','expanded','filtered']){
        const visit=result[name];assert.equal(visit.title,'Destination task');assert.equal(visit.query,'');
        assert.ok(visit.ms<1000,JSON.stringify(result));assert.ok(visit.y>=-5&&visit.y<height*.6,JSON.stringify(result));
        assert.equal(visit.rows,1);
      }
      assert.ok(result.openMs<1000,JSON.stringify(result));
      assert.deepEqual([result.initial,result.opened,result.closed,result.explicitClosed],[false,true,true,false]);
      assert.equal(result.focus,true);assert.equal(result.animations,'true');assert.deepEqual(result.errors,[]);assert.equal(result.overflow,0);assert.equal(result.width,width);assert.equal(result.height,height);
      if(process.env.CD_TEST_EVIDENCE){fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,`detail-${width}.json`),JSON.stringify(result,null,2));run('screenshot',path.join(process.env.CD_TEST_EVIDENCE,`detail-${width}.png`));}
    }
  }finally{run('stop');child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));}
});
