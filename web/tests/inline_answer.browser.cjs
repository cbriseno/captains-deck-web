/* Enter edits the inline draft; only Send submits it. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');

test('row choices and notes send independently through one submit',{timeout:120000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-answer-'));
  const env={...process.env,CD_WEB_LANGUAGE:'en',CD_TEST_QUESTIONS:'1',CD_TEST_REPORT_ACTIONS:'1',CHROME_DEVTOOLS_AXI_SESSION:'deck-answer-'+process.pid};
  for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[key];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[],input)=>{const r=spawnSync(process.env.CD_TEST_BROWSER||'chrome-devtools-axi',[cmd,...args],{env,input,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  let browser=false;
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),12000);child.stdout.on('data',s=>{out+=s;const m=out.match(/(?:Fixture at|URL) ([^\s,]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',s=>out+=s);child.on('exit',c=>reject(Error('fixture '+c+' '+out)));});
    // This fixture normally closes one global hold. Keep it open so two distinct
    // ticket intakes can execute; Deck's per-occurrence receipts still deduplicate.
    const intake=path.join(proof,'home/bin/intake.py');
    fs.writeFileSync(intake,fs.readFileSync(intake,'utf8').replace("(root/'open').unlink(missing_ok=True)","(root/'open').touch()"));
    browser=true;run('open',[url+'/?task=demo-research&view=delivery&item=old-report&do=decisions&r.ask=yes']);
    run('run',[],`await page.wait('#detail-content .notice');`);
    const stale=JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(()=>({notice:document.querySelector('#detail-content').textContent,selected:document.querySelectorAll('.qcard .option-choice[aria-pressed=true]').length}))));`).trim());
    assert.match(stale.notice,/changed/);assert.equal(stale.selected,0);
    run('open',[url+'/?task=ask&view=call&option=later']);
    run('run',[],`await page.wait('.qcard .option-choice[aria-pressed=true]');`);
    const selected=JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(()=>document.querySelector('.qcard .option-choice[aria-pressed=true]').dataset.value)));`).trim());
    assert.equal(selected,'later');assert.equal(fs.existsSync(path.join(proof,'home/mutations.jsonl')),false);
    run('press',['Escape']);
    // A report form prefills the same row without sending on navigation.
    run('open',[url+'/?task=demo-research&view=delivery&item=report-A&do=decisions&r.ask=yes&r.completed-question=keep']);
    run('run',[],`await page.wait('.qcard .option-choice[aria-pressed=true]');`);
    assert.equal(fs.existsSync(path.join(proof,'home/mutations.jsonl')),false);
    run('run',[],`await page.click('#board .answer-batch .answer-send');`);
    run('run',[],`await page.click('#refresh');`);
    run('run',[],`await page.eval(()=>[...document.querySelectorAll('.answer-batch button')].find(b=>b.textContent==='Undo').click());`);
    assert.equal(fs.existsSync(path.join(proof,'home/mutations.jsonl')),false);
    run('run',[],`await page.wait('#board .qcard .inline-answer textarea');await page.fill('#board .qcard .inline-answer textarea','Primera');await page.press('Enter');await page.type('Segunda');`);
    const result=JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(()=>({text:document.querySelector('.inline-answer textarea').value,detail:document.querySelector('#detail').classList.contains('open'),send:!document.querySelector('.answer-batch .answer-send').disabled}))));`).trim());
    assert.deepEqual(result,{text:'Primera\nSegunda',detail:false,send:true});
    run('run',[],`await page.eval(()=>{const original=window.fetch;window.fetch=(url,options)=>{if(String(url).includes('/answer')&&options?.body)(window.sentAnswers||=[]).push({url:String(url),...JSON.parse(options.body)});return original(url,options).then(async response=>{if(String(url).endsWith('/answer')&&options?.body)(window.answerReceipts||=[]).push(await response.clone().json());return response;});};});await page.eval(()=>{document.querySelector('.qcard .option-choice').click();const rows=document.querySelectorAll('.qcard');const note=rows[1].querySelector('textarea');note.value='Investigar destino';note.dispatchEvent(new Event('input',{bubbles:true}));});await page.click('#board .answer-batch .answer-send');`);
    const clicked=JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(async()=>{for(let i=0;i<180&&document.querySelectorAll('.qcard').length;i++)await new Promise(r=>setTimeout(r,100));window.testReceipts=window.answerReceipts;return window.sentAnswers||[];})));`).trim());
    assert.equal(clicked.length,2);
    assert.equal(clicked[0].note,'Primera\nSegunda');assert.equal(clicked[0].value,'yes');
    assert.equal(clicked[1].note,'Investigar destino');assert.equal(clicked[1].value,'keep');
    assert.notEqual(clicked[0].url,clicked[1].url);assert.notEqual(clicked[0].request_id,clicked[1].request_id);
    assert.ok(clicked.every(row=>/^[a-f0-9]{64}$/.test(row.occurrence)));
    // The owner intentionally rejects multiline notes without file intake.
    // One rejected row must not prevent the other row from being saved.
    const receipts=JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(()=>window.testReceipts)));`).trim());
    assert.notEqual(receipts[0].saved,true);assert.equal(receipts[1].saved,true);
    assert.equal(fs.readFileSync(path.join(proof,'home/mutations.jsonl'),'utf8').trim().split('\n').length,1);
    run('run',[],`await page.fill('.qcard textarea','Primera Segunda');await page.click('.answer-batch .answer-send');`);
    const retried=JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(async()=>{for(let i=0;i<180&&window.answerReceipts.length<3;i++)await new Promise(r=>setTimeout(r,100));return window.answerReceipts;})));`).trim());
    assert.equal(retried.length,3);assert.equal(retried[2].saved,true);
    assert.equal(fs.readFileSync(path.join(proof,'home/mutations.jsonl'),'utf8').trim().split('\n').length,2);
  }finally{child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(proof,{recursive:true,force:true});}
});
