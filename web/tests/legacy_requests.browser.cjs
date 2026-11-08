/* Regression for the real home's pre-request tasks: actual renderer + owner adapter. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {test} = require('node:test');

test('legacy project groups retain all tasks, attention and recorded activity beside explicit requests', {timeout:120000}, async t => {
  const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';
  if (spawnSync(cli,['--help'],{stdio:'ignore'}).error) return t.skip('browser CLI unavailable');
  const proof = fs.mkdtempSync(path.join(os.tmpdir(),'deck-legacy-'));
  const env = {...process.env, CD_WEB_LANGUAGE:'es', CHROME_DEVTOOLS_AXI_SESSION:'deck-legacy-'+process.pid};
  const child = spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run = (command,args=[]) => {
    const r = spawnSync(cli,[command,...args],{env,encoding:'utf8',timeout:command==='open'?60000:20000});
    assert.equal(r.status,0,r.stdout+'\n'+r.stderr+'\n'+(r.error?.message||'')); return r.stdout;
  };
  const evaluate = code => {
    const out = run('eval',[code]), match = out.match(/^result: (.*)$/m); assert.ok(match,out);
    let value = JSON.parse(match[1]); while(typeof value === 'string') {try {value=JSON.parse(value);}catch {break;}} return value;
  };
  const rows = expected => evaluate(`async () => {
    for(let i=0;i<100;i++){
      const rows=[...document.querySelectorAll('.request-row')].map(r=>({title:r.querySelector('.request-title').textContent,meta:r.querySelector('.request-meta').textContent,event:JSON.parse(r.querySelector('[data-event]')?.dataset.event||'null')}));
      if(rows.length===${expected.count}&&rows.some(r=>r.meta.includes(${JSON.stringify(expected.text)})))return rows;
      await new Promise(r=>setTimeout(r,100));
    } throw new Error('Expected groups never rendered');
  }`);
  try {
    const url = await new Promise((resolve,reject)=>{
      let output=''; const timer=setTimeout(()=>reject(new Error(output)),10000);
      child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
      child.stderr.on('data',chunk=>output+=chunk);
    });
    run('open',[url]);
    const legacy = rows({count:1,text:'Agrupado por proyecto'});
    assert.match(legacy[0].title,/Deck privado/);
    assert.match(legacy[0].meta,/2 de 7 tareas hechas/); // Captain questions stay in Needs you and do not count as work.
    assert.match(legacy[0].meta,/Te necesita · 1/);
    assert.ok(legacy[0].event.epoch>0);
    const file=path.join(proof,'home/work-snapshot.json'), snapshot=JSON.parse(fs.readFileSync(file));
    snapshot.requests=[{id:'delivery',label:'Recorded request',project:'project:deck',tasks:['task:web','task:next']}];
    // Date-only activity remains useful without pretending to know an hour.
    for(const row of snapshot.tasks)row.updated={value:'2026-10-30',precision:'date'};
    fs.writeFileSync(file,JSON.stringify(snapshot));
    const mixed = rows({count:2,text:'2 de 5 tareas hechas'});
    const explicit=mixed.find(r=>r.title.includes('Recorded request'));
    assert.match(explicit.meta,/0 de 2 tareas hechas/);
    assert.equal(explicit.event.date,'2026-10-30');
    assert.ok(!mixed.some(r=>r.title.includes('Encargo sin registrar')||r.meta.includes('Sin dato')));
    snapshot.requests=[];for(const row of snapshot.tasks)row.updated={value:null,precision:'unknown'};
    fs.writeFileSync(file,JSON.stringify(snapshot));
    const absent = rows({count:1,text:'Última actividad no registrada'});
    assert.equal(absent[0].event,null);
  } finally {
    child.kill('SIGTERM');
    run('stop');
    fs.rmSync(proof,{recursive:true,force:true});
  }
});
