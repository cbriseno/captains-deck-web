/* Copy-only review cards keep their visible Copy ID button without a second menu. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');

test('review cards with no extra actions omit the copy-only menu', {timeout:60000}, async()=>{
  const tmp=process.env.GOTMPDIR?path.resolve(process.env.GOTMPDIR,'..'):os.tmpdir();
  const proof=fs.mkdtempSync(path.join(tmp,'deck-copy-only-'));
  const source=path.join(__dirname,'detail_navigation_fixture.py'),fixture=path.join(proof,'fixture.py');
  const original=fs.readFileSync(source,'utf8');
  const needle="tasks[1]['outcome'] = dict(role='final', review='reviewed')";
  assert.ok(original.includes(needle));
  fs.writeFileSync(fixture,original.replace(needle,"tasks[1].update(outcome=dict(role='final', review='needed'), completed=time.time())"));
  const env={...process.env,PYTHONPATH:path.resolve(__dirname,'..'),CHROME_DEVTOOLS_AXI_SESSION:'deck-copy-only-'+process.pid};
  const child=spawn('python3',[fixture],{env,stdio:['ignore','pipe','pipe']});let browser=false;
  const run=(cmd,args=[])=>{const r=spawnSync('chrome-devtools-axi',[cmd,...args],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{const out=run('eval',[`async () => JSON.stringify(await (${code})())`]);const match=out.match(/^result: (.*)$/m);assert.ok(match,out);let value=JSON.parse(match[1]);while(typeof value==='string')value=JSON.parse(value);return value;};
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),10000);child.stdout.on('data',data=>{out+=data;const match=out.match(/Fixture at (\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});child.stderr.on('data',data=>out+=data);child.on('exit',code=>reject(Error('fixture exited '+code+' '+out)));});
    browser=true;run('open',[url]);
    const initial=evaluate(`async()=>{const card=document.querySelector('.review-card'),id=card?.querySelector('.node-id');id?.click();await new Promise(resolve=>setTimeout(resolve,100));return {reviews:document.querySelectorAll('.review-card').length,menu:!!card?.querySelector('.card-menu-btn'),id:id?.getAttribute('aria-label'),tag:id?.tagName,feedback:document.querySelector('#deck-feedback')?.textContent};}`);
    assert.equal(initial.reviews,1);assert.equal(initial.menu,false);assert.match(initial.id,/Copy ID:/);assert.equal(initial.tag,'BUTTON');assert.match(initial.feedback,/ID copied:|Select and copy this ID:/);
    for(const [width,height] of [[1970,1250],[390,844]]){run('resize',[String(width),String(height)]);const layout=evaluate(`()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth})`);assert.equal(layout.width,width);assert.equal(layout.height,height);assert.equal(layout.overflow,0);if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,`copy-only-${width}.png`)]);}}
  }finally{child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(proof,{recursive:true,force:true});}
});
