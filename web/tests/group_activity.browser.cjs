/* Exercise the real kanban and group signals through a disposable HTTP owner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');

test('C1 follows kanban membership, attention origins and pauses, with bounded motion', {timeout:180000}, async () => {
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-group-activity-'));
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',CD_WEB_LANGUAGE:'es',CD_TEST_PAUSE:'1',CD_TEST_ACTIONS:'1',CD_TEST_GROUP_ACTIVITY:'1',CHROME_DEVTOOLS_AXI_SESSION:'deck-group-activity-'+process.pid,CHROME_DEVTOOLS_AXI_CHROME_ARGS:''};
  for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[key];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(cmd,args=[],input)=>{const r=spawnSync('chrome-devtools-axi',[cmd,...args],{env,input,encoding:'utf8',timeout:40000,maxBuffer:3*1024*1024});assert.equal(r.status,0,String(r.error||'')+'\n'+r.stdout+'\n'+r.stderr);return r.stdout;};
  const evaluate=code=>{const out=run('eval',[`async()=>JSON.stringify(await (${code})())`]),m=out.match(/^result: (.*)$/m);assert.ok(m,out);let v=JSON.parse(m[1]);for(let i=0;i<4&&typeof v==='string';i++){try{v=JSON.parse(v);}catch{break;}}return v;};
  const helpers=`const row=id=>document.querySelector('.mix[data-node$="'+id+'"]');const wait=async f=>{for(let i=0;i<180;i++){if(f())return;await new Promise(r=>setTimeout(r,60));}throw Error('Timed out');};`;
  let browser=false;
  try {
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),12000);child.stdout.on('data',s=>{out+=s;const m=out.match(/(?:Fixture at|URL) ([^\s,]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',s=>out+=s);child.on('exit',c=>reject(Error('Fixture '+c+' '+out)));});
    const snapshot=path.join(proof,'home/work-snapshot.json'),original=JSON.parse(fs.readFileSync(snapshot));
    const write=raw=>{fs.writeFileSync(snapshot+'.tmp',JSON.stringify(raw));fs.renameSync(snapshot+'.tmp',snapshot);};
    browser=true;run('open',[url]);run('resize',['1440','1100']);
    const initial=evaluate(`async()=>{${helpers}await wait(()=>row('project:activity')?.dataset.activity==='needs');const toggle=document.querySelector('[data-control=all-groups]');if(toggle.getAttribute('aria-expanded')==='false')toggle.click();const ids=['project:activity',...['attention','action','now','ready','waiting','unknown','paused','finished','empty','hold'].map(x=>'subproject:activity/'+x),'project:paused-hot','project:empty'];const readings=Object.fromEntries(ids.map(id=>[id,{activity:row(id)?.dataset.activity,signal:!!row(id)?.querySelector('.group-activity'),text:row(id)?.querySelector('.mix-pct').textContent}]));return {readings,columns:Object.fromEntries(['web','next','dependent','activity-unknown','integration'].map(id=>[id,document.querySelector('#board [data-node$="task:'+id+'"]')?.closest('section').id])),textFits:[...document.querySelectorAll('.mix-pct')].every(el=>el.getBoundingClientRect().right<=el.closest('.mix-name').getBoundingClientRect().right+1),taskSignals:document.querySelectorAll('#board .group-activity').length};}`);
    const expected={attention:'needs',action:'needs',now:'now',ready:'now',waiting:'waiting',unknown:'now',paused:'none',finished:'none',empty:'none',hold:'none'};
    for(const [key,value]of Object.entries(expected)){const r=initial.readings['subproject:activity/'+key];assert.equal(r.activity,value,key);assert.equal(r.signal,value!=='none',key);}
    assert.equal(initial.readings['project:activity'].activity,'needs');
    for(const key of ['project:empty','project:paused-hot'])assert.equal(initial.readings[key].activity,'none',key);
    assert.match(initial.readings['subproject:activity/unknown'].text,/Estado sin confirmar/);
    assert.match(initial.readings['project:activity'].text,/te necesita|te necesitan/);
    assert.match(initial.readings['project:activity'].text,/en Ahora/);assert.match(initial.readings['project:activity'].text,/esperando/);
    assert.equal(initial.columns.web,'state-column-now');assert.equal(initial.columns.next,'state-column-now');assert.equal(initial.columns.dependent,'state-column-waiting');assert.equal(initial.columns['activity-unknown'],'state-column-now');assert.equal(initial.columns.integration,'state-column-paused');assert.equal(initial.taskSignals,0);assert.equal(initial.textFits,true,'All lane counts fit inside the group name');
    const filtered=evaluate(`async()=>{${helpers}const search=document.querySelector('#board-search');search.value='absolutely-no-matching-task';search.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>!document.querySelector('#board .task-card'));const searchActivity=row('project:activity').dataset.activity;search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>document.querySelector('#board .task-card'));row('subproject:activity/waiting').querySelector('.mix-name').click();const scopedActivity=row('project:activity').dataset.activity;row('subproject:activity/waiting').querySelector('.mix-name').click();return {searchActivity,scopedActivity};}`);
    assert.equal(filtered.searchActivity,'needs');assert.equal(filtered.scopedActivity,'needs');
    // A normal unchanged HTTP refresh preserves the animation phase.
    const steady=evaluate(`async()=>{${helpers}row('project:activity').scrollIntoView({block:'center'});await wait(()=>row('project:activity').dataset.activityVisible==='true');const before=row('project:activity').querySelector('.group-activity>i').getAnimations()[0].currentTime;document.querySelector('#refresh').click();await new Promise(r=>setTimeout(r,4500));const signal=row('project:activity').querySelector('.group-activity>i');return {elapsed:signal.getAnimations()[0].currentTime-before,duration:getComputedStyle(signal).animationDuration,play:getComputedStyle(signal).animationPlayState};}`);
    assert.ok(steady.elapsed>3800&&steady.elapsed<5500,JSON.stringify(steady));assert.equal(steady.duration,'2.33333s');assert.equal(steady.play,'running');
    const visibility=evaluate(`async()=>{${helpers}Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));const signal=row('project:activity').querySelector('.group-activity>i');const hidden=getComputedStyle(signal).animationPlayState;delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));window.scrollTo(0,document.documentElement.scrollHeight);await wait(()=>row('project:activity').dataset.activityVisible==='false');const offscreen=getComputedStyle(signal).animationPlayState;row('project:activity').scrollIntoView({block:'center'});await wait(()=>row('project:activity').dataset.activityVisible==='true');return {hidden,offscreen,resumed:getComputedStyle(signal).animationPlayState};}`);
    assert.deepEqual(visibility,{hidden:'paused',offscreen:'paused',resumed:'running'});
    if(process.env.CD_TEST_EVIDENCE){evaluate(`()=>{const focus=document.querySelector('#focus-effects');if(focus.checked){focus.checked=false;focus.dispatchEvent(new Event('change'));}return true;}`);fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,'group-activity-desktop.png')]);}
    // The tree uses the same group rows, including inherited group pauses.
    const tree=evaluate(`async()=>{${helpers}document.querySelector('#projects-view').click();row('project:activity') /* mixer remains in DOM */;const parent=document.querySelector('#project-tree .mix[data-node$="project:activity"]');parent.querySelector('.fold-btn').click();const stopped=document.querySelector('#project-tree .mix[data-node$="project:paused-hot"]');stopped.querySelector('.fold-btn').click();return {now:document.querySelector('#project-tree .mix[data-node$="subproject:activity/now"]').dataset.activity,inherited:document.querySelector('#project-tree .mix[data-node$="subproject:paused-hot/child"]').dataset.activity};}`);
    assert.equal(tree.now,'now');assert.equal(tree.inherited,'none');
    // Resume the synthetic group: its child's existing Now task becomes active.
    const resumed=structuredClone(original);delete resumed.projects.find(x=>x.key==='project:paused-hot').pause;write(resumed);
    evaluate(`async()=>{${helpers}await wait(()=>row('project:paused-hot').dataset.activity==='now');await wait(()=>document.querySelector('#project-tree .mix[data-node$="subproject:paused-hot/child"]').dataset.activity==='now');return true;}`);
    // Close attention and move the only executing task to a real dependency wait.
    const waiting=structuredClone(original);
    for(const row of waiting.tasks){if(row.question?.open){row.question.open=false;row.state='done';}if(['task:next','task:activity-unknown'].includes(row.key))row.state='done';if(row.key==='task:web')row.state='waiting_dep';}
    write(waiting);
    const changed=evaluate(`async()=>{${helpers}await wait(()=>row('project:activity').dataset.activity==='waiting');return {parent:row('project:activity').dataset.activity,now:row('subproject:activity/now').dataset.activity,attention:row('subproject:activity/attention').dataset.activity,action:row('subproject:activity/action').dataset.activity,column:document.querySelector('#board [data-node$="task:web"]')?.closest('section').id};}`);
    assert.deepEqual(changed,{parent:'waiting',now:'waiting',attention:'none',action:'none',column:'state-column-waiting'});
    const finished=structuredClone(waiting);for(const row of finished.tasks){if(row.parent?.startsWith('subproject:activity/'))row.state='done';}write(finished);
    evaluate(`async()=>{${helpers}await wait(()=>row('project:activity')?.dataset.activity==='none');return true;}`);
    write(original);
    evaluate(`async()=>{${helpers}await wait(()=>row('project:activity')?.dataset.activity==='needs');return true;}`);
    run('resize',['390','844']);
    const mobile=evaluate(`()=>({overflow:document.documentElement.scrollWidth-innerWidth,signals:document.querySelectorAll('#project-tree .group-activity').length})`);assert.equal(mobile.overflow,0);assert.ok(mobile.signals>0);
    run('stop');browser=false;
    env.CHROME_DEVTOOLS_AXI_SESSION+='-reduced';env.CHROME_DEVTOOLS_AXI_CHROME_ARGS='--force-prefers-reduced-motion';
    browser=true;run('open',[url]);
    const reduced=evaluate(`async()=>{${helpers}await wait(()=>row('project:activity')?.querySelector('.group-activity>i'));const track=row('project:activity').querySelector('.group-activity'),style=getComputedStyle(track.firstChild);return {media:matchMedia('(prefers-reduced-motion:reduce)').matches,animation:style.animationName,width:parseFloat(style.width),trackWidth:track.getBoundingClientRect().width,transform:style.transform};}`);
    assert.equal(reduced.media,true);assert.equal(reduced.animation,'none');assert.equal(reduced.transform,'none');assert.ok(Math.abs(reduced.width-reduced.trackWidth)<1);
    assert.equal(fs.existsSync(path.join(proof,'home/work-calls.jsonl')),false);assert.equal(fs.existsSync(path.join(proof,'home/mutations.jsonl')),false);
    if(process.env.CD_TEST_EVIDENCE)fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'group-activity.json'),JSON.stringify({initial,filtered,steady,visibility,tree,changed,mobile,reduced,noOwnerMutations:true},null,2));
  } finally {child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(proof,{recursive:true,force:true});}
});
