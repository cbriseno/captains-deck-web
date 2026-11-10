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
    order:pref('deck-request-sort','recent'),expanded:new Set(pref('deck-expanded-requests',[])),needsClosed:pref('deck-needs-closed',false),density:pref('deck-density','auto'),animations:pref('deck-animations',true),groups:new Set(['done']),steps:new Set(),logOpen:new Set(),logs:new Map(), reordering:false, pausedOpen:pref('deck-paused-open',true),done:pref('deck-done', true), focus:pref('deck-focus', true), hoverDelay:Math.max(0,Math.min(10,Number(pref('deck-hover-delay',1))||0)), mixer:false, stacks:new Set(), log:[], busy:false, drag:null, signature:'', generation:0,renderedQuery:null,nextRenderMode:''};
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
  const objectId=x=>window.DeckState.identity(x);
  let feedbackTimer;
  function feedback(text){const box=$('deck-feedback');clearTimeout(feedbackTimer);box.textContent=text;box.hidden=false;feedbackTimer=setTimeout(()=>box.hidden=true,4000);}
  function idBadge(x){
    const id=objectId(x);if(!id)return n('span','node-id',t('ID pending'));
    const badge=b('ID: '+id,async e=>{e.stopPropagation();try{await navigator.clipboard.writeText(id);feedback(t('ID copied: {id}',{id}));}catch{feedback(t('Select and copy this ID: {id}',{id}));}},'node-id');
    badge.setAttribute('aria-label',t('Copy ID')+': '+id);badge.title=t('Copy ID');return badge;
  }
  const cardFace=(face,x)=>add(n('div','card-face'),face,idBadge(x));
  const ancestors = x => { const out = [], seen = new Set(); for (let p = x; p && !seen.has(p.id); p = byId.get(p.parent)) {out.unshift(p);seen.add(p.id);} return out; };
  let tasksByAncestor = new Map();
  const tasksOf = x => tasksByAncestor.get(x.id) || [];
  const projectOf = x => ancestors(x).find(y => y.kind === 'project');
  const pathOf = x => ancestors(x).filter(y => y.id !== x.id).map(label).join(' · ');
  function projectLabel(x) {
    const declared=x.card?.project||x.card?.flow?.project||x.flow?.project||x.raw?.project;
    const rawId=typeof declared==='string'?declared:declared?.id;
    const id=rawId?(String(rawId).startsWith('project:')?String(rawId):'project:'+rawId):'';
    const group=id?(byId.get(keyOf(x.home,id))||byId.get(id)):null;
    return (group&&label(group))||(typeof declared==='object'&&declared?.label)||'';
  }
  // Unknown observation is not an explicit dependency/hold. It has its own
  // subgroup and never contributes to the confirmed work count.
  const isStopping = x => x.kind === 'task' && x.state === 'stopping';
  const colOf = x => x.state === 'done' ? 'done' : x.state === 'paused' ? 'paused' : ['ready','active','stopping','unknown'].includes(x.state) ? 'now' : 'waiting';
  const visible = x => (!ui.scope || ancestors(x).some(y => y.id === ui.scope)) && (!app.query || [label(x), pathOf(x), x.reason, x.task, objectId(x)].join(' ').toLocaleLowerCase().includes(app.query));
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
  // Request rows use the approved compact form: "hace 9 min", "ayer".
  function shortAge(value){
    const e=event(value),rtf=new Intl.RelativeTimeFormat(document.documentElement.lang||undefined,{style:'short',numeric:'auto'});
    let text;
    if(e?.date){const days=Math.floor((Date.UTC(new Date().getFullYear(),new Date().getMonth(),new Date().getDate())-Date.parse(e.date))/86400000);text=days<0?t('Not reported'):days===0?t('today'):rtf.format(-days,'day');}
    else if(typeof e?.epoch==='number'){const s=Date.now()/1000-e.epoch;text=s< -5?t('Not reported'):s<60?t('now'):s<3600?rtf.format(-Math.floor(s/60),'minute'):s<86400?rtf.format(-Math.floor(s/3600),'hour'):rtf.format(-Math.floor(s/86400),'day');}
    else text=t('Not reported');
    return window.DeckAnonymize?.formatted(text)??text;
  }
  const ageText=(label,value)=>label==='ago'?shortAge(value):t(label)+' '+(['Created','Created group'].includes(label)?creationAge(event(value)):naturalAge(value));
  function time(labelText, value) { const e = event(value)??null; const el = structural(n('span','dates',ageText(labelText,value)), 'time'); el.title = exactTime(e); el.dataset.event = JSON.stringify(e);el.dataset.ageLabel=labelText;return el; }
  function refreshAges(){for(const el of document.querySelectorAll('[data-age-label]')){const text=ageText(el.dataset.ageLabel,JSON.parse(el.dataset.event));if(el.textContent!==text)el.textContent=text;}}
  function dates(x) { const created=x.kind !== 'project'||event(x.created_at);return add(n('div','dates'),created?time(x.kind === 'task' ? 'Created' : 'Created group',x.created_at):null,created?' · ':null,time(x.kind === 'task' ? 'Updated' : 'Updated group',x.updated_at)); }
  function normalize(data) {
    const cards = [...data.columns.flatMap(c => c.cards)];
    cardMap = new Map(cards.map(c => [keyOf(c.home,c.task),c]));
    for(const row of app.historyRows || []){const key=keyOf(row.home,row.task),current=cardMap.get(key);if(!current){const card={...row,key:'history:'+row.home+':'+row.task,bucket:'landed',dependencies:[],activity:{kind:'delivered'}};cards.push(card);cardMap.set(key,card);}else if(current.bucket==='landed'&&row.project)current.project=row.project;}
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
    window.DeckState.reconcileProjects(nodes,keyOf);
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
    const taskNodes=nodes.filter(x=>x.kind==='task'), taskIds=new Map(taskNodes.map(x=>[keyOf(x.home,x.task),x.id])), membersByRequest=new Map();
    for(const x of taskNodes){const r=x.request||x.raw?.request||x.card?.request;if(r?.id){const key=keyOf(x.home,r.id);if(!membersByRequest.has(key))membersByRequest.set(key,[]);membersByRequest.get(key).push(x);}}
    for(const edge of edges) for(const end of ['from','to']) edge[end]=taskIds.get(edge[end])||edge[end];
    for(const source of sources){
      const requests=new Map((source.snapshot?.requests||[]).map(r=>[r.id,r]));
      const homeTasks=taskNodes.filter(x=>x.home===source.home),byOwner=new Map(homeTasks.map(x=>[x.owner_id,x])),requestOrder=new Map();
      for(const x of homeTasks){const r=x.request||x.raw?.request||x.card?.request;if(r?.id&&!requests.has(r.id))requests.set(r.id,r);}
      [...requests.keys()].forEach((id,i)=>requestOrder.set(id,i));
      for(const r of requests.values()){
        // Firstmate's project_key names the shown group, which may be a logical subproject root.
        const id=keyOf(source.home,'req:'+r.id),project=r.project_key||(typeof r.project==='object'?r.project?.id:r.project);
        const members=[...new Set([...(membersByRequest.get(keyOf(source.home,r.id))||[]),...(r.tasks||[]).map(id=>byOwner.get(id)).filter(Boolean)])];
        nodes.push({...r,id,owner_id:r.scope||'req:'+r.id,order_id:r.key||'request:'+r.id,scope:r.scope||'req:'+r.id,kind:'request',title:r.label,home:source.home,source,rev:source.snapshot.rev,parent:project?keyOf(source.home,/^(sub)?project:/.test(project)?project:'project:'+project):members[0]?.parent||'',updated_at:r.updated_at,pause:{own:!!r.pause,can_resume:!!r.pause,can_pause:!r.pause,inherited:[],...source.snapshot.pause_controls?.find(p=>p.scope===(r.scope||'req:'+r.id))},manual:requestOrder.get(r.id)});
        for(const x of members)x.parent=id;
      }
    }
    byId = new Map(nodes.map(x=>[x.id,x]));
    tasksByAncestor = new Map();
    for(const task of taskNodes)for(const ancestor of ancestors(task)){if(!tasksByAncestor.has(ancestor.id))tasksByAncestor.set(ancestor.id,[]);tasksByAncestor.get(ancestor.id).push(task);}
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
  const priorityRank=p=>['P4','','P3','P2','P1','P0'].indexOf(p||'');
  function priorityChange(x,to) {
    const from=x.priority_reported&&x.priority===null?'P4':x.priority||'';to=to||'';
    const effect=to==='P4'?t('Firstmate will handle it when no higher priority tasks are ready.'):!to?t('It will have no reported priority; no order is assumed.'):!from?t('It will have {name} priority.',{name:priorityName(to)}):t(priorityRank(to)>priorityRank(from)?'Firstmate will handle it sooner.':'Firstmate will handle it later.');
    return t('From {from} to {to}: {effect}',{from:priorityText(x),to:priorityName(to),effect});
  }
  function can(x, action) { if((action==='pause'&&x.pause?.can_pause===false)||(action==='resume'&&x.pause?.can_resume!==true))return false;return !!x.owner_id && (action==='review'?!!x.outcome_occurrence:!!x.rev) && !x.observation_uncertain_since && !!x.source?.available && (x.source.capabilities?.actions || []).includes(action) && app.online; }
  let pauseDescriptionId=0;
  const signalPause=x=>x.source?.capabilities?.signals?.includes('pause.request')&&x.source?.capabilities?.signals?.includes('resume.request');
  function pausePill(x){
    const p=x.pause||{},time=p.at?new Date(p.at).toLocaleTimeString(document.documentElement.lang,{hour:'2-digit',minute:'2-digit',hour12:false}):'';
    const text={pending:Number.isInteger(p.agents_total)?t('Pausing… {safe} of {total} at a safe point',{safe:p.agents_at_safe_point??0,total:p.agents_total}):t('Reaching a safe point'),
      paused:t('Paused · confirmed {time}',{time}),resuming:t('Resuming…'),queued:t('No room to resume · queued'),
      unconfirmed:t('Safe point not confirmed'),failed:t('Firstmate could not complete the change')}[p.state];
    if(!text)return null;
    const pill=structural(n('span','pause-pill',text));pill.dataset.pauseState=p.state;
    if(p.reason||p.queue_position)pill.title=[p.reason?t('Resume reason: {reason}',{reason:t({cap:'Agent limit',resources:'Resources',other:'Other'}[p.reason]||p.reason)}):'',p.queue_position?t('Queue position {position}',{position:p.queue_position}):''].filter(Boolean).join(' · ');
    return pill;
  }
  function signalPauseButton(x){
    const state=x.pause?.state,own=ownPause(x),action=own&&state==='pending'?'cancel-pause':own&&state==='queued'?'dequeue-resume':own?'resume':'pause';
    const text=t(!own&&x.pause?.inherited?.length?(state==='pending'?'Pausing…':'Paused'):{'cancel-pause':'Cancel pause','dequeue-resume':'Leave paused',resume:'Resume',pause:'Pause'}[action]);
    const wrap=n('span','pause-control'),btn=b(text,e=>{e.stopPropagation();if(!btn.disabled)pausePreview(x,action);},'mix-pause');btn.dataset.action=action;
    wrap.dataset.pauseNode=x.id;wrap.pauseReading=pauseReading(x);wrap.addEventListener('click',e=>e.stopPropagation());
    btn.setAttribute('aria-label',t('{action}: {name}',{action:text,name:label(x)}));btn.setAttribute('aria-pressed',String(ownPause(x)));
    const safe=x.pause?.agents_at_safe_point||x.pause?.agents_closed;
    workControl(btn,can(x,action)&&!['resuming','unconfirmed','failed'].includes(state)&&!(action==='cancel-pause'&&safe));
    add(wrap,pausePill(x),btn);
    if(!btn.dataset.workAllowed||btn.dataset.workAllowed==='false'){
      const note=n('span','pause-explanation',t(state==='unconfirmed'?'Safe point not confirmed':x.pause?.inherited?.length?'An inherited pause remains.':'This action is unavailable.'));
      note.id='pause-explanation-'+(++pauseDescriptionId);btn.setAttribute('aria-describedby',note.id);add(wrap,note);
      wrap.tabIndex=0;wrap.setAttribute('role','group');wrap.setAttribute('aria-describedby',note.id);wrap.setAttribute('aria-label',btn.getAttribute('aria-label'));
    }
    return wrap;
  }
  function mountPausePreview(){
    const current=ui.pausePreview;if(!current)return;
    const row=[...document.querySelectorAll('[data-node]')].find(el=>el.dataset.node===current.node&&!el.closest('#detail')&&el.getClientRects().length);
    if(row)(row.matches('.request-row')?row.querySelector('.request-head'):row).after(current.slot);
  }
  async function pausePreview(x,action){
    if(ui.busy)return;
    ui.pausePreview?.slot.remove();
    const slot=n('section','change-preview pause-preview');slot.setAttribute('role','status');slot.addEventListener('click',e=>e.stopPropagation());
    ui.pausePreview={node:x.id,slot};mountPausePreview();
    const request={action,node:x.owner_id,revision:x.rev,request_id:crypto.randomUUID().replaceAll('-','')};
    if(['cancel-pause','dequeue-resume'].includes(action)){await apply(x,request,slot);ui.pausePreview=null;slot.remove();return;}
    ui.busy=true;pending(true);slot.append(n('p','',t('Checking impact with Firstmate…')));
    try{
      const result=await api('api/control/'+encodeURIComponent(x.home)+'/preview',request);
      if(ui.pausePreview?.slot!==slot)return;
      slot.replaceChildren(n('strong','',t('Impact preview')+' · '+label(x)));
      if(result.impact?.still_paused?.length)slot.append(n('p','',t('Pauses that will remain: {names}',{names:result.impact.still_paused.map(id=>label(model.nodes.find(y=>y.home===x.home&&y.owner_id===id))).join(', ')})));
      const blocked=result.error||result.code||result.allowed===false||result.can_pause===false||['rejected','conflict','failed'].includes(result.state);
      if(blocked){
        slot.append(n('p','error',result.message||result.error||result.reason));
        if(result.code==='stale_revision')slot.append(b(t('Review current data'),async()=>{await host.poll();const current=byId.get(x.id);if(current)pausePreview(current,action);}));
      }else{
        if(action==='pause')slot.append(n('p','',t('{running} running tasks will reach a safe point and Firstmate will close their agents; {pending} pending tasks will be set aside.',{running:result.impact?.affected?.running?.length??0,pending:result.impact?.affected?.queued?.length??0})));
        else slot.append(n('p','',t('Needs {needed} agents; {running} of {cap} are running.',{needed:result.agents_needed??'?',running:result.agents_running??'?',cap:result.agents_cap??'?'})));
        const confirm=b(t(action==='pause'?(runningWork(x)?'Pause':'Hold'):'Resume'),async()=>{
          await apply(x,request,slot);
          const entry=ui.log.find(e=>e.request_id===request.request_id);
          if(!['conflict','rejected','failed','error'].includes(entry?.state)){ui.pausePreview=null;slot.remove();}
          else{
            if(entry?.code==='stale_revision')slot.append(b(t('Review current data'),()=>{const current=byId.get(x.id);if(current)pausePreview(current,action);}));
            slot.append(b(t('Cancel'),()=>{ui.pausePreview=null;slot.remove();}));
          }
        });
        confirm.className='primary';workControl(confirm,!!result.impact);slot.append(confirm);
      }
      slot.append(b(t('Cancel'),()=>{ui.pausePreview=null;slot.remove();}));
    }catch(err){slot.replaceChildren(n('p','error',err.message),b(t('Cancel'),()=>{ui.pausePreview=null;slot.remove();}));}
    finally{ui.busy=false;pending(false);}
  }
  const pauseEventsSeen=new Set();let pauseEventsInitialized=false;
  function pauseSignals(){
    const capacity=$('agents-capacity');capacity.replaceChildren();
    for(const source of model.sources){
      const crew=source.snapshot?.crew;
      const agents=Number.isInteger(crew?.agents_running)?t('Agents {count}',{count:crew.agents_running}):t('Agents · unconfirmed');
      const chip=structural(n('span','agents-count',agents+' · '+t('Slots {running} of {cap}',{running:Number.isInteger(crew?.agents_running)?crew.agents_running:t('unconfirmed'),cap:crew?.agents_cap??t('Not reported')})));
      const home=app.board.homes?.find(h=>h.id===source.home)?.label||chip.textContent;
      chip.title=home;chip.dataset.stale=String(!source.available);capacity.append(chip);
    }
    for(const source of model.sources)for(const e of source.snapshot?.events||[]){
      const key=JSON.stringify([source.home,e]);if(pauseEventsSeen.has(key))continue;pauseEventsSeen.add(key);
      if(!pauseEventsInitialized||!source.available)continue;
      const text={'pause.confirmed':'Firstmate confirmed the pause of {name}: {count} agents closed.',
        'pause.unconfirmed':'Firstmate has not confirmed the safe point of {name}.',
        'resume.confirmed':'Firstmate resumed {name}: {count} agents started.',
        'resume.refused':'Firstmate could not resume {name}: {running} of {cap} agents running. Waiting in the queue.',
        'resume.started_from_queue':'Firstmate resumed {name} from the queue.'}[e.event];
      if(text){const name=label(model.nodes.find(x=>x.home===source.home&&x.owner_id===e.scope));const message=e.event==='resume.refused'&&e.reason&&e.reason!=='cap'?t('Firstmate could not resume {name}: {reason}. Waiting in the queue.',{name,reason:t(e.reason==='resources'?'Resources':'Other')}):t(text,{name,count:e.agents_closed??e.agents_started??0,running:e.running??'?',cap:e.cap??'?'});$('pause-events').prepend(n('p','',message));}
    }
    pauseEventsInitialized=true;while($('pause-events').children.length>5)$('pause-events').lastChild.remove();
  }

  const pauseReading=x=>JSON.stringify([x.state,x.pause,x.rev,x.observation_uncertain_since,x.kind==='task'?null:tasksOf(x).map(y=>[y.id,y.state,y.pause?.can_pause]),x.source?.available,x.source?.capabilities?.actions,app.online]);
  // Approved demo: a request whose open tasks are all paused by another scope
  // has nothing of its own to pause; it shows that scope's pause instead.
  const heldBy=x=>{if(x.kind==='task'||ownPause(x))return null;const open=tasksOf(x).filter(y=>y.state!=='done'&&!questionOnly(y));return open.every(y=>ownPause(y)||y.pause?.inherited?.length)&&open.find(y=>!ownPause(y)&&y.pause?.inherited?.length)?.pause.inherited||null;};
  const runningWork=x=>x.kind==='task'?x.state==='active'&&!isStopping(x):tasksOf(x).some(y=>y.state==='active'&&!isStopping(y));
  function pauseButton(x) {
    const wrap=pauseControl(x),button=wrap.querySelector('button[data-action="pause"]');
    if(!button||runningWork(x)||ownPause(x)||isStopping(x)||x.state==='paused')return wrap;
    // Setting a hold on waiting work must not imply that it is running.
    if(button.textContent!==t('Pause')&&button.textContent!==t('Set aside pending work'))return wrap;
    button.textContent=t('Hold');button.setAttribute('aria-label',t('{action}: {name}',{action:t('Hold'),name:label(x)}));
    const note=wrap.querySelector('.pause-explanation');
    const [open,menu]=moreMenu(x,n('span'),[button]);
    if(note)menu.append(note);
    wrap.replaceChildren(open,menu);wrap.classList.add('hold-menu');
    wrap.removeAttribute('tabindex');wrap.removeAttribute('role');wrap.removeAttribute('aria-describedby');wrap.removeAttribute('aria-label');
    return wrap;
  }
  function pauseControl(x) {
    const inheritedScopes=!ownPause(x)&&x.pause?.inherited?.length?x.pause.inherited:heldBy(x);
    if(inheritedScopes){
      const scope=inheritedScopes[0],owner=byId.get(keyOf(x.home,scope))||byId.get(scope),wrap=n('span','pause-control inherited-pause');
      const note=b(t('Pause from {name}',{name:owner?label(owner):scope==='freeze'?t('the fleet freeze'):t('Pause origin not reported')}),e=>{e.stopPropagation();if(!owner)return;if(owner.kind==='request'){const row=requestRows(model.nodes.filter(x=>x.kind==='task')).find(r=>r.id===owner.id);if(row)ui.groups.delete(requestState(row));ui.expanded.add(owner.id);host.setView('board');render(true,'filter');[...$('board').querySelectorAll('.request-row')].find(el=>el.dataset.node===owner.id)?.querySelector('.request-title')?.focus();}else{host.setView('projects');for(const group of ancestors(owner))ui.tree.add(group.id);render(true,'filter');const row=[...$('project-tree').querySelectorAll('.mix')].find(el=>el.dataset.node===owner.id);if(row)openNode(owner,row.querySelector('.mix-name'));}},'pause-owner');
      note.disabled=!owner;note.title=owner?t('Go to pause scope'):pauseText(x);wrap.dataset.pauseNode=x.id;wrap.pauseReading=pauseReading(x);wrap.append(note);if(x.pause?.condition?.reason)wrap.append(n('span','pause-explanation',t('Waiting for: {reason}',{reason:x.pause.condition.reason})));return wrap;
    }
    if(signalPause(x))return signalPauseButton(x);
    const own=ownPause(x),stopping=isStopping(x),action=own?'resume':'pause',inherited=x.pause?.inherited||[];
    const sources=inherited.map(id=>id==='freeze'?t('the fleet freeze'):label(byId.get(keyOf(x.home,id))||byId.get(id))).join(', ');
    const condition=x.pause?.condition,wait=condition?.reason|| (condition?t('its existing condition'):'');
    const reasons={'no-tasks':'No tasks in this scope.','all-stopped':'All tasks are already stopped or completed.',completed:'This task is completed.',unknown:'Work state is not confirmed.','freeze-removal':'Removing this pause would also lift the fleet freeze for this task.'};
    let explanation=t(reasons[x.pause?.disabled_reason]||'');
    if(inherited.length&&x.pause?.disabled_reason!=='freeze-removal')explanation+=(explanation?' ':'')+t(own?'The pause from {name} will remain.':'Paused by {name}.',{name:sources});
    if(wait)explanation+=(explanation?' ':'')+t(own?'It will still wait for: {reason}':'Waiting for: {reason}',{reason:wait});
    const allowed=can(x,action);let idle=false;
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
      }else{text=t(!tasks.length?'No tasks':tasks.some(y=>y.state==='unknown')?'State not confirmed':'No running work');idle=true;}
    }else text=t(x.state==='done'?'Finished':'Pause');
    if(!allowed&&!explanation)explanation=!app.online?t('Offline'):!x.source?.available?t('Firstmate is unavailable.'):t('This action is unavailable.');
    const wrap=n('span','pause-control'),btn=b(text,e=>{e.stopPropagation();if(!btn.disabled)preview(x,{action});},'mix-pause');btn.dataset.action=action;if(idle)btn.dataset.idle='true';
    wrap.classList.toggle('pause-context',own||!!explanation);
    wrap.addEventListener('click',e=>e.stopPropagation());
    wrap.dataset.pauseNode=x.id;wrap.pauseReading=pauseReading(x);
    btn.setAttribute('aria-label',t('{action}: {name}',{action:text,name:label(x)}));btn.setAttribute('aria-pressed',String(own));workControl(btn,allowed&&!stopping);wrap.append(btn);
    if(stopping && own){const cancel=b(t('Cancel pause'),e=>{e.stopPropagation();if(!cancel.disabled)preview(x,{action:'resume'});},'mix-pause');cancel.dataset.action='cancel-pause';cancel.setAttribute('aria-label',t('{action}: {name}',{action:t('Cancel pause'),name:label(x)}));workControl(cancel,can(x,'resume'));wrap.append(cancel);}
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
      bar.setAttribute('role','progressbar');bar.setAttribute('aria-valuenow',pct);bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-label',t('Reported progress'));
      const completionNote=window.DeckState.completionNote(pct,x.state)?` · ${t('all declared steps; task not finished')}`:'';
      box.append(bar,structural(n('span','prog-txt',`${pct}% · ${completed}/${total} ${t('steps')}${completionNote}`)));
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
  // A task that exists only to ask the captain carries its origin. Work the
  // captain answered or released stays on the board.
  const questionOnly=x=>!!(x.question?.origin_task||x.question?.origin);
  const questionNode=c=>{const own=byId.get(taskNodeId(c.home,c.task));return originOf(own)||own;};
  const attentionCards = () => app.board?.columns.find(c=>c.id==='captains_call')?.cards || [];
  const allQuestions = () => attentionCards().filter(c=>c.attention_kind!=='action');
  const actions = () => attentionCards().filter(c=>c.attention_kind==='action');
  const questions = () => allQuestions().filter(c=>!c.answered);
  // The board and group signals share these unfiltered memberships. Search,
  // collapsed stacks and a selected scope must not change a group's activity.
  function kanbanRows() {
    const decisions=new Set(attentionCards().map(c=>keyOf(c.home,c.task)));
    const tasks=model.nodes.filter(x=>x.kind==='task'&&!decisions.has(keyOf(x.home,x.task))&&!questionOnly(x));
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
  function projectWaits(project){
    const projectOf=id=>ancestors(byId.get(id)||{}).find(a=>a.kind==='project'),out=new Map();
    for(const e of model.edges){if(e.completed||byId.get(e.from)?.kind!=='task')continue;const to=projectOf(e.to);if(!to||to.id===project.id||projectOf(e.from)?.id!==project.id||model.edges.some(d=>d.from===project.id&&d.to===to.id&&!d.completed))continue;if(!out.has(to))out.set(to,new Set());out.get(to).add(e.from);}
    return out;
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
    const name=b('',()=>{if(tree){ui.tree.has(x.id)?ui.tree.delete(x.id):ui.tree.add(x.id);render(true,'filter');}else filterAction();},'mix-name');name.setAttribute('aria-pressed',String(ui.scope===x.id));name.title=tree?t(closed?'Expand {name}':'Collapse {name}',{name:label(x)}):t('Click to filter tasks. Keep the pointer still to focus.');if(tree)name.setAttribute('aria-expanded',String(!closed));name.append(n('span','mix-label',label(x)));const meta=add(n('span','mix-meta'),idBadge(x),summary(x),dates(x)),info=add(n('div','mix-info'),name,meta);
    if(x.kind==='project'){const role=x.role||'unknown',known=role!=='unknown';meta.append(n('span',(known?'mix-wait':'mix-visibility')+' mix-role',role==='public-fork'?t('Public fork'):role==='installed-private'?t('Installed private project'):role==='private'?t('Private project'):role==='unknown'?t('Visibility unknown'):role));}
    const deps=model.edges.filter(e=>e.from===x.id&&!e.completed);if(deps.length)meta.append(n('span','mix-wait',t('Waits for {name}',{name:deps.map(e=>label(byId.get(e.to))).join(', ')})));
    // Firstmate's derived_blocked_by groups waits by each task's own project, even when both tasks share one request; the Deck tree cannot see that.
    const derived=Array.isArray(x.raw?.derived_blocked_by)?x.raw.derived_blocked_by.filter(e=>e.open!==false&&e.via?.length&&!deps.some(d=>d.to===keyOf(x.home,e.ref))).map(e=>[byId.get(keyOf(x.home,e.ref))||{title:e.ref},e.via]):null;
    if(x.kind==='project')for(const [to,tasks] of derived||projectWaits(x)){const count=tasks.size??tasks.length;meta.append(n('span','mix-wait',t(count===1?'1 task waits for “{name}”':'{count} tasks wait for “{name}”',{count,name:label(to)})));}
    const detail=b('⋯',()=>openNode(x,detail),'mix-pause');detail.setAttribute('aria-label',t('Details of {name}',{name:label(x)}));
    const pause=pauseButton(x),held=pause.classList.contains('hold-menu');
    if(held){detail.textContent=t('Details');detail.setAttribute('role','menuitem');pause.querySelector('.card-menu').append(detail);}
    add(row,info,priority(x),pause,held?null:detail);row.setAttribute('data-group-action','');wireEvents(row,x.id);return row;
  }
  function mixer() {
    const root=$('project-mixer'),projects=model.nodes.filter(x=>x.kind==='project'),allExpanded=projects.every(p=>!ui.closed.has(p.id));
    const toggle=b(allExpanded?t('Collapse groups'):t('Expand groups'),()=>{for(const p of projects)allExpanded?ui.closed.add(p.id):ui.closed.delete(p.id);save('deck-closed',[...ui.closed]);render(true,'filter');},'more');toggle.dataset.control='all-groups';toggle.setAttribute('aria-expanded',String(allExpanded));
    const tools=add(n('div','mix-tools'),n('span','',t('Projects')),toggle);const groups=projects.map(project=>{const group=n('div','mix-group');group.dataset.relationScope=project.id;wireEvents(group,project.id);group.append(groupRow(project));if(!ui.closed.has(project.id))for(const sub of model.nodes.filter(x=>x.kind==='subproject'&&x.parent===project.id))group.append(groupRow(sub));return group;});
    root.replaceChildren(tools,...groups);root.dataset.open=String(ui.mixer);
  }
  function tree() {
    const root=$('project-tree'), active=n('div','list tree-list'),empty=add(n('details','source-details'),n('summary','',t('No open tasks')));
    const requests=requestRows(model.nodes.filter(x=>x.kind==='task')),peers=orderedRequests(requests),rank={now:0,waiting:1,paused:2};
    const entry=(depth,...items)=>{const e=n('div','tree-entry');e.dataset.depth=depth;e.append(...items);return e;};
    // Open requests first in the board's order (state, then the chosen sort); finished ones fold under «Terminados».
    const children=(x,depth,target)=>{
      const kids=model.nodes.filter(y=>y.parent===x.id),rows=peers.filter(r=>kids.some(y=>y.id===r.id)),open=rows.filter(r=>requestState(r)!=='done').sort((a,c)=>rank[requestState(a)]-rank[requestState(c)]),done=rows.filter(r=>requestState(r)==='done');
      for(const r of open)target.append(entry(depth,requestRow(r,peers)));
      for(const y of kids)if(y.kind!=='request')descend(y,depth,target);
      if(done.length){const key='done:'+x.id,show=ui.tree.has(key),fold=b(t('Finished requests')+' · '+done.length,()=>{show?ui.tree.delete(key):ui.tree.add(key);render(true,'filter');},'more');fold.setAttribute('aria-expanded',String(show));fold.dataset.control='fold:tree:'+key;target.append(entry(depth,structural(fold)));if(show)for(const r of done)target.append(entry(depth,requestRow(r,peers)));}
    };
    const descend=(x,depth,target)=>{if(x.kind==='request')return;if(x.kind==='task'&&allQuestions().some(c=>c.home===x.home&&c.task===x.task&&c.answered))return;const action=x.kind==='task'&&actions().find(c=>c.home===x.home&&c.task===x.task),question=x.kind==='task'&&questions().find(c=>c.home===x.home&&c.task===x.task),row=action?actionCard(action):question?questionCard(question):x.kind==='task'?taskCard(x):groupRow(x,true,depth);
      if(x.kind==='project'){const count=requests.filter(r=>ancestors(r).some(z=>z.id===x.id)).length;const pct=row.querySelector('.mix-pct');if(count&&pct)pct.textContent=t(count===1?'1 request':'{count} requests',{count})+' · '+pct.textContent;}
      target.append(entry(depth,row));if(ui.tree.has(x.id))children(x,depth+1,target);};
    for(const p of model.nodes.filter(x=>x.kind==='project'))descend(p,0,tasksOf(p).some(t=>t.state!=='done')?active:empty);
    for(const x of model.nodes.filter(x=>!x.parent&&x.kind==='task'))descend(x,0,active);root.replaceChildren(active,empty);
  }
  function taskCard(x, turn, list=[]) {
    const resultRole=(x.outcome||x.raw?.outcome||x.card?.outcome)?.role;
    const card=setColor(n('article','task-card card'+(x.state==='done'&&!['final','partial'].includes(resultRole)?' done-card':'')),x);card.dataset.node=x.id;card.dataset.key=x.card?.key || x.id;card.dataset.state=x.state;card.dataset.open=String(ui.selected===x.id);
    const face=b('',()=>{if(card.hasAttribute('data-dim')&&!ui.pin){clearFocus();return;}openNode(x,face);},'card-open');face.dataset.key=card.dataset.key;face.setAttribute('aria-expanded',String(ui.selected===x.id));face.setAttribute('aria-controls','detail');
    const top=add(n('span','card-top'),turn !== undefined?structural(n('span','turn',String(x.turn || turn+1))):null,n('span','where',pathOf(x)||projectLabel(x)||t('Project not reported')));
    add(face,top,n('span','title',label(x)));
    if(x.state==='done'){const outcome=x.outcome||x.raw?.outcome||x.card?.outcome;if(outcome?.role)face.append(n('span','outcome-badge',t({final:'Result',partial:'Progress update',step:'Finished step'}[outcome.role]||'Delivered work')));if(outcome?.review)face.append(n('span','review-badge',t(outcome.review==='needed'?'Not reviewed':'Reviewed')));face.append(time('Completed',x.completed_at));const pending=questions().filter(c=>{const own=byId.get(taskNodeId(c.home,c.task));return own?.question?.origin_task===x.owner_id;});if(pending.length)face.append(structural(n('span','deck-origin',t('Origin delivered · {count} open decisions',{count:pending.length}))));}else{const reason=pauseText(x)||waitingText(x);if(reason){const line=n('span','meta card-line',reason);if(x.reason_time&&reason===x.reason)structural(line,'time');face.append(line);}if(questions().some(c=>questionNode(c)?.id===x.id))face.append(n('span','has-q',t('Has a question for you')));add(face,progress(x),dates(x));}
    if(x.state==='done'&&['final','partial'].includes((x.outcome||x.raw?.outcome||x.card?.outcome)?.role)){
      const summary=x.card?.summary||x.raw?.summary,validation=x.card?.validation_pending||x.raw?.validation_pending;
      if(summary)face.append(n('span','result-summary',summary));if(validation)face.append(n('span','notice',validation));
    }
    const more=add(n('div','card-more'),n('div','card-more-inner'));add(card,cardFace(face,x),more);
    if(x.state!=='done'){
      const ctl=add(n('div','card-ctl'),priority(x),pauseButton(x));
      if(turn !== undefined){for(const [delta,text]of [[-1,'▲'],[1,'▼']]){const at=turn+delta,target=list[at],btn=b(t(delta<0?'Move up':'Move down'),e=>{e.stopPropagation();move(x,target,delta<0?'before':'after');},'ib turn-b');btn.setAttribute('aria-label',t(delta<0?'Move {name} up':'Move {name} down',{name:label(x)}));workControl(btn,!!target&&can(x,'move'));ctl.prepend(btn);}card.draggable=!!ui.reordering&&can(x,'move');card.addEventListener('dragstart',e=>{if(ui.busy){e.preventDefault();return;}ui.drag=x.id;e.dataTransfer.setData('text/plain',x.id);});card.addEventListener('dragover',e=>{if(ui.drag&&ui.drag!==x.id){e.preventDefault();card.dataset.over=e.clientY<card.getBoundingClientRect().top+card.offsetHeight/2?'top':'bottom';}});card.addEventListener('dragleave',()=>delete card.dataset.over);card.addEventListener('drop',e=>{e.preventDefault();const moved=byId.get(ui.drag);if(moved)move(moved,x,card.dataset.over==='top'?'before':'after');delete card.dataset.over;ui.drag=null;});card.addEventListener('dragend',()=>{ui.drag=null;document.querySelectorAll('[data-over]').forEach(y=>delete y.dataset.over);});}
      card.append(ctl);
    }
    const saved=host.answerTools?.summary(x,()=>openNode(x,face));if(saved)card.append(saved);
    wireEvents(card,x.id);return card;
  }
  const actionWhere=c=>c.action?.where==='chat'?t('Act in the chat with {name}.',{name:c.owner}):t('Action instructions need confirmation.');
  // «Te necesita» cards follow the approved v11b demo: kind line (icon, type, ID, encargo, «…» menu), title, context, actions.
  const CARD_ICONS={ask:['M7.9 20A9 9 0 1 0 4 16.1L2 22Z','M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3','M12 17h.01'],ext:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],file:['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z','M14 2v4a2 2 0 0 0 2 2h4','M16 13H8','M16 17H8'],check:['M20 6 9 17l-5-5'],chevronDown:['m6 9 6 6 6-6'],copy:['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z','M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2'],link:['M9 17H7A5 5 0 0 1 7 7h2','M15 7h2a5 5 0 1 1 0 10h-2','M8 12h8'],sort:['m21 16-4 4-4-4','M17 20V4','m3 8 4-4 4 4','M7 4v16'],trash:['M3 6h18','M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6','M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],help:['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z','M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3','M12 17h.01'],chat:['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],redo:['M21 12a9 9 0 1 1-3-6.7L21 8','M21 3v5h-5'],more:['M5 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0','M10.8 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0','M16.6 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0']};
  function cardIcon(name){const ns='http://www.w3.org/2000/svg',s=document.createElementNS(ns,'svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('class','ci');s.setAttribute('aria-hidden','true');for(const d of CARD_ICONS[name]){const p=document.createElementNS(ns,'path');p.setAttribute('d',d);s.append(p);}return s;}
  const withCardIcon=(el,name)=>{el.prepend(cardIcon(name));return el;};
  // Short inline ID («T-BB») that still copies on click.
  function inlineId(x){const badge=idBadge(x);if(badge.tagName==='BUTTON'){const id=badge.textContent.slice(4);badge.replaceChildren(n('span','sr-only','ID: '),id);}return badge;}
  // «…» menu: Copy ID first, then the given items.
  const menuItem=(icon,text,fn,cls='')=>add(b('',fn,'more '+cls),cardIcon(icon),n('span','',text));
  function moreMenu(x,badge,items){
    const menu=n('div','card-menu');menu.hidden=true;menu.setAttribute('role','menu');menu.append(n('div','card-menu-h',label(x)),...[badge.tagName==='BUTTON'&&menuItem('copy',t('Copy {id}',{id:objectId(x)}),()=>badge.click()),...items].filter(Boolean));
    for(const item of menu.querySelectorAll('button')){item.setAttribute('role','menuitem');item.addEventListener('click',()=>{menu.hidden=true;open.setAttribute('aria-expanded','false');});}
    const open=b('',e=>{e.stopPropagation();const show=menu.hidden;document.querySelectorAll('.card-menu:not([hidden])').forEach(m=>m.hidden=true);menu.hidden=!show;open.setAttribute('aria-expanded',String(show));},'card-menu-btn');
    open.append(cardIcon('more'));open.setAttribute('aria-label',t('More actions'));open.title=t('More actions');open.setAttribute('aria-haspopup','menu');open.setAttribute('aria-expanded','false');
    return [open,menu];
  }
  function cardKind(kind,name,text,x,own,items){
    const badge=inlineId(own||x);
    const r=own&&requestFor(own),encargo=r?label(r):(own&&projectOf(own)?.title)||'';
    return add(n('div','cmeta '+kind),add(n('span','kind'),cardIcon(name),text),badge,encargo?Object.assign(n('span','req',encargo),{title:encargo}):null,...moreMenu(own||x,badge,items));
  }
  // Task inside an opened request, as the approved v11b demo row(): status dot,
  // title with inline ID and pills, one summary line, progress and Pause on the
  // right, and «…». Priority shows only when it is High or Critical.
  function requestTaskRow(x){
    const outcome=x.outcome||x.raw?.outcome||x.card?.outcome||{},result=['final','partial'].includes(outcome.role);
    const row=setColor(n('article','task-card card task-row'+(result?' result':'')),x);row.dataset.node=x.id;row.dataset.key=x.card?.key||x.id;row.dataset.state=x.state;row.dataset.open=String(ui.selected===x.id);
    const face=b('',()=>{if(row.hasAttribute('data-dim')&&!ui.pin){clearFocus();return;}openNode(x,face);},'card-open');face.dataset.key=row.dataset.key;face.setAttribute('aria-expanded',String(ui.selected===x.id));face.setAttribute('aria-controls','detail');face.append(n('span','title',label(x)));
    const badge=inlineId(x),pill=(text,cls='')=>n('span','rtag'+cls,text);
    const line=add(n('div','rt'),face,badge,result?pill(t(outcome.role==='partial'?'Progress update':outcome.review==='needed'?'Result · not reviewed':'Result')):null,['P0','P1'].includes(x.priority)?pill(t(x.priority==='P0'?'Critical priority':'High priority'),' prio'):null);
    const sub=n('div','rs'),text=x.card?.summary||x.raw?.summary||x.summary;
    if(x.state==='done'){sub.textContent=[x.card?.validation_pending||x.raw?.validation_pending||x.validation_pending,text].filter(Boolean).join(' · ');const pending=questions().filter(c=>byId.get(taskNodeId(c.home,c.task))?.question?.origin_task===x.owner_id);if(pending.length)sub.append(structural(n('span','deck-origin',t('Origin delivered · {count} open decisions',{count:pending.length}))));}
    else{sub.textContent=pauseText(x)||(x.state==='active'&&text)||waitingText(x);if(questions().some(c=>questionNode(c)?.id===x.id))sub.append(n('span','has-q',t('Has a question for you')));}
    const ctl=n('div','card-ctl rctl');if(x.state==='active')ctl.append(progress(x));if(x.state!=='done')ctl.append(pauseButton(x));
    const chain=new Set(ancestors(x).map(y=>y.id)),related=relationshipEdges().some(e=>chain.has(e.from)||e.to===x.id);
    // As the demo's menu: each entry only when its data or capability exists.
    const chat=x.card?.herdr_url,inDetail=then=>async()=>{if(!(ui.selected===x.id&&detailOpen()))await openNode(x,face);if(ui.selected===x.id&&detailOpen())then($('detail-content'));};
    const items=[chat&&menuItem('chat',t('Open agent chat'),()=>window.open(chat,'_blank','noopener')),
      x.state==='done'&&x.home&&menuItem('help',t('Ask for an explanation'),inDetail(()=>$('explain-request')?.click())),
      x.state!=='done'&&can(x,'priority')&&menuItem('sort',t('Change priority…'),inDetail(c=>c.querySelector('select[name=priority]')?.focus())),
      related&&menuItem('link',t('View relationships'),()=>showRelations(x)),
      can(x,'scope-removal')&&n('hr'),can(x,'scope-removal')&&menuItem('trash',t('Ask to remove it…'),inDetail(c=>c.querySelector('textarea[name=removal-reason]')?.focus()),'danger')];
    const hold=ctl.querySelector('.hold-menu');
    if(hold){items.unshift(...hold.querySelectorAll('.card-menu > button,.card-menu > .pause-explanation'));hold.remove();}
    add(row,n('span','dot'),add(n('div','card-face rmain'),line,sub.childNodes.length?sub:null),ctl,...moreMenu(x,badge,items),add(n('div','card-more'),n('div','card-more-inner')));
    const saved=host.answerTools?.summary(x,()=>openNode(x,face));if(saved)row.append(saved);
    wireEvents(row,x.id);return row;
  }
  document.addEventListener('click',e=>{if(!e.target.closest?.('.card-menu,.card-menu-btn'))document.querySelectorAll('.card-menu:not([hidden])').forEach(m=>{m.hidden=true;m.parentElement.querySelector('.card-menu-btn')?.setAttribute('aria-expanded','false');});});
  function actionLink(c){
    const link=c.action?.link&&host.reportLink?.(c.action.link,c.key);if(!link)return null;
    const control=link.tagName==='A'?link:link.querySelector('button');
    if(control)control.textContent=t(c.action.where==='chat'&&link.tagName==='A'?'Open chat':'Open registered link');return link;
  }
  function actionDetail(c) {
    const action=c.action||{};app.modal={type:'action',key:c.key,home:c.home,task:c.task,reading:JSON.stringify(c.action)};
    const content=$('detail-content');content.replaceChildren(n('p','action-instruction',action.instruction),n('p','fact',actionWhere(c)),n('p','fact',t('This stays here until Firstmate verifies the action is resolved.')));
    const current=byId.get(taskNodeId(c.home,c.task));if(event(current?.created_at))content.append(time('Created',current.created_at));
    if(action.context)content.append(n('p','fact',action.context));
    if(action.error)content.append(n('p','notice error',action.error));
    if(action.link&&host.reportLink)content.append(actionLink(c));
    const own=byId.get(taskNodeId(c.home,c.task)),origin=b(t('Go to source task'),()=>revealQuestionOrigin(c),'more');origin.disabled=!canRevealOrigin(own);content.append(origin);
  }
  function actionCard(c) {
    const own=byId.get(taskNodeId(c.home,c.task)),origin=originOf(own),card=setColor(n('article','task-card card action-card'),origin||own||{id:c.key});
    card.dataset.node=own?.id||taskNodeId(c.home,c.task);card.dataset.key=c.key;card.dataset.state=own?.state||'unknown';
    const face=b('',()=>{if(ui.selected===card.dataset.node&&detailOpen()){clearFocus(true);return;}ui.selected=card.dataset.node;ui.pin=ui.focus?ui.selected:'';showDetail(c.title,'',t('Action required'),face);actionDetail(c);highlight();},'card-open');face.dataset.key=c.key;face.setAttribute('aria-controls','detail');face.setAttribute('aria-expanded',String(ui.selected===card.dataset.node&&detailOpen()));
    const instruction=c.action?.instruction&&c.action.instruction!==c.title?c.action.instruction+' ':'';
    add(face,n('span','title',c.title),n('span','cctx',instruction+actionWhere(c)+(c.action?.context?' '+c.action.context:'')));
    if(c.action?.error)face.append(n('span','notice error',c.action.error));
    const source=b(t('Go to source task'),()=>revealQuestionOrigin(c),'more');source.disabled=!canRevealOrigin(own);
    card.append(cardKind('act','ext',t('Do'),{id:c.key},own,[source]),add(n('div','card-face'),face),add(n('div','card-more'),n('div','card-more-inner')));
    const link=c.action?.link&&host.reportLink&&actionLink(c),control=link&&(link.tagName==='A'?link:link.querySelector('button'));if(control){control.classList.add('primary');withCardIcon(control,'ext');}
    if(link)card.append(add(n('div','cacts'),link));wireEvents(card,card.dataset.node);return card;
  }
  let questionEditors = new Map();
  function questionCard(c) {
    const reading = JSON.stringify([c.title,c.question,c.question_summary,c.inline_call,c.project,c.answered]);
    const previous = questionEditors.get('question:'+c.key);
    if (previous?._reading === reading) return previous;
    const x=questionNode(c),own=byId.get(taskNodeId(c.home,c.task)),card=setColor(n('article','task-card card qcard'),x||{id:c.key});card._reading=reading;card.dataset.node='question:'+c.key;card.dataset.key='question:'+c.key;card.dataset.state=own?.state||'waiting';
    const face=b('',()=>{if(card.hasAttribute('data-dim')&&!ui.pin){clearFocus();return;}if(ui.selected==='question:'+c.key&&detailOpen()){clearFocus(true);return;}ui.selected='question:'+c.key;ui.pin=ui.focus?'question:'+c.key:'';announceFocus(ui.pin,c.title);openCard(c,face);highlight();},'card-open');face.dataset.key='question:'+c.key;face.setAttribute('aria-controls','detail');face.setAttribute('aria-expanded',String(ui.selected==='question:'+c.key));add(face,n('span','title',c.question||c.title));const q=c.question_summary;if(q){if(q.question&&q.question!==(c.question||c.title))face.append(n('span','cctx question',q.question));if(q.context)face.append(n('span','cctx question-context',q.context));} if(x?.state==='done')face.append(n('span','deck-origin',t('Origin delivered · decision still open')));const origin=menuItem('link',t('Go to source task'),e=>{e.stopPropagation();revealQuestionOrigin(c);});origin.disabled=!canRevealOrigin(own);add(card,cardKind('ask','ask',t('Decide'),{id:c.key},own||{kind:'task',task:c.task,home:c.home},[origin]),add(n('div','card-face'),face),add(n('div','card-more'),n('div','card-more-inner')));host.inlineAnswer(c,face,card);host.answerTools?.dropCard(card,c.key,()=>openCard(c,face));wireEvents(card,'question:'+c.key);return card;
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
  const requestFor=x=>ancestors(x).find(y=>y.kind==='request');
  const activityEpoch=value=>{const e=event(value);return e?.epoch||Date.parse(e?.date||'')/1000||0;};
  const reviewNeeded=x=>x.state==='done'&&(x.outcome||x.raw?.outcome||x.card?.outcome)?.review==='needed';
  function requestRows(tasks){
    const groups=new Map(model.nodes.filter(x=>x.kind==='request').map(x=>[x.id,{...x,tasks:[],calls:[]}]));
    const legacyId=x=>'legacy:'+(projectOf(x)?.id||x.home);
    for(const x of tasks){
      let r=requestFor(x);
      if(!r){
        const p=projectOf(x),id=legacyId(x);
        r={id,home:x.home,kind:'request',title:p?.title||t('Project not reported'),parent:p?.id,project:p?.title,project_group:true,owner_id:'',pause:{},updated_at:null};
        if(!groups.has(id))groups.set(id,{...r,tasks:[],calls:[]});
      }
      const group=groups.get(r.id);if(!group)continue;
      if(!questionOnly(x))group.tasks.push(x);
      if(activityEpoch(x.updated_at)>activityEpoch(group.updated_at))group.updated_at=x.updated_at;
    }
    for(const c of attentionCards()){const own=byId.get(taskNodeId(c.home,c.task)),r=own&&(requestFor(own)||requestFor(questionNode(c))||groups.get(legacyId(own)));if(r)groups.get(r.id)?.calls.push(c);}
    return [...groups.values()].filter(r=>r.tasks.length||r.calls.length);
  }
  // Approved demo situation(): «En curso» only while a task has a live agent.
  // Queued (ready), held or unconfirmed work is waiting, never in progress.
  function requestState(r){if(ownPause(r)||['pending','paused','queued','unconfirmed','failed'].includes(r.pause?.state))return 'paused';return r.tasks.some(x=>x.state==='active')?'now':r.tasks.some(x=>['stopping','paused'].includes(x.state))?'paused':r.calls.some(x=>!x.answered)||r.tasks.some(x=>x.state!=='done')?'waiting':'done';}
  function orderedRequests(rows){return [...rows].sort(ui.order==='mine'?(a,b)=>a.home.localeCompare(b.home)||(a.manual??Infinity)-(b.manual??Infinity): (a,b)=>activityEpoch(b.updated_at)-activityEpoch(a.updated_at));}
  function jumpAttention(x){
    if(ui.view!=='board')host.setView('board');
    if(ui.needsClosed){ui.needsClosed=false;save('deck-needs-closed',false);render(true,'filter');}
    const el=[...$('board').querySelectorAll('.attention-list .task-card')].find(el=>el.dataset.key===x||el.dataset.node===x);
    if(!el)return;el.scrollIntoView({block:'center',behavior:'smooth'});el.classList.remove('attention-flash');void el.offsetWidth;el.classList.add('attention-flash');el.querySelector('.card-open')?.focus({preventScroll:true});
  }
  // Review uses the owner's occurrence guard, independently of work revisions.
  async function changeReview(x,payload) {
    if(!x||ui.busy||!can(x,'review'))return;
    const request=payload||{target:x.owner_id,occurrence:x.outcome_occurrence,review:'done',expected_review:(x.outcome||x.raw?.outcome)?.review};
    const entry={id:x.id,request};ui.reviewResult=entry;ui.busy=true;pending(true);render(true);
    try{entry.result=await api('api/control/'+encodeURIComponent(x.home)+'/review',request);}
    catch(error){entry.error=error.message;}
    finally{ui.busy=false;pending(false);await host.poll();render(true);}
  }
  function reviewFeedback(){
    const entry=ui.reviewResult;if(!entry)return null;
    const result=entry.result,applied=result?.ok===true&&result.state==='applied';
    const message=entry.error|| (applied?t(entry.request.review==='done'?'Marked as reviewed.':'Review mark restored.'):result?t(result.message||'Could not apply'):t('Requested'));
    const box=add(n('div','review-feedback'),n('p','fact',message));box.setAttribute('role','status');
    if(applied&&result.undo)box.append(workControl(b(t('Undo'),()=>changeReview(byId.get(entry.id),result.undo)),true));
    if(entry.error||result&&!applied)box.append(b(t('Review current data'),async()=>{await host.poll();render(true);}));
    return box;
  }
  let reviewCards = new Map();
  function reviewCard(x){
    const reading=JSON.stringify([x.raw,x.card,projectOf(x)?.title,app.online,x.source?.available,x.source?.capabilities]);
    const previous=reviewCards.get(x.id);if(previous?._reading===reading)return previous;
    const card=setColor(n('article','task-card card review-card'),x);card._reading=reading;card.dataset.node=x.id;card.dataset.key=x.card?.key||x.id;card.dataset.state=x.state;card.dataset.open=String(ui.selected===x.id);
    const face=b('',()=>{if(card.hasAttribute('data-dim')&&!ui.pin){clearFocus();return;}openNode(x,face);},'card-open');face.dataset.key=card.dataset.key;face.setAttribute('aria-expanded',String(ui.selected===x.id));face.setAttribute('aria-controls','detail');
    const outcome=x.outcome||x.raw?.outcome||x.card?.outcome||{},validation=x.card?.validation_pending||x.raw?.validation_pending||x.validation_pending,summary=x.card?.summary||x.raw?.summary||x.summary;
    add(face,n('span','title',label(x)),validation||summary?n('span','cctx',[validation,summary].filter(Boolean).join(' ')):null);
    const view=withCardIcon(b(t('View result'),()=>openNode(x,face)),'chevronDown'),mark=workControl(withCardIcon(b(t('I have reviewed it'),()=>changeReview(x),'review-mark'),'check'),can(x,'review'));if(mark.disabled)mark.title=t('Shared review is not available from this Firstmate yet.');
    add(card,cardKind('rev','file',t(outcome.role==='partial'?'Progress update':'Review'),x,x,[]),add(n('div','card-face'),face),add(n('div','card-more'),n('div','card-more-inner')),add(n('div','cacts'),view,mark));
    const saved=host.answerTools?.summary(x,()=>openNode(x,face));if(saved)card.append(saved);wireEvents(card,x.id);return card;
  }
  // Spend per request: Firstmate's requests[].usage, priced at public API list rates.
  // Unknown stays visible: never rendered as zero or hidden inside a total.
  const money=v=>'US$'+(v>=100?Math.round(v).toLocaleString():v.toFixed(2));
  const megaTokens=v=>v<1000?t('{count} tokens',{count:v}):v>=1e6?t('{count} M tokens',{count:(v/1e6).toLocaleString(undefined,{maximumFractionDigits:v>=1e8?0:1})}):t('{count} k tokens',{count:Math.round(v/1e3)});
  const modelName=id=>({'claude-opus-5-5':'Opus 5.5','claude-sonnet-5-5':'Sonnet 5.5','claude-haiku-5-5':'Haiku 5.5','claude-fable-5-1':'Fable 5.1','gpt-6.1-sol':'GPT-6.1 Sol','gpt-6.1-terra':'GPT-6.1 Terra','gpt-6-luna':'GPT-6 Luna','gpt-6-astra':'GPT-6 Astra'})[id]||id||t('model not reported');
  const harnessName=h=>({claude:'Claude Code',codex:'Codex'})[h]||h||t('harness not reported');
  const effortLabels={low:'effort:low',medium:'effort:medium',high:'effort:high',xhigh:'effort:xhigh',max:'effort:max'};
  function usageUnknown(r){
    const captain=x=>x.reason==='captain'||model.nodes.some(task=>task.home===r.home&&([task.task,task.owner_id].includes(x.task)||task.owner_id==='task:'+x.task)&&(task.raw?.state==='captain'||task.pause?.condition?.kind==='captain'||task.raw?.pause?.own?.kind==='captain'));
    const decisions=(r.usage.unknown||[]).filter(captain);
    return {decisions,unknown:(r.usage.unknown||[]).filter(x=>!decisions.includes(x)),missing:Math.max(0,(r.usage.tasks?.unknown||0)-decisions.length)};
  }
  function usageChip(r){
    const u=r.usage;if(!u)return n('span','usage-line unknown',t('Spend not recorded'));
    const k=u.tasks||{},{missing,decisions}=usageUnknown(r);
    if(!u.by?.length)return n('span','usage-line'+(missing?' unknown':''),missing?t('Spend unknown'):(k.no_agent||decisions.length)&&!k.not_started?t('Your decision: no agent spend'):t('No spend yet'));
    const el=n('span','usage-line',(u.usd_complete||decisions.length&&!missing&&u.by.every(x=>x.usd_known)?'≈ ':'≥ ')+money(u.usd)+' · '+megaTokens(u.tokens)+(missing?' · '+t(missing===1?'{count} task unknown':'{count} tasks unknown',{count:missing}):'')+(k.running?' · '+t('in progress'):''));
    el.title=t('API list-price equivalent. Not a charge to your subscription.');return structural(el);
  }
  function usageDetail(r){
    const u=r.usage;if(!u)return null;const box=n('div','usage-detail');
    box.append(n('p','usage-h',t('Spend by harness, model and effort')));
    for(const x of u.by||[])box.append(structural(n('p','usage-row',harnessName(x.harness)+' · '+modelName(x.model)+' · '+t('effort {level}',{level:(effortLabels[x.effort]?t(effortLabels[x.effort]):x.effort||t('effort:unknown'))})+' — '+(x.usd_known?money(x.usd):t('price unknown'))+' · '+megaTokens(x.tokens)+' · '+t(x.sessions===1?'{count} session':'{count} sessions',{count:x.sessions}))));
    const k=u.tasks||{};
    if(k.running)box.append(n('p','usage-note',t(k.running===1?'{count} task still running: its figure keeps growing.':'{count} tasks still running: their figures keep growing.',{count:k.running})));
    if(k.not_started)box.append(n('p','usage-note',t(k.not_started===1?'{count} task not started: no spend.':'{count} tasks not started: no spend.',{count:k.not_started})));
    const {decisions,unknown}=usageUnknown(r);
    for(const x of decisions)box.append(n('p','usage-note',t('Your decision: {task} — no agent spend.',{task:x.title||x.task})));
    if(k.no_agent)box.append(n('p','usage-note',t('{count} of your decisions: no agent spend.',{count:k.no_agent})));
    for(const x of unknown)box.append(n('p','usage-note unknown',t('Unknown: {task} has no identified agent session.',{task:x.title||x.task})));
    if((u.excludes||[]).includes('coordinator'))box.append(n('p','usage-note unknown',t('Not included: Firstmate coordination, shared by every request.')));
    box.append(n('p','usage-note',t('USD = tokens × public API list price of each model. Your Claude and Codex subscriptions are not charged this way.')));
    return box;
  }

  let peersAll=[];
  // Bitácora: what each agent did for this request, newest first, from Firstmate's records (web/timeline.py).
  const LOG_LABEL={created:'Task created',started:'Agent started',working:'Progress',['needs-decision']:'Asked you',blocked:'Blocked',paused:'Waiting',done:'Reported done',failed:'Failed',resolved:'Resolved','closed-done':'Closed','closed-merged':'Integrated','closed-reported':'Report delivered'};
  function chatLink(home,task,number,x,agents){
    const live=x&&x.state!=='done'&&x.card?.herdr_url;
    const last=agents?.length?agents.length-1:null;
    if(!live&&last===null)return null;
    const a=n('a','log-chat',t('View chat'));a.href=live||('conversation?home='+encodeURIComponent(home)+'&task='+encodeURIComponent(task)+'&n='+(number??last));a.target='_blank';a.rel='noopener noreferrer';return a;
  }

  function activityLog(r){
    const box=n('div','activity-log'),tasks=r.tasks.map(x=>x.task).filter(Boolean);let entry=ui.logs.get(r.id);
    if(!entry||(!entry.loading&&Date.now()-entry.at>60000)){const next={at:Date.now(),loading:true,data:entry?.data,error:''};ui.logs.set(r.id,next);entry=next;
      api('api/timeline?home='+encodeURIComponent(r.home)+'&tasks='+encodeURIComponent(tasks.join(','))).then(d=>{next.data=d;}).catch(e=>{next.error=e.message;}).finally(()=>{next.loading=false;next.at=Date.now();if(ui.logOpen.has(r.id))render(true,'filter');});}
    if(!entry.data){box.append(n('p','meta',entry.error||t('Reading the activity log…')));return box;}
    const byTask=new Map(r.tasks.map(x=>[x.task,x])),lang=document.documentElement.lang||undefined;let day='';
    for(const e of [...entry.data.events].reverse()){
      const at=new Date(e.at*1000),dayText=window.DeckAnonymize.formatted(at.toLocaleDateString(lang,{weekday:'short',day:'numeric',month:'short'}));
      if(dayText!==day){day=dayText;box.append(structural(n('p','log-day',dayText),'time'));}
      const x=byTask.get(e.task),kind=e.kind==='closed'?'closed-'+e.text:e.kind,row=n('div','log-row');row.dataset.kind=kind;
      const what=add(n('span','log-what'),n('b','log-kind',t(LOG_LABEL[kind]||kind)),n('span','log-task',x?label(x):e.task));
      const detail=e.kind==='started'?e.agent:e.kind==='closed'?e.summary:e.text;if(detail)what.append(n('span','log-text',detail));
      add(row,structural(n('time','log-time',window.DeckAnonymize.formatted(at.toLocaleTimeString(lang,{hour:'2-digit',minute:'2-digit',hour12:false}))),'time'),what,chatLink(r.home,e.task,e.chat,x,entry.data.agents?.[e.task]));box.append(row);
    }
    if(!entry.data.events.length)box.append(n('p','meta',t('No recorded activity yet.')));
    return box;
  }
  function requestRow(r,peers){
    const opened=ui.expanded.has(r.id)||!!app.query,wrap=setColor(n('section','request-row'),r);wrap.dataset.node=r.id;wrap.dataset.kind='request';wrap.dataset.relationScope=r.id;
    const toggle=()=>{opened?ui.expanded.delete(r.id):ui.expanded.add(r.id);save('deck-expanded-requests',[...ui.expanded]);render(true,'filter');};
    const title=b('',toggle,'request-title');title.dataset.control='request:'+r.id;title.setAttribute('aria-expanded',String(opened));add(title,n('span','fold'),n('span','dot'),n('span','request-name',label(r)));
    const work=r.tasks,completed=work.filter(x=>x.state==='done').length,bar=n('span','request-bar');bar.style.setProperty('--p',Math.round(100*completed/Math.max(1,work.length))+'%');bar.setAttribute('aria-hidden','true');const meta=add(n('div','request-meta'),window.DeckAnonymize.project(n('span','request-project',projectOf(r)?.title||r.project?.label||r.project||projectOf(work[0])?.title||t('Project not reported')),projectOf(r)?.owner_id||r.project?.id||r.project||r.home),add(n('span','request-progress'),bar,structural(n('span','request-count',t(work.length===1?'{done} of {total} task done':'{done} of {total} tasks done',{done:completed,total:work.length})))));
    const attention=r.calls.filter(c=>!c.answered),reviews=work.filter(reviewNeeded);
    if(attention.length)meta.append(structural(b(attention.length>1?t('Needs you · {count}',{count:attention.length}):t('Needs you'),()=>jumpAttention(attention[0].attention_kind==='action'?attention[0].key:'question:'+attention[0].key),'request-chip needs-chip')));
    if(r.calls.some(c=>c.answered)||r.tasks.some(x=>(x.raw?.recorded_answers||[]).some(a=>a.application?.state==='pending')||x.question?.answer?.application?.state==='pending'))meta.append(n('span','reading-note',t('Reading your answer')));
    if(reviews.length)meta.append(structural(b(t('Review · {count}',{count:reviews.length}),()=>jumpAttention(reviews[0].id),'request-chip review-chip')));
    if(r.project_group)meta.querySelector('.request-project').textContent=t('Grouped by project');
    if(ui.order==='mine'){const turn=ui.turns?.get(r.id);if(turn)meta.append(structural(n('span','request-chip turn-chip',t('Next · #{count}',{count:turn}))));
      const y=r.source?.snapshot?.yields;if(y&&y.request===r.order_id){const to=peersAll.find(q=>q.home===r.home&&q.order_id===y.for_request);meta.append(n('span','request-chip yield-chip',t(y.room?'If room runs out, gives way to «{name}»':'No room: gives way at its safe point to «{name}»',{name:to?label(to):y.for_request})));}}
    meta.append(event(r.updated_at)?time('ago',r.updated_at):n('span','dates',t('Last activity not recorded')));
    if(!r.project_group)meta.append(usageChip(r));
    const head=add(n('div','request-head'),title,r.owner_id?pauseButton(r):null,meta);wrap.append(head);
    if(ui.order==='mine'&&r.owner_id){
      const handle=b('⠿',()=>feedback(t('Drag to move, or use ↑ and ↓')),'request-handle');handle.title=t('Drag to move, or use ↑ and ↓');handle.dataset.control='handle:'+r.id;handle.setAttribute('aria-label',t('Move {name} up or down',{name:label(r)}));workControl(handle,can(r,'move'));head.prepend(handle);
      handle.addEventListener('pointerdown',()=>{wrap.draggable=!handle.disabled;});
      handle.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const delta=e.key==='ArrowUp'?-1:1,target=peers[peers.findIndex(x=>x.id===r.id)+delta];if(target&&target.home===r.home)preview(r,{action:'move',target:target.order_id,position:delta<0?'before':'after'});});
      wrap.addEventListener('dragstart',e=>{ui.drag=r.id;e.dataTransfer.setData('text/plain',r.id);});wrap.addEventListener('dragend',()=>{ui.drag=null;wrap.draggable=false;});
      wrap.addEventListener('dragover',e=>{if(ui.drag&&ui.drag!==r.id)e.preventDefault();});wrap.addEventListener('drop',e=>{e.preventDefault();const x=byId.get(ui.drag);ui.drag=null;if(x?.home===r.home&&x.id!==r.id)preview(x,{action:'move',target:r.order_id,position:'before'});});
    }
    if(opened){
      const body=n('div','request-tasks'),done=work.filter(x=>x.state==='done'&&!['final','partial'].includes((x.outcome||x.raw?.outcome||x.card?.outcome)?.role)&&visible(x)),rank={active:0,stopping:1,unknown:2,ready:3,waiting:4,paused:5,done:6};
      const asking=new Set(r.calls.filter(c=>!c.answered).map(c=>keyOf(c.home,c.task)));
      body.append(...work.filter(x=>!done.includes(x)&&!asking.has(keyOf(x.home,x.task))&&visible(x)).sort((a,b)=>rank[a.state]-rank[b.state]).map(requestTaskRow));
      if(done.length){const show=ui.steps.has(r.id),fold=b(t(show?'Hide {count} finished tasks':'View {count} finished tasks',{count:done.length}),()=>{show?ui.steps.delete(r.id):ui.steps.add(r.id);render(true,'filter');},'more');fold.setAttribute('aria-expanded',String(show));body.append(structural(fold));if(show)body.append(...done.map(requestTaskRow));}
      if(!body.children.length)body.append(n('p','meta',t('What remains is in Needs you.')));const spend=usageDetail(r);if(spend)body.prepend(spend);const logOpen=ui.logOpen.has(r.id),logFold=b(t(logOpen?'Hide activity log':'View activity log'),()=>{logOpen?ui.logOpen.delete(r.id):ui.logOpen.add(r.id);render(true,'filter');},'more log-fold');logFold.setAttribute('aria-expanded',String(logOpen));body.append(logFold);if(logOpen)body.append(activityLog(r));
      wrap.append(body);
    }
    const latest=ui.log.find(entry=>entry.home===r.home&&(entry.command.node===r.order_id||entry.command.node===r.owner_id)&&(entry.command.action==='move'||entry.command.undo_operation?.op==='move'));if(latest?.undo)wrap.append(add(n('div','request-order-result'),n('span','meta',receiptLabel(latest)),workControl(b(t('Undo'),()=>undo(latest),'more'),true)));
    wireEvents(wrap,r.id);return wrap;
  }
  function syncChildren(parent,children){
    let cursor=parent.firstChild;
    for(const child of children){if(child===cursor)cursor=cursor.nextSibling;else parent.insertBefore(child,cursor);}
    while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
  }
  function renderRequests(board,tasks,asks,act){
    board.classList.add('request-board');board.closest('.deck').classList.add('request-layout');$('projects-toggle').hidden=true;
    const nav=$('columns-nav');nav.className='request-tools';nav.removeAttribute('role');
    for(const [value,text]of [['recent','Recent first'],['mine','My order']]){const btn=b(t(text),()=>{ui.order=value;save('deck-request-sort',value);render(true,'filter');});btn.setAttribute('aria-pressed',String(ui.order===value));nav.append(btn);}
    const rows=orderedRequests(requestRows(model.nodes.filter(x=>x.kind==='task')).filter(r=>r.tasks.some(x=>tasks.some(y=>y.id===x.id))||r.calls.some(c=>asks.some(q=>q.key===c.key)||act.some(q=>q.key===c.key)))),allOpen=rows.length&&rows.every(r=>ui.expanded.has(r.id));nav.append(b(t(allOpen?'Collapse requests':'Expand requests'),()=>{for(const r of rows)allOpen?ui.expanded.delete(r.id):ui.expanded.add(r.id);save('deck-expanded-requests',[...ui.expanded]);render(true,'filter');}));
    peersAll=rows;ui.turns=new Map();document.querySelectorAll('.order-note').forEach(x=>x.remove());if(ui.order==='mine'){let k=0;for(const source of model.sources||[])for(const key of source.snapshot?.sigue||[]){const row=rows.find(r=>r.home===source.home&&r.tasks.some(x=>x.owner_id===key));if(row&&!ui.turns.has(row.id))ui.turns.set(row.id,++k);}
      nav.after(n('p','order-note',t('Firstmate starts at the top: it dispatches first whatever is ready highest in your order. If room runs out, it pauses only the lowest running request, at its safe point, and only to make way for one you put above it.')));}
    const side=board.querySelector(':scope > .attention-list')||n('section','attention-list'),reviews=tasks.filter(reviewNeeded);side.setAttribute('aria-label',t('Needs you'));const needsToggle=b('',()=>{ui.needsClosed=!ui.needsClosed;save('deck-needs-closed',ui.needsClosed);render(true,'filter');});add(needsToggle,n('span','fold'),n('span','dot'),n('span','',t('Needs you')));needsToggle.dataset.control='needs-fold';needsToggle.setAttribute('aria-expanded',String(!ui.needsClosed));
    const head=add(n('div','request-group-head'),needsToggle,structural(n('span','n',String(asks.length+act.length+reviews.length)))),previousHead=side.querySelector(':scope > .request-group-head');
    const attention=[previousHead?.textContent===head.textContent&&previousHead.querySelector('button').getAttribute('aria-expanded')===needsToggle.getAttribute('aria-expanded')?previousHead:head];
    const feedback=reviewFeedback();if(feedback)attention.push(feedback);
    // Keep owner attention order; card kinds are labels, never separate stacks.
    const pending=new Set([...asks,...act].map(c=>c.key));if(!ui.needsClosed){for(const c of attentionCards().filter(c=>pending.has(c.key)).sort((a,b)=>(b.attention_kind==='action')-(a.attention_kind==='action')))attention.push(c.attention_kind==='action'?actionCard(c):questionCard(c));attention.push(...reviews.map(reviewCard));if(!pending.size&&!reviews.length)attention.push(n('p','meta',t('Nothing needs you right now.')));}
    syncChildren(side,attention);
    const list=n('div','request-list');
    for(const [state,title]of [['now','In progress'],['waiting','Waiting'],['paused','Paused'],['done','Finished requests']]){
      const peers=rows.filter(r=>requestState(r)===state);if(!peers.length)continue;
      const group=n('section','request-group');group.dataset.k=state;group.id='state-column-'+state;
      const folded=ui.groups.has(state),toggle=b('',()=>{folded?ui.groups.delete(state):ui.groups.add(state);render(true,'filter');});add(toggle,n('span','fold'),n('span','dot'),n('span','',t(title)));toggle.setAttribute('aria-expanded',String(!folded));
      group.append(add(n('div','request-group-head col-h'),toggle,structural(n('span','n',String(peers.length)))));if(!folded)group.append(add(n('div','request-table'),...peers.map(r=>requestRow(r,peers))));list.append(group);
    }
    if(!rows.length)list.append(n('p','meta',t('No requests match.')));syncChildren(board,[side,list]);
  }
  function render(force=false,mode='state') {
    if(!app.board)return;
    const traceStart=performance.now(), oldColumns=new Map();
    for(const el of document.querySelectorAll('#board .task-card[data-key]')){const actual=el.closest('.col')?.dataset.k;oldColumns.set(el.dataset.key,actual);const x=byId.get(el.dataset.node);if(!el.closest('.request-board')&&x&&actual&&!el.classList.contains('qcard')&&!el.classList.contains('action-card')&&(colOf(x)!==actual||x.state!==el.dataset.state))window.DeckTrace?.mismatch(el.dataset.key,actual,colOf(x));}
    // SSE already identifies a new reading; only local renders need a content comparison.
    const cardSignature=mode==='refresh'?null:app.board.columns.map(c=>[c.id,c.cards.map(x=>[x.key,x.title,x.question,x.question_summary,x.attention_kind,x.action,x.answered,x.project,host.cardLine(x),host.phaseText(x),x.dependencies,x.time?.epoch,x.time?.date,x.summary,x.presentation])]);
    const workSignature=mode==='refresh'?null:app.board.deck?.sources.map(s=>[s.home,s.available,s.error,s.capabilities,s.snapshot?.nodes,s.snapshot?.edges,s.snapshot?.requests,s.snapshot?.rev,s.snapshot?.sigue,s.snapshot?.yields,s.snapshot?.pause_controls,s.snapshot?.crew,s.snapshot?.events,s.retained_at && Date.now()/1000-s.retained_at>=30,s.snapshot?.nodes?.map(x=>x.observation_uncertain_since && Date.now()/1000-x.observation_uncertain_since>=30)]);
    const signature=mode==='refresh'?null:JSON.stringify([cardSignature,workSignature,app.board.diagnostics,app.historyRows,app.query,ui.scope,ui.view,ui.column,ui.done,ui.pausedOpen,ui.order,ui.needsClosed,ui.density,[...ui.expanded],[...ui.groups],[...ui.steps],ui.mixer,[...ui.closed],[...ui.stacks],[...ui.tree],app.online]);
    // Nothing changed: leave the DOM as it is, only ages that moved.
    if(!force&&signature!==null&&signature===ui.signature){refreshAges();return;}ui.signature=signature;
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
    model=normalize(app.board);assignHues();pauseSignals();$('workspace').dataset.density=ui.density==='auto'?(model.nodes.filter(x=>x.kind==='task'&&x.state!=='done').length<=10?'comfortable':model.nodes.filter(x=>x.kind==='task'&&x.state!=='done').length<=25?'normal':'compact'):ui.density;
    // A closed question must not leave the rest of the board dimmed. Keep the receipt open.
    if(!(app.board.deck?.sources||[]).some(s=>!s.available)) {
      const open=new Set(questions().map(c=>'question:'+c.key));
      for(const field of ['pin','selected','hover'])if(ui[field].startsWith('question:')&&!open.has(ui[field]))ui[field]='';
    }
    const actionOwner=app.modal?.type==='action'?byId.get(taskNodeId(app.modal.home,app.modal.task)):null;
    if(actionOwner?.source?.available&&actionOwner.question?.open===false){closeDetail(false);ui.selected='';ui.pin='';}
    if(!ui.initialized&&!app.board.loading){ui.initialized=true;model.nodes.filter(x=>x.kind==='project').forEach(p=>{if(!ui.hasClosedPreference&&!tasksOf(p).some(t=>['active','stopping'].includes(t.state)||questions().some(q=>taskNodeId(q.home,q.task)===t.id)))ui.closed.add(p.id);});}
    const lanes=kanbanRows();groupActivities=readGroupActivity(lanes);
    const attentionVisible=c=>{const x=byId.get(taskNodeId(c.home,c.task));return x?visible(x):!ui.scope;};
    const ts=lanes.tasks.filter(visible),run=lanes.run.filter(visible),stopping=lanes.stopping.filter(visible),unconfirmed=lanes.unconfirmed.filter(visible),ready=lanes.ready.filter(visible),asks=lanes.asks.filter(attentionVisible),act=lanes.act.filter(attentionVisible);
    const sorted=k=>ts.filter(x=>colOf(x)===k).sort((a,b)=>(priorities.findIndex(p=>p[0]===(b.priority||'')))-(priorities.findIndex(p=>p[0]===(a.priority||''))));
    const done=ts.filter(x=>x.state==='done').sort((a,b)=>(event(b.completed_at)?.epoch||Date.parse(event(b.completed_at)?.date||'')/1000||0)-(event(a.completed_at)?.epoch||Date.parse(event(a.completed_at)?.date||'')/1000||0));
    if(!ui.column)ui.column=asks.length||act.length ? 'needs' : 'now';
    const uncertain=ts.some(x=>x.state==='unknown')||(app.board.sources||[]).some(x=>x.error);
    const lead=[act.length===1?t('1 action requires attention.'):act.length?t('{count} actions require attention.',{count:act.length}):'',asks.length===1?t('1 decision needs you.'):asks.length?t('{count} decisions need you',{count:asks.length}):'',run.length===1?t('Firstmate has 1 task in progress.'):run.length?t('Firstmate has {count} tasks in progress.',{count:run.length}):uncertain?t('State not confirmed'):t('Firstmate has nothing in progress.')].filter(Boolean);
    $('deck-lead').replaceChildren(...(ui.scope?[n('span','',label(byId.get(ui.scope))+': ')]:[]),...lead.flatMap((text,i)=>[i?' ':'',structural(n('span','',text))]));$('deck-next').textContent=ready[0]?t('Next is {name}',{name:label(ready[0])}):t('Nothing is ready to follow.');
    $('overview').textContent='';
    const diagnostics=$('deck-diagnostics');diagnostics.replaceChildren(...(app.board.diagnostics||[]).map(d=>add(n('div','deck-diagnostic'),n('strong','',t('Inventory needs attention')),n('p','',d.owner+' · '+d.message))));diagnostics.hidden=!diagnostics.children.length;
    const counts={needs:asks.length+act.length,now:run.length+stopping.length,waiting:sorted('waiting').length,paused:sorted('paused').length,done:done.length};
    $('columns-nav').replaceChildren();
    const detail=$('detail'),wasOpen=detailOpen();parkDetail();
    // Hidden views render when selected; they need no DOM work for a board update.
    if(ui.mixer)mixer();
    if(ui.view==='projects')tree();
    const board=$('board');questionEditors=new Map([...board.querySelectorAll('.qcard')].map(card=>[card.dataset.key,card]));reviewCards=new Map([...board.querySelectorAll('.review-card')].map(card=>[card.dataset.node,card]));board.dataset.done=ui.done?'open':'closed';board.dataset.paused=ui.pausedOpen?'open':'closed';
    renderRequests(board,ts,asks,act);
    mountPausePreview();
    if(wasOpen){const face=[...document.querySelectorAll('.card-open')].find(y=>y.dataset.key===app.openerKey && y.getClientRects().length);if(face){app.opener=face;host.placeDetail(face);face.setAttribute('aria-expanded','true');face.closest('.task-card').dataset.open='true';}else if(ui.selected&&byId.has(ui.selected)){const group=[...document.querySelectorAll('[data-node]')].find(y=>y.dataset.node===ui.selected && y.getClientRects().length);if(group){group.append(detail);detail.hidden=false;$('detail-panel').dataset.active='false';}}}
    if(wasOpen){refreshDetailProgress(focused);refreshDetailPause(focused);if(app.modal?.type==='action'){const current=actions().find(c=>c.key===app.modal.key);if(current&&JSON.stringify(current.action)!==app.modal.reading)actionDetail(current);}}
    if(focusNode&&focusLabel&&!document.contains(focused)){const el=[...document.querySelectorAll('[data-node]')].filter(y=>y.dataset.node===focusNode&&y.getClientRects().length).flatMap(y=>[...y.querySelectorAll('[aria-label]')]).find(y=>y.getAttribute('aria-label')===focusLabel);el?.focus({preventScroll:true});}
    if(focused?.isConnected && document.activeElement!==focused && (focused.matches('input,textarea,select')||wasOpen&&focusedInDetail))focused.focus({preventScroll:true});
    else if(focusKey && !focused.isConnected){const face=[...document.querySelectorAll('.card-open')].find(x=>x.dataset.key===focusKey && x.getClientRects().length);face?.focus({preventScroll:true});}
    if(!focused?.isConnected){const target=focusId?$(focusId):focusControl?[...document.querySelectorAll('[data-control]')].find(x=>x.dataset.control===focusControl&&x.getClientRects().length):null;target?.focus({preventScroll:true});}
    if(wasOpen)for(const [el,left,top]of detailScroll)if(el.isConnected){el.scrollLeft=left;el.scrollTop=top;}
    for(const el of board.querySelectorAll('.task-card[data-key]')){const from=oldColumns.get(el.dataset.key),to=el.closest('.col')?.dataset.k;if(from&&to&&from!==to)window.DeckTrace?.move(el.dataset.key,from,to,'snapshot');const x=byId.get(el.dataset.node);if(!el.closest('.request-board')&&x&&!el.classList.contains('qcard')&&!el.classList.contains('action-card')){const expected=colOf(x);if(to&&expected!==to)window.DeckTrace?.mismatch(el.dataset.key,to,expected);}}
    window.DeckTrace?.add('card.render',{duration_ms:Math.round(performance.now()-traceStart)});
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
    if(detailOpen()&&x.kind==='task'&&host.answerTools&&(x.raw?.recorded_answers?.length||x.question?.answer)) {const content=$('detail-content'),panel=await host.answerTools.panel(x.home,x.task,x.state,x.card?.herdr_url);if(ui.selected===x.id&&detailOpen())content.append(panel);}
    if(detailOpen())reviewObject(x);
    highlight();
  }
  function decorate(x) {
    const previous=$('detail-content').querySelector('.deck-controls'),controls=n('section','deck-controls deck-simple');
    reviewObject(x);
    controls.setAttribute('aria-label',t('Work actions'));
    if(x.kind==='task')controls.append(time('Created',x.created_at));
    const main=add(n('div','deck-action-row'),x.kind!=='request'?n('span','fact',t('Priority')):null,x.kind!=='request'?priority(x):null,pauseButton(x));controls.append(main);
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
    relationshipDetail(x);
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
    const files=[],area=n('div','deck-removal-compose');area.append(reason);
    const send=b(t('Discuss removal'),async()=>{if(area.dataset.uploading)return;await preview(current(),{action:'scope-removal',reason:reason.value.trim(),...(files.length?{attachments:files.map(f=>f.id)}:{})});refresh();},'deck-removal-send');
    box.refreshRemoval=refresh;reason.addEventListener('input',refresh);refresh();
    host.answerTools?.composer(area,'api/control/'+encodeURIComponent(x.home)+'/upload',files,refresh,()=>area.isConnected&&!ui.busy,true);
    panel.append(send,area);box.append(panel);if(app.modal?.type==='call')content.append(box);else content.prepend(box);
  }
  function reveal(x) {
    ui.scope='';ui.view='board';ui.column=colOf(x);const r=requestFor(x);if(r){ui.expanded.add(r.id);ui.groups.delete(requestState(r));ui.steps.add(r.id);}host.setView('board');render(true,'filter');
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
    const requestMove=x.kind==='request'&&(command.action==='move'||command.undo_operation?.op==='move');
    if(requestMove){const row=[...document.querySelectorAll('.request-row')].find(y=>y.dataset.node===x.id);row?.querySelector('.change-preview')?.remove();row?.append(previewSlot);}
    else{if(!detailOpen() || (ui.selected!==x.id&&!reviewing))await openNode(x,[...document.querySelectorAll('[data-node]')].find(y=>y.dataset.node===x.id)?.querySelector('button'));
      const previous=$('detail-content').querySelector('.change-preview');previous?.restore?.();previous?.remove();$('detail-content').append(previewSlot);}
    const request={...command,node:command.action==='move'&&x.order_id?x.order_id:x.owner_id,revision:x.rev,request_id:crypto.randomUUID().replaceAll('-','')};
    try {
      const result=await api('api/control/'+encodeURIComponent(x.home)+'/preview',request);
      if(seq!==ui.generation||!previewSlot.isConnected)return;
      previewSlot.replaceChildren(n('h3','',t('Impact preview')));if(result.impact)previewSlot.append(renderImpact(result.impact));
      if(result.error || result.allowed===false || ['rejected','conflict','failed'].includes(result.state) || result.code || (result.cycle_path||result.impact?.cycle_path)?.length){add(previewSlot,n('p','error',result.message||result.error),(result.cycle || result.cycle_path || result.impact?.cycle_path)?n('p','',t('Cycle')+': '+(result.cycle || result.cycle_path || result.impact.cycle_path).map(id=>label(model.nodes.find(x=>x.owner_id===id))).join(' → ')):null);if(result.code==='stale_revision')previewSlot.append(b(t('Review current data'),async()=>{ui.busy=false;await host.poll();const current=byId.get(x.id);ui.selected='';if(current){const face=[...document.querySelectorAll('[data-node]')].find(el=>el.dataset.node===x.id&&el.getClientRects().length)?.querySelector('.card-open,.mix-name');if(face)openNode(current,face);}}));return;}
      if(!result.impact)previewSlot.append(renderImpact(null));
      if(command.action==='scope-removal'){ui.busy=false;await apply(x,{...request,preview:result.token || result.preview_token},previewSlot);return;}
      // Approved demo: «De X a Y: efecto · Confirmar · Cancelar» beside the selector, which shows the draft.
      if(command.action==='priority'&&result.impact){
        const select=$('detail-content').querySelector('.deck-controls select[name=priority]'),wrap=select?.parentElement,shown=wrap?.firstChild,before=[select?.value,shown?.textContent,wrap?.dataset.p];
        previewSlot.restore=()=>{if(select?.isConnected){[select.value,shown.textContent,wrap.dataset.p]=before;}previewSlot.restore=null;};
        if(select){select.value=command.priority||'';shown.textContent=priorityName(command.priority||'');wrap.dataset.p=command.priority||'';select.closest('.deck-action-row').after(previewSlot);}
        previewSlot.classList.add('priority-preview');previewSlot.replaceChildren(n('span','fact',priorityChange(x,command.priority)));
        // The receipt and Deshacer leave the controls, which apply() redraws.
        const confirm=workControl(b(t('Confirm'),()=>{previewSlot.restore=null;previewSlot.classList.remove('priority-preview');$('detail-content').append(previewSlot);apply(x,request,previewSlot);},'primary'),can(x,'priority'));
        add(previewSlot,confirm,b(t('Cancel'),()=>{previewSlot.restore?.();previewSlot.remove();}));return;}
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
    }catch(err){entry.state=err.retry?'uncertain':'error';entry.code=err.code;entry.message=err.retry?t('Receipt not confirmed'):err.message;slot.replaceChildren(n('p',err.retry?'fact':'notice error',entry.message));}
    finally{renderLog();await host.poll();const current=byId.get(ui.selected);if(request.action!=='scope-removal'&&current&&detailOpen()&&$('detail-content').querySelector('.deck-controls'))decorate(current);ui.busy=false;pending(false);renderLog();refreshReceipts();}
  }
  async function undo(entry){const x=model.nodes.find(x=>x.home===entry.home&&(x.owner_id===entry.command.node||x.order_id===entry.command.node));if(x&&entry.undo)preview(x,{action:'undo',undo_operation:entry.undo});}
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
      if(entry.undo&&entry.command.action!=='scope-removal')row.append(workControl(b(t('Undo'),()=>undo(entry)),true));if(entry.code==='busy')row.append(b(t('Try again'),()=>{const x=model.nodes.find(x=>x.home===entry.home&&(x.owner_id===entry.command.node||x.order_id===entry.command.node));if(x)apply(x,entry.command,$('change-results'));}));if(!['applied','error','rejected','conflict','failed'].includes(entry.state))row.append(b(t('Check receipt'),()=>checkReceipt(entry)));return row;}));
  }
  function refreshReceipts(){for(const entry of ui.log)if(['pause','resume','cancel-pause','dequeue-resume'].includes(entry.command?.action)&&['received','uncertain'].includes(entry.state))checkReceipt(entry);}
  async function checkReceipt(entry){if(entry.reading)return;entry.reading=true;try{const result=await api('api/control/'+encodeURIComponent(entry.home)+'/receipt?request_id='+encodeURIComponent(entry.request_id));delete entry.message;delete entry.code;Object.assign(entry,result);delete entry.receiptError;renderLog();host.poll();}catch(err){entry.receiptError=err.message;renderLog();}finally{delete entry.reading;}}
  function wireEvents(el,id) {
    const group=()=>{const x=byId.get(id);return x&&['project','subproject','request'].includes(x.kind)?x:null;};
    const keep=()=>{
      if(!ui.focus)return true;const x=byId.get(id),isGroup=x&&['project','subproject','request'].includes(x.kind),isTask=x?.kind==='task'||id.startsWith('question:');if(!isGroup&&!isTask)return false;
      const current=byId.get(ui.pin);if(isTask&&current&&['project','subproject','request'].includes(current.kind))return true;
      const changed=ui.pin!==id;ui.pin=id;ui.hover='';if(changed)ui.selected='';highlight();announceFocus(id,x?label(x):el.querySelector('.title')?.textContent||t('Task relationships'));return true;
    };
    let point=null;
    const schedule=()=>{cancelHover();hoverTarget=el;hoverTimer=setTimeout(()=>{hoverTimer=0;if(hoverTarget!==el||!el.isConnected||!ui.focus)return;hoverTarget=null;if(!keep()){ui.hover=id;highlight();}},ui.hoverDelay*1000);};
    el.addEventListener('pointerenter',event=>{if(!ui.focus)return;const moved=!lastHoverPoint||Math.abs(event.clientX-lastHoverPoint.x)+Math.abs(event.clientY-lastHoverPoint.y)>.5;if(!moved)return;const hovering=event.pointerType==='mouse'||event.pointerType==='pen'||matchMedia('(hover:hover)').matches;if(hovering&&matchMedia('(min-width:641px)').matches){point={x:event.clientX,y:event.clientY};schedule();}});
    el.addEventListener('pointermove',event=>{if(hoverTarget!==el||!point)return;if(Math.abs(event.clientX-point.x)+Math.abs(event.clientY-point.y)>.5){point={x:event.clientX,y:event.clientY};schedule();}});
    el.addEventListener('pointerleave',()=>{if(hoverTarget===el)cancelHover();point=null;ui.hover='';highlight();});
    el.addEventListener('focusin',()=>{if(keyboardFocus&&ui.focus&&group()){cancelHover();keep();}});
    el.addEventListener('click',event=>{
      if(!group()||event.target.closest('button,input,select,a,summary,details,#detail'))return;
      const area=event.target.closest('[data-node],[data-relation-scope]');
      if(area!==el)return;
      cancelHover();keep();
    });
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
  function showRelations(x){ui.focus=true;save('deck-focus',true);$('focus-effects').checked=true;delayInput.disabled=false;ui.pin=x.id;ui.hover='';highlight();announceFocus(x.id,label(x));}
  function relationshipDetail(x) {
    const content=$('detail-content');content.querySelector('.deck-relationships')?.remove();
    const chain=new Set(ancestors(x).map(y=>y.id)),edges=relationshipEdges().filter(e=>chain.has(e.from)||e.to===x.id);
    if(!edges.length)return;
    const section=n('section','deck-relationships'),list=n('ul','deps');
    section.append(n('h3','',t('Recorded relationships')),b(t('View recorded relationships'),()=>showRelations(x),'more'));
    for(const edge of edges){
      const outgoing=chain.has(edge.from),id=outgoing?edge.to:edge.from,call=questions().find(c=>'question:'+c.key===id),other=byId.get(id);
      const role=edge.question?t(outgoing?'Task asking this question':'Question from this task'):edge.completed?t(outgoing?'Released by this':'Already released this'):t(outgoing?'Waits for this':'Blocks this');
      const link=b(call?.question||call?.title||label(other),()=>{if(call)jumpAttention(id);else if(other)reveal(other);},'link');link.disabled=!call&&!other;
      const source=edge.origin==='captain'?t('Recorded by the captain'):edge.origin==='firstmate'?t('Recorded by Firstmate'):edge.origin?t('Recorded by {name}',{name:edge.origin}):t('Question origin');
      list.append(add(n('li'),n('span','meta',role+' · '),link,n('span','meta',' · '+source+(outgoing&&edge.from!==x.id?' · '+t('Inherited from {name}',{name:label(byId.get(edge.from))}):''))));
    }
    section.append(list);content.append(section);
  }
  function findRelationNode(id) {
    const visible=el=>el&&el.getClientRects().length&&!el.closest('[hidden]');
    const nodes=[...$('workspace').querySelectorAll('[data-node]')];
    const direct=nodes.find(el=>el.dataset.node===id&&visible(el));if(direct)return direct.matches('.request-row')?direct.querySelector('.request-head'):direct;
    const call=id.startsWith('question:')&&questions().find(c=>'question:'+c.key===id);
    const own=byId.get(id)||call&&byId.get(taskNodeId(call.home,call.task));
    if(call){const head=$('board').querySelector('.attention-list .request-group-head');if(visible(head))return head;}
    const requests=own?requestRows(model.nodes.filter(x=>x.kind==='task')).filter(r=>r.id===own.id||r.tasks.some(x=>ancestors(x).some(group=>group.id===own.id))):[];
    for(const request of requests){const row=nodes.find(el=>el.dataset.node===request.id&&visible(el));if(row)return row.querySelector('.request-head');}
    for(const group of own?ancestors(own).reverse():[]){const row=nodes.find(el=>el.dataset.node===group.id&&visible(el));if(row)return row.matches('.request-row')?row.querySelector('.request-head'):row;}
    const column=own&&$('state-column-'+(requests.length?requestState(requests[0]):colOf(own)));
    return column&&[...column.querySelectorAll('.rail-btn,.col-h')].find(visible);
  }
  function highlight() {
    if(!ui.focus){window.DeckTrace?.focus?.(false);ui.pin='';ui.hover='';for(const el of document.querySelectorAll('[data-node]')){delete el.dataset.dim;delete el.dataset.link;if(el.classList.contains('mix'))el.dataset.on='false';}document.querySelectorAll('.relation-role').forEach(el=>el.remove());document.querySelectorAll('.relation-id').forEach(el=>el.classList.remove('relation-id'));document.querySelector('svg.links')?.remove();$('connector-key').hidden=true;announceFocus('');return;}
    if(motion.animating)return;
    for(const row of document.querySelectorAll('.mix[data-node]')){row.dataset.on=String(ui.pin===row.dataset.node);delete row.dataset.preview;}
    const focus=ui.pin||ui.selected||ui.hover, center=byId.get(focus), members=new Set(center&&center.kind!=='task'?model.nodes.filter(y=>ancestors(y).some(z=>z.id===center.id)).map(x=>x.id):[focus]);
    const inherited=center?.kind==='task'?model.edges.filter(e=>e.from!==center.id&&ancestors(center).some(x=>x.id===e.from)).map(e=>({...e,from:center.id,inherited_from:e.from})):[];
    const edges=[...relationshipEdges(),...inherited].filter(e=>members.has(e.from)||members.has(e.to));
    document.querySelectorAll('.relation-role').forEach(el=>el.remove());document.querySelectorAll('.relation-id').forEach(el=>el.classList.remove('relation-id'));const related=new Set([...members,...edges.flatMap(e=>[e.from,e.to])]);
    const anchors=new Set([...related].map(findRelationNode).filter(Boolean));
    for(const el of document.querySelectorAll('[data-node]')){delete el.dataset.link;delete el.dataset.dim;if(focus&&edges.length){if(related.has(el.dataset.node)||[...anchors].some(anchor=>el.contains(anchor))){el.dataset.link='true';const edge=edges.find(e=>e.from===el.dataset.node||e.to===el.dataset.node);if(edge&&!members.has(el.dataset.node)){const text=edge.question?t(edge.from===el.dataset.node?'Question from this task':'Task asking this question'):edge.completed?t(edge.to===el.dataset.node?'Already released this':'Released by this'):t(edge.to===el.dataset.node?'Blocks this':'Waits for this');const badge=el.querySelector('.node-id');if(badge){badge.classList.add('relation-id');badge.append(n('span','relation-role',text));}}}else if(ui.focus)el.dataset.dim='true';}}
    window.DeckTrace?.focus?.(focus.startsWith('question:')&&!!document.querySelector('#board .task-card[data-dim]'));
    $('connector-key').hidden=!edges.length;$('connector-key').replaceChildren(...[[t('Blocks this'),'k-before',edges.some(e=>!e.question&&!e.completed&&members.has(e.from))],[t('Waits for this'),'k-after',edges.some(e=>!e.question&&!e.completed&&!members.has(e.from))],[t('Question from this task'),'k-ask',edges.some(e=>e.question)],[t('Already released this'),'k-freed',edges.some(e=>!e.question&&e.completed)]].filter(([, ,used])=>used).map(([s,c])=>n('span',c,'— '+s)));
    document.querySelector('svg.links')?.remove();if(!edges.length)return;
    const root=$('workspace'),find=findRelationNode;
    window.routeDeckRelations({edges,members,focus,root,find,label:id=>id.startsWith('question:')?(questions().find(c=>'question:'+c.key===id)?.question||questions().find(c=>'question:'+c.key===id)?.title||t('Decision pending')):label(byId.get(id)),t,motion});
  }
  function clearFocus(keepPin=false){cancelHover();if(!keepPin){ui.pin='';announceFocus('');}ui.selected='';ui.hover='';closeDetail();highlight();}
  const density=$('row-density');density.value=ui.density;
  density.addEventListener('change',()=>{ui.density=density.value;save('deck-density',ui.density);render(true,'filter');});
  const animations=$('deck-animations');animations.checked=ui.animations;document.documentElement.dataset.animations=String(ui.animations);
  animations.addEventListener('change',()=>{ui.animations=animations.checked;save('deck-animations',ui.animations);document.documentElement.dataset.animations=String(ui.animations);motion.cancel();});
  $('projects-toggle').addEventListener('click',()=>{ui.mixer=!ui.mixer;$('projects-toggle').setAttribute('aria-expanded',String(ui.mixer));render(true,'filter');});
  const delayInput=$('focus-delay');delayInput.value=String(ui.hoverDelay);delayInput.disabled=!ui.focus;
  delayInput.addEventListener('change',()=>{const value=Number(delayInput.value);if(!Number.isFinite(value)){delayInput.value=String(ui.hoverDelay);return;}ui.hoverDelay=Math.max(0,Math.min(10,value));delayInput.value=String(ui.hoverDelay);save('deck-hover-delay',ui.hoverDelay);cancelHover();});
  $('focus-effects').checked=ui.focus;$('focus-effects').addEventListener('change',()=>{cancelHover();ui.focus=$('focus-effects').checked;delayInput.disabled=!ui.focus;if(!ui.focus){ui.pin='';ui.hover='';}save('deck-focus',ui.focus);highlight();announceFocus(ui.pin,ui.pin?label(byId.get(ui.pin)):'');});
  $('changes-toggle').addEventListener('click',()=>{$('change-log').open=!$('change-log').open;$('change-log').scrollIntoView({block:'nearest'});});
  document.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tab=e.target.closest('[role=tab]');if(!tab)return;const tabs=[...tab.parentElement.querySelectorAll('[role=tab]')];let at=tabs.indexOf(tab);at=e.key==='Home'?0:e.key==='End'?tabs.length-1:(at+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;e.preventDefault();tabs[at].focus();tabs[at].click();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){ui.pin='';announceFocus('');ui.selected='';ui.hover='';highlight();}});
  document.addEventListener('click',e=>{
    if(!(ui.pin||ui.selected||ui.hover))return;
    const node=e.target.closest('[data-node]'),area=e.target.closest('[data-relation-scope]');
    if(node?.dataset.link==='true'||!node&&area?.dataset.relationScope===ui.pin)return;
    cancelHover();ui.pin='';announceFocus('');ui.selected='';ui.hover='';highlight();
  },true);
  window.addEventListener('resize',()=>{render(true,'filter');});document.addEventListener('scroll',highlight,true);document.addEventListener('transitionend',e=>{if(e.target.classList.contains('card-more'))highlight();});
  return {showAction(c){$('detail-kicker').textContent=t('Action required');actionDetail(c);},aliasFor(home,task){return objectId(model.nodes.find(x=>x.home===home&&x.task===task));},decorateIdentity(home,task){const own=model.nodes.find(x=>x.home===home&&x.task===task);if(own)reviewObject(own);},decisionOrigin(home,task){const own=byId.get(taskNodeId(home,task));return originOf(own);},historyMenu(item,explain){return moreMenu(item,idBadge(item),[menuItem('help',t('Ask for an explanation'),explain)]);},render,decorate,clearFocus,refreshAges,refreshReceipts,hueFor,locateCall(key){ui.needsClosed=false;save('deck-needs-closed',false);ui.scope='';ui.column='needs';app.query='';$('board-search').value='';ui.selected='question:'+key;const call=attentionCards().find(c=>c.key===key);if(call?.attention_kind==='action')ui.selected=taskNodeId(call.home,call.task);if(call)ui.stacks.add(call.project?.id||call.home);render(true,'filter');return [...document.querySelectorAll('.qcard .card-open,.action-card .card-open')].find(x=>x.dataset.key===(call?.attention_kind==='action'?key:'question:'+key));},addMenuItem(card,icon,text,fn){const menu=card.querySelector('.cmeta .card-menu');if(!menu)return;const item=menuItem(icon,text,fn);item.setAttribute('role','menuitem');item.addEventListener('click',()=>{menu.hidden=true;menu.parentElement.querySelector('.card-menu-btn')?.setAttribute('aria-expanded','false');});menu.append(item);},hasOrigin(home,task){const own=model.nodes.find(x=>x.home===home&&x.task===task);return canRevealOrigin(own);},revealTask(home,task){const own=model.nodes.find(x=>x.home===home&&x.task===task);if(own?.question?.origin_task)revealQuestionOrigin({home,task});else if(own){ui.selected='';reveal(own);}},setView(view){ui.view=view;ui.signature='';ui.nextRenderMode='filter';},get model(){return model;}};
};
