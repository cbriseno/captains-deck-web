/* Request spend through the real renderer and disposable owner, never production. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),test=require('node:test');
const cli=process.env.CD_TEST_BROWSER||'chrome-devtools-axi';
const available=spawnSync(cli,['--version'],{encoding:'utf8'}).status===0;
test('request spend preserves unknowns, captain decisions and narrow layouts',{skip:!available,timeout:120000},async()=>{
  const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-usage-'));
  const env={...process.env,CD_WEB_LANGUAGE:'es',CD_TEST_RELATIONS:'1',FM_DIAGNOSTICS_HOME:path.join(proof,'diagnostics'),CHROME_DEVTOOLS_AXI_SESSION:process.env.CD_TEST_SESSION||'deck-usage-'+process.pid};
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
  const run=(command,args=[])=>{const r=spawnSync(cli,[command,...args],{env,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
  const evaluate=code=>{const output=run('eval',[code]);let value=JSON.parse(output.match(/^result: (.*)$/m)[1]);while(typeof value==='string'){try{value=JSON.parse(value);}catch{break;}}return value;};
  try{
    const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('fixture startup: '+output)),15000);child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.on('exit',code=>{clearTimeout(timer);reject(Error('fixture exit '+code));});});
    const file=path.join(proof,'home/work-snapshot.json'),snapshot=JSON.parse(fs.readFileSync(file));
    const usage={usd:3.28,usd_complete:false,tokens:7463121,tasks:{running:1,not_started:2,unknown:2},by:[{harness:'codex',model:'gpt-6.1-sol',effort:'high',usd:3.28,usd_known:true,tokens:7463121,sessions:1}],unknown:[{task:'ask',title:'Captain choice',reason:'no-session'},{task:'web',title:'Missing transcript',reason:'no-session'}],excludes:['coordinator']};
    const requests=Object.fromEntries(snapshot.requests.map(r=>[r.id,r]));
    requests.run.usage=usage;
    requests.paused.usage={tasks:{unknown:1},by:[],unknown:[{task:'next',title:'No session',reason:'no-session'}]};
    requests.result.usage={tasks:{not_started:1},by:[],unknown:[]};
    requests.isolated.usage={usd:0,usd_complete:false,tokens:0,tasks:{},by:[{harness:'other',model:'unpriced-model',effort:'unknown',usd_known:false,tokens:0,sessions:1}]};
    snapshot.requests.push({id:'decision',label:'Decision only',project:'project:isolated',tasks:['task:second'],usage:{tasks:{no_agent:1},by:[],unknown:[]}});
    snapshot.tasks.find(x=>x.key==='task:second').request={id:'decision',label:'Decision only',project:'project:isolated'};
    fs.writeFileSync(file,JSON.stringify(snapshot));fs.appendFileSync(path.join(proof,'home/state/fleet-ledger.jsonl'),JSON.stringify({home:path.join(proof,'home'),event:'fixture.snapshot',value:snapshot})+'\n');
    run('open',[url]);
    evaluate(`async () => {for(let i=0;i<100;i++){if(document.querySelector('.request-row .usage-line')?.textContent.includes('3.28'))break;await new Promise(r=>setTimeout(r,50));}document.querySelector('.request-group[data-k=done] .col-h button[aria-expanded=false]')?.click();return true;}`);
    const read=()=>evaluate(`() => [...document.querySelectorAll('.request-row')].map(r=>({id:r.dataset.node,line:r.querySelector('.usage-line')?.textContent,detail:r.querySelector('.usage-detail')?.textContent}))`);
    let rows=read(),row=id=>rows.find(r=>r.id.endsWith(':req:'+id));
    assert.match(row('run').line,/≥ US\$3\.28.*7.5 M tokens.*1 tarea desconocida.*en curso/);
    assert.equal(row('paused').line,'Costo no disponible');assert.equal(row('waiting').line,'Costo no disponible');assert.equal(row('result').line,'Sin gasto aún');
    evaluate(`() => {for(const button of document.querySelectorAll('.request-title[aria-expanded=false]'))button.click();return true;}`);
    rows=read();assert.match(row('run').detail,/Captain choice.*sin gasto de agente/);assert.match(row('run').detail,/Desconocido.*Missing transcript/);
    assert.match(row('run').detail,/Codex.*GPT-6.1 Sol.*esfuerzo alto.*1 sesión/);assert.match(row('run').detail,/No incluye.*coordinación/);
    assert.match(row('isolated').detail,/precio desconocido.*0 tokens/);
    assert.equal(row('decision').line,'Decisión tuya: sin gasto de agente');
    for(const width of [1970,1440,390]){run('resize',[String(width),'1250']);assert.equal(evaluate('() => document.documentElement.scrollWidth-innerWidth'),0);}
  }finally{run('stop');child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});fs.rmSync(proof,{recursive:true,force:true});}
});
