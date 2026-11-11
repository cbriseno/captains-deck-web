/* Observed regressions: relation reveal, filtered detail placement, spend folds. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');
test('relationships and filters preserve detail; activity log preserves spend',{timeout:120000},async()=>{
  const env={...process.env,CHROME_DEVTOOLS_AXI_SESSION:'deck-detail-'+process.pid};
  const child=spawn('python3',['-B',path.join(__dirname,'detail_navigation_fixture.py')],{env,stdio:['ignore','pipe','pipe']});
  const run=(command,...args)=>{const r=spawnSync('chrome-devtools-axi',[command,...args.map(String)],{env,encoding:'utf8',timeout:60000,maxBuffer:2e6});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{let v=JSON.parse(run('eval',code).match(/^result: (.*)$/m)[1]);while(typeof v==='string'){try{v=JSON.parse(v);}catch{break;}}return v;};
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),10000);child.stdout.on('data',s=>{out+=s;const m=out.match(/Fixture at (http:\/\/127.0.0.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',s=>out+=s);child.once('exit',()=>{clearTimeout(timer);reject(Error(out));});});
    run('open',url);
    for(const [width,height] of [[1970,1250],[390,844]]){
      run('resize',width,height);
      const result=evaluate(`async()=>{
        const sleep=()=>new Promise(r=>setTimeout(r,300)),q=document.querySelector('#board-search');
        window.errors=[];window.onerror=e=>errors.push(e);
        const search=async text=>{q.value=text;q.dispatchEvent(new Event('input',{bubbles:true}));await sleep();};
        const escape=()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        const origin=()=>document.querySelector('[data-node="fixture:task:origin"] .card-open');
        const spend=()=>document.querySelector('[data-node="fixture:req:origin"] .usage-detail');
        const log=()=>document.querySelector('[data-node="fixture:req:origin"] .log-fold');
        const visits=[];escape();
        for(const filter of ['', 'Origin task']){
          await search(filter);document.querySelector('.request-title[aria-expanded=false]')?.click();origin().click();await sleep();
          [...document.querySelectorAll('.deck-relationships .link')].find(x=>x.textContent==='Destination task').click();await sleep();
          visits.push({title:document.querySelector('#detail-title').textContent,query:q.value});escape();
        }
        await search('Origin task');origin().click();await sleep();
        await search('missing task');const parked=document.querySelector('#detail').parentElement.id;
        await search('');const restored=document.querySelector('#detail').closest('.task-card')?.dataset.node;
        const initial=spend().open;spend().querySelector('summary').click();log().click();await sleep();const opened=spend().open;
        log().click();await sleep();const closed=spend().open;spend().querySelector('summary').click();log().click();await sleep();
        return {visits,parked,restored,initial,opened,closed,explicitClosed:spend().open,errors,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth};
      }`);
      assert.deepEqual(result,{visits:[{title:'Destination task',query:''},{title:'Destination task',query:''}],parked:'detail-panel',restored:'fixture:task:origin',initial:false,opened:true,closed:true,explicitClosed:false,errors:[],width,height,overflow:0});
      if(process.env.CD_TEST_EVIDENCE){fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,`detail-${width}.json`),JSON.stringify(result,null,2));run('screenshot',path.join(process.env.CD_TEST_EVIDENCE,`detail-${width}.png`));}
    }
  }finally{run('stop');child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));}
});
