/* Discoverable task actions navigate to controls without sending a change. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');
test('task actions are visible and open their controls without modifying work',{timeout:90000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deck-actions-'));
  const env={...process.env,CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-actions-'+process.pid};
  for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[key];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),dir],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[],input)=>{const r=spawnSync('chrome-devtools-axi',[cmd,...args],{env,input,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evalPage=code=>JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(${code})));`).trim());
  let browser=false;
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),12000);child.stdout.on('data',s=>{out+=s;const m=out.match(/Fixture at (\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',s=>out+=s);child.on('exit',c=>reject(Error('Fixture exit '+c+' '+out)));});
    browser=true;run('open',[url]);
    evalPage(`async()=>{for(let i=0;i<100&&!document.querySelector('.request-title');i++)await new Promise(r=>setTimeout(r,50));document.querySelector('.request-title').click();return true;}`);
    for(const width of [1970,390]){
      run('resize',[String(width),'1250']);
      const info=evalPage(`()=>{const row=document.querySelector('.task-row:has(.task-actions)');return {count:row?.querySelectorAll('.task-actions button').length||0,visible:[...row?.querySelectorAll('.task-actions button')||[]].every(b=>!!b.getClientRects().length),overflow:document.documentElement.scrollWidth-innerWidth};}`);
      assert.equal(info.count,2);assert.equal(info.visible,true);assert.equal(info.overflow,0);
      for(const [index,selector] of [[0,'select[name=priority]'],[1,'textarea[name=removal-reason]']]){
        evalPage(`()=>{document.querySelector('.task-row .task-actions button:nth-child(${index+1})').focus();return true;}`);run('press',['Enter']);
        const focused=evalPage(`async()=>{await new Promise(r=>setTimeout(r,300));return document.activeElement?.matches('${selector}');}`);
        assert.equal(focused,true);run('press',['Escape']);
      }
    }
    assert.equal(fs.existsSync(path.join(dir,'home/work-calls.jsonl')),false);
  }finally{child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(dir,{recursive:true,force:true});}
});
