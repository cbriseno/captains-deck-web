/* The real consumer renders the additive owner checkpoint contract over HTTP. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');
const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';
const available = spawnSync(cli,['--version'],{encoding:'utf8'}).status === 0;

for (const language of ['es','en']) test('progress checkpoint: current, historical and missing in '+language,
  {skip:!available,timeout:120000}, async () => {
    const proof = fs.mkdtempSync(path.join(os.tmpdir(),'deck-progress-'));
    const env = {...process.env,CD_TEST_PROGRESS:'1',CD_WEB_LANGUAGE:language,
      CHROME_DEVTOOLS_AXI_SESSION:'deck-progress-'+process.pid+'-'+language};
    for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT',
      'CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL']) delete env[key];
    const child = spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
    let browser = false;
    const run = (command,args=[],input) => {
      const p=spawnSync(cli,[command,...args],{env,input,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
      assert.equal(p.status,0,p.stdout+'\n'+p.stderr);return p.stdout;
    };
    const evaluate = code => {
      const output=run('eval',[`async () => JSON.stringify(await (${code})())`]),m=output.match(/^result: (.*)$/m);
      assert.ok(m,output);let value=JSON.parse(m[1]);for(let i=0;i<4&&typeof value==='string';i++){
        try{value=JSON.parse(value);}catch{break;}
      }return value;
    };
    try {
      const url=await new Promise((resolve,reject)=>{
        let output='';const timer=setTimeout(()=>reject(new Error('Fixture startup '+output)),12000);
        child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/(?:Fixture at|URL) ([^\s,]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
        child.stderr.on('data',chunk=>output+=chunk);child.on('exit',code=>reject(new Error('Fixture exit '+code+' '+output)));
      });
      const original=fs.readFileSync(path.join(proof,'home/work-snapshot.json'),'utf8');
      browser=true;run('open',[url]);run('resize',['1440','1000']);
      const cards=evaluate(`async()=>{for(let i=0;i<100&&!document.querySelector('#board .card[data-state=active]');i++)await new Promise(r=>setTimeout(r,50));return Object.fromEntries(['web','dependent','integration','next','second'].map(id=>{const card=[...document.querySelectorAll('#board .task-card')].find(x=>x.dataset.node.endsWith('task:'+id));return [id,{text:card.querySelector('.prog').textContent,bar:card.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')||null,alias:card.querySelector('.node-id').textContent,state:card.dataset.state}];}));}`);
      assert.equal(cards.web.bar,'33');assert.match(cards.web.alias,/^ID: T-/);
      for(const key of ['dependent','integration','next','second']) {assert.equal(cards[key].bar,null);assert.equal(cards[key].text.includes('%'),false);}
      const expected=language==='es'?['actualizarse','no hay avance declarado','sin confirmar','no es válida']:['needs an update','No progress declared','not confirmed','invalid'];
      for(const [i,key] of ['dependent','integration','next','second'].entries())assert.ok(cards[key].text.includes(expected[i]),cards[key].text);
      assert.equal(cards.integration.state,'paused');assert.equal(cards.next.state,'ready');assert.equal(cards.second.state,'ready');
      assert.ok(cards.integration.text.includes(language==='es'?'Lista para integrar':'Ready for integration'));
      assert.ok(cards.next.text.includes(language==='es'?'Activación':'Activation'));
      assert.ok(cards.second.text.includes(language==='es'?'Integración':'Integration'));
      const historical=evaluate(`async()=>{[...document.querySelectorAll('#board .task-card')].find(x=>x.dataset.node.endsWith('task:dependent')).querySelector('.card-open').click();for(let i=0;i<100&&!document.querySelector('#detail-content .prog[data-freshness=stale]');i++)await new Promise(r=>setTimeout(r,50));const p=document.querySelector('#detail-content .prog');return {text:p.textContent,summary:p.querySelector('summary')?.textContent,bar:!!p.querySelector('[role=progressbar]')};}`);
      assert.equal(historical.bar,false);assert.equal(historical.text.includes('%'),false);
      assert.ok(historical.summary.includes(language==='es'?'histórica':'historical'));assert.ok(historical.text.includes(language==='es'?'4 de 7':'4 of 7'));assert.ok(historical.text.includes('Earlier scope'));
      const missing=evaluate(`async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));[...document.querySelectorAll('#board .task-card')].find(x=>x.dataset.node.endsWith('task:integration')).querySelector('.card-open').click();for(let i=0;i<100&&!document.querySelector('#detail-content .prog[data-freshness=missing]');i++)await new Promise(r=>setTimeout(r,50));const p=document.querySelector('#detail-content .prog');return {text:p.textContent,bar:!!p.querySelector('[role=progressbar]'),history:!!p.querySelector('details'),alias:document.querySelector('#detail-content .node-id').textContent};}`);
      assert.equal(missing.bar,false);assert.equal(missing.history,false);assert.equal(missing.alias,cards.integration.alias);
      assert.equal(fs.readFileSync(path.join(proof,'home/work-snapshot.json'),'utf8'),original);
      // Change the disposable owner snapshot, then wait for the real HTTP poll.
      // No browser response injection or detail close/reopen drives a transition.
      const snapshotPath=path.join(proof,'home/work-snapshot.json'),snapshot=JSON.parse(original),transitions=[];
      const writeSnapshot = () => {fs.writeFileSync(snapshotPath+'.tmp',JSON.stringify(snapshot));fs.renameSync(snapshotPath+'.tmp',snapshotPath);};
      const publish = (id,freshness,done,total,phase) => {
        const row=snapshot.tasks.find(x=>x.key==='task:'+id),steps=Array.from({length:total},(_,i)=>({label:'Live step '+(i+1),state:i<done?'done':'todo'}));
        row.progress=freshness==='current'?{done,total,steps}:null;
        row.declared_progress={done,total,steps,updated:'2026-11-01T06:00:00Z'};
        row.progress_evidence={freshness,current:freshness==='current',reported_at:'2026-11-01T06:00:00Z',source:'task.progress.checkpoint',reasons:freshness==='stale'?['status-checkpoint-required']:[],applicable_gates:[]};row.phase=phase;
        writeSnapshot();
      };
      const reading = (id,freshness,bar,focus) => {
        const result=evaluate(`async()=>{let p,c;for(let i=0;i<180;i++){p=document.querySelector('#detail-content .prog');c=document.querySelector('#board [data-node$="task:${id}"] .prog');if(p?.dataset.freshness==='${freshness}'&&(p.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')||null)===${JSON.stringify(bar)}&&(!c||c.dataset.freshness==='${freshness}'))break;await new Promise(r=>setTimeout(r,100));}await new Promise(r=>setTimeout(r,250));const saved=window.progressEdit,ta=saved.textarea;return {freshness:p?.dataset.freshness,text:p?.textContent,bar:p?.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')||null,cardBar:c?.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')||null,cardFreshness:c?.dataset.freshness,phase:p?.querySelector('.prog-phase')?.textContent,foldOpen:p?.querySelector('details')?.open,active:document.activeElement?.outerHTML?.slice(0,240),focus:document.activeElement===ta?'textarea':document.activeElement===p?.querySelector('summary')?'summary':'other',sameTextarea:document.querySelector(saved.selector)===ta,sameControls:document.querySelector('#detail-content .deck-controls')===saved.controls,samePanel:document.querySelector('#detail-content .deck-removal-panel')===saved.panel,dependencyUnchanged:saved.dependency===document.querySelector('#detail-content select[name=dependency]'),draft:ta.value,consultation:document.querySelector('#detail-content textarea[name=removal-reason]')?.value,selection:[ta.selectionStart,ta.selectionEnd],textareaScroll:ta.scrollTop,savedTextareaScroll:saved.textareaScroll,scroll:[scrollX,scrollY],savedScroll:saved.scroll};}`);
        assert.equal(result.freshness,freshness);assert.equal(result.bar,bar);
        if(result.cardFreshness){assert.equal(result.cardFreshness,freshness);assert.equal(result.cardBar,bar);}
        if(freshness==='stale'){assert.equal(result.text.includes('%'),false);assert.ok(result.text.includes(language==='es'?'histórica':'historical'));}
        for(const key of ['sameTextarea','sameControls','samePanel','dependencyUnchanged'])assert.equal(result[key],true,key);
        assert.equal(result.focus,focus,JSON.stringify(result));assert.match(result.draft,/Unsent/);assert.match(result.consultation,/Unsent/);
        assert.deepEqual(result.selection,[3,9]);assert.equal(result.textareaScroll,result.savedTextareaScroll,JSON.stringify(result));assert.deepEqual(result.scroll,result.savedScroll);assert.equal(result.foldOpen,true);
        transitions.push({id,...result});return result;
      };
      const prepare = (selector) => {
        run('run',[],`await page.fill('#detail-content textarea[name=removal-reason]','Unsent consultation stays here');await page.fill('${selector}','Unsent draft\\n${'extra line\\n'.repeat(15)}');`);
        const prepared=evaluate(`async()=>{const ta=document.querySelector('${selector}');document.querySelector('#detail-content .prog details').open=true;document.querySelector('#detail-content .deck-more').open=true;ta.focus({preventScroll:true});ta.setSelectionRange(3,9);ta.scrollTop=40;window.scrollTo(0,Math.min(120,document.documentElement.scrollHeight-innerHeight));window.progressEdit={textarea:ta,selector:'${selector}',controls:document.querySelector('#detail-content .deck-controls'),panel:document.querySelector('#detail-content .deck-removal-panel'),dependency:document.querySelector('#detail-content select[name=dependency]'),textareaScroll:ta.scrollTop,scroll:[scrollX,scrollY]};return {focused:document.activeElement===ta,visible:!!ta.getClientRects().length,panelHidden:document.querySelector('#detail-content .deck-removal-panel').hidden};}`);assert.equal(prepared.focused,true,JSON.stringify(prepared));
      };
      run('run',[],`await page.press('Escape');await page.click('#board [data-node$="task:web"] .card-open');await page.wait('#detail-content .prog details');`);
      prepare('#detail-content textarea[name=removal-reason]');
      snapshot.tasks.find(x=>x.key==='task:web').reason='Separate board update before progress changes';writeSnapshot();
      const otherRefresh=evaluate(`async()=>{for(let i=0;i<180&&!document.querySelector('#board [data-node$="task:web"] .card-line')?.textContent.includes('Separate board update');i++)await new Promise(r=>setTimeout(r,100));return document.querySelector('#board [data-node$="task:web"] .card-line')?.textContent;}`);
      assert.ok(otherRefresh.includes('Separate board update'));reading('web','current','33','textarea');
      publish('web','stale',1,3,'activation');reading('web','stale',null,'textarea');
      evaluate(`async()=>{document.querySelector('#detail-content .prog summary').focus({preventScroll:true});window.progressEdit.textareaScroll=window.progressEdit.textarea.scrollTop;window.progressEdit.scroll=[scrollX,scrollY];return true;}`);
      publish('web','current',2,3,'integration');const restored=reading('web','current','67','summary');
      assert.ok(restored.phase.includes(language==='es'?'Integración':'Integration'));
      publish('ask','current',1,2,'validation');
      run('run',[],`await page.press('Escape');await page.click('#board .qcard .card-open');await page.wait('#answer-note');`);
      run('run',[],`await page.click('#detail-content .own-words-fold > summary');await page.fill('#answer-note','Unsent question draft');await page.eval(()=>{window.questionDraft=document.querySelector('#answer-note');});`);
      for(const [freshness,done,total,phase] of [['stale',1,2,'activation'],['current',2,2,'complete']]){
        publish('ask',freshness,done,total,phase);
        const question=evaluate(`async()=>{for(let i=0;i<180;i++){const b=await(await fetch('api/board')).json();if(b.deck.sources[0].snapshot.nodes.find(x=>x.task==='ask')?.phase==='${phase}')break;await new Promise(r=>setTimeout(r,100));}await new Promise(r=>setTimeout(r,500));return {sameDraft:window.questionDraft===document.querySelector('#answer-note'),draft:document.querySelector('#answer-note')?.value,executionControls:document.querySelectorAll('.qcard .prog,.qcard .card-ctl,#detail-content .prog,#detail-content .deck-controls').length};}`);
        assert.equal(question.executionControls,0);assert.equal(question.sameDraft,true);assert.equal(question.draft,'Unsent question draft');
      }
      run('run',[],`await page.press('Escape');await page.click('#board [data-node$="task:demo-research"] .card-open');await page.wait('#detail-content .detail-tabs');await page.click('#detail-content .detail-tabs button:nth-child(2)');`);
      evaluate(`async()=>{window.retainedReportTab=document.querySelector('#detail-content .detail-tabs button[aria-pressed=true]');return true;}`);
      publish('web','current',3,3,'complete');
      const report=evaluate(`async()=>{for(let i=0;i<180&&document.querySelector('#board [data-node$="task:web"] [role=progressbar]')?.getAttribute('aria-valuenow')!=='100';i++)await new Promise(r=>setTimeout(r,100));return {boardBar:document.querySelector('#board [data-node$="task:web"] [role=progressbar]')?.getAttribute('aria-valuenow'),sameTab:window.retainedReportTab===document.querySelector('#detail-content .detail-tabs button[aria-pressed=true]'),tab:document.querySelector('#detail-content .detail-tabs button[aria-pressed=true]')?.textContent,report:document.querySelector('#detail-content').textContent.includes('FIN_DEL_INFORME')};}`);
      assert.equal(report.boardBar,'100');assert.equal(report.sameTab,true);assert.equal(report.report,true);assert.equal(report.tab,language==='es'?'Informe':'Report');
      fs.writeFileSync(snapshotPath+'.tmp',original);fs.renameSync(snapshotPath+'.tmp',snapshotPath);
      assert.equal(fs.readFileSync(snapshotPath,'utf8'),original);
      const calls=path.join(proof,'home/work-calls.jsonl');assert.equal(fs.existsSync(calls),false,'No preview/apply operation is needed for progress reads');
      assert.equal(fs.existsSync(path.join(proof,'home/mutations.jsonl')),false,'Unsent answer must not reach intake');
      if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'progress-'+language+'.json'),JSON.stringify({cards,historical,missing,transitions,report,ownerUnchanged:true},null,2));}
    } finally {
      child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(proof,{recursive:true,force:true});
    }
  });
