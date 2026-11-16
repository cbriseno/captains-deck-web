/* Request completion counts are distinct from worker activity and task steps. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),test=require('node:test');
for(const lang of ['es','en']) test('request completion count in '+lang,{timeout:120000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-count-'));
  const env={...process.env,CD_WEB_LANGUAGE:lang,CHROME_DEVTOOLS_AXI_SESSION:'deck-count-'+process.pid+'-'+lang};
  for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[key];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});let browser=false;
  const run=(cmd,args=[])=>{const r=spawnSync('chrome-devtools-axi',[cmd,...args],{env,encoding:'utf8',timeout:40000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),15000);child.stdout.on('data',c=>{out+=c;const m=out.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',c=>out+=c);child.on('exit',code=>reject(Error('fixture '+code+' '+out)));});
    const file=path.join(proof,'home/work-snapshot.json'),snapshot=JSON.parse(fs.readFileSync(file));
    for(const id of ['web','dependent','demo-research'])snapshot.tasks.find(x=>x.key==='task:'+id).request={id:'count-multiple',label:'Multiple tasks',project:'project:deck'};
    snapshot.tasks.find(x=>x.key==='task:next').request={id:'count-single',label:'Single task',project:'project:deck'};
    snapshot.requests=[{id:'count-multiple',scope:'req:count-multiple',label:'Multiple tasks',project:'project:deck',tasks:['task:web','task:dependent','task:demo-research']},{id:'count-single',scope:'req:count-single',label:'Single task',project:'project:deck',tasks:['task:next']}];
    fs.writeFileSync(file,JSON.stringify(snapshot));fs.appendFileSync(path.join(proof,'home/state/fleet-ledger.jsonl'),JSON.stringify({home:path.join(proof,'home'),event:'fixture.snapshot',value:snapshot})+'\n');browser=true;run('open',[url]);
    for(const width of [1970,390]){
      run('resize',[String(width),'1250']);
      const out=run('eval',[`async()=>{for(let i=0;i<100&&!Array.from(document.querySelectorAll('.request-name')).some(x=>x.textContent==='Multiple tasks');i++)await new Promise(r=>setTimeout(r,50));const row=name=>Array.from(document.querySelectorAll('.request-row')).find(x=>x.querySelector('.request-name')?.textContent===name);return JSON.stringify({single:row('Single task')?.querySelector('.request-count')?.textContent||null,multiple:row('Multiple tasks')?.querySelector('.request-count')?.textContent||null,overflow:document.documentElement.scrollWidth-innerWidth});}`]);
      let data=JSON.parse(out.match(/^result: (.*)$/m)[1]);while(typeof data==='string')data=JSON.parse(data);
      assert.equal(data.single,null);assert.equal(data.multiple,lang==='es'?'Tareas completadas: 1 de 3':'Tasks completed: 1 of 3');assert.equal(data.overflow,0);
    }
  }finally{if(browser)run('stop');child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));fs.rmSync(proof,{recursive:true,force:true});}
});
