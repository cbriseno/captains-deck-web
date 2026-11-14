const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';

test('child rows retain aligned columns at wide and narrow sizes', {timeout: 120000}, async () => {
  const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-row-'));
  const env = {...process.env, CHROME_DEVTOOLS_AXI_SESSION: 'deck-row-' + process.pid};
  const child = spawn('python3', [path.join(__dirname, 'approved_fixture.py'), proof], {env, stdio:['ignore','pipe','pipe']});
  const run = (cmd, args=[]) => { const p=spawnSync(cli,[cmd,...args],{env,encoding:'utf8',timeout:30000}); assert.equal(p.status,0,p.stdout+p.stderr); return p.stdout; };
  try {
    const url = await new Promise((resolve,reject) => {
      let out=''; const timer=setTimeout(()=>reject(new Error(out)),12000);
      child.stdout.on('data', c=>{out+=c; const m=out.match(/Fixture at (\S+)/); if(m){clearTimeout(timer);resolve(m[1]);}});
      child.stderr.on('data',c=>out+=c); child.on('exit',()=>reject(new Error(out)));
    });
    run('open',[url]);
    for (const width of [1970, 390]) {
      run('resize',[String(width),'1250']);
      const output=run('eval',[`async () => { for(let i=0;i<100&&!document.querySelector('.request-head button[aria-expanded]');i++) await new Promise(r=>setTimeout(r,50)); document.querySelector('.request-head button[aria-expanded=false]')?.click(); const rows=[...document.querySelectorAll('.request-tasks>.task-row')]; return JSON.stringify(rows.map(r=>{const rect=s=>{const b=r.querySelector(s).getBoundingClientRect();return [Math.round(b.x),Math.round(b.width)];};return {main:rect('.rmain'),ctl:rect('.rctl'),menu:rect('.card-menu-btn'),overflow:r.scrollWidth>r.clientWidth};})); }`]);
      const match=output.match(/^result: (.*)$/m); assert.ok(match,output);
      let rows=JSON.parse(match[1]); for(let i=0;i<4&&typeof rows==='string';i++) rows=JSON.parse(rows);
      assert.ok(rows.length>=3,JSON.stringify(rows));
      for(const row of rows){assert.deepEqual(row.main,rows[0].main);assert.equal(row.menu[0],rows[0].menu[0]);assert.equal(row.overflow,false);if(width>640)assert.deepEqual(row.ctl,rows[0].ctl);else assert.equal(row.ctl[0],row.main[0]);}
    }
  } finally {try{run('stop');}finally{child.kill('SIGTERM');fs.rmSync(proof,{recursive:true,force:true});}}
});
