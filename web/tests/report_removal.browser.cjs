const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');

test('report review separates the task removal consultation', {timeout:120000}, async () => {
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-report-removal-'));
  const env={...process.env,CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-report-removal-'+process.pid};
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[])=>{const p=spawnSync('chrome-devtools-axi',[cmd,...args],{env,encoding:'utf8',timeout:30000});assert.equal(p.status,0,p.stdout+p.stderr);return p.stdout;};
  const evaluate=code=>{const out=run('eval',[`async () => JSON.stringify(await (${code})())`]);const m=out.match(/^result: (.*)$/m);assert.ok(m,out);let v=JSON.parse(m[1]);while(typeof v==='string')v=JSON.parse(v);return v;};
  try {
    const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error(output)),12000);child.stdout.on('data',c=>{output+=c;const m=output.match(/Fixture at (\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',c=>output+=c);child.on('exit',()=>reject(Error(output)));});
    run('open',[url]);
    evaluate(`async()=>{document.querySelector('#history-view').click();for(let i=0;i<100&&!document.querySelector('#history-results .card-open');i++)await new Promise(r=>setTimeout(r,100));document.querySelector('#history-results .card-open').click();for(let i=0;i<100&&!document.querySelector('.deck-removal-panel');i++)await new Promise(r=>setTimeout(r,100));return true;}`);
    for(const width of [1970,390]) {
      run('resize',[String(width),width===390?'844':'1250']);
      const before=evaluate(`()=>{const d=document.querySelector('.deck-object-tools details'),p=document.querySelector('.deck-removal-panel');return {summary:d?.querySelector('summary')?.textContent,open:d?.open,report:!!document.querySelector('.detail-tabs'),overflow:document.documentElement.scrollWidth-innerWidth};}`);
      assert.deepEqual(before,{summary:'Consultar retiro de la tarea',open:false,report:true,overflow:0});
      const after=evaluate(`()=>{const d=document.querySelector('.deck-object-tools details');d.open=true;const p=d.querySelector('.deck-removal-panel');return {visible:!!p.getClientRects().length,text:d.textContent,button:!!p.querySelector('.deck-removal-send')};}`);
      assert.equal(after.visible,true);assert.equal(after.button,true);assert.match(after.text,/Esta consulta es sobre la tarea/);
      if(process.env.CD_TEST_EVIDENCE)run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,`report-removal-${width}.png`)]);
      evaluate(`()=>{document.querySelector('.deck-object-tools details').open=false;return true;}`);
    }
  } finally {child.kill('SIGTERM');run('stop');fs.rmSync(proof,{recursive:true,force:true});}
});
