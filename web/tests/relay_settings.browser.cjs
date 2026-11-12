/* Settings UI + actual HTTP adapter against an isolated extension CLI double. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');
const cli=process.env.CD_TEST_BROWSER||'chrome-devtools-axi';
const available=spawnSync(cli,['--version'],{encoding:'utf8'}).status===0;

for(const real of [false,true])test('relay settings '+(real?'real CLI':'CLI double')+': confirmation, refusal, receipts, scopes and responsive focus', {skip:!available||(real&&!process.env.CD_TEST_EXTENSIONS_ROOT),timeout:180000},async()=>{
 const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-relay-'));
 const env={...process.env,CD_TEST_REAL_EXTENSION:real?'1':'0',CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:process.env.CD_TEST_SESSION||'deck-relay-'+process.pid+(real?'-real':'-double')};
 const child=spawn('python3',[path.join(__dirname,'relay_settings_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
 let started=false;
 const run=(command,args=[])=>{const r=spawnSync(cli,[command,...args],{env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});assert.equal(r.status,0,`${command}: ${r.stdout}\n${r.stderr}`);return r.stdout;};
 const evaluate=code=>{const out=run('eval',[`async()=>JSON.stringify(await (${code})())`]);const m=out.match(/^result: (.*)$/m);assert.ok(m,out);let value=JSON.parse(m[1]);for(let i=0;i<4&&typeof value==='string';i++){try{value=JSON.parse(value);}catch{break;}}return value;};
 const wait='const wait=async f=>{for(let i=0;i<120;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw new Error("Timed out");};';
 try{
  const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('fixture startup '+out)),12000);child.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',chunk=>out+=chunk);child.on('exit',code=>reject(new Error('fixture exited '+code+' '+out)));});
  started=true;run('open',[url]);run('resize',['1440','1000']);
  const initial=evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#connection').textContent!=='Conectando…');document.querySelector('#settings-open').click();document.querySelector('#relay-settings-open').click();await wait(()=>document.querySelector('[name=threshold-codex]'));return {text:document.querySelector('#relay-settings-content').textContent,codex:document.querySelector('[name=threshold-codex]').value,overflow:document.documentElement.scrollWidth-innerWidth};}`);
  assert.ok(initial.text.includes('apagado'));assert.ok(initial.text.includes('Modo de planeación'));assert.ok(initial.codex.includes('umbral:600K'));assert.ok(initial.codex.includes('compactaciones:5'));assert.ok(initial.codex.includes(' o '));assert.equal(initial.overflow,0);
  if(!real){
  const review=evaluate(`async()=>{${wait}[...document.querySelectorAll('#relay-settings-content button')].find(x=>x.textContent==='Activar relevo automático').click();await wait(()=>document.querySelector('#relay-confirm-dialog').open);const confirm=document.querySelector('#relay-confirm-apply');const value={disabled:confirm.disabled,text:document.querySelector('#relay-confirm-disclosure').textContent};document.querySelector('#relay-confirm-cancel').click();return value;}`);
  assert.equal(review.disabled,true);assert.ok(review.text.includes('sin otra confirmación'));assert.ok(review.text.includes('30'));assert.ok(review.text.includes('4'));assert.ok(review.text.includes('fallidos'));assert.ok(review.text.includes('umbral:600K'));
  let calls=fs.readFileSync(path.join(proof,'home/extension-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(x=>x.args[1]==='authorize').length,0);
  const words='  Actívalo; conserva "$()"\nmi confirmación exacta.  ';
  evaluate(`async()=>{${wait}[...document.querySelectorAll('#relay-settings-content button')].find(x=>x.textContent==='Activar relevo automático').click();await wait(()=>document.querySelector('#relay-confirm-dialog').open);const words=document.querySelector('#relay-confirm-words');words.value=${JSON.stringify(words)};words.dispatchEvent(new Event('input'));document.querySelector('#relay-confirm-apply').click();document.querySelector('#relay-confirm-apply').click();await wait(()=>document.querySelector('#relay-settings-result').textContent.includes('rechaza')||document.querySelector('#relay-settings-result').textContent.includes('refuses'));return true;}`);
  calls=fs.readFileSync(path.join(proof,'home/extension-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const authorize=calls.filter(x=>x.args[1]==='authorize');assert.equal(authorize.length,1);assert.equal(authorize[0].args[authorize[0].args.indexOf('--captain-words')+1],words);
  }else{const blocked=evaluate(`()=>({disabled:[...document.querySelectorAll('#relay-settings-content button')].find(x=>x.textContent==='Activar relevo automático').disabled,text:document.querySelector('#relay-settings-content').textContent})`);assert.equal(blocked.disabled,true);assert.ok(blocked.text.includes('todo este espacio'));}
  const changed=evaluate(`async()=>{${wait}const input=document.querySelector('[name=threshold-codex]');input.value='compactaciones:5 umbral:80%';input.closest('label').nextElementSibling.click();await wait(()=>document.querySelector('#relay-settings-result').textContent.includes('Aplicado')&&document.querySelector('[name=threshold-codex]')?.value==='compactaciones:5 umbral:80%');return {value:document.querySelector('[name=threshold-codex]').value,undo:[...document.querySelectorAll('#relay-settings-result button')].some(x=>x.textContent==='Deshacer')};}`);
  assert.equal(changed.value,'compactaciones:5 umbral:80%');assert.equal(changed.undo,true);
  evaluate(`async()=>{${wait}[...document.querySelectorAll('#relay-settings-result button')].find(x=>x.textContent==='Deshacer').click();await wait(()=>document.querySelector('[name=threshold-codex]')?.value===${JSON.stringify(initial.codex)});return true;}`);
  const scopes=evaluate(`async()=>{${wait}const result=[];for(const scope of ['installation','home','project','task']){let select=document.querySelector('[name=planning-scope]');select.value=scope;select.dispatchEvent(new Event('change'));await wait(()=>document.querySelector('[name=planning-scope]')?.value===scope);const mode=document.querySelector('[name=planning-mode]');mode.value='native';[...document.querySelectorAll('#relay-settings-content button')].find(x=>x.textContent==='Guardar modo de planeación').click();await wait(()=>document.querySelector('[name=planning-scope]')?.value===scope&&document.querySelector('[name=planning-mode]')?.value==='native'&&!document.querySelector('[name=planning-mode]').disabled);result.push({scope,choices:document.querySelector('[name=planning-target]').options.length});}return result;}`);
  assert.deepEqual(scopes.map(x=>x.scope),['installation','home','project','task']);assert.ok(scopes.filter(x=>['project','task'].includes(x.scope)).every(x=>x.choices>0));
  // A lost HTTP reply is retried verbatim with the same ID, including after reload.
  evaluate(`async()=>{${wait}const original=window.fetch;let dropped=false;window.fetch=async(...args)=>{const response=await original(...args);if(!dropped&&String(args[0]).endsWith('/apply')){dropped=true;throw new TypeError('Simulated lost reply');}return response;};const input=document.querySelector('[name=threshold-codex]');input.value='umbral:80%';input.closest('label').nextElementSibling.click();await wait(()=>JSON.parse(sessionStorage.getItem('deck-settings-receipts')||'[]').some(x=>x.state==='uncertain')&&document.querySelector('[name=threshold-codex]')&&!document.querySelector('[name=threshold-codex]').disabled);return true;}`);
  const statePath=real?path.join(proof,'xdg/fm-planning/settings-contract.json'):path.join(proof,'home/extension-state.json');
  const beforeRetry=JSON.parse(fs.readFileSync(statePath,'utf8')).generation;
  run('open',[url]);
  evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#connection').textContent!=='Conectando…');document.querySelector('#settings-open').click();document.querySelector('#relay-settings-open').click();await wait(()=>document.querySelector('[name=threshold-codex]'));[...document.querySelectorAll('#relay-settings-result button')].find(x=>x.textContent==='Reintentar la misma solicitud').click();await wait(()=>!document.querySelector('#relay-settings-result').textContent.includes('No está confirmado')&&!document.querySelector('#relay-settings-result').textContent.includes('Reintentar la misma solicitud')&&document.querySelector('[name=threshold-codex]'));return true;}`);
  assert.equal(JSON.parse(fs.readFileSync(statePath,'utf8')).generation,beforeRetry);
  for(const width of [390,360]){run('resize',[String(width),'844']);const mobile=evaluate(`()=>({overflow:document.documentElement.scrollWidth-innerWidth,width:document.querySelector('#relay-settings-dialog').getBoundingClientRect().width})`);assert.equal(mobile.overflow,0);assert.ok(mobile.width<=width);}
  const closed=evaluate(`async()=>{${wait}document.querySelector('#relay-settings-close').click();await wait(()=>document.activeElement.id==='settings-open');return {closed:!document.querySelector('#relay-settings-dialog').open,focus:document.activeElement.id};}`);assert.equal(closed.closed,true);assert.equal(closed.focus,'settings-open');
  const state=JSON.parse(fs.readFileSync(real?path.join(proof,'home/config/context-relay.json'):path.join(proof,'home/extension-state.json'),'utf8'));assert.notEqual(state.relay_mode,'auto');assert.equal(state.automatic_enabled||false,false);
 }finally{child.kill('SIGTERM');if(started&&!process.env.CD_TEST_SESSION)run('stop');fs.rmSync(proof,{recursive:true,force:true});}
});
