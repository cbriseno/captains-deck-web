/* Read controls through the real HTTP adapter with a disposable owner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');
const cli = 'chrome-devtools-axi';
const available = spawnSync(cli,['--version'],{encoding:'utf8'}).status === 0;

test('pause controls: empty scopes, stopped descendants, inherited waits, own layers and queued work',
  {skip:!available,timeout:180000}, async () => {
    const proof=fs.mkdtempSync(path.join(os.tmpdir(),'deck-pause-'));
    const env={...process.env,CD_TEST_PAUSE:'1',CD_WEB_LANGUAGE:'es',CHROME_DEVTOOLS_AXI_SESSION:'deck-pause-controls-'+process.pid};
    for(const key of ['CHROME_DEVTOOLS_AXI_BROWSER_URL','CHROME_DEVTOOLS_AXI_AUTO_CONNECT','CHROME_DEVTOOLS_AXI_USER_DATA_DIR','CHROME_DEVTOOLS_AXI_MCP_SERVER_URL'])delete env[key];
    const child=spawn('python3',[path.join(__dirname,'approved_fixture.py'),proof],{env,stdio:['ignore','pipe','pipe']});
    let browser=false;
    const run=(command,args=[],input)=>{const p=spawnSync(cli,[command,...args],{env,input,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});assert.equal(p.status,0,String(p.error||'')+'\n'+p.stdout+'\n'+p.stderr);return p.stdout;};
    const evaluate=code=>{const output=run('eval',[`async () => JSON.stringify(await (${code})())`]),m=output.match(/^result: (.*)$/m);assert.ok(m,output);let v=JSON.parse(m[1]);for(let i=0;i<4&&typeof v==='string';i++){try{v=JSON.parse(v);}catch{break;}}return v;};
    const wait='const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw new Error("Timed out");};';
    try{
      const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(output)),12000);child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/(?:Fixture at|URL) ([^\s,]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',chunk=>output+=chunk);child.on('exit',code=>reject(new Error('Fixture '+code+' '+output)));});
      const snapshotPath=path.join(proof,'home/work-snapshot.json'),original=fs.readFileSync(snapshotPath,'utf8');
      browser=true;run('open',[url]);run('resize',['1440','1000']);
      const readings=evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#board [data-node$="task:inherited-wait"]'));const toggle=document.querySelector('[data-control=all-groups]');if(toggle?.getAttribute('aria-expanded')==='false')toggle.click();return Object.fromEntries(['project:stopping','subproject:stopping','task:stopping','project:empty','subproject:empty','subproject:stopped','task:inherited-wait','task:freeze-wait','task:own-wait','task:own-freeze','task:paused-unknown','task:integration','task:next','project:deck','subproject:deck/ux','project:queue','subproject:queue','project:waiting','project:unknown','project:own-empty'].map(id=>{const el=[...document.querySelectorAll('[data-node]')].find(x=>x.dataset.node.endsWith(id)),p=el.querySelector('.pause-control'),b=p.querySelector('button'),note=p.querySelector('.pause-explanation');if(b.disabled)b.click();return [id,{label:b.textContent,disabled:b.disabled,note:note?.textContent,described:!!note&&b.getAttribute('aria-describedby')===note.id,keyboard:p.tabIndex,visible:!!p.getClientRects().length,column:el.closest('section')?.id}];}));}`);
      assert.equal(readings['task:stopping'].label,'Pausando…');assert.equal(readings['task:stopping'].disabled,true);
      assert.equal(readings['task:stopping'].column,'state-column-now');
      const stopping=evaluate(`async()=>{const card=document.querySelector('#board [data-node$="task:stopping"]'),group=document.querySelector('[data-node$="project:stopping"]');const data=await (await fetch('api/board')).json();const nodes=data.deck.sources.flatMap(s=>s.snapshot?.nodes||[]);return {heading:card.closest('.subcol').querySelector('h3').textContent,buttons:[...card.querySelectorAll('.pause-control button')].map(b=>[b.textContent,b.disabled]),group:group.textContent,api:nodes.filter(n=>['task:stopping','project:stopping','subproject:stopping'].includes(n.id)).map(n=>({id:n.id,state:n.state,pause:n.pause}))};}`);
      const inherited=evaluate(`async()=>{const card=document.querySelector('#board [data-node$="task:stopping-inherited"]'),group=document.querySelector('[data-node$="project:stopping-inherited"]');return {buttons:[...card.querySelectorAll('.pause-control button')].map(b=>b.textContent),group:group.textContent};}`);
      assert.deepEqual(inherited.buttons,['Pausando…']);assert.match(inherited.group,/1 en Ahora/);
      assert.equal(stopping.heading,'Deteniéndose');assert.deepEqual(stopping.buttons,[['Pausando…',true],['Cancelar pausa',false]]);assert.match(stopping.group,/1 deteniéndose/);
      assert.equal(stopping.api.find(n=>n.id==='task:stopping').state,'stopping');
      for(const id of ['project:stopping','subproject:stopping'])assert.equal(stopping.api.find(n=>n.id===id).pause.can_pause,false);
      for(const id of ['project:stopping','subproject:stopping']){assert.equal(readings[id].disabled,true);assert.notEqual(readings[id].label,'Pausar');}
      for(const id of ['project:empty','subproject:empty']){assert.equal(readings[id].disabled,true);assert.equal(readings[id].label,'Sin tareas');assert.match(readings[id].note,/No hay tareas/);}
      assert.match(readings['subproject:stopped'].note,/ya están detenidas/);assert.equal(readings['subproject:stopped'].label,'Sin trabajo en ejecución');
      for(const id of ['task:inherited-wait','task:freeze-wait','task:own-freeze']){assert.equal(readings[id].disabled,true);assert.equal(readings[id].described,true);assert.equal(readings[id].keyboard,0);}
      assert.equal(readings['task:inherited-wait'].label,'En pausa');assert.match(readings['task:inherited-wait'].note,/Stopped subproject/);assert.match(readings['task:inherited-wait'].note,/Existing external/);
      assert.equal(readings['task:freeze-wait'].label,'En pausa');assert.match(readings['task:freeze-wait'].note,/congelación/);assert.match(readings['task:freeze-wait'].note,/Existing future/);
      assert.match(readings['task:own-freeze'].note,/también levantaría/);assert.equal(readings['task:own-freeze'].label,'En pausa');
      assert.equal(readings['task:paused-unknown'].label,'En pausa');assert.equal(readings['task:paused-unknown'].disabled,true);
      for(const id of ['task:integration','project:own-empty']){assert.equal(readings[id].label,'Reanudar');assert.equal(readings[id].disabled,false);}
      for(const id of ['project:queue','subproject:queue']){assert.equal(readings[id].label,'Apartar pendientes');assert.equal(readings[id].disabled,false);assert.match(readings[id].note,/No hay tareas en ejecución/);}
      assert.equal(readings['project:waiting'].label,'Sin trabajo en ejecución');assert.equal(readings['project:waiting'].disabled,true);
      assert.match(readings['project:waiting'].note,/siguen esperando/);
      assert.equal(readings['project:unknown'].label,'Estado sin confirmar');assert.equal(readings['project:unknown'].disabled,true);
      assert.match(readings['project:unknown'].note,/no está confirmado/);
      for(const id of ['task:inherited-wait','task:freeze-wait','task:own-wait','task:own-freeze','task:paused-unknown','task:integration'])assert.equal(readings[id].column,'state-column-paused');
      assert.equal(readings['task:own-wait'].label,'Quitar pausa propia');assert.equal(readings['task:own-wait'].disabled,false);assert.match(readings['task:own-wait'].note,/seguirá vigente/);assert.match(readings['task:own-wait'].note,/Existing captain/);
      for(const id of ['task:next','project:deck','subproject:deck/ux']){assert.equal(readings[id].disabled,false);assert.equal(readings[id].label,'Pausar');}
      const geometry=evaluate(`async()=>[...document.querySelectorAll('#board .card-ctl')].map(el=>{const a=el.querySelector('.plabel')?.getBoundingClientRect(),b=el.querySelector('.pause-control button')?.getBoundingClientRect(),note=el.querySelector('.pause-explanation')?.getBoundingClientRect();return {overlap:!!a&&!!b&&Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top),wideReason:!note||note.width>=el.getBoundingClientRect().width*.75};})`);
      assert.ok(geometry.every(x=>!x.overlap&&x.wideReason),JSON.stringify(geometry));
      if(process.env.CD_TEST_EVIDENCE)run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,'pause-desktop.png'),'--full-page']);
      assert.equal(fs.existsSync(path.join(proof,'home/work-calls.jsonl')),false,'Disabled controls never request a mutation');
      // Keyboard focus reaches disabled explanations. Enter cannot invoke them.
      const focus=evaluate(`async()=>{const p=document.querySelector('#board [data-node$="task:inherited-wait"] .pause-control');p.focus();return document.activeElement===p;}`);assert.equal(focus,true);run('run',[],"await page.press('Enter');");
      assert.equal(fs.existsSync(path.join(proof,'home/work-calls.jsonl')),false);
      // Details reuse the same label, availability and explanation for every scope.
      const details={};
      for(const id of ['project:stopping','subproject:stopping','task:stopping','project:empty','subproject:empty','subproject:stopped','task:inherited-wait','task:freeze-wait','task:own-wait','task:own-freeze','task:paused-unknown','task:integration','project:queue','subproject:queue','project:waiting','project:unknown','project:own-empty','task:next']){
        details[id]=evaluate(`async()=>{${wait}document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const el=[...document.querySelectorAll('[data-node]')].find(x=>x.dataset.node.endsWith('${id}'));(el.querySelector('.card-open')||[...el.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith('Detalles de'))).click();await wait(()=>document.querySelector('#detail-content .deck-controls .pause-control'));const p=document.querySelector('#detail-content .deck-controls .pause-control'),b=p.querySelector('button');return {label:b.textContent,disabled:b.disabled,note:p.querySelector('.pause-explanation')?.textContent};}`);
        assert.equal(details[id].label,readings[id].label);assert.equal(details[id].disabled,readings[id].disabled);assert.equal(details[id].note,readings[id].note);
      }
      // A group's label follows descendant execution even when its own pause,
      // revision and capabilities are unchanged. Keep other detail controls intact.
      evaluate(`async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('[data-node$="project:queue"] button[aria-label^="Detalles de"]').click();window.groupPriority=document.querySelector('#detail-content select[name=priority]');return true;}`);
      const running=JSON.parse(original);running.tasks.find(x=>x.key==='task:queued-only').state='running';
      fs.writeFileSync(snapshotPath+'.tmp',JSON.stringify(running));fs.renameSync(snapshotPath+'.tmp',snapshotPath);
      const activeGroup=evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#detail-content .pause-control button')?.textContent==='Pausar');return {same:window.groupPriority===document.querySelector('#detail-content select[name=priority]'),labels:[...document.querySelectorAll('[data-node$="project:queue"] .pause-control button,[data-node$="subproject:queue"] .pause-control button')].map(b=>b.textContent),column:document.querySelector('#board [data-node$="task:queued-only"]')?.closest('section')?.id};}`);
      assert.equal(activeGroup.same,true);assert.ok(activeGroup.labels.every(x=>x==='Pausar'));assert.equal(activeGroup.column,'state-column-now');
      fs.writeFileSync(snapshotPath+'.tmp',original);fs.renameSync(snapshotPath+'.tmp',snapshotPath);
      evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#detail-content .pause-control button')?.textContent==='Apartar pendientes');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('#board [data-node$="task:next"] .card-open').click();return true;}`);
      // Polling updates the open detail control without rebuilding its siblings.
      evaluate(`async()=>{window.pausePriority=document.querySelector('#detail-content select[name=priority]');return true;}`);
      const changed=JSON.parse(original),queued=changed.tasks.find(x=>x.key==='task:next');
      queued.state='paused_inherited';queued.pause={own:{kind:'future',reason:'New future wait'},inherited:{from:'freeze'},condition:null};
      fs.writeFileSync(snapshotPath+'.tmp',JSON.stringify(changed));fs.renameSync(snapshotPath+'.tmp',snapshotPath);
      const refreshed=evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#detail-content .deck-controls .pause-explanation')?.textContent.includes('New future wait'));const p=document.querySelector('#detail-content .deck-controls .pause-control');return {disabled:p.querySelector('button').disabled,label:p.querySelector('button').textContent,samePriority:window.pausePriority===document.querySelector('#detail-content select[name=priority]')};}`);
      assert.equal(refreshed.disabled,true);assert.equal(refreshed.label,'En pausa');assert.equal(refreshed.samePriority,true);
      fs.writeFileSync(snapshotPath+'.tmp',original);fs.renameSync(snapshotPath+'.tmp',snapshotPath);
      evaluate(`async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;}`);
      run('resize',['390','844']);
      const mobile=evaluate(`async()=>{${wait}document.querySelector('#state-tab-paused').click();await wait(()=>document.querySelector('#board [data-node$="task:inherited-wait"] .pause-explanation')?.getClientRects().length);const p=document.querySelector('#board [data-node$="task:inherited-wait"] .pause-control'),note=p.querySelector('.pause-explanation'),r=note.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth-innerWidth,visible:!!note.getClientRects().length,inside:r.left>=0&&r.right<=innerWidth,text:note.textContent,buttonDisabled:p.querySelector('button').disabled};}`);
      assert.equal(mobile.overflow,0);assert.equal(mobile.visible,true);assert.equal(mobile.inside,true);assert.equal(mobile.buttonDisabled,true);assert.match(mobile.text,/Existing external/);
      if(process.env.CD_TEST_EVIDENCE)run('screenshot',[path.join(process.env.CD_TEST_EVIDENCE,'pause-mobile.png')]);
      assert.equal(fs.readFileSync(snapshotPath,'utf8'),original,'Disposable snapshot restored');
      assert.equal(fs.existsSync(path.join(proof,'home/work-calls.jsonl')),false,'No preview or apply was requested');
      // Cancel is the owner's clear_pause operation, distinct from resuming an already paused task.
      evaluate(`async()=>{document.querySelector('#state-tab-now').click();const p=document.querySelector('#board [data-node$="task:stopping"] .pause-control');[...p.querySelectorAll('button')].find(b=>b.textContent==='Cancelar pausa').click();return true;}`);
      await new Promise(resolve=>setTimeout(resolve,1500));
      const calls=fs.readFileSync(path.join(proof,'home/work-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
      assert.ok(calls.some(c=>c.command==='preview'&&c.operation.op==='clear_pause'&&c.operation.target==='task:stopping'));
      assert.ok(calls.some(c=>c.command==='apply'&&c.operation.op==='clear_pause'&&c.operation.target==='task:stopping'));
      if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'pause-controls.json'),JSON.stringify({readings,geometry,details,activeGroup,refreshed,mobile,noControlRequests:true},null,2));}
    }finally{child.kill('SIGTERM');if(browser)run('stop');fs.rmSync(proof,{recursive:true,force:true});}
  });
