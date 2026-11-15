/* Real extension and disposable home: exercise all cells through the Deck. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');
const cli=process.env.CD_TEST_BROWSER||'chrome-devtools-axi';
const available=spawnSync(cli,['--version'],{encoding:'utf8'}).status===0;
test('relay-lite settings persist independently at desktop and mobile widths', {skip:!available||!process.env.CD_TEST_EXTENSIONS_ROOT,timeout:180000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deck-relay-'));
 const env={...process.env,CD_TEST_REAL_EXTENSION:'1',CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-relay-'+process.pid};
 const child=spawn('python3',[path.join(__dirname,'relay_settings_fixture.py'),dir],{env,stdio:['ignore','pipe','pipe']});
 const run=(command,args=[])=>{const r=spawnSync(cli,[command,...args],{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);return r.stdout;};
 const evaluate=code=>{const out=run('eval',[`async()=>JSON.stringify(await (${code})())`]);let value=JSON.parse(out.match(/^result: (.*)$/m)[1]);for(let i=0;i<4&&typeof value==='string';i++){try{value=JSON.parse(value);}catch{break;}}return value;};
 const wait='const wait=async f=>{for(let i=0;i<150;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw Error("timeout")};';
 let started=false;
 try{
  const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),20000);child.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',chunk=>out+=chunk);child.on('exit',()=>reject(Error(out)));});
  run('open',[url]);started=true;run('resize',['1970','1250']);
  const result=evaluate(`async()=>{${wait}document.querySelector('#settings-open').click();document.querySelector('#relay-settings-open').click();await wait(()=>document.querySelector('[name=primary-claude-percent]'));for(const role of ['primary','worker'])for(const harness of ['claude','codex'])for(const axis of ['percent','tokens']){const name=[role,harness,axis].join('-'),value=axis==='percent'?47:123456;const el=document.querySelector('[name='+name+']');el.value=value;el.closest('label').nextElementSibling.click();await wait(()=>{const input=document.querySelector('[name='+name+']');return input&&Number(input.value)===value&&!input.disabled});}return {count:document.querySelectorAll('#relay-settings-content input').length,overflow:document.documentElement.scrollWidth-innerWidth}}`);
  assert.deepEqual(result,{count:8,overflow:0});
  run('resize',['390','844']);assert.equal(evaluate('()=>document.documentElement.scrollWidth-innerWidth'),0);
  const data=JSON.parse(fs.readFileSync(path.join(dir,'home/config/relay-lite.json'),'utf8'));assert.equal(data.thresholds.primary.claude.tokens,123456);assert.equal(data.thresholds.worker.codex.percent,47);
 }finally{child.kill('SIGTERM');if(started)run('stop');fs.rmSync(dir,{recursive:true,force:true});}
});
