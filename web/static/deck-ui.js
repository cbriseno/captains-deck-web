'use strict';
/* Rendering and interaction only. Scheduling, inheritance, cycles and receipts
 * come from the Firstmate owner. A missing owner is a read-only board. */
window.createDeckUI = function (host) {
  const {t, node: n, button: b, append: add, api, ago, creationAge, exactTime, openCard, showDetail, closeDetail, detailOpen, parkDetail, state: app} = host;
  const structural = (el, kind = 'count') => { window.DeckAnonymize?.structural(el, kind); return el; };
  const $ = id => document.getElementById(id);
  const pref = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Current page still works. */ } };
  const ui = {pin:'',view:'board', scope:'', selected:'', hover:'', column:'', closed:new Set(pref('deck-closed', [])), hasClosedPreference:pref('deck-closed',null)!==null, initialized:false, tree:new Set(),
    reordering:false, pausedOpen:pref('deck-paused-open',true),done:pref('deck-done', true), focus:pref('deck-focus', true), hoverDelay:Math.max(0,Math.min(10,Number(pref('deck-hover-delay',1))||0)), mixer:false, stacks:new Set(), log:[], busy:false, drag:null, signature:'', generation:0,renderedQuery:null,nextRenderMode:''};
  const motion=window.createDeckMotion({t,settled:highlight});
  const announceFocus=(_id,text='')=>{const status=$('focus-status');if(status)status.textContent=ui.focus?(text?t('Focused: {name}',{name:text}):t('Focus cleared')):t('Focus disabled');};
  let hoverTimer=0, hoverTarget=null, keyboardFocus=false;
  function cancelHover(){clearTimeout(hoverTimer);hoverTimer=0;hoverTarget=null;}
  document.addEventListener('pointerdown',()=>{keyboardFocus=false;cancelHover();},true);
  document.addEventListener('click',cancelHover,true);
  document.addEventListener('keydown',event=>{keyboardFocus=event.key==='Tab'||event.key.startsWith('Arrow')||['Home','End'].includes(event.key);cancelHover();},true);
  let lastHoverPoint=null;document.addEventListener('pointermove',event=>{lastHoverPoint={x:event.clientX,y:event.clientY};},true);
  let model = {nodes:[], edges:[], sources:[]}, byId = new Map(), cardMap = new Map(), hues=new Map(), groupActivities=new Map();
  const activityObserver=new IntersectionObserver(entries=>{
    for(const entry of entries)entry.target.dataset.activityVisible=String(entry.isIntersecting);
  });
  const activityVisibility=()=>{document.documentElement.dataset.deckHidden=String(document.hidden);};
  document.addEventListener('visibilitychange',activityVisibility);activityVisibility();
  const savedHues=pref('deck-project-hues',{});
  try{ui.log=JSON.parse(sessionStorage.getItem('deck-control-receipts')||'[]').slice(0,100);}catch{/* A receipt read never resends a change. */}
  const kinds = {project:t('Project'), subproject:t('Subproject'), task:t('Task')};
  const priorities = [['',t('Not reported')],['P4','NA'],['P3',t('Low')],['P2',t('Medium')],['P1',t('High')],['P0',t('Critical')]];
  const priorityName = p => priorities.find(([v]) => v === p)?.[1] || t('Not reported');
  const priorityText = x => x.priority_reported && x.priority === null ? 'NA' : priorityName(x.priority);
  const keyOf = (home, id) => home + ':' + id;
  const taskNodeId = (home,task) => model.nodes.find(x=>x.home===home&&x.kind==='task'&&x.task===task)?.id || keyOf(home,task);
  const label = x => x?.card?.title || x?.title || x?.label || t('Not recorded.');
  const objectId=x=>x?.alias||x?.raw?.alias||x?.card?.alias||'';
  const idBadge=x=>n('span','node-id',objectId(x)?'ID: '+objectId(x):t('ID pending'));
  const ancestors = x => { const out = [], seen = new Set(); for (let p = x; p && !seen.has(p.id); p = byId.get(p.parent)) {out.unshift(p);seen.add(p.id);} return out; };
  const tasksOf = x => model.nodes.filter(y => y.kind === 'task' && ancestors(y).some(z => z.id === x.id));
  const projectOf = x => ancestors(x).find(y => y.kind === 'project');
  const pathOf = x => ancestors(x).filter(y => y.id !== x.id).map(label).join(' · ');
  // Unknown observation is not an explicit dependency/hold. It has its own
  // subgroup and never contributes to the confirmed work count.
  const isStopping = x => x.kind === 'task' && x.state === 'stopping';
  const colOf = x => x.state === 'done' ? 'done' : x.state === 'paused' ? 'paused' : ['ready','active','stopping','unknown'].includes(x.state) ? 'now' : 'waiting';
  const visible = x => (!ui.scope || ancestors(x).some(y => y.id === ui.scope)) && (!app.query || [label(x), pathOf(x), x.reason, x.task].join(' ').toLocaleLowerCase().includes(app.query));
  const hueKey=x=>x.color_key || x.owner_id || x.id;
  const hueFor=key=>hues.get(key) ?? host.hashOf(key)%11;
  function assignHues(){const used=new Set();hues=new Map();for(const key of [...new Set(model.nodes.filter(x=>x.kind==='project').map(hueKey))].sort()){let h=Number.isInteger(savedHues[key])?savedHues[key]:host.hashOf(key)%11;for(let i=0;i<11&&used.has(h);i++)h=(h+1)%11;hues.set(key,h);used.add(h);savedHues[key]=h;}save('deck-project-hues',savedHues);}
  const setColor = (el, x) => { const p = projectOf(x); const h = hueFor(p?hueKey(p):x.id); el.style.setProperty('--pc', `var(--h${h})`); el.dataset.hue = String(h); return el; };
  function event(value) {
    if(value?.precision==='unknown')return null;
    if(value && Object.hasOwn(value,'value'))return event(value.value);
    if(typeof value==='number')return Number.isFinite(value)&&value>0?{epoch:value}:null;
    if(typeof value==='string'){
      if(/^\d{4}-\d\d-\d\d$/.test(value)){const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?{date:value}:null;}
      return /[T ]\d\d:\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/i.test(value)&&Number.isFinite(Date.parse(value))?{epoch:Date.parse(value)/1000}:null;
    }
    return value;
  }
  function naturalAge(value) {
    const e=event(value), now=Date.now()/1000;
    let seconds=e?.date?(Date.UTC(new Date().getFullYear(),new Date().getMonth(),new Date().getDate())-Date.parse(e.date))/1000:typeof e?.epoch==='number'?now-e.epoch:NaN;
    if(!Number.isFinite(seconds)||seconds < -5)return t('Not reported');
    if(e?.date&&seconds<86400)return t('today');
    if(seconds<60)return t('now');
    const [count,singular,plural]=seconds<3600?[Math.floor(seconds/60),'1 minute','{count} minutes']:seconds<86400?[Math.floor(seconds/3600),'1 hour','{count} hours']:seconds<2592000?[Math.floor(seconds/86400),'1 day','{count} days']:[Math.floor(seconds/2592000),'1 month','{count} months'];
    return window.DeckAnonymize?.formatted(count===1?t(singular):t(plural,{count})) ?? (count===1?t(singular):t(plural,{count}));
  }
  const ageText=(label,value)=>t(label)+' '+(['Created','Created group'].includes(label)?creationAge(event(value)):naturalAge(value));
  function time(labelText, value) { const e = event(value); const el = structural(n('span','dates',ageText(labelText,value)), 'time'); el.title = exactTime(e); el.dataset.event = JSON.stringify(e);el.dataset.ageLabel=labelText;return el; }
  function refreshAges(){for(const el of document.querySelectorAll('[data-age-label]'))el.textContent=ageText(el.dataset.ageLabel,JSON.parse(el.dataset.event));}
  function dates(x) { const created=x.kind !== 'project'||event(x.created_at);return add(n('div','dates'),created?time(x.kind === 'task' ? 'Created' : 'Created group',x.created_at):null,created?' · ':null,time(x.kind === 'task' ? 'Updated' : 'Updated group',x.updated_at)); }
  function normalize(data) {
    const cards = [...data.columns.flatMap(c => c.cards)];
    for(const row of app.historyRows || []){const current=cards.find(c=>c.home===row.home&&c.task===row.task);if(!current)cards.push({...row,key:'history:'+row.home+':'+row.task,bucket:'landed',dependencies:[],activity:{kind:'delivered'}});else if(current.bucket==='landed'&&row.project)current.project=row.project;} cardMap = new Map(cards.map(c => [keyOf(c.home,c.task),c]));
    const nodes = [], edges = [], sources = data.deck?.sources || [];
    for (const source of sources) {
      if (!source.snapshot) continue;
      const snap = source.snapshot;
      for (const x of snap.nodes || []) {
        const id = keyOf(source.home,x.id), card = cardMap.get(keyOf(source.home,x.task || x.id));
        const retained = !source.available;
        nodes.push({...x, id, owner_id:x.id, parent:x.parent ? keyOf(source.home,x.parent) : '', home:source.home, card,
          kind:x.kind === 'sub' ? 'subproject' : x.kind, title:x.title || x.label, source,
          // Keep the last observation visible; uncertainty never renews it.
          observation_uncertain_since:x.observation_uncertain_since || (retained ? source.retained_at : null)});
      }
      for (const e of snap.edges || []) edges.push({...e,from:keyOf(source.home,e.from),to:keyOf(source.home,e.to)});
    }
    const existing = new Set(nodes.filter(x => x.kind === 'task').map(x => keyOf(x.home,x.task || x.owner_id)));
    for (const c of cards) {
      if (existing.has(keyOf(c.home,c.task))) continue;
      const pid = c.project?.id ? keyOf(c.home,c.project.id.startsWith('project:')?c.project.id:'project:'+c.project.id) : '';
      if (pid && !nodes.some(x => x.id === pid)) nodes.push({id:pid,owner_id:'',home:c.home,title:c.project.label,color_key:c.project.id,kind:'project',state:'unknown',priority:null});
      const a = c.activity?.kind;
      const state = c.bucket === 'landed' ? 'done' : c.bucket === 'underway' && ['unknown','last_seen_working'].includes(a) ? 'unknown' : a === 'paused' ? 'paused' : a === 'ready' && c.native?.source !== 'backlog.hold_reason' ? 'ready' : a === 'working' || a === 'validating' ? 'active' : c.bucket === 'underway' && !['paused','deferred','blocked','held','stopped','decision'].includes(a) ? 'active' : 'waiting';
      const taskIdentity=sources.some(s=>s.home===c.home&&s.snapshot)?'task:'+c.task:c.task;
      nodes.push({id:keyOf(c.home,taskIdentity),owner_id:'',task:c.task,home:c.home,card:c,parent:pid,kind:'task',title:c.title,state,priority:null,
        reason:host.cardLine(c) || host.phaseText(c),reason_time:!host.cardLine(c)&&['paused','deferred','last_seen_working'].includes(c.activity?.kind),updated_at:null,created_at:c.time?.source === 'backlog.since' ? c.time : null,completed_at:state === 'done' ? c.time : null,
        pause:{own:false,inherited:[]},progress:null});
      for (const dep of c.dependencies || []) edges.push({from:keyOf(c.home,c.task),to:keyOf(c.home,dep.id),origin:dep.origin || 'firstmate',completed:dep.state === 'done' || dep.unresolved === false});
    }
    for(const edge of edges) for(const end of ['from','to']) { const match=nodes.find(x=>x.kind==='task'&&keyOf(x.home,x.task)===edge[end]); if(match)edge[end]=match.id; }
    byId = new Map(nodes.map(x=>[x.id,x]));
    return {nodes,edges,sources};
  }
  function ownPause(x) { return x.pause?.own === true; }
  function waitingText(x){if(x.reason)return x.reason;const edges=model.edges.filter(e=>e.from===x.id&&!e.completed);if(edges.length)return t('Waits for {name}',{name:edges.map(e=>label(byId.get(e.to))).join(', ')});if(x.raw?.state==='captain')return t('Waiting for your answer');return x.card?host.cardLine(x.card)||host.phaseText(x.card):'';}
  function pauseText(x) {
    if(x.pause?.state==='unconfirmed')return t('Safe point not confirmed');
    if (x.state === 'stopping' || x.pause?.state==='pending') return t('Reaching a safe point');
    if (ownPause(x)) return t('Own pause');
    const inherited = x.pause?.inherited || [];
    if(x.pause?.inherited_reason)return x.pause.inherited_reason;
    if (inherited.length) return t('Pause from {name}',{name:inherited.map(id=>id==='freeze'?t('the fleet freeze'):label(byId.get(keyOf(x.home,id)) || byId.get(id))).join(', ')});
    return x.state === 'paused' ? t('Pause origin not reported') : '';
  }
  function workControl(el,allowed){el.dataset.workAllowed=String(!!allowed);el.disabled=!allowed||ui.busy;return el;}
  function pending(value){$('workspace').setAttribute('aria-busy',String(value));for(const el of document.querySelectorAll('[data-work-allowed]'))el.disabled=value||el.dataset.workAllowed!=='true';}
  function priority(x) {
    const select = n('select'); select.setAttribute('aria-label', t('Priority of {name}',{name:label(x)}));
    priorities.forEach(([v,text])=>select.append(new Option(text,v))); select.value = x.priority_reported && x.priority === null ? 'P4' : x.priority || '';select.name='priority';if(x.priority_reported)select.options[0].disabled=true;
    workControl(select,can(x,'priority'));
    select.addEventListener('change',e=>{e.stopPropagation();if(select.disabled)return;preview(x,{action:'priority',priority:select.value || null});select.value=x.priority_reported && x.priority === null ? 'P4' : x.priority || '';});
    select.addEventListener('click',e=>e.stopPropagation());
    const wrap = add(n('label','plabel'),n('span','',priorityText(x)),n('span','caret','▾'),select); wrap.dataset.p = x.priority || '';
    wrap.title = x.priority === 'P4' || x.priority_reported && x.priority === null ? t('NA: Firstmate handles this when no higher priority work is ready.') : !x.priority ? t('Priority not reported; no scheduling rank is assumed.') : t('Priority');
    return wrap;
  }
  function can(x, action) { if((action==='pause'&&x.pause?.can_pause===false)||(action==='resume'&&x.pause?.can_resume!==true))return false;return !!x.owner_id && !!x.rev && !x.observation_uncertain_since && !!x.source?.available && (x.source.capabilities?.actions || []).includes(action) && app.online; }
  let pauseDescriptionId=0;
  const pauseReading=x=>JSON.stringify([x.state,x.pause,x.rev,x.observation_uncertain_since,x.kind==='task'?null:tasksOf(x).map(y=>[y.id,y.state,y.pause?.can_pause]),x.source?.available,x.source?.capabilities?.actions,app.online]);
  function pauseButton(x) {
    const own=ownPause(x),stopping=isStopping(x),action=own?'resume':'pause',inherited=x.pause?.inherited||[];
    const sources=inherited.map(id=>id==='freeze'?t('the fleet freeze'):label(byId.get(keyOf(x.home,id))||byId.get(id))).join(', ');
    const condition=x.pause?.condition,wait=condition?.reason|| (condition?t('its existing condition'):'');
    const reasons={'no-tasks':'No tasks in this scope.','all-stopped':'All tasks are already stopped or completed.',completed:'This task is completed.',unknown:'Work state is not confirmed.','freeze-removal':'Removing this pause would also lift the fleet freeze for this task.'};
    let explanation=t(reasons[x.pause?.disabled_reason]||'');
    if(inherited.length&&x.pause?.disabled_reason!=='freeze-removal')explanation+=(explanation?' ':'')+t(own?'The pause from {name} will remain.':'Paused by {name}.',{name:sources});
    if(wait)explanation+=(explanation?' ':'')+t(own?'It will still wait for: {reason}':'Waiting for: {reason}',{reason:wait});
    const allowed=can(x,action);
    let text;
    if(stopping){
      text=t('Pausing…');
      explanation=t('Waiting for a safe point.')+(explanation?' '+explanation:'');
    }else if(own){
      text=t(allowed?(inherited.length||condition?'Remove own pause':'Resume'):'Paused');
    }else if(inherited.length||x.state==='paused'){
      text=t('Paused');
      if(!explanation)explanation=t('Pause origin not reported');
    }else if(x.kind!=='task'){
      // Use the same descendant states as the kanban. The ability to set a
      // pause on queued work is not evidence that a group is running.
      const tasks=tasksOf(x),running=tasks.some(y=>y.state==='active'&&!isStopping(y));
      if(x.pause?.disabled_reason==='all-stopped'){
        if(tasks.some(isStopping))explanation=t('A pause is still reaching a safe point.');
        else if(tasks.some(y=>y.state==='unknown'))explanation=t('Work state is not confirmed.');
        else if(tasks.some(y=>y.state==='waiting'))explanation=t('The tasks in this group are still waiting on their existing conditions.');
      }
      if(running)text=t('Pause');
      else if(allowed){
        text=t('Set aside pending work');
        explanation=t('No tasks are running. This prevents pending work from starting.');
      }else text=t(!tasks.length?'No tasks':tasks.some(y=>y.state==='unknown')?'State not confirmed':'No running work');
    }else text=t(x.state==='done'?'Finished':'Pause');
    if(!allowed&&!explanation)explanation=!app.online?t('Offline'):!x.source?.available?t('Firstmate is unavailable.'):t('This action is unavailable.');
    const wrap=n('span','pause-control'),btn=b(text,e=>{e.stopPropagation();if(!btn.disabled)preview(x,{action});},'mix-pause');
    wrap.classList.toggle('pause-context',own||!!explanation);
    wrap.addEventListener('click',e=>e.stopPropagation());
    wrap.dataset.pauseNode=x.id;wrap.pauseReading=pauseReading(x);
    btn.setAttribute('aria-label',t('{action}: {name}',{action:text,name:label(x)}));btn.setAttribute('aria-pressed',String(own));workControl(btn,allowed&&!stopping);wrap.append(btn);
    if(stopping && own){const cancel=b(t('Cancel pause'),e=>{e.stopPropagation();if(!cancel.disabled)preview(x,{action:'resume'});},'mix-pause');cancel.setAttribute('aria-label',t('{action}: {name}',{action:t('Cancel pause'),name:label(x)}));workControl(cancel,can(x,'resume'));wrap.append(cancel);}
    if(explanation){const note=n('span','pause-explanation',explanation);note.id='pause-explanation-'+(++pauseDescriptionId);btn.setAttribute('aria-describedby',note.id);wrap.append(note);if(!allowed||stopping){wrap.tabIndex=0;wrap.setAttribute('role','group');wrap.setAttribute('aria-label',btn.getAttribute('aria-label'));wrap.setAttribute('aria-describedby',note.id);}}
    return wrap;
  }
  function refreshDetailPause(focused) {
    for(const previous of $('detail-content').querySelectorAll('.pause-control[data-pause-node]')){
      const x=byId.get(previous.dataset.pauseNode);if(!x||previous.pauseReading===pauseReading(x))continue;
      const restore=previous.contains(focused),next=pauseButton(x);previous.replaceWith(next);
      if(restore)(next.tabIndex===0?next:next.querySelector('button')).focus({preventScroll:true});
    }
  }
  const progressReading=x=>JSON.stringify([x.progress,x.progress_evidence,x.declared_progress,x.phase,x.observation_uncertain_since && Date.now()/1000-x.observation_uncertain_since>=30]);
  function progress(x, detail=false) {
    const box=n('div','prog'),p=x.progress,e=x.progress_evidence;
    const observationStale=x.observation_uncertain_since && Date.now()/1000-x.observation_uncertain_since >= 30;
    if(x.kind!=='task'&&!p&&!e)return box;
    if(detail&&x.kind==='task'){box.dataset.progressNode=x.id;box.progressReading=progressReading(x);}
    const known=['current','stale','missing','unknown','invalid'];
    let freshness=known.includes(e?.freshness)?e.freshness:'unknown';
    const completed=p?.completed,total=p?.total;
    const measured=Number.isInteger(completed)&&Number.isInteger(total)&&total>0&&completed>=0&&completed<=total;
    const current=freshness==='current'&&e?.current===true;
    if(freshness==='current'&&!current)freshness='unknown';
    else if(current&&!measured)freshness=!p||total===0?'unmeasured':'invalid';
    box.dataset.freshness=observationStale?'stale':freshness;
    if(current&&measured){
      const pct=Math.round(completed/total*100),bar=n('span','prog-bar'),fill=n('i');fill.style.width=pct+'%';bar.append(fill);
      bar.setAttribute('role','progressbar');bar.setAttribute('aria-valuenow',pct);bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-label',t('Reported progress'));box.append(bar,structural(n('span','prog-txt',`${pct}% · ${completed}/${total} ${t('steps')}`)));
    }else{
      const messages={stale:'Progress needs an update.',missing:'No progress declared yet.',unknown:'Progress is not confirmed.',invalid:'The progress declaration is invalid.',unmeasured:'No measured steps yet.'};
      box.append(n('span','prog-txt',t(messages[freshness])));
    }
    if(observationStale)box.append(n('span','prog-txt',t('Out of date')));
    const phases={investigation:'Investigation',implementation:'Implementation',rebase:'Rebasing',validation:'Validation','branch-ready':'Ready for integration',integration:'Integration',activation:'Activation',complete:'Completion stage'};
    if(Object.hasOwn(phases,x.phase))box.append(n('span','prog-phase',t('Phase: {name}',{name:t(phases[x.phase])})));
    const steps=(record,historical)=>{
      const fold=add(n('details'),n('summary','',t(historical?'Last declaration (historical)':'View steps')));
      if(historical){
        fold.append(n('p','fact',t('This is a previous declaration, not current progress.')));
        if(Number.isInteger(record.done)&&Number.isInteger(record.total)&&record.done>=0&&record.total>0&&record.done<=record.total)fold.append(structural(n('p','fact',t('{done} of {total} steps in the last declaration',{done:record.done,total:record.total}))));
        if(record.updated)fold.append(time('Declared',record.updated));
      }
      if(Array.isArray(record.steps)&&record.steps.length){const list=n('ul','steps');for(const step of record.steps){const text=typeof step==='string'?step:step?.label||step?.title;if(typeof text!=='string')continue;const state=typeof step==='object'?step.state:null;const li=n('li','',(state==='done'?'✓ ':state==='active'?'→ ':'○ ')+text);li.dataset.s=state||'unknown';list.append(li);}fold.append(list);}
      return fold;
    };
    if(detail&&current&&measured&&Array.isArray(p.steps)&&p.steps.length)box.append(steps(p,false));
    else if(detail&&(!current||!p)&&x.declared_progress&&typeof x.declared_progress==='object')box.append(steps(x.declared_progress,true));
    return box;
  }
  function refreshDetailProgress(focused) {
    for(const previous of $('detail-content').querySelectorAll('.prog[data-progress-node]')){
      const x=byId.get(previous.dataset.progressNode);
      if(!x||previous.progressReading===progressReading(x))continue;
      // Refresh only this reading. Controls and unsent drafts keep their DOM.
      const next=progress(x,true),fold=previous.querySelector('details'),nextFold=next.querySelector('details');
      if(fold&&nextFold)nextFold.open=fold.open;
      const restoreFocus=previous.contains(focused);
      previous.replaceWith(next);
      if(restoreFocus)next.querySelector('summary')?.focus({preventScroll:true});
    }
  }

  function summary(x) {
    const ts=tasksOf(x).filter(t=>t.state!=='done'), c={active:0,stopping:0,ready:0,waiting:0,paused:0,done:0,unknown:0}; ts.forEach(t=>c[isStopping(t)?'stopping':t.state in c?t.state:'unknown']++);
    const activity=groupActivities.get(x.id),parts=[];
    if(activity?.needs)parts.push(activity.needs===1?t('1 needs you'):t('{count} need you',{count:activity.needs}));
    if(c.stopping)parts.push(t('{count} stopping',{count:c.stopping}));
    if(activity?.now)parts.push(t('{count} in Now',{count:activity.now}));
    if(activity?.queued)parts.push(t('{count} queued',{count:activity.queued}));
    if(activity?.unconfirmed)parts.push(t('{count} unconfirmed',{count:activity.unconfirmed}));
    if(activity?.waiting)parts.push(t('{count} waiting',{count:activity.waiting}));
    if(c.unknown)parts.push(t('State not confirmed'));
    const text=[ts.length===1?t('1 task'):t('{count} tasks',{count:ts.length}),...(parts.length?parts:[c.paused?t(c.paused===ts.length&&ts.every(ownPause)?'Own pauses':'Paused'):t('No running work')])].join(' · ');
    const wrap=n('span','mix-sub'),bar=n('span','minibar');bar.setAttribute('aria-hidden','true');
    for(const [k,count]of Object.entries(c)){if(count){const i=n('i');i.dataset.k=k;i.style.flex=String(count);bar.append(i);}}
    return add(wrap,bar,structural(n('span','mix-pct',text)));
  }
  const originOf=own=>{const origin=own?.question?.origin_task;if(!origin)return null;const recorded=own.question.origin;return byId.get(keyOf(own.home,origin))||(recorded?{...recorded,id:keyOf(own.home,recorded.key||origin),state:recorded.backlog_state==='done'?'done':'unknown'}:null);};
  const questionNode=c=>{const own=byId.get(taskNodeId(c.home,c.task));return originOf(own)||own;};
  const attentionCards = () => app.board?.columns.find(c=>c.id==='captains_call')?.cards || [];
  const allQuestions = () => attentionCards().filter(c=>c.attention_kind!=='action');
  const actions = () => attentionCards().filter(c=>c.attention_kind==='action');
  const questions = () => allQuestions().filter(c=>!c.answered);
  // The board and group signals share these unfiltered memberships. Search,
  // collapsed stacks and a selected scope must not change a group's activity.
  function kanbanRows() {
    const decisions=new Set(attentionCards().map(c=>keyOf(c.home,c.task)));
    const tasks=model.nodes.filter(x=>x.kind==='task'&&!decisions.has(keyOf(x.home,x.task)));
    return {tasks,run:tasks.filter(x=>x.state==='active'&&!isStopping(x)),stopping:tasks.filter(isStopping),
      unconfirmed:tasks.filter(x=>x.state==='unknown'),ready:readyList(),asks:questions(),act:actions()};
  }
  const groupPaused=x=>x.state==='paused'||ownPause(x)||!!x.pause?.inherited?.length;
  function readGroupActivity(lanes) {
    const entries=new Map(),groups=new Map();
    // Highest attention wins for an identity present in more than one list.
    for(const task of lanes.tasks.filter(x=>colOf(x)==='waiting'))entries.set(task.id,[task,'waiting']);
    for(const task of lanes.ready)entries.set(task.id,[task,'queued']);
    for(const task of lanes.unconfirmed)entries.set(task.id,[task,'unconfirmed']);
    for(const task of [...lanes.run,...lanes.stopping])entries.set(task.id,[task,'now']);
    for(const card of [...lanes.asks,...lanes.act]){
      const own=byId.get(taskNodeId(card.home,card.task));
      let task=questionNode(card)||own;
      // A retained origin may no longer have a node in this model. Keep its
      // identity, but use the call's known scope rather than losing activity.
      if(task&&!projectOf(task)){
        const project=card.project?.id;
        const parent=own?.parent||(project?keyOf(card.home,project.startsWith('project:')?project:'project:'+project):'');
        task={...task,parent};
      }
      if(task)entries.set(task.id,[task,'needs']);
    }
    for(const [task,lane] of entries.values()){
      const chain=ancestors(task);
      if(task.state==='paused'||(!isStopping(task)&&chain.some(groupPaused)))continue;
      for(const group of chain.filter(x=>x.kind==='project'||x.kind==='subproject')){
        if(!groups.has(group.id))groups.set(group.id,{needs:0,now:0,waiting:0,queued:0,unconfirmed:0});
        groups.get(group.id)[lane]++;
      }
    }
    return groups;
  }
  function groupRow(x, tree=false, depth=0) {
    const row=setColor(n('div','mix'),x);row.dataset.node=x.id;row.dataset.kind=x.kind==='subproject'?'sub':x.kind;row.dataset.paused=String(ownPause(x));row.dataset.on=String(ui.pin===x.id);row.dataset.filtered=String(ui.scope===x.id);row.style.setProperty('--d',depth);
    const activity=groupActivities.get(x.id);
    row.dataset.activity=activity?.needs?'needs':activity?.now?'now':(activity?.waiting||activity?.queued||activity?.unconfirmed)?'waiting':'none';
    if(row.dataset.activity!=='none'){
      const signal=n('span','group-activity');signal.setAttribute('aria-hidden','true');signal.append(n('i'));row.append(signal);
    }
    const closed=tree?!ui.tree.has(x.id):ui.closed.has(x.id);
    if(tree || x.kind==='project'){const fold=b(closed?'▸':'▾',()=>{const set=tree?ui.tree:ui.closed;if(set.has(x.id))set.delete(x.id);else set.add(x.id);save('deck-closed',[...ui.closed]);render(true,'filter');},'fold-btn');fold.setAttribute('aria-label',t(closed?'Expand {name}':'Collapse {name}',{name:label(x)}));fold.setAttribute('aria-expanded',String(!closed));fold.dataset.control='fold:'+(tree?'tree:':'mixer:')+x.id;row.append(fold);}
    const filterAction=()=>{ui.scope=ui.scope===x.id?'':x.id;ui.pin=ui.focus?x.id:'';ui.selected='';ui.hover='';closeDetail(false);render(true,'filter');announceFocus(ui.pin,label(x));};
    const name=b('',()=>{if(tree)openNode(x,name);else filterAction();},'mix-name');name.setAttribute('aria-pressed',String(ui.scope===x.id));name.title=t('Click to filter tasks. Keep the pointer still to focus.');add(name,n('span','mix-label',label(x)),idBadge(x),summary(x),dates(x));
    if(x.role)name.append(n('span','mix-wait',x.role==='public-fork'?t('Public fork'):x.role==='installed-private'?t('Installed private project'):x.role==='private'?t('Private project'):x.role==='unknown'?t('Visibility not reported'):x.role));
    const deps=model.edges.filter(e=>e.from===x.id&&!e.completed);if(deps.length)name.append(n('span','mix-wait',t('Waits for {name}',{name:deps.map(e=>label(byId.get(e.to))).join(', ')})));
    const detail=b('⋯',()=>openNode(x,detail),'mix-pause');detail.setAttribute('aria-label',t('Details of {name}',{name:label(x)}));
    add(row,name,priority(x),pauseButton(x),detail);row.setAttribute('data-group-action','');row.title=t('Keep the pointer still to focus. Click to filter tasks.');row.addEventListener('click',e=>{if(e.target.closest('button,input,select,a,summary,details,#detail'))return;filterAction();});wireEvents(row,x.id);return row;
  }
  function mixer() {
    const root=$('project-mixer'),projects=model.nodes.filter(x=>x.kind==='project'&&tasksOf(x).some(t=>t.state!=='done')),allExpanded=projects.every(p=>!ui.closed.has(p.id));
    const toggle=b(allExpanded?t('Collapse groups'):t('Expand groups'),()=>{for(const p of projects)allExpanded?ui.closed.add(p.id):ui.closed.delete(p.id);save('deck-closed',[...ui.closed]);render(true,'filter');},'more');toggle.dataset.control='all-groups';toggle.setAttribute('aria-expanded',String(allExpanded));
    const tools=add(n('div','mix-tools'),n('span','',t('Projects')),toggle);const groups=projects.map(project=>{const group=n('div','mix-group');group.append(groupRow(project));if(!ui.closed.has(project.id))for(const sub of model.nodes.filter(x=>x.kind==='subproject'&&x.parent===project.id))group.append(groupRow(sub));return group;});
    root.replaceChildren(tools,...groups);root.dataset.open=String(ui.mixer);
  }
  function tree() {
    const root=$('project-tree'), active=n('div','list tree-list'),empty=add(n('details','source-details'),n('summary','',t('No open tasks')));
    const descend=(x,depth,target)=>{if(x.kind==='task'&&allQuestions().some(c=>c.home===x.home&&c.task===x.task&&c.answered))return;const wrap=n('div','tree-entry');wrap.dataset.depth=depth;const action=x.kind==='task'&&actions().find(c=>c.home===x.home&&c.task===x.task),question=x.kind==='task'&&questions().find(c=>c.home===x.home&&c.task===x.task);wrap.append(action?actionCard(action):question?questionCard(question):x.kind==='task'?taskCard(x):groupRow(x,true,depth));target.append(wrap);if(ui.tree.has(x.id))for(const child of model.nodes.filter(y=>y.parent===x.id))descend(child,depth+1,target);};
    for(const p of model.nodes.filter(x=>x.kind==='project'))descend(p,0,tasksOf(p).some(t=>t.state!=='done')?active:empty);
    for(const x of model.nodes.filter(x=>!x.parent&&x.kind==='task'))descend(x,0,active);root.replaceChildren(active,empty);
  }
  function taskCard(x, turn, list=[]) {
    const card=setColor(n('article','task-card card'+(x.state==='done'?' done-card':'')),x);card.dataset.node=x.id;card.dataset.key=x.card?.key || x.id;card.dataset.state=x.state;card.dataset.open=String(ui.selected===x.id);
    const face=b('',()=>{if(card.hasAttribute('data-dim')&&!ui.pin){clearFocus();return;}openNode(x,face);},'card-open');face.dataset.key=card.dataset.key;face.setAttribute('aria-expanded',String(ui.selected===x.id));face.setAttribute('aria-controls','detail');
    const top=add(n('span','card-top'),turn !== undefined?structural(n('span','turn',String(x.turn || turn+1))):null,n('span','where',pathOf(x)||x.card?.project?.label||t('Project not reported')));
    add(face,top,n('span','title',label(x)),idBadge(x));
    if(x.state==='done'){face.append(time('Completed',x.completed_at));const pending=questions().filter(c=>{const own=byId.get(taskNodeId(c.home,c.task));return own?.question?.origin_task===x.owner_id;});if(pending.length)face.append(structural(n('span','deck-origin',t('Origin delivered · {count} open decisions',{count:pending.length}))));}else{const reason=pauseText(x)||waitingText(x);if(reason){const line=n('span','meta card-line',reason);if(x.reason_time&&reason===x.reason)structural(line,'time');face.append(line);}if(questions().some(c=>questionNode(c)?.id===x.id))face.append(n('span','has-q',t('Has a question for you')));add(face,progress(x),dates(x));}
    const more=add(n('div','card-more'),n('div','card-more-inner'));add(card,face,more);
    if(x.state!=='done'){
      const ctl=add(n('div','card-ctl'),priority(x),pauseButton(x));
      if(turn !== undefined){for(const [delta,text]of [[-1,'▲'],[1,'▼']]){const at=turn+delta,target=list[at],btn=b(t(delta<0?'Move up':'Move down'),e=>{e.stopPropagation();move(x,target,delta<0?'before':'after');},'ib turn-b');btn.setAttribute('aria-label',t(delta<0?'Move {name} up':'Move {name} down',{name:label(x)}));workControl(btn,!!target&&can(x,'move'));ctl.prepend(btn);}card.draggable=!!ui.reordering&&can(x,'move');card.addEventListener('dragstart',e=>{if(ui.busy){e.preventDefault();return;}ui.drag=x.id;e.dataTransfer.setData('text/plain',x.id);});card.addEventListener('dragover',e=>{if(ui.drag&&ui.drag!==x.id){e.preventDefault();card.dataset.over=e.clientY<card.getBoundingClientRect().top+card.offsetHeight/2?'top':'bottom';}});card.addEventListener('dragleave',()=>delete card.dataset.over);card.addEventListener('drop',e=>{e.preventDefault();const moved=byId.get(ui.drag);if(moved)move(moved,x,card.dataset.over==='top'?'before':'after');delete card.dataset.over;ui.drag=null;});card.addEventListener('dragend',()=>{ui.drag=null;document.querySelectorAll('[data-over]').forEach(y=>delete y.dataset.over);});}
      card.append(ctl);
    }
    wireEvents(card,x.id);return card;
  }
  const actionWhere=c=>c.action?.where==='chat'?t('Act in the chat with {name}.',{name:c.owner}):t('Action instructions need confirmation.');
  function actionDetail(c) {
    const action=c.action||{};app.modal={type:'action',key:c.key,home:c.home,task:c.task,reading:JSON.stringify(c.action)};
    const content=$('detail-content');content.replaceChildren(n('p','action-instruction',action.instruction),n('p','fact',actionWhere(c)),n('p','fact',t('This stays here until Firstmate verifies the action is resolved.')));
    const current=byId.get(taskNodeId(c.home,c.task));if(event(current?.created_at))content.append(time('Created',current.created_at));
    if(action.context)content.append(n('p','fact',action.context));
    if(action.error)content.append(n('p','notice error',action.error));
    if(action.link&&host.reportLink)content.append(host.reportLink(action.link,c.key));
    const own=byId.get(taskNodeId(c.home,c.task)),origin=b(t('Go to source task'),()=>revealQuestionOrigin(c),'more');origin.disabled=!canRevealOrigin(own);content.append(origin);
  }
  function actionCard(c) {
    const own=byId.get(taskNodeId(c.home,c.task)),origin=originOf(own),card=setColor(n('article','task-card card action-card'),origin||own||{id:c.key});
    card.dataset.node=own?.id||taskNodeId(c.home,c.task);card.dataset.key=c.key;card.dataset.state=own?.state||'unknown';
    const face=b('',()=>{if(ui.selected===card.dataset.node&&detailOpen()){clearFocus(true);return;}ui.selected=card.dataset.node;ui.pin=ui.focus?ui.selected:'';showDetail(c.title,'',t('Action required'),face);actionDetail(c);highlight();},'card-open');face.dataset.key=c.key;face.setAttribute('aria-controls','detail');face.setAttribute('aria-expanded',String(ui.selected===card.dataset.node&&detailOpen()));
    add(face,n('span','where',t('Action required')),n('span','title',c.title),n('span','action-instruction',c.action?.instruction),n('span','meta',actionWhere(c)),idBadge(own||{}));
    if(event(own?.created_at))face.append(time('Created',own.created_at));
    if(c.action?.error)face.append(n('span','notice error',c.action.error));
    card.append(face,add(n('div','card-more'),n('div','card-more-inner')));wireEvents(card,card.dataset.node);return card;
  }
  function questionCard(c) {
    const x=questionNode(c),own=byId.get(taskNodeId(c.home,c.task)),card=setColor(n('article','task-card card qcard'),x||{id:c.key});card.dataset.node='question:'+c.key;card.dataset.key='question:'+c.key;card.dataset.state=own?.state||'waiting';
    const face=b('',()=>{if(card.hasAttribute('data-dim')&&!ui.pin){clearFocus();return;}if(ui.selected==='question:'+c.key&&detailOpen()){clearFocus(true);return;}ui.selected='question:'+c.key;ui.pin=ui.focus?'question:'+c.key:'';announceFocus(ui.pin,c.title);openCard(c,face);highlight();},'card-open');face.dataset.key='question:'+c.key;face.setAttribute('aria-controls','detail');face.setAttribute('aria-expanded',String(ui.selected==='question:'+c.key));add(face,n('span','title',c.question||c.title),time('Asked',own?.question?.asked || own?.raw?.asked || own?.raw?.question?.asked || c.question_at || (c.time?.label === 'Asked' || c.time?.label === t('Asked') ? c.time : null)));const q=c.question_summary;if(q){if(q.question&&q.question!==(c.question||c.title))face.append(n('span','question',q.question));if(q.context)face.append(n('span','meta question-context',q.context));for(const option of q.options||[])face.append(n('span','question-option','• '+option.label));if(!q.options?.length)face.append(n('span','meta',t('Answer in your own words')));} face.prepend(n('span','where',t('Decision pending')));face.append(idBadge(own||{kind:'task',task:c.task,home:c.home}));if(event(own?.created_at))face.append(time('Created',own.created_at));if(x?.state==='done')face.append(n('span','deck-origin',t('Origin delivered · decision still open')));add(card,face,add(n('div','card-more'),n('div','card-more-inner')));const origin=b(t('Go to source task'),e=>{e.stopPropagation();revealQuestionOrigin(c);},'more');origin.disabled=!canRevealOrigin(own);card.append(origin);wireEvents(card,'question:'+c.key);return card;
  }
  function needs(cards) {
    const groups=new Map();for(const c of cards){const key=projectOf(questionNode(c))?.id || c.project?.id || c.home; if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
    return [...groups].map(([key,list])=>{const open=list.length===1||ui.stacks.has(key)||list.some(c=>ui.selected==='question:'+c.key);const btn=b((projectOf(questionNode(list[0]))?.title||list[0].project?.label||t('Project not reported'))+(list.length>1?' · '+t('{count} questions',{count:list.length})+(open?' ▾':' ▸'):''),()=>{ui.stacks.has(key)?ui.stacks.delete(key):ui.stacks.add(key);render(true,'filter');},'stack-h');if(list.length>1)structural(btn,{kind:'count',suffix:' · '+t('{count} questions',{count:list.length})+(open?' ▾':' ▸')});btn.disabled=list.length===1;btn.dataset.control='questions:'+key;btn.setAttribute('aria-expanded',String(open));return add(n('div','stackq'),btn,...(open?list.map(questionCard):[]));});
  }
  function readyList(){return model.nodes.filter(x=>x.kind==='task'&&x.state==='ready').sort((a,b)=>(a.turn??Infinity)-(b.turn??Infinity));}
  function move(x,target,position) {
    if(!target)return;
    const list=readyList().filter(y=>y.id!==x.id),at=list.findIndex(y=>y.id===target.id)+(position==='after'?1:0);
    list.splice(at,0,x);const neighbors=[list[at-1],list[at+1]].filter(Boolean),fits=neighbors.some(y=>y.priority===x.priority),near=list[at+1]||list[at-1];
    preview(x,{action:'move',target:target.owner_id,position,adopt_priority:!fits&&near?(near.priority?Number(near.priority.slice(1)):near.priority_reported?4:null):null});
  }
  function render(force=false,mode='state') {
    if(!app.board)return;
    const cardSignature=app.board.columns.map(c=>[c.id,c.cards.map(x=>[x.key,x.title,x.question,x.question_summary,x.attention_kind,x.action,x.answered,x.project,host.cardLine(x),host.phaseText(x),x.dependencies,x.time?.epoch,x.time?.date])]);
    const workSignature=app.board.deck?.sources.map(s=>[s.home,s.available,s.error,s.capabilities,s.snapshot?.nodes,s.snapshot?.edges,s.snapshot?.sigue,s.retained_at && Date.now()/1000-s.retained_at>=30,s.snapshot?.nodes?.map(x=>x.observation_uncertain_since && Date.now()/1000-x.observation_uncertain_since>=30)]);
    const signature=JSON.stringify([cardSignature,workSignature,app.board.diagnostics,app.historyRows,app.query,ui.scope,ui.view,ui.column,ui.done,ui.pausedOpen,ui.mixer,[...ui.closed],[...ui.stacks],[...ui.tree],app.online]);
    if(!force&&signature===ui.signature){refreshAges();highlight();return;}ui.signature=signature;
    // A refresh may rebuild rows for unrelated detail/focus changes. Preserve
    // each existing comet's phase, including a paused offscreen instance.
    const activityKey=row=>(row.closest('#project-tree')?'tree:':'mixer:')+row.dataset.node;
    const activityTimes=new Map([...document.querySelectorAll('.mix[data-activity]')].flatMap(row=>{
      const at=row.querySelector('.group-activity>i')?.getAnimations()[0]?.currentTime;
      return Number.isFinite(at)?[[activityKey(row),{lane:row.dataset.activity,at}]]:[];
    }));
    const detailPosition=detailOpen()?{left:window.scrollX,top:window.scrollY}:null;
    const movement=motion.capture(ui.nextRenderMode|| (ui.renderedQuery!==app.query?'filter':mode));ui.nextRenderMode='';ui.renderedQuery=app.query;
    cancelHover();
    const focused=document.activeElement,focusNode=focused?.closest('[data-node]')?.dataset.node,focusLabel=focused?.getAttribute('aria-label'),focusKey=focused?.dataset.key,focusId=focused?.id,focusControl=focused?.dataset.control;
    const focusedInDetail=$('detail').contains(focused);
    const detailScroll=detailOpen()?[...$('detail-content').querySelectorAll('*')]
      .filter(el=>el.matches('textarea,select')||el.scrollLeft||el.scrollTop).map(el=>[el,el.scrollLeft,el.scrollTop]):[];
    model=normalize(app.board);assignHues();
    const actionOwner=app.modal?.type==='action'?byId.get(taskNodeId(app.modal.home,app.modal.task)):null;
    if(actionOwner?.source?.available&&actionOwner.question?.open===false){closeDetail(false);ui.selected='';ui.pin='';}
    if(!ui.initialized&&!app.board.loading){ui.initialized=true;model.nodes.filter(x=>x.kind==='project').forEach(p=>{if(!ui.hasClosedPreference&&!tasksOf(p).some(t=>['active','stopping'].includes(t.state)||questions().some(q=>taskNodeId(q.home,q.task)===t.id)))ui.closed.add(p.id);});}
    const lanes=kanbanRows();groupActivities=readGroupActivity(lanes);
    const attentionVisible=c=>{const x=byId.get(taskNodeId(c.home,c.task));return x?visible(x):!ui.scope;};
    const ts=lanes.tasks.filter(visible),run=lanes.run.filter(visible),stopping=lanes.stopping.filter(visible),unconfirmed=lanes.unconfirmed.filter(visible),ready=lanes.ready.filter(visible),asks=lanes.asks.filter(attentionVisible),act=lanes.act.filter(attentionVisible);
    const sorted=k=>ts.filter(x=>colOf(x)===k).sort((a,b)=>(priorities.findIndex(p=>p[0]===(b.priority||'')))-(priorities.findIndex(p=>p[0]===(a.priority||''))));
    const done=ts.filter(x=>x.state==='done').sort((a,b)=>(event(b.completed_at)?.epoch||Date.parse(event(b.completed_at)?.date||'')/1000||0)-(event(a.completed_at)?.epoch||Date.parse(event(a.completed_at)?.date||'')/1000||0));
    const doneShown=[...done.slice(0,8),...done.slice(8).filter(x=>model.edges.some(e=>e.to===x.id&&byId.get(e.from)?.state!=='done'))];
    if(!ui.column)ui.column=asks.length||act.length ? 'needs' : 'now';
    const uncertain=ts.some(x=>x.state==='unknown')||(app.board.sources||[]).some(x=>x.error);
    const lead=[act.length===1?t('1 action requires attention.'):act.length?t('{count} actions require attention.',{count:act.length}):'',asks.length===1?t('1 decision needs you.'):asks.length?t('{count} decisions need you',{count:asks.length}):'',run.length===1?t('Firstmate has 1 task in progress.'):run.length?t('Firstmate has {count} tasks in progress.',{count:run.length}):uncertain?t('State not confirmed'):t('Firstmate has nothing in progress.')].filter(Boolean);
    $('deck-lead').replaceChildren(...(ui.scope?[n('span','',label(byId.get(ui.scope))+': ')]:[]),...lead.flatMap((text,i)=>[i?' ':'',structural(n('span','',text))]));$('deck-next').textContent=ready[0]?t('Next is {name}',{name:label(ready[0])}):t('Nothing is ready to follow.');
    $('overview').textContent='';
    const diagnostics=$('deck-diagnostics');diagnostics.replaceChildren(...(app.board.diagnostics||[]).map(d=>add(n('div','deck-diagnostic'),n('strong','',t('Inventory needs attention')),n('p','',d.owner+' · '+d.message))));diagnostics.hidden=!diagnostics.children.length;
    const counts={needs:asks.length+act.length,now:run.length+stopping.length,waiting:sorted('waiting').length,paused:sorted('paused').length,done:done.length};
    const columns=[['needs',t('Needs you')],['now',t('Now')],['waiting',t('Waiting')],['paused',t('Paused')],['done',t('Finished')]];
    $('columns-nav').className='mtabs';$('columns-nav').setAttribute('role','tablist');$('columns-nav').replaceChildren(...columns.map(([id,title])=>{const btn=b('',()=>{ui.column=id;render(true,'filter');});btn.setAttribute('role','tab');btn.id='state-tab-'+id;btn.tabIndex=ui.column===id?0:-1;btn.setAttribute('aria-controls','state-column-'+id);btn.dataset.kind=id;btn.setAttribute('aria-selected',String(ui.column===id));add(btn,structural(n('b','',String(counts[id]))),title);return btn;}));
    const detail=$('detail'),wasOpen=detailOpen();parkDetail();
    mixer();tree();
    const board=$('board');board.dataset.done=ui.done?'open':'closed';board.dataset.paused=ui.pausedOpen?'open':'closed';board.replaceChildren();
    for(const [id,title]of columns){const section=n('section','col');section.id='state-column-'+id;section.setAttribute('role','tabpanel');section.setAttribute('aria-labelledby','state-tab-'+id);section.dataset.k=id;section.dataset.on=String(ui.column===id);section.setAttribute('aria-label',title);const head=add(n('div','col-h'),n('span','sdot'),n('h2','',title),structural(n('span','n',String(counts[id]))));head.firstChild.dataset.k=id;
      if(id==='paused'&&!ui.pausedOpen&&!matchMedia('(max-width:640px)').matches){section.classList.add('rail');const rail=add(b('',()=>{ui.pausedOpen=true;save('deck-paused-open',true);render(true,'filter');},'rail-btn'),structural(n('span','n',String(counts.paused))),n('span','rail-t',title));rail.dataset.control='paused-toggle';rail.setAttribute('aria-label',t('Show paused'));rail.setAttribute('aria-expanded','false');section.append(rail);board.append(section);continue;}
      if(id==='done'&&!ui.done&&!matchMedia('(max-width:640px)').matches){section.classList.add('rail');const rail=add(b('',()=>{ui.done=true;save('deck-done',true);render(true,'filter');},'rail-btn'),structural(n('span','n',String(counts.done))),n('span','rail-t',title));rail.dataset.control='finished-toggle';rail.setAttribute('aria-label',t('Show finished'));rail.setAttribute('aria-expanded','false');section.append(rail);board.append(section);continue;}
      if(id==='paused'){const hide=b('»',()=>{ui.pausedOpen=false;save('deck-paused-open',false);render(true,'filter');},'hide-col');hide.dataset.control='paused-toggle';hide.setAttribute('aria-label',t('Hide paused'));hide.setAttribute('aria-expanded','true');head.append(hide);}
      if(id==='done'){const hide=b('»',()=>{ui.done=false;save('deck-done',false);render(true,'filter');},'hide-col');hide.dataset.control='finished-toggle';hide.setAttribute('aria-label',t('Hide finished'));hide.setAttribute('aria-expanded','true');head.append(hide);}
      const cards=n('div','cards');if(id==='needs')cards.append(...act.map(actionCard),...needs(asks));else if(id==='now'){for(const [title,list,turns]of [[t('In progress'),run,false],...(stopping.length?[[t('Stopping'),stopping,false]]:[]),[t('Follow'),ready,true],...(unconfirmed.length?[[t('State not confirmed'),unconfirmed,false]]:[])]){const sub=add(n('div','subcol'),add(n('div','sub-h'),n('h3','',title),turns?n('span','dates',t('in this order')):null,structural(n('span','n',String(list.length)))));if(turns){const reorder=b(ui.reordering?t('Done editing'):t('Change order'),()=>{ui.reordering=!ui.reordering;document.documentElement.dataset.reordering=String(ui.reordering);render(true,'filter');},'more');sub.firstChild.append(reorder);}sub.append(...list.map((x,i)=>taskCard(x,turns?i:undefined,list)));if(!list.length)sub.append(n('p','none',t('Nothing here.')));cards.append(sub);}}
      else cards.append(...(id==='done'?doneShown:sorted(id)).map(x=>taskCard(x)));
      if(!cards.children.length)cards.append(n('p','none',t(id==='needs'?'Nothing needs you right now.':'Nothing here.')));if(id==='done')cards.append(b(t('View all history'),()=>host.setView('history'),'more'));
      add(section,head,cards);board.append(section);
    }
    if(wasOpen){const face=[...document.querySelectorAll('.card-open')].find(y=>y.dataset.key===app.openerKey && y.getClientRects().length);if(face){app.opener=face;host.placeDetail(face);face.setAttribute('aria-expanded','true');face.closest('.task-card').dataset.open='true';}else if(ui.selected&&byId.has(ui.selected)){const group=[...document.querySelectorAll('[data-node]')].find(y=>y.dataset.node===ui.selected && y.getClientRects().length);if(group){group.append(detail);detail.hidden=false;$('detail-panel').dataset.active='false';}}}
    if(wasOpen){refreshDetailProgress(focused);refreshDetailPause(focused);if(app.modal?.type==='action'){const current=actions().find(c=>c.key===app.modal.key);if(current&&JSON.stringify(current.action)!==app.modal.reading)actionDetail(current);}}
    if(focusNode&&focusLabel&&!document.contains(focused)){const el=[...document.querySelectorAll('[data-node]')].filter(y=>y.dataset.node===focusNode&&y.getClientRects().length).flatMap(y=>[...y.querySelectorAll('[aria-label]')]).find(y=>y.getAttribute('aria-label')===focusLabel);el?.focus({preventScroll:true});}
    if(focused?.isConnected && document.activeElement!==focused && (focused.matches('input,textarea,select')||wasOpen&&focusedInDetail))focused.focus({preventScroll:true});
    else if(focusKey && !focused.isConnected){const face=[...document.querySelectorAll('.card-open')].find(x=>x.dataset.key===focusKey && x.getClientRects().length);face?.focus({preventScroll:true});}
    if(!focused?.isConnected){const target=focusId?$(focusId):focusControl?[...document.querySelectorAll('[data-control]')].find(x=>x.dataset.control===focusControl&&x.getClientRects().length):null;target?.focus({preventScroll:true});}
    if(wasOpen)for(const [el,left,top]of detailScroll)if(el.isConnected){el.scrollLeft=left;el.scrollTop=top;}
    $('focus-effects').checked=ui.focus;motion.play(movement,wasOpen?detail:null);host.refreshTimes();host.sourceStatus();renderLog();
    activityObserver.disconnect();for(const row of document.querySelectorAll('.mix[data-activity]:not([data-activity=none])')){
      const previous=activityTimes.get(activityKey(row)),animation=row.querySelector('.group-activity>i').getAnimations()[0];
      if(animation&&previous?.lane===row.dataset.activity)animation.currentTime=previous.at;
      activityObserver.observe(row);
    }
    if(wasOpen&&detailPosition)window.scrollTo(detailPosition.left,detailPosition.top);
  }
  async function openNode(x,opener) {
    cancelHover();
    if(ui.selected===x.id&&detailOpen()){clearFocus(true);return;}
    ui.selected=x.id;ui.pin=ui.focus?x.id:'';ui.hover='';announceFocus(ui.pin,label(x));
    if(x.state==='done'&&(x.question?.call||x.raw?.pause?.own?.kind==='captain')&&!app.historyRows?.some(r=>r.home===x.home&&r.task===x.task)&&x.card?.bucket!=='landed'){
      showDetail(label(x),'',t('Question closed'),opener);app.modal={type:'completed-call',node:x.id};
      const content=$('detail-content');content.replaceChildren(time('Completed',x.completed_at),n('p','question',x.question?.call?.question||x.reason||label(x)),n('p','fact',t('Question closed')),b(t('See answer status'),host.showAnswers));
      const list=n('ul');for(const edge of model.edges.filter(e=>e.from===x.id)){const other=byId.get(edge.to);const link=b(label(other),()=>{if(other)reveal(other);},'link');link.disabled=!other;list.append(add(n('li'),link,n('span','meta',edge.completed?t('Completed blocker'):t('Waits for this'))));}if(list.children.length)content.append(add(n('section','deps'),n('h3','',t('Dependencies')),list));
    }else if(x.state==='done'&&x.home){await host.openDelivery(x.home,x.task,opener);}
    else if(x.card){await openCard(x.card,opener,true);if(!detailOpen())return;if(x.state!=='done')decorate(x);}
    else{showDetail(label(x),'',kinds[x.kind],opener);app.modal={type:'control',node:x.id};const content=$('detail-content');content.replaceChildren(dates(x),summary(x),progress(x,true));const slot=opener.closest('.mix') || opener.closest('.task-card');if(slot){slot.append($('detail'));$('detail').hidden=false;$('detail-panel').dataset.active='false';}decorate(x);}
    if(detailOpen())reviewObject(x);
    highlight();
  }
  function decorate(x) {
    const previous=$('detail-content').querySelector('.deck-controls'),controls=n('section','deck-controls deck-simple');
    reviewObject(x);
    controls.setAttribute('aria-label',t('Work actions'));
    if(x.kind==='task')controls.append(time('Created',x.created_at));
    const main=add(n('div','deck-action-row'),n('span','fact',t('Priority')),priority(x),pauseButton(x));controls.append(main);
    controls.append(progress(x,true));
    const deps=model.edges.filter(e=>ancestors(x).some(a=>a.id===e.from));
    if(deps.length){const fold=n('details','source-details');fold.append(structural(n('summary','',t('Waits for {count} tasks',{count:deps.length}))));const list=n('ul','deps');for(const edge of deps){const other=byId.get(edge.to);list.append(add(n('li'),b(label(other),()=>{if(other)reveal(other);},'link'),edge.completed?n('span','meta',t('Already completed')):null));}fold.append(list);controls.append(fold);}
    const more=n('details','source-details deck-more');more.append(n('summary','',t('More options')),n('p','fact',t('Review dependencies or discuss a possible removal.')));
    const dep=n('select');dep.name='dependency';dep.setAttribute('aria-label',t('Dependency'));dep.append(new Option(t('Choose a dependency'),''));for(const y of model.nodes.filter(y=>y.home===x.home&&y.id!==x.id&&y.owner_id))dep.append(new Option(kinds[y.kind]+': '+label(y),y.owner_id));
    const edit=b(t('Preview dependency'),()=>{if(dep.value)preview(x,{action:'dependency-add',target:dep.value});});workControl(edit,can(x,'dependency-add'));
    more.append(dep,edit);
    if(x.root_blocker){const blocker=byId.get(keyOf(x.home,x.root_blocker));more.append(n('p','fact',t('Root blocker')+': '+label(blocker)));}
    if(Number.isInteger(x.frees?.chain_count))more.append(structural(n('p','fact',t('Releases {count} tasks in the chain',{count:x.frees.chain_count}))));
    more.append(n('p','fact',t('Scheduling priorities')+': '+ancestors(x).map(y=>kinds[y.kind]+': '+priorityText(y)).join(' › ')));
    for(const edge of deps){const remove=b(t('Remove dependency'),()=>preview(x,{action:'dependency-remove',target:byId.get(edge.to)?.owner_id}));workControl(remove,can(x,'dependency-remove'));more.append(add(n('div','dep-row'),n('span','',label(byId.get(edge.to))),remove));}controls.append(more);if(previous)previous.replaceWith(controls);else $('detail-content').append(controls);
  }
  function reviewObject(x) {
    if(!x)return;const content=$('detail-content'),previous=content.querySelector('.deck-object-tools');
    // Re-decoration must not replace a focused comment or another detail draft.
    if(previous?.dataset.node===x.id){previous.refreshRemoval();return;}
    previous?.remove();
    const box=n('section','deck-object-tools'),id=objectId(x),status=n('p','fact');box.dataset.node=x.id;status.setAttribute('role','status');
    const copy=b(t('Copy ID'),async()=>{try{await navigator.clipboard.writeText(id);status.textContent=t('ID copied: {id}',{id});}catch{status.textContent=t('Select and copy this ID: {id}',{id});}},'more');copy.disabled=!id;
    box.append(add(n('div','deck-object-id-row'),idBadge(x),copy),status);
    const panel=n('section','deck-removal-panel');panel.setAttribute('aria-label',t('Removal consultation'));
    const reason=n('textarea');reason.name='removal-reason';reason.maxLength=2000;reason.rows=2;reason.placeholder=t('Why are you considering removing it? (optional)');reason.setAttribute('aria-label',t('Reason for considering removal'));
    const current=()=>byId.get(x.id)||x;
    const refresh=()=>workControl(send,can(current(),'scope-removal')&&!ui.log.some(entry=>entry.home===x.home&&entry.command?.node===x.owner_id&&entry.command.action==='scope-removal'&&entry.command.reason===reason.value.trim()&&['pending','received','applied','uncertain'].includes(entry.state)));
    const send=b(t('Discuss removal'),async()=>{await preview(current(),{action:'scope-removal',reason:reason.value.trim()});refresh();},'deck-removal-send');
    box.refreshRemoval=refresh;reason.addEventListener('input',refresh);refresh();
    panel.append(send,reason);box.append(panel);if(app.modal?.type==='call')content.append(box);else content.prepend(box);
  }
  function reveal(x) {
    ui.scope='';ui.view='board';ui.column=colOf(x);host.setView('board');render(true,'filter');
    const el=[...document.querySelectorAll('[data-node]')].find(y=>y.dataset.node===x.id && y.getClientRects().length);if(el){el.scrollIntoView({block:'nearest'});const opener=el.querySelector('.card-open,.mix-name');if(opener)openNode(x,opener);}
  }
  function renderImpact(value) {
    const box=n('div','impact');
    if(typeof value==='string')box.append(n('p','fact',value));
    else if(value){
      if(value.message)box.append(n('p','fact',value.message));
      const groups = [['running',t('Running tasks')],['queued',t('Queued tasks')],['waiting_behind',t('Blocked descendants')]];
      for(const [key,title]of groups){const ids=value.affected?.[key] || [];box.append(structural(n('h4','',title+' · '+ids.length)));if(ids.length){const list=n('ul');for(const id of ids)list.append(n('li','',label(model.nodes.find(x=>x.owner_id===(id.id||id)))));box.append(list);}}
      if(Array.isArray(value.still_paused)){box.append(structural(n('h4','',t('Keep their own pauses')+' · '+value.still_paused.length)));for(const id of value.still_paused)box.append(n('p','',label(model.nodes.find(x=>x.owner_id===id))));}
      if(Array.isArray(value.sigue_after)){const list=n('ol');value.sigue_after.forEach(id=>list.append(n('li','',label(model.nodes.find(x=>x.owner_id===id)))));box.append(add(n('details'),n('summary','',t('Order after this change')),list));}
      if(value.offer){const offer=model.nodes.find(x=>x.owner_id===value.offer.target);if(offer)box.append(b(value.offer.why || t('Pause {name}',{name:label(offer)}),()=>preview(offer,{action:'pause'})));}
    }else box.append(n('p','fact',t('Impact not reported. The change cannot be confirmed.')));
    return box;
  }
  async function preview(x,command) {

    if(ui.busy)return;
    const seq=++ui.generation;ui.busy=true;pending(true);
    const previewSlot=n('section','change-preview');previewSlot.setAttribute('role','status');previewSlot.append(n('p','',t('Checking impact with Firstmate…')));
    const reviewing=command.action==='scope-removal'&&$('detail-content').querySelector('.deck-object-tools')?.dataset.node===x.id;
    if(!detailOpen() || (ui.selected!==x.id&&!reviewing))await openNode(x,[...document.querySelectorAll('[data-node]')].find(y=>y.dataset.node===x.id)?.querySelector('button'));
    $('detail-content').querySelector('.change-preview')?.remove();$('detail-content').append(previewSlot);
    const request={...command,node:x.owner_id,revision:x.rev,request_id:crypto.randomUUID().replaceAll('-','')};
    try {
      const result=await api('api/control/'+encodeURIComponent(x.home)+'/preview',request);
      if(seq!==ui.generation||!previewSlot.isConnected)return;
      previewSlot.replaceChildren(n('h3','',t('Impact preview')));if(result.impact)previewSlot.append(renderImpact(result.impact));
      if(result.error || result.allowed===false || ['rejected','conflict','failed'].includes(result.state) || result.code || (result.cycle_path||result.impact?.cycle_path)?.length){add(previewSlot,n('p','error',result.message||result.error),(result.cycle || result.cycle_path || result.impact?.cycle_path)?n('p','',t('Cycle')+': '+(result.cycle || result.cycle_path || result.impact.cycle_path).map(id=>label(model.nodes.find(x=>x.owner_id===id))).join(' → ')):null);if(result.code==='stale_revision')previewSlot.append(b(t('Review current data'),async()=>{ui.busy=false;await host.poll();const current=byId.get(x.id);ui.selected='';if(current){const face=[...document.querySelectorAll('[data-node]')].find(el=>el.dataset.node===x.id&&el.getClientRects().length)?.querySelector('.card-open,.mix-name');if(face)openNode(current,face);}}));return;}
      if(!result.impact)previewSlot.append(renderImpact(null));
      if(command.action==='scope-removal'){ui.busy=false;await apply(x,{...request,preview:result.token || result.preview_token},previewSlot);return;}
      if(command.action!=='dependency-add' && result.impact){ui.busy=false;await apply(x,request,previewSlot);return;}
      const confirm=b(t('Confirm change'),()=>apply(x,{...request,preview:result.token || result.preview_token},previewSlot));
      workControl(confirm,!!result.impact);add(previewSlot,confirm,b(t('Cancel'),()=>previewSlot.remove()));
    } catch(err){previewSlot.replaceChildren(n('p','notice error',err.message));}
    finally{ui.busy=false;pending(false);}
  }
  async function apply(x,request,slot) {
    if(ui.busy||!x)return;ui.busy=true;pending(true);
    const existing=ui.log.find(e=>e.home===x.home&&e.request_id===request.request_id);
    const entry=existing||{home:x.home,request_id:request.request_id,title:label(x),command:request};Object.assign(entry,{state:'pending',code:null,message:t('Requested')});if(!existing)ui.log.unshift(entry);renderLog();
    slot.replaceChildren(n('p','',t('Requested')));
    try{const result=await api('api/control/'+encodeURIComponent(x.home)+'/apply',request);Object.assign(entry,result,{request_id:request.request_id});slot.replaceChildren(n('p','fact',receiptLabel(entry)),receiptReply(entry),renderImpact(entry.impact));if(entry.undo&&request.action!=='scope-removal')slot.append(b(t('Undo'),()=>undo(entry)));
    }catch(err){entry.state=err.retry?'uncertain':'error';entry.message=err.message;slot.replaceChildren(n('p','notice error',err.message));}
    finally{renderLog();await host.poll();const current=byId.get(ui.selected);if(request.action!=='scope-removal'&&current&&detailOpen()&&$('detail-content').querySelector('.deck-controls'))decorate(current);ui.busy=false;pending(false);renderLog();}
  }
  async function undo(entry){const x=model.nodes.find(x=>x.home===entry.home&&x.owner_id===entry.command.node);if(x&&entry.undo)preview(x,{action:'undo',undo_operation:entry.undo});}
  function receiptReply(entry){const body=entry.command?.action==='scope-removal'&&entry.consultation?.status==='replied'?entry.consultation.reply?.body:'';return n('p','deck-consultation-reply',typeof body==='string'?body:'');}
  function receiptLabel(entry){
    if(entry.command?.action==='scope-removal'&&entry.consultation?.status==='replied')return t('Firstmate replied. Removing work still requires your separate approval.');
    if(entry.command?.action==='scope-removal'&&['applied','received'].includes(entry.state))return t('Consultation recorded. Firstmate must review the impact before any removal.');
    return entry.message||t({pending:'Requested',received:'Received',applied:'Applied',error:'Error',uncertain:'Receipt not confirmed',rejected:'Rejected',conflict:'Changed before applying',failed:'Could not apply'}[entry.state]||'Requested');
  }
  function renderLog() {
    try{sessionStorage.setItem('deck-control-receipts',JSON.stringify(ui.log.slice(0,100)));}catch{/* Receipt status remains in memory. */}
    structural($('changes-toggle'));$('changes-toggle').hidden=!ui.log.length;$('changes-toggle').textContent=t('Changes')+' '+ui.log.length;
    $('change-log').hidden=!ui.log.length;
    $('change-results').replaceChildren(...ui.log.map(entry=>{const row=add(n('div','change-row'),n('strong','',entry.title),n('span','',entry.command?.action==='scope-removal'&&entry.consultation?.status==='replied'?t('Firstmate replied'):t({pending:'Requested',received:'Received',applied:'Applied',error:'Error',uncertain:'Receipt not confirmed',rejected:'Rejected',conflict:'Changed before applying',failed:'Could not apply'}[entry.state]||'Requested')),n('p','fact',receiptLabel(entry)),receiptReply(entry),n('p','receipt-read-error',entry.receiptError||''));
      if(entry.undo&&entry.command.action!=='scope-removal')row.append(workControl(b(t('Undo'),()=>undo(entry)),true));if(entry.code==='busy')row.append(b(t('Try again'),()=>{const x=model.nodes.find(x=>x.home===entry.home&&x.owner_id===entry.command.node);if(x)apply(x,entry.command,$('change-results'));}));if(!['applied','error','rejected','conflict','failed'].includes(entry.state))row.append(b(t('Check receipt'),()=>checkReceipt(entry)));return row;}));
  }
  async function checkReceipt(entry){if(entry.reading)return;entry.reading=true;try{const result=await api('api/control/'+encodeURIComponent(entry.home)+'/receipt?request_id='+encodeURIComponent(entry.request_id));Object.assign(entry,result);delete entry.receiptError;renderLog();host.poll();}catch(err){entry.receiptError=err.message;renderLog();}finally{delete entry.reading;}}
  function wireEvents(el,id) {
    const group=()=>{const x=byId.get(id);return x&&['project','subproject'].includes(x.kind)?x:null;};
    const keep=()=>{
      if(!ui.focus)return true;const x=byId.get(id),isGroup=x&&['project','subproject'].includes(x.kind),isTask=x?.kind==='task'||id.startsWith('question:');if(!isGroup&&!isTask)return false;
      const current=byId.get(ui.pin);if(isTask&&current&&['project','subproject'].includes(current.kind))return true;
      const changed=ui.pin!==id;ui.pin=id;ui.hover='';if(changed)ui.selected='';highlight();announceFocus(id,x?label(x):el.querySelector('.title')?.textContent||t('Task relationships'));return true;
    };
    let point=null;
    const schedule=()=>{cancelHover();hoverTarget=el;hoverTimer=setTimeout(()=>{hoverTimer=0;if(hoverTarget!==el||!el.isConnected||!ui.focus)return;hoverTarget=null;if(!keep()){ui.hover=id;highlight();}},ui.hoverDelay*1000);};
    el.addEventListener('pointerenter',event=>{if(!ui.focus)return;const moved=!lastHoverPoint||Math.abs(event.clientX-lastHoverPoint.x)+Math.abs(event.clientY-lastHoverPoint.y)>.5;if(!moved)return;const hovering=event.pointerType==='mouse'||event.pointerType==='pen'||matchMedia('(hover:hover)').matches;if(hovering&&matchMedia('(min-width:641px)').matches){point={x:event.clientX,y:event.clientY};schedule();}});
    el.addEventListener('pointermove',event=>{if(hoverTarget!==el||!point)return;if(Math.abs(event.clientX-point.x)+Math.abs(event.clientY-point.y)>.5){point={x:event.clientX,y:event.clientY};schedule();}});
    el.addEventListener('pointerleave',()=>{if(hoverTarget===el)cancelHover();point=null;ui.hover='';highlight();});
    el.addEventListener('focusin',()=>{if(keyboardFocus&&ui.focus&&group()){cancelHover();keep();}});
  }
  function canRevealOrigin(own){const origin=originOf(own);return !!origin&&(byId.has(origin.id)||origin.available===true&&origin.state==='done');}
  function revealQuestionOrigin(c){const own=byId.get(taskNodeId(c.home,c.task)),origin=originOf(own);if(origin&&byId.has(origin.id)){ui.selected='';reveal(origin);}else if(origin?.available===true&&origin.state==='done'&&origin.key){host.openDelivery(c.home,origin.key.replace(/^task:/,''));}}
  function relationshipEdges() {
    // Dependency records still name the real question task. Route their
    // visible endpoint to its question card, without inventing a work node.
    const calls=questions(),endpoints=new Map(calls.map(c=>[taskNodeId(c.home,c.task),'question:'+c.key]));
    const edges=model.edges.map(e=>({...e,from:endpoints.get(e.from)||e.from,to:endpoints.get(e.to)||e.to}));
    for(const c of calls){const own=byId.get(taskNodeId(c.home,c.task)),origin=own?.question?.origin_task || c.question_origin,question='question:'+c.key,source=origin?keyOf(c.home,origin):'';if(source&&!edges.some(e=>e.from===source&&e.to===question||e.from===question&&e.to===source))edges.push({from:question,to:source,question:true});}
    return edges;
  }
  function highlight() {
    if(!ui.focus){ui.pin='';ui.hover='';for(const el of document.querySelectorAll('[data-node]')){delete el.dataset.dim;delete el.dataset.link;if(el.classList.contains('mix'))el.dataset.on='false';}document.querySelectorAll('.relation-role').forEach(el=>el.remove());document.querySelector('svg.links')?.remove();$('connector-key').hidden=true;announceFocus('');return;}
    if(motion.animating)return;
    for(const row of document.querySelectorAll('.mix[data-node]')){row.dataset.on=String(ui.pin===row.dataset.node);delete row.dataset.preview;}
    const focus=ui.pin||ui.selected||ui.hover, center=byId.get(focus), members=new Set(center&&center.kind!=='task'?model.nodes.filter(y=>ancestors(y).some(z=>z.id===center.id)).map(x=>x.id):[focus]);
    const inherited=center?.kind==='task'?model.edges.filter(e=>e.from!==center.id&&ancestors(center).some(x=>x.id===e.from)).map(e=>({...e,from:center.id,inherited_from:e.from})):[];
    const edges=[...relationshipEdges(),...inherited].filter(e=>members.has(e.from)||members.has(e.to));
    document.querySelectorAll('.relation-role').forEach(el=>el.remove());const related=new Set([...members,...edges.flatMap(e=>[e.from,e.to])]);
    for(const el of document.querySelectorAll('[data-node]')){delete el.dataset.link;delete el.dataset.dim;if(focus&&(edges.length||ui.pin)){if(related.has(el.dataset.node)){el.dataset.link='true';const edge=edges.find(e=>e.from===el.dataset.node||e.to===el.dataset.node);if(edge&&!members.has(el.dataset.node)){const text=edge.question?t(edge.from===el.dataset.node?'Question from this task':'Task asking this question'):edge.completed?t(edge.to===el.dataset.node?'Already released this':'Released by this'):t(edge.to===el.dataset.node?'Blocks this':'Waits for this');el.querySelector('.card-open,.mix-name')?.append(n('span','relation-role',text));}}else if(ui.focus)el.dataset.dim='true';}}
    $('connector-key').hidden=!edges.length;$('connector-key').replaceChildren(...[[t('Blocks this'),'k-before'],[t('Waits for this'),'k-after'],[t('Question from this task'),'k-ask'],[t('Already released this'),'k-freed']].map(([s,c])=>n('span',c,'— '+s)));
    document.querySelector('svg.links')?.remove();if(!edges.length||matchMedia('(max-width:640px)').matches){return;}
    const root=$('workspace');const find=id=>[...document.querySelectorAll('[data-node]')].find(el=>el.dataset.node===id&&el.getBoundingClientRect().width&&el.getBoundingClientRect().height&&!el.closest('[hidden]'));
    window.routeDeckRelations({edges,members,focus,root,find,label:id=>id.startsWith('question:')?(questions().find(c=>'question:'+c.key===id)?.question||questions().find(c=>'question:'+c.key===id)?.title||t('Decision pending')):label(byId.get(id)),t,motion});
  }
  function clearFocus(keepPin=false){cancelHover();if(!keepPin){ui.pin='';announceFocus('');}ui.selected='';ui.hover='';closeDetail();highlight();}
  $('projects-toggle').addEventListener('click',()=>{ui.mixer=!ui.mixer;$('projects-toggle').setAttribute('aria-expanded',String(ui.mixer));render(true,'filter');});
  const delayInput=$('focus-delay');delayInput.value=String(ui.hoverDelay);delayInput.disabled=!ui.focus;
  delayInput.addEventListener('change',()=>{const value=Number(delayInput.value);if(!Number.isFinite(value)){delayInput.value=String(ui.hoverDelay);return;}ui.hoverDelay=Math.max(0,Math.min(10,value));delayInput.value=String(ui.hoverDelay);save('deck-hover-delay',ui.hoverDelay);cancelHover();});
  $('focus-effects').checked=ui.focus;$('focus-effects').addEventListener('change',()=>{cancelHover();ui.focus=$('focus-effects').checked;delayInput.disabled=!ui.focus;if(!ui.focus){ui.pin='';ui.hover='';}save('deck-focus',ui.focus);highlight();announceFocus(ui.pin,ui.pin?label(byId.get(ui.pin)):'');});
  $('changes-toggle').addEventListener('click',()=>{$('change-log').open=!$('change-log').open;$('change-log').scrollIntoView({block:'nearest'});});
  document.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tab=e.target.closest('[role=tab]');if(!tab)return;const tabs=[...tab.parentElement.querySelectorAll('[role=tab]')];let at=tabs.indexOf(tab);at=e.key==='Home'?0:e.key==='End'?tabs.length-1:(at+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;e.preventDefault();tabs[at].focus();tabs[at].click();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){ui.pin='';announceFocus('');ui.selected='';ui.hover='';highlight();}});
  document.addEventListener('pointerdown',e=>{if(e.target.closest('.deck,#board')&&!e.target.closest('[data-node],#detail,button,input,select,summary')){ui.pin='';announceFocus('');ui.selected='';ui.hover='';highlight();}});
  window.addEventListener('resize',()=>{render(true,'filter');});document.addEventListener('scroll',highlight,true);document.addEventListener('transitionend',e=>{if(e.target.classList.contains('card-more'))highlight();});
  return {showAction(c){$('detail-kicker').textContent=t('Action required');actionDetail(c);},aliasFor(home,task){return objectId(model.nodes.find(x=>x.home===home&&x.task===task));},decorateIdentity(home,task){const own=model.nodes.find(x=>x.home===home&&x.task===task);if(own)reviewObject(own);},decisionOrigin(home,task){const own=byId.get(taskNodeId(home,task));return originOf(own);},render,decorate,clearFocus,refreshAges,hueFor,locateCall(key){ui.scope='';ui.column='needs';app.query='';$('board-search').value='';ui.selected='question:'+key;const call=attentionCards().find(c=>c.key===key);if(call?.attention_kind==='action')ui.selected=taskNodeId(call.home,call.task);if(call)ui.stacks.add(call.project?.id||call.home);render(true,'filter');return [...document.querySelectorAll('.qcard .card-open,.action-card .card-open')].find(x=>x.dataset.key===(call?.attention_kind==='action'?key:'question:'+key));},hasOrigin(home,task){const own=model.nodes.find(x=>x.home===home&&x.task===task);return canRevealOrigin(own);},revealTask(home,task){const own=model.nodes.find(x=>x.home===home&&x.task===task);if(own?.question?.origin_task)revealQuestionOrigin({home,task});else if(own){ui.selected='';reveal(own);}},setView(view){ui.view=view;ui.signature='';ui.nextRenderMode='filter';},get model(){return model;}};
};
