/* Real owner question records stay separate from work and supervisor notices. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');
const cli=process.env.CD_TEST_BROWSER||'chrome-devtools-axi';

test('dedicated questions preserve work positions, dependency arrows and answer drafts',{timeout:120000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-questions-'));
  const env={...process.env,CD_TEST_QUESTIONS:'1',CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-questions-'+process.pid};
  for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[key];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[],input)=>{const r=spawnSync(cli,[cmd,...args],{env,input,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(${code})));`).trim());
  let browser=false;
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error(out)),12000);child.stdout.on('data',s=>{out+=s;const m=out.match(/(?:Fixture at|URL) ([^\s,]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',s=>out+=s);child.on('exit',c=>reject(new Error('Fixture '+c+' '+out)));});
    run('open',[url]);browser=true;run('resize',['1440','1000']);
    const initial=evaluate(`async()=>{for(let i=0;i<120&&!document.querySelector('#board .stack-h');i++)await new Promise(r=>setTimeout(r,100));for(const b of document.querySelectorAll('#board .stack-h[aria-expanded=false]'))b.click();const b=await(await fetch('api/board')).json();return {questions:[...document.querySelectorAll('#board .qcard')].map(c=>({text:c.textContent,forbidden:c.querySelectorAll('.prog,.prog-phase,.plabel,.pause-control,.card-ctl').length,origin:[...c.querySelectorAll('button')].some(b=>b.textContent==='Ir a la tarea de origen'&&!b.disabled)})),work:Object.fromEntries(['web','dependent','coordination'].map(id=>[id,document.querySelector('#board [data-node$="task:'+id+'"]')?.closest('section')?.id])),asks:b.columns.find(c=>c.id==='captains_call').cards.map(c=>({task:c.task,key:c.key,home:c.home})),coordination:b.columns.flatMap(c=>c.cards).find(c=>c.task==='coordination').activity.kind,edges:b.deck.sources[0].snapshot.edges};}`);
    assert.equal(initial.questions.length,2);assert.ok(initial.questions.every(q=>q.forbidden===0&&q.origin));
    assert.equal(initial.work.web,'state-column-now');assert.equal(initial.work.dependent,'state-column-waiting');assert.equal(initial.work.coordination,'state-column-now');assert.equal(initial.coordination,'technical');
    assert.ok(initial.questions.some(q=>q.text.includes('Autorizar')&&q.text.includes('La tarea conserva su dependencia')));
    assert.ok(initial.questions.some(q=>q.text.includes('elección es abierta')&&q.text.includes('decisión aún abierta')));
    assert.deepEqual(initial.asks.map(c=>c.task).sort(),['ask','completed-question']);
    assert.ok(initial.edges.some(e=>e.from==='task:dependent'&&e.to==='task:ask'&&!e.completed));
    run('run',[],`await page.click('#board [data-node$="task:dependent"] .card-open');`);
    const arrows=evaluate(`async()=>{for(let i=0;i<100&&!document.querySelector('svg.links .before-link');i++)await new Promise(r=>setTimeout(r,100));return {path:!!document.querySelector('svg.links .before-link'),questionRole:[...document.querySelectorAll('#board .qcard .relation-role')].map(x=>x.textContent)};}`);
    assert.equal(arrows.path,true);assert.ok(arrows.questionRole.some(t=>t.includes('Detiene')));
    run('run',[],`await page.press('Escape');await page.eval(()=>[...document.querySelectorAll('#board .qcard')].find(c=>c.textContent.includes('¿Autorizas')).querySelector('.card-open').click());await page.wait('#answer-note');await page.click('#detail-content .own-words-fold > summary');await page.fill('#answer-note','Unsent captain answer');await page.eval(()=>{window.questionDraft=document.querySelector('#answer-note');});`);
    const snapshot=path.join(proof,'home/work-snapshot.json'),raw=JSON.parse(fs.readFileSync(snapshot));
    const ask=raw.tasks.find(x=>x.key==='task:ask');ask.phase='activation';ask.progress={done:9,total:10};ask.progress_evidence={freshness:'current',current:true};fs.writeFileSync(snapshot,JSON.stringify(raw));
    const draft=evaluate(`async()=>{for(let i=0;i<160;i++){const b=await(await fetch('api/board')).json();if(b.deck.sources[0].snapshot.nodes.find(x=>x.task==='ask').phase==='activation')break;await new Promise(r=>setTimeout(r,100));}await new Promise(r=>setTimeout(r,500));return {same:window.questionDraft===document.querySelector('#answer-note'),text:document.querySelector('#answer-note')?.value,forbidden:document.querySelectorAll('#detail-content .prog,#detail-content .deck-controls,#detail-content .plabel,#detail-content .pause-control').length,choices:[...document.querySelectorAll('#detail-content .option-choice')].map(x=>x.textContent)};}`);
    assert.equal(draft.same,true);assert.equal(draft.text,'Unsent captain answer');assert.equal(draft.forbidden,0);assert.ok(draft.choices.some(t=>t.includes('Autorizar')));
    const question=initial.asks.find(c=>c.task==='ask');const routing=evaluate(`async()=>{const t=await(await fetch('api/ticket/${question.key}')).json();return {task:t.task,home:t.home,occurrence:!!t.call.occurrence};}`);
    assert.deepEqual(routing,{task:'ask',home:question.home,occurrence:true});
    run('run',[],`await page.click('#detail-content .option-choice[data-value=yes]');`);
    const saved=evaluate(`async()=>{let b;for(let i=0;i<160;i++){b=await(await fetch('api/board')).json();if(b.columns.flatMap(c=>c.cards).find(c=>c.task==='ask')?.answered&&document.querySelectorAll('#board .qcard').length===1)break;await new Promise(r=>setTimeout(r,100));}return {answered:b.columns.flatMap(c=>c.cards).find(c=>c.task==='ask')?.answered,ordinary:!!document.querySelector('#board [data-node$=\"task:ask\"]'),remaining:[...document.querySelectorAll('#board .qcard')].map(x=>x.textContent),work:document.querySelector('#board [data-node$=\"task:dependent\"]')?.closest('section')?.id};}`);
    const focusAfterAnswer=evaluate(`async()=>{await new Promise(r=>setTimeout(r,700));return {dimmed:document.querySelectorAll('#board .task-card[data-dim]').length,receipt:!!document.querySelector('#answer-status .receipt')};}`);
    assert.equal(focusAfterAnswer.dimmed,0);assert.equal(focusAfterAnswer.receipt,true);
    assert.equal(saved.answered,true);assert.equal(saved.ordinary,false);assert.equal(saved.remaining.length,1);assert.match(saved.remaining[0],/Qué destino/);assert.equal(saved.work,'state-column-waiting');
    run('run',[],`await page.press('Escape');await page.eval(()=>[...document.querySelectorAll('#board .qcard')].find(c=>c.textContent.includes('¿Qué destino')).querySelector('.card-open').click());await page.wait('#answer-note');`);
    const completed=evaluate(`()=>({text:document.querySelector('#detail-content').textContent,forbidden:document.querySelectorAll('#detail-content .prog,#detail-content .deck-controls').length,origin:[...document.querySelectorAll('#detail-content button')].some(b=>b.textContent==='Ir a la tarea de origen'&&!b.disabled)})`);
    assert.match(completed.text,/destino porque la elección es abierta/);assert.match(completed.text,/sigue abierta/);assert.equal(completed.forbidden,0);assert.equal(completed.origin,true);
    assert.equal(fs.existsSync(path.join(proof,'home/work-calls.jsonl')),false);assert.equal(fs.readFileSync(path.join(proof,'home/mutations.jsonl'),'utf8').trim().split('\n').length,1,'Only the explicit fixture answer is sent');
    if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'question-cards.json'),JSON.stringify({initial,arrows,draft,routing,saved,completed,controlMutations:false,fixtureAnswers:1},null,2));}
  }finally{child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(proof,{recursive:true,force:true});}
});
