/* Enter edits the inline draft; only Send submits it. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');

test('inline answer accepts newlines and sends only on request',{timeout:120000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-answer-'));
  const env={...process.env,CD_TEST_QUESTIONS:'1',CHROME_DEVTOOLS_AXI_SESSION:'deck-answer-'+process.pid};
  for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[key];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[],input)=>{const r=spawnSync(process.env.CD_TEST_BROWSER||'chrome-devtools-axi',[cmd,...args],{env,input,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  let browser=false;
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),12000);child.stdout.on('data',s=>{out+=s;const m=out.match(/(?:Fixture at|URL) ([^\s,]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',s=>out+=s);child.on('exit',c=>reject(Error('fixture '+c+' '+out)));});
    browser=true;run('open',[url]);
    run('run',[],`await page.wait('#board .qcard .inline-answer textarea');await page.fill('#board .qcard .inline-answer textarea','Primera');await page.press('Enter');await page.type('Segunda');`);
    const result=JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(()=>({text:document.querySelector('.inline-answer textarea').value,detail:document.querySelector('#detail').classList.contains('open'),send:!document.querySelector('.inline-answer .answer-send').disabled}))));`).trim());
    assert.deepEqual(result,{text:'Primera\nSegunda',detail:false,send:true});
    run('run',[],`await page.eval(()=>{const original=window.fetch;window.fetch=(url,options)=>{if(String(url).includes('/answer')&&options?.body)window.sentAnswer=JSON.parse(options.body);return original(url,options);};});await page.click('#board .qcard .inline-answer .answer-send');`);
    const clicked=JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(async()=>{for(let i=0;i<100&&!window.sentAnswer;i++)await new Promise(r=>setTimeout(r,100));return window.sentAnswer||null;})));`).trim());
    assert.equal(clicked?.note,'Primera\nSegunda');
  }finally{child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(proof,{recursive:true,force:true});}
});
