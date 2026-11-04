/* Reordered HTTP replies must not replay an old wait after newer work/progress. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');
const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';

test('an obsolete board reply cannot rewind Now to Waiting or mark a newer read offline', {timeout:90000}, async () => {
  const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-board-order-'));
  const env = {...process.env, CD_WEB_LANGUAGE:'es', CHROME_DEVTOOLS_AXI_SESSION:'deck-board-order-'+process.pid};
  for (const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL']) delete env[key];
  const child = spawn('python3', [path.join(__dirname,'ordered_board_fixture.py'), proof], {env, stdio:['ignore','pipe','pipe']});
  const run = (command, args=[], input) => {
    const r = spawnSync(cli, [command,...args], {env,input,encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
    assert.equal(r.status,0,r.stdout+r.stderr); return r.stdout;
  };
  const evaluate = code => JSON.parse(run('run',[],`console.log(JSON.stringify(await page.eval(${code})));`).trim());
  const until = async predicate => {
    const deadline=Date.now()+12000;
    while (!predicate()) { assert.ok(Date.now()<deadline,'Fixture condition timed out'); await new Promise(r=>setTimeout(r,30)); }
  };
  let browser=false;
  try {
    const url=await new Promise((resolve,reject)=>{
      let out='';const timer=setTimeout(()=>reject(new Error(out)),12000);
      child.stdout.on('data',s=>{out+=s;const m=out.match(/(?:Fixture at|URL) ([^\s,]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
      child.stderr.on('data',s=>out+=s); child.on('exit',c=>reject(new Error('Fixture '+c+' '+out)));
    });
    const snapshot=path.join(proof,'home/work-snapshot.json');
    const change=(state,done)=>{
      const raw=JSON.parse(fs.readFileSync(snapshot));const web=raw.tasks.find(x=>x.key==='task:web');
      web.state=state;web.reason=state==='waiting_dep'?'Actual fixture dependency':null;
      web.blocked_by=state==='waiting_dep'?[{ref:'task:next',open:true}]:[];
      web.progress.done=done;fs.writeFileSync(snapshot,JSON.stringify(raw));
    };
    change('waiting_dep',0);
    browser=true;run('open',[url]);
    evaluate(`async()=>{for(let i=0;i<100;i++){if(document.querySelector('#board [data-node$="task:web"]')?.dataset.state==='waiting')return true;await new Promise(r=>setTimeout(r,50));}throw Error('No initial wait');}`);
    // Keep the ordinary four-second polling loop, and observe every render.
    evaluate(`()=>{window.orderProof=[];window.orderTimer=setInterval(()=>{const c=document.querySelector('#board [data-node$="task:web"]');window.orderProof.push({at:Date.now(),state:c?.dataset.state,column:c?.closest('section')?.id,progress:c?.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow'),connection:document.querySelector('#connection').dataset.level});},20);return true;}`);
    fs.writeFileSync(path.join(proof,'delay-response'),'');
    run('run',[],`await page.click('#refresh');`);
    await until(()=>fs.existsSync(path.join(proof,'held-board.json')));
    const held=JSON.parse(fs.readFileSync(path.join(proof,'held-board.json')));
    assert.equal(held.deck.sources[0].available,true);
    assert.equal(held.deck.sources[0].snapshot.nodes.find(n=>n.task==='web').state,'waiting');
    change('running',2);
    // The owner read cache lasts three seconds. A newer real read must win first.
    const active=evaluate(`async()=>{for(let i=0;i<160;i++){const c=document.querySelector('#board [data-node$="task:web"]');if(c?.dataset.state==='active'&&c.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')==='67')return {at:Date.now(),column:c.closest('section').id};await new Promise(r=>setTimeout(r,50));}throw Error('Newer running state never arrived');}`);
    assert.equal(active.column,'state-column-now');
    fs.writeFileSync(path.join(proof,'release-response'),'');
    const result=evaluate(`async()=>{await new Promise(r=>setTimeout(r,5500));return window.orderProof.filter(x=>x.at>=${active.at});}`);
    const rewound=result.filter(x=>x.column==='state-column-waiting');
    if(process.env.CD_TEST_EXPECT_BUG==='1') {
      assert.ok(rewound.length,'The old reply must reproduce the false wait before the fix');
      assert.ok(rewound.some(x=>x.progress==='0'),'The obsolete progress moved with the card');
      assert.equal(result.at(-1).column,'state-column-now');
    } else {
      assert.equal(rewound.length,0,'An old wait must never replace a newer running read');
      assert.ok(result.every(x=>x.progress==='67'),'The newer progress must not rewind');
      // Repeat with an old failed read after a newer successful read.
      for(const name of ['response-held','held-board.json','release-response']) fs.unlinkSync(path.join(proof,name));
      fs.writeFileSync(path.join(proof,'fail-response'),'');fs.writeFileSync(path.join(proof,'delay-response'),'');
      run('run',[],`await page.click('#refresh');`);
      await until(()=>fs.existsSync(path.join(proof,'held-board.json')));
      change('running',3);
      evaluate(`async()=>{for(let i=0;i<160;i++){if(document.querySelector('#board [data-node$="task:web"] [role=progressbar]')?.getAttribute('aria-valuenow')==='100')return true;await new Promise(r=>setTimeout(r,50));}throw Error('Newer progress never arrived');}`);
      const after=Date.now();fs.writeFileSync(path.join(proof,'release-response'),'');
      const failures=evaluate(`async()=>{await new Promise(r=>setTimeout(r,1000));return window.orderProof.filter(x=>x.at>=${after});}`);
      assert.ok(failures.length);assert.ok(failures.every(x=>x.connection==='ok'),'An obsolete failure must not mark the newer board offline');
      // A genuinely new authoritative wait still moves immediately, with its progress.
      change('waiting_dep',1);
      evaluate(`async()=>{for(let i=0;i<160;i++){const c=document.querySelector('#board [data-node$="task:web"]');if(c?.dataset.state==='waiting'&&c.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')==='33')return true;await new Promise(r=>setTimeout(r,50));}throw Error('Fresh actual dependency must appear');}`);
    }
    assert.equal(fs.existsSync(path.join(proof,'home/work-calls.jsonl')),false);
    const evidence={heldSeq:held.seq,active,rewound:rewound.length>0,waitDurationMs:rewound.length?rewound.at(-1).at-rewound[0].at:0,observations:result,ownerMutations:false};
    if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'board-ordering.json'),JSON.stringify(evidence,null,2));}
    console.log(JSON.stringify({reproduced:rewound.length>0,waitDurationMs:evidence.waitDurationMs,ownerMutations:false}));
  } finally {
    child.kill('SIGTERM'); if(browser)run('stop');fs.rmSync(proof,{recursive:true,force:true});
  }
});
