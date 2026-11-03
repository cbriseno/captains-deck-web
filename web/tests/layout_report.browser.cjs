/* Real-browser measurements for the reported dense, long-title Deck state. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');

const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';
const available = spawnSync(cli, ['--version'], {encoding: 'utf8'}).status === 0;

test('reported Deck layout with four active tasks at desktop widths', {skip: !available, timeout: 120000}, async () => {
  const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-layout-report-'));
  const session = process.env.CD_TEST_SESSION || `deck-layout-report-${process.pid}`;
  const env = {...process.env, CD_WEB_LANGUAGE: 'en', CHROME_DEVTOOLS_AXI_SESSION: session,
    CHROME_DEVTOOLS_AXI_CHROME_ARGS: process.env.CHROME_DEVTOOLS_AXI_CHROME_ARGS || '--force-device-scale-factor=2'};
  const fixture = path.join(__dirname, 'layout_fixture.py');
  const child = spawn('python3', [fixture, proof, 'en'], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let browserStarted = false;
  const run = (command, args = []) => {
    const result = spawnSync(cli, [command, ...args], {env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024});
    assert.equal(result.status, 0, `${command}: ${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const evaluate = code => {
    const output = run('eval', ['--full', `async () => JSON.stringify(await (${code})())`]);
    const match = output.match(/^result: (.*)$/m);
    assert.ok(match, output);
    let value = JSON.parse(match[1]);
    for (let i = 0; i < 4 && typeof value === 'string'; i++) {
      try {value = JSON.parse(value);} catch {break;}
    }
    return value;
  };
  try {
    const url = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`fixture startup timeout ${output}`)), 12000);
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/URL (http:\/\/127\.0\.0\.1:\d+\/)/);
        if (match) {clearTimeout(timer); resolve(match[1]);}
      });
      child.stderr.on('data', chunk => {output += chunk;});
      child.on('exit', code => reject(new Error(`fixture exited ${code} ${output}`)));
    });
    browserStarted = true;
    run('open', [url]);
    for (const [width, height] of [[1440, 1000], [2560, 1200]]) {
      run('resize', [String(width), String(height)]);
      run('eval', [`async()=>{for(let i=0;i<120&&!document.querySelector('#board .task-card');i++)await new Promise(r=>setTimeout(r,50));let style=document.querySelector('#mac-font-fixture');if(!style){style=document.createElement('style');style.id='mac-font-fixture';style.textContent=':root,body,button,input,select{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif!important}';document.head.append(style);}await document.fonts.ready;return true;}`]);
      const measured = evaluate(`async()=>{for(let i=0;i<120&&!document.querySelector('#board .task-card');i++)await new Promise(r=>setTimeout(r,50));const api=await(await fetch('api/board')).json(),box=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},intersects=(a,b)=>a.left<b.right-.5&&a.right>b.left+.5&&a.top<b.bottom-.5&&a.bottom>b.top+.5,cols=[...document.querySelectorAll('#board>.col')].filter(e=>getComputedStyle(e).display!=='none'),mixer=document.querySelector('#project-mixer'),needs=document.querySelector('#state-column-needs'),all=[...document.querySelectorAll('.topbar,#deck-lead,#deck-next,#projects-view,#board-view,#project-mixer,#board,.col')].filter(e=>getComputedStyle(e).display!=='none'),focus=[...document.querySelectorAll('.top-r [data-i18n]')].map(e=>e.dataset.i18n).filter(x=>x==='Focus'||x==='Delay'),overlaps=[];for(let i=0;i<cols.length;i++)for(let j=i+1;j<cols.length;j++)if(intersects(box(cols[i]),box(cols[j])))overlaps.push([cols[i].dataset.k,cols[j].dataset.k]);return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,font:getComputedStyle(document.body).fontFamily,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,overflow:document.documentElement.scrollWidth-innerWidth,lead:document.querySelector('#deck-lead').textContent,next:document.querySelector('#deck-next').textContent,activeCards:document.querySelectorAll('#board [data-state=active]').length,columns:cols.map(e=>({key:e.dataset.k,...box(e),header:box(e.querySelector('.col-h'))})),mixer:box(mixer),needs:box(needs),mixerOverlapsNeeds:intersects(box(mixer),box(needs)),columnOverlaps:overlaps,allVisible:all.every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}),focus,taskTitles:[...document.querySelectorAll('#board .task-card .title')].map(e=>({text:e.textContent,rect:box(e),scroll:e.scrollWidth,client:e.clientWidth})),rightControls:[...document.querySelectorAll('#state-column-done .rail-btn,#state-column-done .hide-col,#state-column-paused .rail-btn,#state-column-paused .hide-col')].map(e=>({text:e.textContent,aria:e.getAttribute('aria-label'),rect:box(e)})),sourceCards:api.columns.flatMap(c=>c.cards).map(c=>({title:c.title,project:c.project,flowProject:c.flow?.project})),deckNodes:(api.deck?.sources||[]).flatMap(s=>s.snapshot?.nodes||[]).map(n=>({kind:n.kind,title:n.title,parent:n.parent,alias:n.alias,role:n.role,visibility:n.raw?.visibility})),renderedCards:[...document.querySelectorAll('#board .task-card')].map(e=>({title:e.querySelector('.title')?.textContent,where:e.querySelector('.where')?.textContent,id:e.querySelector('.node-id')?.textContent})),projectVisibility:[...document.querySelectorAll('#project-mixer .mix[data-kind=project]')].map(e=>({title:e.querySelector('.mix-label')?.textContent,visibility:e.querySelector('.mix-visibility')?.textContent,warning:e.querySelector('.mix-wait')?.textContent,id:e.querySelector('.node-id')?.textContent})),projectIds:[...document.querySelectorAll('#project-mixer .mix[data-kind=project] .node-id')].map(e=>e.textContent)};}`);
      assert.equal(measured.width, width, JSON.stringify(measured));
      assert.equal(measured.dpr, 2);
      assert.equal(measured.activeCards, 4);
      assert.equal(measured.deckNodes.length, 0);
      assert.equal(measured.overflow, 0);
      assert.equal(measured.allVisible, true);
      assert.equal(measured.mixerOverlapsNeeds, false);
      assert.deepEqual(measured.columnOverlaps, []);
      assert.ok(measured.columns.every(column => Math.abs(column.top - measured.columns[0].top) < 1));
      assert.ok(measured.columns.every(column => Math.abs(column.header.height - measured.columns[0].header.height) < 1));
      assert.equal(measured.focus.filter(label => label === 'Focus').length, 1);
      assert.equal(measured.focus.filter(label => label === 'Delay').length, 1);
      assert.ok(measured.projectVisibility.length > 0);
      assert.ok(measured.projectVisibility.every(group => group.visibility === 'Visibility unknown' && !group.warning));
      assert.ok(measured.projectIds.length > 0);
      assert.ok(measured.projectIds.every(id => !id.includes('ID pending')));
      assert.ok(measured.renderedCards.length > 0);
      assert.ok(measured.renderedCards.every(card => card.id && !card.id.includes('ID pending')));
      for (const card of measured.sourceCards.filter(row => ['Paginate', 'Rebuild the search', 'Refresh the setup'].some(prefix => row.title.startsWith(prefix)))) {
        const expected = card.flowProject?.label || card.project?.label;
        if (expected) assert.equal(measured.renderedCards.find(row => row.title === card.title)?.where, expected);
      }
      assert.equal(measured.renderedCards.find(row => row.title === 'Write the release notes')?.where, 'Firstmate');
      assert.ok(measured.rightControls.every(control => control.rect.left >= 0 && control.rect.right <= width));
      assert.equal(measured.activeCards, 4);
      const parity = evaluate(`async()=>{const anon=window.DeckAnonymize;if(!anon)return {available:false};const selectors='.topbar,#workspace,.row-hero,#deck-lead,#deck-next,#board>.col,#project-mixer,.task-card .title,.task-card .dates,.col-h';const sample=()=>[...document.querySelectorAll(selectors)].map(el=>{const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const value={selector:el.id||el.className,connected:el.isConnected,x:r.x,y:r.y,w:r.width,h:r.height,lines:new Set([...range.getClientRects()].filter(x=>x.width&&x.height).map(x=>Math.round(x.top))).size};if(el.id==='project-mixer')value.groups=[...el.querySelectorAll('.mix-group')].map(group=>(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))(group.getBoundingClientRect()));if(el.classList.contains('col'))value.cards=[...el.querySelectorAll('.task-card')].map(card=>({title:card.querySelector('.title')?.textContent,box:(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))(card.getBoundingClientRect()),titleBox:(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))(card.querySelector('.title').getBoundingClientRect()),datesBox:card.querySelector('.dates')&&(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))(card.querySelector('.dates').getBoundingClientRect())}));return value;});const before=sample();await anon.set(true);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const on=sample();return {available:true,before,on};}`);
      if (parity.available) {
        if (process.env.CD_TEST_EVIDENCE) run('screenshot', [path.join(process.env.CD_TEST_EVIDENCE, `dense-anonymous-${width}.png`)]);
        if (process.env.CD_TEST_EVIDENCE) fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE, `dense-parity-${width}.json`), JSON.stringify(parity,null,2));
        parity.off=evaluate(`async()=>{await DeckAnonymize.set(false);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const selectors='.topbar,#workspace,.row-hero,#deck-lead,#deck-next,#board>.col,#project-mixer,.task-card .title,.task-card .dates,.col-h';return [...document.querySelectorAll(selectors)].map(el=>{const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const value={x:r.x,y:r.y,w:r.width,h:r.height,lines:new Set([...range.getClientRects()].filter(x=>x.width&&x.height).map(x=>Math.round(x.top))).size};if(el.classList.contains('col'))value.cards=[...el.querySelectorAll('.task-card')].map(card=>({title:card.querySelector('.title')?.textContent,box:(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))(card.getBoundingClientRect()),titleBox:(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))(card.querySelector('.title').getBoundingClientRect()),datesBox:card.querySelector('.dates')&&(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))(card.querySelector('.dates').getBoundingClientRect())}));return value;});}`);
        assert.equal(parity.before.length, parity.on.length);
        assert.equal(parity.before.length, parity.off.length);
        for (let i=0;i<parity.before.length;i++) for (const key of ['x','y','w','h']) {
          assert.ok(Math.abs(parity.before[i][key]-parity.on[i][key])<=Math.max(key==='lines'?0:1,Math.abs(parity.before[i][key])*.02),JSON.stringify({width,key,item:parity.before[i],anon:parity.on[i]}));
          assert.ok(Math.abs(parity.before[i][key]-parity.off[i][key])<=Math.max(key==='lines'?0:1,Math.abs(parity.before[i][key])*.02),JSON.stringify({width,key,item:parity.before[i],restored:parity.off[i]}));
        }
      }
      if (process.env.CD_TEST_EVIDENCE) {
        fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE, `dense-${width}.json`), JSON.stringify({...measured,parity}, null, 2));
        run('screenshot', [path.join(process.env.CD_TEST_EVIDENCE, `dense-${width}.png`)]);
      }
    }
  } finally {
    child.kill('SIGTERM');
    if (browserStarted && !process.env.CD_TEST_SESSION) run('stop');
    fs.rmSync(proof, {recursive: true, force: true});
  }
});
