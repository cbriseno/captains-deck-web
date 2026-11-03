/* Real Chromium checks via the repository's existing browser CLI and fixture. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');
const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';
test('anonymize: deny unknown DOM data, restore, geometry, late updates and scale', {timeout:180000}, async () => {
  const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-anonymize-'));
  const env = {...process.env, CD_WEB_LANGUAGE: process.env.CD_TEST_ANON_LANGUAGE || 'es', CHROME_DEVTOOLS_AXI_SESSION: process.env.CD_TEST_SESSION || 'deck-anonymize-' + process.pid};
  const child = spawn('python3', [path.join(__dirname, 'approved_fixture.py'), proof], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let opened = false;
  const run = (command, args = []) => {
    const r = spawnSync(cli, [command, ...args], {env, encoding:'utf8', timeout:45000, maxBuffer:4*1024*1024});
    assert.equal(r.status, 0, command + ': ' + r.stdout + r.stderr); return r.stdout;
  };
  const evaluate = code => {
    const output = run('eval', ['async () => JSON.stringify(await (' + code + ')())']);
    const m = output.match(/^result: (.*)$/m); assert.ok(m, output);
    let result = JSON.parse(m[1]); for (let i=0;i<4 && typeof result === 'string';i++) {try {result=JSON.parse(result);} catch {break;}} return result;
  };
  const evidence = {};
  try {
    const url = await new Promise((resolve,reject) => {
      let output=''; const timer=setTimeout(()=>reject(new Error('fixture timeout '+output)),12000);
      child.stdout.on('data',data=>{output+=data; const m=output.match(/(?:Fixture at|URL) ([^\s,]+)/); if(m){clearTimeout(timer);resolve(m[1]);}});
      child.stderr.on('data',data=>output+=data);child.on('exit',code=>reject(new Error('fixture exit '+code+' '+output)));
    });
    run('open', [url]); opened=true;
    evidence.canaries = evaluate(`async () => {
      const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw Error('timeout');};
      await wait(()=>document.querySelector('.task-card'));
      const root=document.createElement('section');root.id='anon-fixture';document.body.append(root);
      const values=['CANARY_ERROR_101','CANARY_CONVERSATION_102','/CANARY_PATH_103/file','CANARY_ATTACHMENT_104.txt','1234567890123456789012345','2026-12-31 CANARY_DATE_105','CANARY_SERVER_106','CANARY_SEARCH_107'];
      for(const value of values){const el=document.createElement('p');el.textContent=value;root.append(el);}
      const hidden=document.createElement('p');hidden.hidden=true;hidden.textContent='CANARY_HIDDEN_108';root.append(hidden);
      for(const tag of ['input','textarea','select']){const el=document.createElement(tag);el.id='fixture-'+tag;if(tag==='select'){el.append(new Option('CANARY_OPTION_109','CANARY_OPTION_VALUE_110'));}else el.value='CANARY_VALUE_'+tag;root.append(el);}
      const tip=document.createElement('span');for(const attr of ['title','aria-label','alt','placeholder'])tip.setAttribute(attr,'CANARY_ATTR_'+attr);root.append(tip);
      const dialog=document.createElement('dialog');dialog.textContent='CANARY_DIALOG_111';root.append(dialog);
      const menu=document.createElement('div');menu.setAttribute('role','menu');menu.textContent='CANARY_MENU_112';root.append(menu);
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');const txt=document.createElementNS(svg.namespaceURI,'text');txt.textContent='CANARY_SVG_113';svg.append(txt);root.append(svg);
      const host=document.createElement('div');root.append(host);const shadow=host.attachShadow({mode:'open'});shadow.append('CANARY_SHADOW_DIRECT_121');shadow.innerHTML+='<span title="CANARY_SHADOW_ATTR_114">CANARY_SHADOW_115</span>';
      const translated=document.createElement('p');translated.textContent=(await DeckI18n.ready).t('Priority of {name}',{name:'CANARY_INTERPOLATED_116'});root.append(translated);
      const known=document.createElement('p');known.id='fixture-known';known.textContent=document.documentElement.lang.startsWith('es')?'Tablero':'Board';root.append(known);
      const counter=document.createElement('p');counter.id='fixture-count';counter.textContent='60% · 3/5 '+(await DeckI18n.ready).t('steps');DeckAnonymize.structural(counter,'count');root.append(counter);
      const date=document.createElement('p');date.id='fixture-date';date.textContent=DeckAnonymize.formatted('3 nov 2026, 10:42');DeckAnonymize.structural(date,'time');root.append(date);
      const numeric=document.createElement('input');numeric.type='number';numeric.value='987654321012345';root.append(numeric);
      const controlDefault=document.createElement('input');controlDefault.setAttribute('value','CANARY_DEFAULT_VALUE_120');root.append(controlDefault);
      const uiLabels=[...document.querySelectorAll('[data-i18n]')].map(x=>[x,x.textContent]);
      const beforeDates=[...document.querySelectorAll('[data-age-label]')].map(x=>x.textContent);
      const untyped=document.createElement('p');untyped.textContent='33%';root.append(untyped);
      const typedTwin=document.createElement('p');typedTwin.textContent=(await DeckI18n.ready).t('Paused until {date}',{date:'3 nov 2026, 10:42'});root.append(typedTwin);
      const title=document.title;const input=root.querySelector('input');input.focus();
      const read=()=>{let text='';function visit(root){text+=root.textContent;for(const el of root.querySelectorAll('*')){text+=el.textContent;for(const key of ['title','aria-label','alt','placeholder'])text+=' '+el.getAttribute(key);if('value'in el)text+=' '+el.value;if(el.shadowRoot)visit(el.shadowRoot);}}visit(root);return text;};
      await DeckAnonymize.set(true);const first=read();const focus=document.activeElement===input;
      root.querySelector('textarea').value='CANARY_PROPERTY_LATE_117';tip.title='CANARY_TOOLTIP_LATE_118';const lateHost=document.createElement('span');root.append(lateHost);lateHost.attachShadow({mode:'open'}).append('CANARY_SHADOW_LATE_122');
      const late=document.createElement('p');late.textContent='CANARY_LATE_119';root.append(late);
      await new Promise(requestAnimationFrame);const lateText=read();const uiMismatches=uiLabels.filter(([el,text])=>el.textContent!==text).map(([el,text])=>({id:el.id,tag:el.tagName,before:text,after:el.textContent}));const uiPreserved=!uiMismatches.length;
      const deniedNumber=numeric.value==='';const deniedDefault=!controlDefault.getAttribute('value').includes('CANARY');
      const preserved={known:document.querySelector('#fixture-known').textContent,count:document.querySelector('#fixture-count').textContent,date:document.querySelector('#fixture-date').textContent,tab:document.title};
      const realProgress=[...document.querySelectorAll('.prog-txt')].map(x=>x.textContent);
      const realDates=[...document.querySelectorAll('[data-age-label]')].map(x=>x.textContent);
      const readonly=input.readOnly;const keyboardBlocked=!root.querySelector('select').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));const untypedDenied=untyped.textContent!=='33%';const untypedDateDenied=!typedTwin.textContent.includes('3 nov 2026, 10:42');await DeckAnonymize.set(false);const restored=read();
      const result={leak:first.match(/CANARY_[\\w_-]+|1234567890123456789012345/g),lateLeak:lateText.match(/CANARY_[\\w_-]+/g),preserved,title,focus,readonly,realProgress,realDates,beforeDates,uiMismatches,uiPreserved,keyboardBlocked,untypedDenied,untypedDateDenied,deniedNumber,deniedDefault,numericRestored:numeric.value==='987654321012345',selectedRestored:root.querySelector('select').value==='CANARY_OPTION_VALUE_110',defaultRestored:controlDefault.value==='CANARY_DEFAULT_VALUE_120',restored:values.every(v=>restored.includes(v)),lateRestored:restored.includes('CANARY_PROPERTY_LATE_117')&&restored.includes('CANARY_LATE_119'),editable:!input.readOnly};root.remove();return result;
    }`);
    assert.equal(evidence.canaries.leak,null);assert.equal(evidence.canaries.lateLeak,null);
    assert.equal(evidence.canaries.preserved.known,env.CD_WEB_LANGUAGE==='es'?'Tablero':'Board');assert.equal(evidence.canaries.preserved.count,'60% · 3/5 '+(env.CD_WEB_LANGUAGE==='es'?'pasos':'steps'));assert.equal(evidence.canaries.preserved.date,'3 nov 2026, 10:42');assert.equal(evidence.canaries.preserved.tab,evidence.canaries.title);
    for(const k of ['focus','readonly','restored','lateRestored','editable','uiPreserved','deniedNumber','deniedDefault','numericRestored','selectedRestored','defaultRestored','untypedDenied','untypedDateDenied','keyboardBlocked'])assert.equal(evidence.canaries[k],true,k+JSON.stringify(evidence.canaries));
    assert.deepEqual(evidence.canaries.realDates,evidence.canaries.beforeDates);
    assert.ok(evidence.canaries.realProgress.includes('33% · 1/3 '+(env.CD_WEB_LANGUAGE==='es'?'pasos':'steps')));
    evidence.persistence=evaluate(`async()=>{
      const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw Error('timeout');};
      document.querySelector('.qcard .card-open').click();await wait(()=>document.querySelector('#answer-note'));
      const note=document.querySelector('#answer-note');note.value='CANARY_REAL_DRAFT_130';note.dispatchEvent(new Event('input',{bubbles:true}));
      const drafts=()=>Object.keys(sessionStorage).filter(k=>k.startsWith('deck-draft-')).map(k=>[k,sessionStorage.getItem(k)]);
      const before=drafts();await DeckAnonymize.set(true);let posts=0;const fetchOriginal=window.fetch;window.fetch=(...args)=>{if(args[1]?.method==='POST')posts++;return fetchOriginal(...args);};
      document.querySelector('.option-choice')?.click();document.querySelector('#answer-submit')?.click();await new Promise(r=>setTimeout(r,30));
      const after=drafts();window.fetch=fetchOriginal;await DeckAnonymize.set(false);
      const result={before,after,posts,restored:document.querySelector('#answer-note')?.value};document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return result;
    }`);
    assert.deepEqual(evidence.persistence.after,evidence.persistence.before);assert.equal(evidence.persistence.posts,0);assert.equal(evidence.persistence.restored,'CANARY_REAL_DRAFT_130');
    evidence.layout=[];
    for(const viewport of [[1440,1000],[390,844]])for(const font of ['Arial','Georgia']){
      run('resize',viewport.map(String));
      const result=evaluate(`async()=>{
        const fixture=document.createElement('section');fixture.style.cssText='width:min(92vw,600px);font:16px ${font};line-height:1.5';document.body.prepend(fixture);
        for(const source of ['A synthetic conversation with several words and narrow iii wide WWW glyphs.','Otro ejemplo inventado para medir saltos entre palabras de diferentes tamaños.','Accented café, Unicode 日本語 and a second line\\nwith a file-name/example.','W'.repeat(90),'日本語の合成テキスト'.repeat(12),'cloudcloud wavewavew echoecho orbitorb- amberam week4 minutes ago']){const p=document.createElement('p');p.textContent=source;p.style.whiteSpace='pre-wrap';p.style.overflowWrap='anywhere';fixture.append(p);}
        const rects=()=>[...fixture.children].map(el=>{const r=el.getBoundingClientRect();const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),lines=[];while(walker.nextNode()){if(!walker.currentNode.data.trim())continue;const range=document.createRange();range.selectNodeContents(walker.currentNode);for(const r of range.getClientRects())if(r.width>0&&r.height>0)lines.push(Math.round(r.top));}return {x:r.x,y:r.y,w:r.width,h:r.height,lines:new Set(lines).size};});
        const before=rects();await DeckAnonymize.set(true);const after=rects(),masked=fixture.lastElementChild.textContent,maskedTokens=masked.split(/\\s+/).map(x=>x.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z]/gi,''));await DeckAnonymize.set(false);fixture.remove();return {before,after,masked,maskedTokens};
      }`);
      evidence.layout.push({viewport,font,...result});
      for(let i=0;i<result.before.length;i++)for(const key of ['x','y','w','h'])assert.ok(Math.abs(result.before[i][key]-result.after[i][key])<=Math.max(key==='lines'?0:1,Math.abs(result.before[i][key])*.02),JSON.stringify({viewport,font,key,...result}));
      const words=env.CD_WEB_LANGUAGE==='es'?['ambar','nube','orbita','pieza','onda','eco','minutes','ago']:['amber','cloud','orbit','tile','wave','echo','minutes','ago'];
      assert.equal(result.maskedTokens.length,8,JSON.stringify({viewport,font,...result}));
      assert.ok(result.maskedTokens.every(word=>words.includes(word)),JSON.stringify({viewport,font,...result}));
    }
    evidence.performance=[];
    for(const rows of (process.env.CD_TEST_ANON_FUNCTIONAL ? [] : [500,2000]))evidence.performance.push(evaluate(`async()=>{
      const fixture=document.createElement('div');document.body.append(fixture);const fragment=document.createDocumentFragment();
      for(let i=0;i<${rows};i++){const p=document.createElement('p');p.textContent='Synthetic private row '+i+' with distinct attachment-'+i+'.txt';fragment.append(p);}fixture.append(fragment);
      const gaps=[];let last=performance.now();const beat=setInterval(()=>{const now=performance.now();gaps.push(now-last);last=now;},10);const start=performance.now();await DeckAnonymize.set(true);clearInterval(beat);const swept=performance.now();fixture.getBoundingClientRect();const painted=performance.now(),phases=DeckAnonymize.metrics;await DeckAnonymize.set(false);fixture.remove();return {rows:${rows},sweep:swept-start,layout:painted-swept,total:painted-start,phases,maxHeartbeatGap:Math.max(0,...gaps)};
    }`));
    console.log(JSON.stringify(evidence,null,2));
    if(process.env.CD_TEST_EVIDENCE){fs.mkdirSync(process.env.CD_TEST_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE,'anonymize-checks.json'),JSON.stringify(evidence,null,2));}
    evidence.performanceSkipped=!!process.env.CD_TEST_ANON_FUNCTIONAL;
    if(evidence.performance.length)assert.ok((evidence.performance[0].phases.staged ? Math.max(evidence.performance[0].phases.maxTask,evidence.performance[0].maxHeartbeatGap)<=200 : evidence.performance[0].total<=200),'500-row pause exceeds 200ms: '+JSON.stringify(evidence.performance[0]));
    const saved=evaluate(`async()=>{await DeckAnonymize.set(true);return sessionStorage.getItem('deck-anonymize');}`);assert.equal(saved,true);run('open',[url]);
    assert.equal(evaluate(`async()=>{for(let i=0;i<100&&(!window.DeckAnonymize?.enabled||document.documentElement.hasAttribute('data-anon-pending'));i++)await new Promise(r=>setTimeout(r,50));return {enabled:DeckAnonymize.enabled,pending:document.documentElement.hasAttribute('data-anon-pending')};}`).enabled,true);
  } finally {
    child.kill('SIGTERM');if(opened&&!process.env.CD_TEST_SESSION)run('stop');fs.rmSync(proof,{recursive:true,force:true});
  }
});
