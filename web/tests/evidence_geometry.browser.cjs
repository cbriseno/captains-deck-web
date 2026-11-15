/* The Mac report's 164 -> 122 px mechanism: evidence-only refresh moves a neighbor. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),test=require('node:test');
const cli=process.env.CD_TEST_BROWSER||'chrome-devtools-axi';
for(const width of [1970,390])test('evidence and telemetry preserve geometry at '+width,{timeout:180000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-geometry-'));
  const env={...process.env,CD_WEB_LANGUAGE:'es',FM_DIAGNOSTICS_HOME:path.join(proof,'diagnostics'),CHROME_DEVTOOLS_AXI_AUTO_CONNECT:'0',CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS:'60000',CHROME_DEVTOOLS_AXI_SESSION:'deck-geometry-'+process.pid+'-'+width};
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[])=>{const r=spawnSync(cli,[cmd,...args],{env,encoding:'utf8',timeout:70000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{let v=JSON.parse(run('eval',[code]).match(/^result: (.*)$/m)[1]);while(typeof v==='string'){try{v=JSON.parse(v);}catch{break;}}return v;};
  let browser=false;
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),15000);child.stdout.on('data',c=>{out+=c;const m=out.match(/Fixture at (\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.on('exit',code=>{clearTimeout(timer);reject(Error('fixture exit '+code));});});
    const file=path.join(proof,'home/work-snapshot.json'),snapshot=JSON.parse(fs.readFileSync(file));
    const web=snapshot.tasks.find(x=>x.key==='task:web'),next=snapshot.tasks.find(x=>x.key==='task:next');
    const declaration={done:1,total:3,steps:[{label:'Done',state:'done'},{label:'Verificar el comportamiento con un texto de paso deliberadamente largo',state:'active'},{label:'Check',state:'todo'}],updated:'2026-11-14T01:00:00Z'};
    snapshot.requests=[web,next].map((x,i)=>{x.state='running';x.pause={own:null,inherited:null};x.updated={value:`2026-11-14T0${2-i}:00:00Z`,precision:'instant',source:'fleet.entity:task.changed'};x.request={id:i?'neighbor':'geometry',label:i?'Neighbor':'Geometry',project:'project:deck'};return {id:x.request.id,key:'request:'+x.request.id,label:x.request.label,project:'project:deck',tasks:[x.key]};});
    const initialUsage={usd:1,usd_complete:false,tokens:100,tasks:{running:1},by:[{harness:'codex',model:'gpt-6.1-sol',effort:'high',usd:1,tokens:100,usd_known:true,sessions:1}]};
    snapshot.requests[0].usage=initialUsage;
    const publish=freshness=>{web.progress=freshness==='current'?declaration:null;web.declared_progress=declaration;web.phase='implementation';web.progress_evidence={freshness,current:freshness==='current',reported_at:declaration.updated,source:'task.progress.checkpoint',reasons:freshness==='current'?[]:['source-changed']};fs.writeFileSync(file,JSON.stringify(snapshot));fs.appendFileSync(path.join(proof,'home/state/fleet-ledger.jsonl'),JSON.stringify({home:path.join(proof,'home'),event:'fixture.snapshot',value:snapshot})+'\n');};
    publish('current');browser=true;run('open',[url]);
    const read=(freshness,usage='')=>evaluate(`async()=>{let row;for(let i=0;i<100;i++){row=document.querySelector('.request-row[data-node$=":req:geometry"]');if(row?.querySelector('.request-stage')?.dataset.freshness===${JSON.stringify(freshness)}&&row.querySelector('.usage-line')?.textContent.includes(${JSON.stringify(usage)}))break;await new Promise(r=>setTimeout(r,100));}const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};return {expanded:row?.querySelector('.request-title')?.getAttribute('aria-expanded'),freshness:row?.querySelector('.request-stage')?.dataset.freshness,bar:row?.querySelector('.request-stage [role=progressbar]')?.getAttribute('aria-valuenow')||null,text:row?.querySelector('.request-stage')?.textContent,usage:row?.querySelector('.usage-line')?.textContent,row:rect(row),child:rect(row?.querySelector('.task-row')),neighbor:rect(document.querySelector('.request-row[data-node$=":req:neighbor"]')),overflow:document.documentElement.scrollWidth-innerWidth};}`);
    const evidence=[];
    run('resize',[String(width),'1250']);
      for(const expanded of [false,true]){
        console.log(JSON.stringify({width,expanded}));
        publish('current');assert.equal(read('current').bar,'33');
        evaluate(`()=>{const b=document.querySelector('.request-row[data-node$=":req:geometry"] .request-title');if(b.getAttribute('aria-expanded')!=='${expanded}')b.click();return true;}`);
        const initial=read('current','1.00');assert.equal(!!initial.child,expanded,JSON.stringify({width,expanded,initial}));
        for(const freshness of ['unknown','stale','missing','invalid','current']){
          publish(freshness);const after=read(freshness);assert.equal(after.freshness,freshness);assert.equal(after.bar,freshness==='current'?'33':null);
          assert.deepEqual(after.row,initial.row,JSON.stringify({width,expanded,initial,after}));assert.deepEqual(after.neighbor,initial.neighbor);assert.deepEqual(after.child,initial.child);assert.equal(after.overflow,0);
          evidence.push({width,expanded,freshness,geometry:after.row,neighbor:after.neighbor});
        }
        snapshot.requests[0].usage={usd:123456.78,usd_complete:false,tokens:987654321,tasks:{running:1,unknown:12},by:[{harness:'codex',model:'gpt-6.1-sol',effort:'high',usd:123456.78,tokens:987654321,usd_known:true,sessions:1}]};
        web.observed={value:'2026-11-14T03:00:00Z',precision:'instant',source:'task.usage'};publish('current');
        const telemetry=read('current','123');assert.match(telemetry.usage,/123/,JSON.stringify({width,expanded,telemetry,}));assert.deepEqual(telemetry.row,initial.row);assert.deepEqual(telemetry.neighbor,initial.neighbor);assert.deepEqual(telemetry.child,initial.child);assert.equal(telemetry.overflow,0);
        snapshot.requests[0].usage=initialUsage;publish('current');read('current','1.00');
      }
    // Deliberate expansion still changes height.
    evaluate(`()=>{const row=document.querySelector('.request-row[data-node$=":req:geometry"]');window.geometryExpanded=row.getBoundingClientRect().height;row.querySelector('.request-title').click();return true;}`);
    assert.ok(read('current').row.height<evaluate('()=>window.geometryExpanded'));
    if(process.env.CD_TEST_EVIDENCE)fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'evidence-geometry-'+width+'.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({cases:evidence.length,width,expandedAndCollapsed:true,telemetry:true}));
  }finally{try{if(browser)run('stop');}finally{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});fs.rmSync(proof,{recursive:true,force:true});}}
});
