/* End-to-end UI checks through chrome-devtools-axi, against a disposable owner.
   This proves Deck rendering and transport only; real Firstmate acceptance is separate. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');
const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';
const available = spawnSync(cli,['--version'],{encoding:'utf8'}).status === 0;

test('approved Deck: hierarchy, controls, receipts, inline questions, history, themes, keyboard and phone', {skip:!available,timeout:120000}, async () => {
  const proof = fs.mkdtempSync(path.join(os.tmpdir(),'deck-approved-'));
  const env = {...process.env,CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_AUTO_CONNECT:'0',CHROME_DEVTOOLS_AXI_SESSION:process.env.CD_TEST_SESSION || 'deck-test-'+process.pid};
  const child = spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  let browserStarted = false;
  const run = (command,args=[]) => {
    const result = spawnSync(cli,[command,...args],{env,encoding:'utf8',timeout:command==='open'?60000:30000,maxBuffer:2*1024*1024});
    assert.equal(result.status,0,`${command}: ${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const evaluate = code => {
    const output=run('eval',[`async () => JSON.stringify(await (${code})())`]);
    const match=output.match(/^result: (.*)$/m);assert.ok(match,output);
    let value=JSON.parse(match[1]);for(let i=0;i<4&&typeof value==='string';i++){try{value=JSON.parse(value);}catch{break;}}
    return value;
  };
  const wait = 'const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw new Error("Timed out");};';
  try {
    const url = await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error('fixture startup timeout '+output)),12000);
      child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
      child.stderr.on('data',chunk=>output+=chunk);child.on('exit',code=>reject(new Error('fixture exited '+code+' '+output)));
    });
    browserStarted=true;if(process.env.CD_TEST_PAGE_ID)run('selectpage',[process.env.CD_TEST_PAGE_ID]);run('open',[url]);run('resize',['1440','1000']);
    // The approved board groups work by request (including legacy project groups).
    // Open requests before expecting task controls; finished steps fold separately.
    const initial=evaluate(`async()=>{${wait}
      await wait(()=>document.querySelector('.request-row'));
      const folded=document.querySelector('.request-title').getAttribute('aria-expanded');
      [...document.querySelectorAll('#columns-nav button')].find(x=>x.textContent==='Desplegar encargos').click();
      const finished=[...document.querySelectorAll('.request-tasks>.more')].find(x=>!x.classList.contains('log-fold'));
      finished?.click();
      return {folded,requests:document.querySelectorAll('#board .request-row').length,
        ready:document.querySelectorAll('#board .task-row[data-state=ready]').length,
        aliases:[...document.querySelectorAll('#board .task-row .node-id')].map(x=>x.textContent),
        progress:[...document.querySelectorAll('[role=progressbar]')].map(x=>x.getAttribute('aria-valuenow'))};
    }`);
    assert.equal(initial.folded,'false');assert.equal(initial.requests,1);assert.equal(initial.ready,2);
    assert.ok(initial.aliases.length>=7);assert.ok(initial.aliases.every(x=>/^ID: T-[2-9A-HJ-NP-Z]{3}$/.test(x)));assert.ok(initial.progress.includes('33'));
    for(const [width,height] of [[1440,1000],[2560,1200]]){
      run('resize',[String(width),String(height)]);
      const layout=evaluate(`()=>{const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
        const a=box(document.querySelector('.attention-list')),b=box(document.querySelector('.request-list'));
        return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,
          overlap:a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top};}`);
      assert.equal(layout.width,width);assert.equal(layout.height,height);assert.equal(layout.overflow,0);assert.equal(layout.overlap,false);
      if(process.env.CD_TEST_EVIDENCE){fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,`layout-${width}.json`),JSON.stringify(layout,null,2));run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,`layout-${width}.png`)]);}
    }
    run('resize',['1440','1000']);
    const hierarchy=evaluate(`()=>{
      document.querySelector('#projects-view').click();
      const project=()=>document.querySelector('#project-tree .mix[data-kind=project]');project().querySelector('.fold-btn').click();
      const subs=[...document.querySelectorAll('#project-tree .mix[data-kind=sub]')].map(x=>({label:x.querySelector('.mix-label').textContent,depth:+x.closest('.tree-entry').dataset.depth}));
      const priority=project().querySelector('select[name=priority]').value;
      project().querySelector('.fold-btn').click();const collapsed=document.querySelectorAll('#project-tree .mix[data-kind=sub]').length;
      document.querySelector('#board-view').click();return {subs,priority,collapsed};
    }`);
    assert.equal(hierarchy.subs.length,2);assert.ok(hierarchy.subs.every(x=>x.depth===1));assert.equal(hierarchy.priority,'P0');assert.equal(hierarchy.collapsed,0);
    const ownerBeforeConsultation=fs.readFileSync(path.join(proof,'home/work-snapshot.json'),'utf8');
    const consultation=evaluate(`async()=>{${wait}document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const card=[...document.querySelectorAll('#board .task-card')].find(x=>x.dataset.node.endsWith('task:next'));const alias=card.querySelector('.node-id').textContent;card.querySelector('.card-open').click();await wait(()=>document.querySelector('.deck-object-tools'));const reason=document.querySelector('[name=removal-reason]');reason.value='Consultar iniciativa y dependencias, sin eliminar.';const preview='Guarded consultation sent in one press';document.querySelector('.deck-removal-send').click();await wait(()=>document.querySelector('.change-preview')?.textContent.includes('Consulta registrada'));return {alias,detail:document.querySelector('.deck-object-tools .node-id').textContent,preview,receipt:document.querySelector('.change-preview').textContent};}`);
    assert.equal(consultation.detail,consultation.alias);assert.ok(consultation.receipt.includes('Firstmate debe revisar el impacto'));assert.equal(fs.readFileSync(path.join(proof,'home/work-snapshot.json'),'utf8'),ownerBeforeConsultation);
    const removalCalls=fs.readFileSync(path.join(proof,'home/work-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(x=>x.operation?.op==='request_removal');assert.deepEqual(removalCalls.map(x=>x.command),['preview','apply']);assert.equal(removalCalls[1].operation.note,'Consultar iniciativa y dependencias, sin eliminar.');assert.equal(removalCalls[1].operation.target,'task:next');
    // A real owner reply receipt is distinct from a still-pending consultation.
    const consultationId=removalCalls[1].operation.request_id, replyText='Dependencias revisadas. Espera tu aprobación. <script>window.unwantedAdviceExecution=true</script>';
    fs.writeFileSync(path.join(proof,'home/request-'+consultationId+'.json'),'malformed fixture receipt');
    const failedReceipt=evaluate(`async()=>{${wait}[...document.querySelectorAll('#change-results button')].find(x=>x.textContent==='Comprobar recepción').click();await wait(()=>document.querySelector('#change-results .receipt-read-error')?.textContent);return {error:document.querySelector('#change-results .receipt-read-error').textContent,pending:document.querySelector('#change-results').textContent.includes('Consulta registrada')};}`);assert.ok(failedReceipt.error);assert.equal(failedReceipt.pending,true);
    fs.writeFileSync(path.join(proof,'home/request-'+consultationId+'.json'),JSON.stringify({request_id:consultationId,state:'applied',consultation:{note_id:'fixture-note',status:'replied',reply:{id:'fixture-note',body:replyText,cursor:'000000000001'}}}));
    const advice=evaluate(`async()=>{${wait}[...document.querySelectorAll('#change-results button')].find(x=>x.textContent==='Comprobar recepción').click();await wait(()=>document.querySelector('#change-results').textContent.includes('Firstmate respondió'));return {body:document.querySelector('#change-results .deck-consultation-reply').textContent,executed:!!window.unwantedAdviceExecution,state:document.querySelector('#change-results').textContent};}`);
    assert.equal(advice.body,replyText);assert.equal(advice.executed,false);assert.ok(advice.state.includes('visto bueno por separado'));assert.equal(fs.readFileSync(path.join(proof,'home/work-snapshot.json'),'utf8'),ownerBeforeConsultation);
    // Native question choices and drafts remain on the established intake.
    const question=evaluate(`async()=>{${wait}document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('#board .qcard .card-open').click();await wait(()=>document.querySelector('.recommended-choice'));const text=document.querySelector('#board .qcard .inline-answer input');text.value='Borrador del fixture';text.dispatchEvent(new Event('input',{bubbles:true}));return {recommended:document.querySelector('.recommended-choice').textContent,host:document.querySelector('#detail').closest('.qcard')!==null,draft:text.value};}`);
    assert.ok(question.recommended.includes('Recomendada'));assert.equal(question.host,true);
    // Priority preview/apply/undo is persisted by the disposable endpoint.
    const changed=evaluate(`async()=>{${wait}document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const card=[...document.querySelectorAll('.card')].find(x=>x.dataset.node.endsWith('task:next'));card.querySelector('.card-open').click();await wait(()=>document.querySelector('.deck-controls'));const select=card.querySelector('select');select.value='P0';select.dispatchEvent(new Event('change',{bubbles:true}));let confirm;await wait(()=>confirm=[...document.querySelectorAll('#detail-content .change-preview button')].find(x=>x.textContent==='Confirmar'));const effect=confirm.parentElement.querySelector('.fact').textContent,early=document.querySelector('#change-results').textContent.includes('Aplicado');confirm.click();await wait(()=>document.querySelector('#change-results').textContent.includes('Aplicado'));return {effect,early,results:document.querySelector('#change-results').textContent};}`);
    // Approved demo: «De X a Y: efecto · Confirmar» before anything is written.
    assert.match(changed.effect,/^De .+ a Crítica: Firstmate la atenderá antes\.$/);assert.equal(changed.early,false);assert.ok(changed.results.includes('Aplicado'));
    let snapshot=JSON.parse(fs.readFileSync(path.join(proof,'home/work-snapshot.json')));assert.equal(snapshot.tasks.find(x=>x.key==='task:next').priority.own,0);
    evaluate(`async()=>{${wait}[...document.querySelectorAll('#change-results button')].find(x=>x.textContent==='Deshacer').click();await wait(()=>document.querySelectorAll('#change-results .change-row').length===3&&document.querySelector('#change-results .change-row').textContent.includes('Aplicado'));return true;}`);
    snapshot=JSON.parse(fs.readFileSync(path.join(proof,'home/work-snapshot.json')));assert.equal(snapshot.tasks.find(x=>x.key==='task:next').priority.own,2);
    const calls=fs.readFileSync(path.join(proof,'home/work-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(calls.some(c=>c.command==='preview'&&!c.operation.request_id));assert.ok(calls.some(c=>c.command==='apply'&&c.operation.request_id));
    // An open related task draws lines; Focus can remove dimming independently.
    const lines=evaluate(`async()=>{${wait}document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));[...document.querySelectorAll('.card')].find(x=>x.dataset.node.endsWith('task:dependent')).querySelector('.card-open').click();await wait(()=>document.querySelector('.deck-controls'));const paths=document.querySelectorAll('svg.links path').length;document.querySelector('#focus-effects').checked=false;document.querySelector('#focus-effects').dispatchEvent(new Event('change'));return {paths,dim:document.querySelectorAll('[data-dim]').length,still:document.querySelectorAll('svg.links path').length};}`);
    assert.ok(lines.paths>0);assert.equal(lines.dim,0);assert.equal(lines.still,0);
    // All palettes and modes must maintain readable text and visible project marks.
    const contrast=evaluate(`()=>{const rgb=h=>h.match(/[0-9.]+/g).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0),ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05),color=(token)=>{const el=document.createElement('i');el.style.color='var('+token+')';document.body.append(el);const c=rgb(getComputedStyle(el).color);el.remove();return c;};const rows=[];for(const palette of ['grafito','papel','oceano','catppuccin','rosepine','gruvbox','solarized','nord','dracula','github','everforest','kanagawa'])for(const mode of ['light','dark']){DeckAppearance.set('palette',palette);DeckAppearance.set('mode',mode);for(const bg of ['--surface','--canvas','--hover'])for(const fg of ['--ink','--muted','--blue','--amber','--red','--pause'])rows.push({palette,mode,fg,bg,ratio:ratio(color(fg),color(bg)),min:4.5});for(let i=0;i<11;i++)rows.push({palette,mode,fg:'--h'+i,bg:'--surface',ratio:ratio(color('--h'+i),color('--surface')),min:3});}return rows.filter(x=>x.ratio<x.min);}`);
    assert.deepEqual(contrast,[]);
    // Keyboard closes inline detail and returns to the card.
    const keyboard=evaluate(`()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const focused=document.activeElement.classList.contains('card-open');return {closed:document.querySelector('#detail')?.dataset.open!=='true',focused,retained:!!document.querySelector('#detail')};}`);assert.equal(keyboard.closed,true);assert.equal(keyboard.focused,true);assert.equal(keyboard.retained,true);
    run('resize',['390','844']);run('open',[url]);
    // The question summary can push choices below the fold; verify the marked choice after scrolling.
    const phone=evaluate(`async()=>{${wait}await wait(()=>document.querySelector('.qcard'));document.querySelector('.qcard .card-open').click();await wait(()=>document.querySelector('.recommended-choice'));const choice=document.querySelector('.recommended-choice');await Promise.all(document.querySelector('.card-more').getAnimations().map(a=>a.finished));choice.scrollIntoView({block:'center',behavior:'instant'});const r=choice.getBoundingClientRect(),mark=choice.querySelector('.recommended'),m=mark.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth-innerWidth,width:innerWidth,height:innerHeight,recommended:r.top>=0&&r.bottom<=innerHeight&&m.width>0&&m.height>0&&getComputedStyle(mark).visibility==='visible'&&mark.textContent.includes('Recomendada')&&choice.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),lines:[...document.querySelectorAll('svg.links')].filter(x=>getComputedStyle(x).display!=='none').length,draft:document.querySelector('#board .qcard .inline-answer input').value};}`);
    if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'phone-check.json'),JSON.stringify(phone,null,2));}
    assert.equal(phone.overflow,0);assert.equal(phone.width,390);assert.equal(phone.height,844);assert.equal(phone.recommended,true);assert.equal(phone.draft,'Borrador del fixture');
    run('resize',['360','844']);assert.equal(evaluate(`()=>document.documentElement.scrollWidth-innerWidth`),0);
    evaluate(`async()=>{${wait}document.querySelector('#history-tab').click();await wait(()=>document.querySelector('.history-row'));document.querySelector('.history-row').click();await wait(()=>document.querySelector('#explain-request'));return {dialog:document.querySelectorAll('dialog').length,report:document.querySelector('#detail-content').textContent.includes('informe')};}`);
    // A busy worker's declared pause must agree across the request and detail.
    snapshot=JSON.parse(fs.readFileSync(path.join(proof,'home/work-snapshot.json')));
    snapshot.tasks=snapshot.tasks.filter(x=>x.key==='task:web');
    snapshot.tasks[0].request={id:'pause-demo',label:'Pausa declarada',project:'project:deck'};
    snapshot.requests=[{id:'pause-demo',key:'request:pause-demo',scope:'req:pause-demo',label:'Pausa declarada',project:'project:deck',tasks:['task:web']}];
    fs.writeFileSync(path.join(proof,'home/work-snapshot.json'),JSON.stringify(snapshot));
    const home=path.join(proof,'home'), journal=path.join(home,'state/fleet-ledger.jsonl');
    for(const event of [{event:'fixture.snapshot',value:snapshot},{event:'agent.activity',task:'web',value:{gen:'pause-test',seq:1,state:'busy'}},{event:'task.status',task:'web',state:'paused',text:'until later',ts:1792922000}]) fs.appendFileSync(journal,JSON.stringify({home,...event})+'\n');
    run('resize',['1970','1250']);run('open',[url]);
    const paused=evaluate(`async()=>{${wait}await wait(()=>document.querySelector('.request-row[data-node$="req:pause-demo"]'));const row=()=>document.querySelector('.request-row[data-node$="req:pause-demo"]');if(row().querySelector('.request-title').getAttribute('aria-expanded')==='false')row().querySelector('.request-title').click();await wait(()=>row().querySelector('.task-row .card-open'));row().querySelector('.task-row .card-open').click();await wait(()=>row().textContent.includes('No hay hora de fin para esta pausa'));return {signal:row().querySelector('.request-signal').textContent,line:row().querySelector('.task-row .rs').textContent};}`);
    assert.equal(paused.signal,'En pausa');assert.equal(paused.line,'En pausa');
    const evidence={initial,hierarchy,consultation,failedReceipt,advice,question,changed,lines,keyboard,phone,contrastFailures:contrast.length};
    if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'browser-fixture-checks.json'),JSON.stringify(evidence,null,2));}
  } finally {
    child.kill('SIGTERM');
    try {if(browserStarted&&!process.env.CD_TEST_SESSION)run('stop');}
    finally {await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));fs.rmSync(proof,{recursive:true,force:true});}
  }
});
require('./mac_regressions.browser.cjs');
