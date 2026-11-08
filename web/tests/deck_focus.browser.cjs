/* G3: exercise the real renderer and router with a disposable owner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');
const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';

test('focus resolves visible request/project anchors and completed relationship details', {timeout:120000}, async () => {
  const proof = fs.mkdtempSync(path.join(os.tmpdir(),'deck-focus-'));
  const env = {...process.env,CD_WEB_LANGUAGE:'es',CD_TEST_RELATIONS:'1',CHROME_DEVTOOLS_AXI_AUTO_CONNECT:'0',
    CHROME_DEVTOOLS_AXI_SESSION:'deck-focus-'+process.pid};
  const child = spawn('python3',['-B',path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run = (command,...args) => {
    const r=spawnSync(cli,[command,...args.map(String)],{env,encoding:'utf8',timeout:60000});
    assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;
  };
  const evaluate = code => {
    const output=run('eval',code,'--full'),match=output.match(/^result: (.*)$/m);assert.ok(match,output);
    let value=JSON.parse(match[1]);while(typeof value==='string'){try{value=JSON.parse(value);}catch{break;}}return value;
  };
  const helpers = `const sleep=ms=>new Promise(r=>setTimeout(r,ms)),vis=x=>x&&x.getClientRects().length&&!x.closest('[hidden]'),
    click=text=>[...document.querySelectorAll('button')].find(x=>vis(x)&&x.textContent.includes(text)).click(),
    task=id=>[...document.querySelectorAll('.task-card')].find(x=>vis(x)&&x.dataset.node.endsWith(':task:'+id)),
    esc=()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`;
  let started=false;
  try {
    const url=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error('fixture timeout '+output)),12000);
      child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/Fixture at (http:\/\/127.0.0.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
      child.stderr.on('data',chunk=>output+=chunk);child.on('exit',code=>reject(new Error('fixture exit '+code+' '+output)));
    });
    started=true;run('open',url);run('resize',1440,1000);
    const isolated=evaluate(`async()=>{${helpers}click('Unrelated request');await sleep(400);task('second').querySelector('.card-open').click();await sleep(500);return {dim:document.querySelectorAll('#board [data-dim]').length,legend:!document.querySelector('#connector-key').hidden};}`);
    assert.deepEqual(isolated,{dim:0,legend:false});
    evaluate(`()=>{const route=window.routeDeckRelations;window.routeDeckRelations=o=>{window.focusAnchors=o.edges.map(e=>({edge:e,ends:[e.from,e.to].map(id=>{const el=o.find(id);return {id,found:!!el,visible:!!el?.getClientRects().length,group:el?.closest('.request-group')?.dataset.k,node:el?.dataset.node,dim:el?.closest('[data-dim]')?.dataset.node};})}));return route(o)};return true;}`);
    const folded=evaluate(`async()=>{${helpers}esc();click('Dependent request');await sleep(400);document.querySelector('#state-column-paused .col-h button').click();await sleep(400);task('dependent').querySelector('.card-open').click();await sleep(700);return {anchors:window.focusAnchors,numbers:[...document.querySelectorAll('.route-number')].map(x=>x.textContent),detail:document.querySelector('.deck-relationships')?.textContent,dimOpacity:getComputedStyle(document.querySelector('[data-node$=":req:isolated"]>.request-head')).opacity};}`);
    const dependency=folded.anchors.find(x=>x.edge.to.endsWith(':task:next'));
    assert.equal(dependency.ends[1].group,'paused');assert.ok(dependency.ends.every(x=>x.found&&x.visible&&!x.dim));
    assert.equal(folded.dimOpacity,'0.28');assert.equal(folded.numbers.length,6);assert.match(folded.detail,/Registrada por Firstmate/);assert.match(folded.detail,/Registrada por el capitán/);assert.match(folded.detail,/Heredada de/);
    const question=evaluate(`async()=>{${helpers}esc();document.querySelector('.qcard .card-open').click();await sleep(700);return {anchors:window.focusAnchors,numbers:[...document.querySelectorAll('.route-number')].map(x=>x.textContent)};}`);
    assert.equal(question.anchors.find(x=>x.edge.question).ends[1].group,'done');assert.ok(question.numbers.length>=2);
    const external=evaluate(`async()=>{${helpers}let dimAtAction=-1;const face=task('second').querySelector('.card-open');face.addEventListener('click',()=>dimAtAction=document.querySelectorAll('#board [data-dim]').length,{once:true});face.click();await sleep(500);return {dimAtAction,title:document.querySelector('#detail-title').textContent};}`);
    assert.equal(external.dimAtAction,0);assert.match(external.title,/Segundo turno/);
    const result=evaluate(`async()=>{${helpers}esc();document.querySelector('#state-column-done .col-h button').click();await sleep(400);click('Completed result');await sleep(400);const fold=[...document.querySelectorAll('[data-node$=":req:result"] .request-tasks button')].find(x=>vis(x)&&x.textContent.includes('terminada'));if(fold)fold.click();await sleep(400);task('demo-research').querySelector('.card-open').click();await sleep(700);return {detail:document.querySelector('.deck-relationships')?.textContent,view:[...document.querySelectorAll('.deck-relationships button')].some(x=>x.textContent==='Ver relaciones registradas')};}`);
    assert.equal(result.view,true);assert.match(result.detail,/Ya la liberó/);assert.match(result.detail,/Pregunta de esta tarea/);assert.match(result.detail,/Registrada por el capitán/);
    const projects=evaluate(`async()=>{${helpers}esc();document.querySelector('#projects-view').click();await sleep(400);const row=[...document.querySelectorAll('#project-tree .mix')].find(x=>x.dataset.node.endsWith(':project:deck'));[...row.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')?.startsWith('Detalles de')).click();await sleep(700);return {anchors:window.focusAnchors,numbers:[...document.querySelectorAll('.route-number')].map(x=>x.textContent)};}`);
    const cross=projects.anchors.find(x=>x.edge.from.endsWith(':project:deck')&&x.edge.to.endsWith(':project:other'));
    assert.ok(cross.ends.every(x=>x.visible&&x.node&&!x.dim));assert.ok(projects.numbers.length>=2);
    const expanded=evaluate(`async()=>{${helpers}esc();for(const row of [...document.querySelectorAll('#project-tree .mix')].filter(x=>x.dataset.node.endsWith(':project:deck')||x.dataset.node.endsWith(':project:other')))row.querySelector('.fold-btn').click();await sleep(500);const row=[...document.querySelectorAll('#project-tree .mix')].find(x=>x.dataset.node.endsWith(':project:deck'));[...row.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')?.startsWith('Detalles de')).click();await sleep(700);return {anchors:window.focusAnchors,numbers:[...document.querySelectorAll('.route-number')].map(x=>x.textContent)};}`);
    assert.ok(expanded.anchors.every(x=>x.ends.every(end=>end.visible&&!end.dim)));assert.ok(expanded.numbers.length>=2);
    run('resize',390,844);
    const mobile=evaluate(`async()=>{await new Promise(r=>setTimeout(r,500));return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,numbers:document.querySelectorAll('.route-number').length};}`);
    assert.deepEqual(mobile,{width:390,height:844,overflow:0,numbers:0});
  } finally {
    if(started)run('stop');child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
    fs.rmSync(proof,{recursive:true,force:true});
  }
});
