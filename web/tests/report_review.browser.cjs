/* Consumer regression only: Firstmate routing is accepted in its own repository. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const test=require('node:test');
test('HTML reading stays passive; explicit review reuses one window', {timeout:180000}, async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck-review-'));
  const env={...process.env,CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-review-'+process.pid};
  for(const k of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[k];
  const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),root],{env,stdio:['ignore','pipe','pipe']});
  let browser=false;
  const cli=(cmd,args=[],input)=>{const p=spawnSync('chrome-devtools-axi',[cmd,...args],{env,input,encoding:'utf8',timeout:60000});assert.equal(p.status,0,p.stdout+p.stderr);return p.stdout;};
  const evaluate=js=>{const out=cli('eval',[js]);const m=out.match(/^result: (.*)$/m);assert.ok(m,out);let v=JSON.parse(m[1]);for(let i=0;i<4&&typeof v==='string';i++){try{v=JSON.parse(v);}catch{break;}}return v;};
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error(out)),15000);child.stdout.on('data',c=>{out+=c;const m=out.match(/Fixture at (\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',c=>out+=c);child.on('exit',code=>reject(new Error(out+' '+code)));});
    const home=path.join(root,'home');
    fs.writeFileSync(path.join(home,'data/demo-research/report.html'),'<style>body{font-family:system-ui}</style><h1>Original HTML</h1><script>top.COMPROMISED=true</script>');
    const reviewUrl=url+'/?review-consumer-test';
    fs.writeFileSync(path.join(home,'report-review.json'),JSON.stringify({ok:true,url:reviewUrl}));
    const calls=()=>fs.existsSync(path.join(home,'work-calls.jsonl'))?fs.readFileSync(path.join(home,'work-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(c=>c.command==='report.review'):[];
    browser=true;cli('open',[url]);cli('resize',['1970','1250']);
    evaluate("async()=>{const data=await(await fetch('api/board')).json();location.href='/?'+new URLSearchParams({home:data.homes[0].id,task:'demo-research',view:'delivery'});return true;}");
    cli('wait',['Revisar en Lavish']);
    cli('run',[],"await page.click('#detail-content .detail-tabs button:last-child');");
    assert.match(cli('snapshot'),/Original HTML/);
    assert.deepEqual(evaluate("()=>({sandbox:document.querySelector('iframe').getAttribute('sandbox'),compromised:!!window.COMPROMISED})"),{sandbox:'',compromised:false});
    assert.equal(calls().length,0,'Reading HTML starts no review');
    cli('run',[],"await page.click('#detail-content [data-action=report-review]');");
    cli('wait',['Los comentarios van al autor']);
    cli('run',[],"await page.click('#detail-content [data-action=report-review]');await page.click('#detail-content [data-action=report-review]');");
    assert.equal(calls().length,1,'Repeated clicks reuse the confirmed window');
    assert.deepEqual(calls()[0].operation,{target:'task:demo-research'});
    assert.equal(cli('pages').split(reviewUrl).length-1,1,'One review window');
    evaluate("()=>{window.open(location.href,'deck-review-mobile','popup,width=390,height=844');return true;}");
    const mobile=cli('pages').match(/^  (\d+),[^\n]+view=delivery,false$/m);assert.ok(mobile);
    cli('selectpage',[mobile[1]]);cli('wait',['Revisar en Lavish']);
    cli('run',[],"await page.click('#detail-content .detail-tabs button:last-child');");
    assert.deepEqual(evaluate('()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth})'),{width:390,overflow:0});
  }finally{
    child.kill('SIGTERM');if(browser)cli('stop');
    await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});
    fs.rmSync(root,{recursive:true,force:true});
  }
});
