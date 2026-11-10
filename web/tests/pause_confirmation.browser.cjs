/* Slow real subprocesses through HTTP; synthetic owner, never real agents. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');

test('slow pause/resume and a lost reply converge using the original receipt',{timeout:120000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck-confirmation-'));
  const env={...process.env,CHROME_DEVTOOLS_AXI_SESSION:'deck-confirmation-'+process.pid};
  for(const k of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[k];
  const child=spawn('python3',[path.join(__dirname,'pause_confirmation_fixture.py'),root],{env,stdio:['ignore','pipe','pipe']});
  const run=(...args)=>{const r=spawnSync('chrome-devtools-axi',args,{env,encoding:'utf8',timeout:60000,maxBuffer:2e6});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;};
  const evaluate=code=>{const out=run('eval',`async()=>JSON.stringify(await (${code})())`),m=out.match(/^result: (.*)$/m);assert.ok(m,out);let v=JSON.parse(m[1]);for(let i=0;i<4&&typeof v==='string';i++){try{v=JSON.parse(v);}catch{break;}}return v;};
  const wait='const wait=async f=>{for(let i=0;i<500;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw Error("Timed out");};';
  const button=`[...document.querySelectorAll('[data-node$="task:slow"] .pause-control button')].find(b=>b.getClientRects().length)`;
  const action=text=>evaluate(`async()=>{${wait}await wait(()=>document.querySelector('.request-title'));for(const b of document.querySelectorAll('.request-title[aria-expanded=false]'))b.click();await wait(()=>${button}?.textContent==='${text}'&&!${button}.disabled);${button}.click();await wait(()=>[...document.querySelectorAll('.pause-preview button')].some(b=>b.textContent==='${text}'&&!b.disabled));[...document.querySelectorAll('.pause-preview button')].find(b=>b.textContent==='${text}').click();await wait(()=>!document.querySelector('.pause-preview'));return document.querySelector('#change-results').textContent;}`);
  let browser=false;
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),12000);child.stdout.on('data',c=>{out+=c;const m=out.match(/Fixture at (\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',c=>out+=c);child.on('exit',c=>{clearTimeout(timer);reject(Error('Fixture '+c+' '+out));});});
    browser=true;run('open',url);
    assert.match(action('Pausar'),/Aplicado/);
    // A lingering request receipt must converge after a normal Deck resume too.
    const snapshot=path.join(root,'home/snapshot.json'),raw=JSON.parse(fs.readFileSync(snapshot));
    raw.rev='r2';raw.tasks[0].worker_liveness={state:'alive'};
    raw.requests=[{id:'relaunch',label:'Encargo reactivado',tasks:['task:slow'],pause:null}];
    raw.pause_controls=[{scope:'req:relaunch',state:'resuming'}];
    fs.writeFileSync(snapshot+'.tmp',JSON.stringify(raw));fs.renameSync(snapshot+'.tmp',snapshot);
    evaluate(`async()=>{${wait}await wait(()=>document.querySelector('[data-node$="req:relaunch"]'));return true;}`);
    assert.match(action('Reanudar'),/Aplicado/);
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>document.querySelector('[data-node$="req:relaunch"] .pause-control button')?.disabled===false);for(const b of document.querySelectorAll('.request-title[aria-expanded=false]'))b.click();await wait(()=>${button}&&!${button}.disabled);return !document.querySelector('[data-node$="req:relaunch"] [data-pause-state=resuming]');}`),true);
    evaluate(`async()=>{const original=window.fetch;let lost=false;window.fetch=async(...args)=>{if(lost&&String(args[0]).includes('/receipt?')){window.fetch=original;throw new TypeError('Lost receipt read');}const response=await original(...args);if(String(args[0]).endsWith('/apply')){lost=true;throw new TypeError('Lost reply');}return response;};return true;}`);
    action('Pausar');
    assert.equal(evaluate(`async()=>{${wait}await wait(()=>JSON.parse(sessionStorage.getItem('deck-control-receipts'))[0].state==='applied');return !document.querySelector('#change-results').textContent.includes('sin confirmar')&&!document.querySelector('.pause-preview');}`),true);
    assert.deepEqual(fs.readFileSync(path.join(root,'home/writes'),'utf8').trim().split('\n'),['pause.request','resume.request','pause.request']);
    assert.equal(evaluate(`async()=>!document.body.innerText.includes('took too long')`),true);
  }catch(err){if(browser)console.log(evaluate(`async()=>({text:document.body.innerText,buttons:[...document.querySelectorAll('[data-node]')].map(n=>({id:n.dataset.node,buttons:[...n.querySelectorAll('button')].map(b=>({text:b.textContent,disabled:b.disabled}))}))})`));throw err;}finally{child.kill('SIGTERM');if(browser)run('stop');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));fs.rmSync(root,{recursive:true,force:true});}
});
