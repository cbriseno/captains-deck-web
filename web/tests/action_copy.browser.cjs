/* Action copy removes repeated title/context while keeping the incomplete-decision instruction. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');
const cli=process.env.CD_TEST_BROWSER||'chrome-devtools-axi';

test('action card and detail do not repeat title and preserve the filing instruction',{timeout:150000},async()=>{
  const scratch=path.dirname(process.env.GOTMPDIR||os.tmpdir());
  const proof=fs.mkdtempSync(path.join(scratch,'deck-action-copy-'));
  const env={...process.env,CD_TEST_ACTIONS:'1',CD_TEST_ACTION_COPY:'1',CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-action-copy-'+process.pid};
  for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[key];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[],input)=>{const r=spawnSync(cli,[cmd,...args],{env,input,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(${code})));`).trim());
  let browser=false;
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error(out)),12000);child.stdout.on('data',s=>{out+=s;const m=out.match(/(?:Fixture at|URL) ([^\s,]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',s=>out+=s);child.on('exit',c=>reject(new Error('Fixture '+c+' '+out)));});
    browser=true;run('open',[url]);run('resize',['1970','1250']);
    const title='Choose the target branch for example tooling';
    const instruction='Ask Firstmate to file this decision with its question and options.';
    const desktop=evaluate(`async()=>{for(let i=0;i<150;i++){const card=[...document.querySelectorAll('#board .action-card')].find(c=>c.querySelector('.title')?.textContent===${JSON.stringify(title)});if(card?.querySelector('.cctx')?.textContent.includes(${JSON.stringify(instruction)}))return {text:card.querySelector('.card-open').textContent,overflow:document.documentElement.scrollWidth-innerWidth,width:innerWidth,height:innerHeight};await new Promise(r=>setTimeout(r,100));}throw new Error('updated action was not rendered');}`);
    assert.equal(desktop.width,1970);assert.equal(desktop.height,1250);assert.equal(desktop.overflow,0);
    assert.equal(desktop.text.split('Choose the target branch').length-1,1,'the duplicated title/context appears once');
    assert.match(desktop.text,/Ask Firstmate to file this decision with its question and options\./);
    assert.match(desktop.text,/Hazlo en el chat/);
    if(process.env.CD_TEST_EVIDENCE)run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,'action-copy-card-1970.png')]);
    run('run',[],`await page.click('#board .action-card .card-open');`);
    const detail=evaluate(`()=>({text:document.querySelector('#detail-content').textContent,overflow:document.documentElement.scrollWidth-innerWidth})`);
    assert.equal(detail.overflow,0);assert.doesNotMatch(detail.text,/Choose the target branch for example tooling\./);
    assert.match(detail.text,/Ask Firstmate to file this decision with its question and options\./);
    if(process.env.CD_TEST_EVIDENCE)run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,'action-copy-detail-1970.png')]);
    run('resize',['390','844']);
    const mobile=evaluate(`()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,detail:document.querySelector('#detail-content').textContent})`);
    assert.equal(mobile.width,390);assert.equal(mobile.height,844);assert.equal(mobile.overflow,0);
    assert.match(mobile.detail,/Ask Firstmate to file this decision with its question and options\./);
    if(process.env.CD_TEST_EVIDENCE)run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,'action-copy-detail-390.png')]);
    run('press',['Escape']);
    const mobileCard=evaluate(`()=>{const card=[...document.querySelectorAll('#board .action-card')].find(c=>c.querySelector('.title')?.textContent==='Choose the target branch for example tooling');return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,text:card?.querySelector('.card-open')?.textContent||''}}`);
    assert.equal(mobileCard.width,390);assert.equal(mobileCard.height,844);assert.equal(mobileCard.overflow,0);
    assert.equal(mobileCard.text.split('Choose the target branch').length-1,1);assert.match(mobileCard.text,/Ask Firstmate to file this decision with its question and options\./);
    if(process.env.CD_TEST_EVIDENCE)run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,'action-copy-card-390.png')]);
  }finally{child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(proof,{recursive:true,force:true});}
});
