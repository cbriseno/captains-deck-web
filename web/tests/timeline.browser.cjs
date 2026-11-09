/* Activity log through the real renderer and disposable owner, never production. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),test=require('node:test');
const cli=process.env.CD_TEST_BROWSER||'chrome-devtools-axi';
const available=spawnSync(cli,['--version'],{encoding:'utf8'}).status===0;
test('activity fold reads records, links live chat and anonymizes at narrow widths',{skip:!available,timeout:120000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-timeline-'));
  const env={...process.env,CD_WEB_LANGUAGE:'es',CD_TEST_TIMELINE:'1',CODEX_HOME:path.join(proof,'codex'),CLAUDE_CONFIG_DIR:path.join(proof,'claude'),FM_DIAGNOSTICS_HOME:path.join(proof,'diagnostics'),CHROME_DEVTOOLS_AXI_SESSION:process.env.CD_TEST_SESSION||'deck-timeline-'+process.pid};
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(command,args=[])=>{const r=spawnSync(cli,[command,...args],{env,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{const output=run('eval',[code]);let value=JSON.parse(output.match(/^result: (.*)$/m)[1]);while(typeof value==='string'){try{value=JSON.parse(value);}catch{break;}}return value;};
  try{
    const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('fixture startup: '+output)),15000);child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.on('exit',code=>{clearTimeout(timer);reject(Error('fixture exit '+code));});});
    fs.mkdirSync(path.join(proof,'home/state'),{recursive:true});
    fs.mkdirSync(path.join(proof,'claude/projects/fixture'),{recursive:true});
    fs.writeFileSync(path.join(proof,'claude/projects/fixture/closed.jsonl'),[JSON.stringify({timestamp:'2026-11-08T00:00:00Z',text:'steering inbox is `'+proof+'/home/state/phone.inbox`'}),JSON.stringify({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'CLOSED_CHAT_TEXT'}]}})].join('\n'));
    fs.writeFileSync(path.join(proof,'home/state/web.status'),'working [at=1794096010]: CANARY_LOG_DETAIL\n');
    run('open',[url]);
    evaluate(`async () => {for(let i=0;i<100;i++){if(document.querySelector('.request-row'))break;await new Promise(r=>setTimeout(r,50));}document.querySelector('.request-group[data-k=done] .col-h button[aria-expanded=false]')?.click();for(const b of document.querySelectorAll('.request-title[aria-expanded=false]'))b.click();return true;}`);
    assert.equal(evaluate('() => document.querySelectorAll(".activity-log").length'),0);
    evaluate(`() => {for(const b of document.querySelectorAll('.log-fold'))b.click();return true;}`);
    const content=evaluate(`async () => {for(let i=0;i<100;i++){if(document.querySelector('.log-row'))break;await new Promise(r=>setTimeout(r,50));}return {text:[...document.querySelectorAll('.activity-log')].map(x=>x.textContent).join(' '),links:[...document.querySelectorAll('.log-chat')].map(x=>x.href)};}`);
    assert.match(content.text,/CANARY_LOG_DETAIL/);assert.ok(content.links.some(x=>x.startsWith('https://')));
    const closedLink=content.links.find(x=>x.includes('/conversation?'));assert.ok(closedLink);
    const closed=await (await fetch(closedLink)).text();assert.match(closed,/CLOSED_CHAT_TEXT/);
    const masked=evaluate(`async () => {const times=()=>[...document.querySelectorAll('.log-time,.log-day')].map(x=>x.textContent);const before=times();await DeckAnonymize.set(true);const leak=document.body.textContent.includes('CANARY_LOG_DETAIL');const after=times();await DeckAnonymize.set(false);return {before,after,leak};}`);
    assert.equal(masked.leak,false);assert.deepEqual(masked.after,masked.before);
    for(const width of [1970,1440,390]){run('resize',[String(width),'1250']);assert.equal(evaluate('() => document.documentElement.scrollWidth-innerWidth'),0);}
    evaluate(`() => {for(const b of document.querySelectorAll('.log-fold[aria-expanded=true]'))b.click();return true;}`);
    assert.equal(evaluate('() => document.querySelectorAll(".activity-log").length'),0);
  }finally{run('stop');child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});fs.rmSync(proof,{recursive:true,force:true});}
});
