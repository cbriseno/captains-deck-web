/* Focused real-DOM regression against the disposable owner, never live work. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');
const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';

test('removal consultation: one press, guarded delivery, receipts, drafts, keyboard and narrow layout', {timeout:120000}, async () => {
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-removal-'));
  const env={...process.env,CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-removal-test-'+process.pid};
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(command,args=[],input)=>{
    const p=spawnSync(cli,[command,...args],{env,input,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
    assert.equal(p.status,0,p.stdout+'\n'+p.stderr);return p.stdout;
  };
  const evaluate=code=>{
    const output=run('eval',[`async () => JSON.stringify(await (${code})())`]),m=output.match(/^result: (.*)$/m);
    assert.ok(m,output);let value=JSON.parse(m[1]);for(let i=0;i<4&&typeof value==='string';i++){try{value=JSON.parse(value);}catch{break;}}return value;
  };
  const wait='const wait=async f=>{for(let i=0;i<180;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw new Error("Timed out");};';
  const calls=()=>fs.existsSync(path.join(proof,'home/work-calls.jsonl'))?fs.readFileSync(path.join(proof,'home/work-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
  const open=async id=>run('run',[],`await page.press('Escape');await page.click('#board [data-node$="task:${id}"] .card-open');await page.wait('.deck-removal-send');`);
  try {
    const url=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error('Fixture startup '+output)),12000);
      child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/(?:Fixture at|URL) ([^\s,]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
      child.stderr.on('data',chunk=>output+=chunk);child.on('exit',code=>reject(new Error('Fixture exit '+code+' '+output)));
    });
    const original=fs.readFileSync(path.join(proof,'home/work-snapshot.json'),'utf8');
    run('open',[url]);run('resize',['1440','1000']);
    evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#board .task-card'));return true;}`);
    await open('next');
    const initial=evaluate(`()=>{const p=document.querySelector('.deck-removal-panel'),b=p.querySelector('button'),ta=p.querySelector('textarea'),style=getComputedStyle(b);return {buttons:p.querySelectorAll('button').length,visible:!!ta.getClientRects().length,below:ta.getBoundingClientRect().top>=b.getBoundingClientRect().bottom,text:p.textContent,color:style.backgroundColor,red:getComputedStyle(document.documentElement).getPropertyValue('--red').trim()};}`);
    assert.equal(initial.buttons,1);assert.equal(initial.visible,true);assert.equal(initial.below,true);
    assert.equal(initial.text,'Consultar eliminación');
    assert.equal(evaluate(`()=>{const el=document.createElement('i');el.style.color='var(--red)';document.body.append(el);const red=getComputedStyle(el).color;el.remove();return red;}`),initial.color);
    run('run',[],`await page.fill('[name=removal-reason]','Consultar iniciativa y dependencias, sin eliminar.');`);
    // Delay only this fixture transport so rapid presses exercise the real busy guard.
    const pending=evaluate(`()=>{const fetchOriginal=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).includes('/preview'))await new Promise(r=>setTimeout(r,300));return fetchOriginal(...args);};const b=document.querySelector('.deck-removal-send');b.click();b.click();return {disabled:b.disabled,busy:document.querySelector('#workspace').getAttribute('aria-busy')};}`);
    assert.deepEqual(pending,{disabled:true,busy:'true'});
    const sent=evaluate(`async()=>{${wait}await wait(()=>document.querySelector('.change-preview')?.textContent.includes('Consulta registrada'));await wait(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');return {text:document.querySelector('.change-preview').textContent,disabled:document.querySelector('.deck-removal-send').disabled,comment:document.querySelector('[name=removal-reason]').value,extra:[...document.querySelectorAll('#detail-content button')].some(x=>/Revisar consulta|Enviar consulta/.test(x.textContent))};}`);
    assert.equal(sent.disabled,true);assert.equal(sent.extra,false);assert.equal(sent.comment,'Consultar iniciativa y dependencias, sin eliminar.');
    const delivery=calls();assert.deepEqual(delivery.map(x=>x.command),['preview','apply']);
    assert.equal(delivery[1].operation.op,'request_removal');assert.equal(delivery[1].operation.target,'task:next');assert.equal(delivery[1].operation.note,sent.comment);assert.ok(delivery[1].operation.request_id);
    assert.equal(fs.readFileSync(path.join(proof,'home/work-snapshot.json'),'utf8'),original);
    // Receipt/reply readback remains an owner read and renders replies as plain text.
    const requestId=delivery[1].operation.request_id,reply='Consulta diagnóstica respondida <script>window.bad=true</script>';
    fs.writeFileSync(path.join(proof,'home/request-'+requestId+'.json'),JSON.stringify({request_id:requestId,state:'applied',consultation:{note_id:'fixture-note',status:'replied',reply:{id:'fixture-note',body:reply}}}));
    run('run',[],`await page.click('#change-results button');`);
    const readback=evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#change-results').textContent.includes('Firstmate respondió'));return {reply:document.querySelector('#change-results .deck-consultation-reply').textContent,bad:!!window.bad};}`);
    assert.deepEqual(readback,{reply,bad:false});assert.equal(calls().length,2);
    // A rejected preview cannot send. Other detail controls and focus survive.
    await open('web');
    evaluate(`()=>{const f=window.fetch;window.fetch=(...args)=>String(args[0]).includes('/preview')?Promise.resolve(new Response(JSON.stringify({state:'conflict',code:'stale_revision',message:'Fixture stale revision'}),{status:200,headers:{'Content-Type':'application/json'}})):f(...args);window.fixtureRestoreFetch=f;return true;}`);
    run('run',[],`await page.click('.deck-removal-send');`);
    evaluate(`async()=>{${wait}await wait(()=>document.querySelector('.change-preview')?.textContent.includes('Fixture stale revision'));window.fetch=window.fixtureRestoreFetch;return true;}`);
    assert.equal(calls().length,2);
    // Native Enter activates a single request with the optional comment empty.
    run('run',[],`await page.eval(() => document.querySelector('.deck-removal-send').focus());await page.press('Enter');`);
    evaluate(`async()=>{${wait}await wait(()=>document.querySelector('.change-preview')?.textContent.includes('Consulta registrada'));await wait(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');return true;}`);
    assert.deepEqual(calls().slice(2).map(x=>x.command),['preview','apply']);assert.match(calls()[3].operation.note,/Considering removal/);
    await open('dependent');
    const uncertain=evaluate(`async()=>{${wait}const f=window.fetch;window.fetch=(...args)=>String(args[0]).includes('/apply')?Promise.reject(new TypeError('Fixture connection lost')):f(...args);document.querySelector('.deck-removal-send').click();await wait(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');window.fetch=f;return {error:document.querySelector('.change-preview').textContent,disabled:document.querySelector('.deck-removal-send').disabled,check:[...document.querySelectorAll('#change-results button')].some(x=>x.textContent==='Comprobar recepción')};}`);
    assert.ok(uncertain.error);assert.equal(uncertain.disabled,true);assert.equal(uncertain.check,true);assert.equal(calls().length,5);
    // Consultation from a question must preserve the unsent answer and its focus.
    run('run',[],`await page.press('Escape');await page.click('#board .qcard .card-open');await page.wait('#answer-note');await page.fill('#answer-note','Unsent answer draft');await page.fill('[name=removal-reason]','Harmless fixture question consultation');`);
    const kept=evaluate(`async()=>{${wait}const ta=document.querySelector('#answer-note'),controls=document.querySelector('.deck-controls'),panel=document.querySelector('.deck-removal-panel');ta.closest('details').open=true;ta.focus();if(document.activeElement!==ta)throw new Error('Draft focus setup failed');ta.setSelectionRange(2,7);document.querySelector('.deck-removal-send').click();await wait(()=>document.querySelector('.change-preview')?.textContent.includes('Consulta registrada'));await wait(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');return {same:document.querySelector('#answer-note')===ta,value:ta.value,focus:document.activeElement===ta,selection:[ta.selectionStart,ta.selectionEnd],controls:document.querySelector('.deck-controls')===controls,panel:document.querySelector('.deck-removal-panel')===panel};}`);
    assert.deepEqual(kept,{same:true,value:'Unsent answer draft',focus:true,selection:[2,7],controls:true,panel:true});
    run('press',['Escape']);
    assert.deepEqual(evaluate(`()=>({closed:document.querySelector('#detail').dataset.open!=='true',focused:document.activeElement.classList.contains('card-open')})`),{closed:true,focused:true});
    run('run',[],`await page.click('#board .qcard .card-open');await page.wait('.deck-removal-send');`);
    run('resize',['360','844']);
    const phone=evaluate(`()=>{const p=document.querySelector('.deck-removal-panel'),b=p.querySelector('button').getBoundingClientRect(),ta=p.querySelector('textarea').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth-innerWidth,below:ta.top>=b.bottom,width:ta.width,buttonWidth:b.width,height:b.height};}`);
    assert.equal(phone.overflow,0);assert.equal(phone.below,true);assert.ok(phone.width>0&&phone.width<=360);assert.ok(phone.buttonWidth<=360);assert.ok(phone.height>=44);
    assert.equal(fs.readFileSync(path.join(proof,'home/work-snapshot.json'),'utf8'),original);
    if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'removal-fixture.json'),JSON.stringify({initial,pending,sent,readback,kept,phone,calls:calls()},null,2));}
  } finally {
    child.kill('SIGTERM');run('stop');fs.rmSync(proof,{recursive:true,force:true});
  }
});
