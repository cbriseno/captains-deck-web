'use strict';
/* Polling never replaces a settings draft. Only explicit buttons submit changes. */
window.createRelaySettings = function ({t, node:n, button:b, api, state}) {
  const $=id=>document.getElementById(id);
  const dialog=$('relay-settings-dialog'), content=$('relay-settings-content'), homes=$('relay-settings-home');
  const confirmation=$('relay-confirm-dialog'), disclosure=$('relay-confirm-disclosure'), words=$('relay-confirm-words');
  const confirm=$('relay-confirm-apply'), resultSlot=$('relay-settings-result');
  let generation=0, source=null, busy=false, proposed=null, receipts=[], planningScope='home';
  try{receipts=JSON.parse(sessionStorage.getItem('deck-settings-receipts')||'[]').slice(0,20);}catch{/* Loading never resubmits. */}
  const field=(text,control)=>{const label=n('label','settings-field');label.append(n('span','',t(text)),control);return label;};
  const select=(items,value)=>{const el=n('select');for(const [key,text] of items)el.append(new Option(t(text),key));el.value=value;return el;};
  const allowed=action=>source?.available&&source.actions?.includes(action);
  const route=(home,command='')=>'api/settings/'+encodeURIComponent(home)+(command?'/'+command:'');
  const labels={pending:'Requested',received:'Received',applied:'Applied',uncertain:'Receipt not confirmed',rejected:'Rejected',conflict:'Changed before applying',failed:'Could not apply'};
  function pending(value){busy=value;homes.disabled=value;for(const el of content.querySelectorAll('button,input,select'))el.disabled=value||el.dataset.allowed!=='true';}
  function enable(el,value){el.dataset.allowed=String(!!value);el.disabled=!value||busy;return el;}
  function renderReceipts(){
    try{sessionStorage.setItem('deck-settings-receipts',JSON.stringify(receipts.slice(0,20)));}catch{/* Receipt stays in memory. */}
    const rows=receipts.filter(entry=>entry.home===homes.value);
    resultSlot.replaceChildren(...rows.map(entry=>{
      const row=n('div','change-row');row.append(n('strong','',t(labels[entry.state]||'Receipt not confirmed')));
      if(entry.message)row.append(n('p','',t(entry.message)));
      if(entry.undo&&entry.state==='applied')row.append(b(t('Undo'),async()=>{if(busy)return;if(source?.selection!==entry.selection){planningScope=entry.scope||'home';await load(entry.selection||'');}request({action:'undo',undo_operation:entry.undo});}));
      if(entry.command&&(!['applied','rejected','conflict','failed'].includes(entry.state)||entry.code==='busy'))row.append(b(t('Retry same request'),()=>{if(!busy)apply(entry.home,entry.command,entry);}));return row;
    }));
  }
  function render(data){
    source=data;content.replaceChildren();renderReceipts();
    if(!data.available){content.append(n('p','muted',t('Relay settings are not available for this space.')));return;}
    const relay=data.relay, planning=data.planning;
    const modes={assisted:'Assisted relay',auto:'Automatic relay',warn:'Warnings only'};
    content.append(n('h3','',t('Relay mode')),n('p','fact',t(modes[relay.mode]||'Not reported')),
      n('p','',t(relay.auto_enabled?'Automatic relay is on.':'Automatic relay is off.')));
    if(relay.reason)content.append(n('p','muted',relay.reason));
    content.append(n('p','muted',t('Authorization applies to this whole space. Readiness is checked separately for Claude and Codex; every covered harness must pass.')));
    content.append(enable(b(t(relay.auto_enabled?'Turn off automatic relay':'Turn on automatic relay'),event=>request({action:'automatic',enabled:!relay.auto_enabled},event.currentTarget)),allowed('automatic')&&(relay.auto_enabled||relay.can_authorize)));
    if(!relay.can_authorize){
      const details=n('details','source-details');details.append(n('summary','',t('Automatic relay availability')));
      const reasons=relay.preflight?.reasons||[];
      for(const row of reasons.filter(row=>!['missing_standing_authorization','invalid_standing_authorization'].includes(row.code)))details.append(n('p','',row.harness+': '+row.message));
      content.append(details);
    }
    content.append(n('h3','',t('Context thresholds')),n('p','muted',t('Use umbral:600K, umbral:80% or compactaciones:5. Together means both; o means whichever happens first.')));
    for(const row of relay.thresholds){
      const input=n('input');input.type='text';input.value=row.value;input.placeholder=t('No threshold configured');input.name='threshold-'+row.harness;enable(input,allowed('threshold'));
      const save=enable(b(t('Save threshold'),()=>request({action:'threshold',harness:row.harness,value:input.value})),allowed('threshold'));
      content.append(field(row.harness==='codex'?'Codex threshold':'Claude threshold',input),save);
      if(row.source)content.append(n('p','muted',row.source));
    }
    content.append(n('h3','',t('Planning mode')),n('p','muted',t('Preferences apply to new tasks. Active tasks retain their pinned brief.')));
    content.append(n('p','muted',t('Project and task choices include scopes already known to Deck and registered preferences. This is not a complete inventory.')));
    const modeNames={native:t('Native planning'),speckit:t('Spec Kit'),inherit:t('Inherit')};
    content.append(n('p','muted',t('Installation')+': '+(modeNames[planning.installation_default]||t('Not reported'))+' · '+t('Home')+': '+(modeNames[planning.home_default]||t('Not reported'))));
    if(data.selection&&planning.project_installation_mode&&planning.project_installation_mode!=='inherit')content.append(n('p','muted',t('Installation project preference: {mode}',{mode:modeNames[planning.project_installation_mode]||t('Not reported')})));
    if(planning.resolution){
      const resolution=planning.resolution;
      content.append(n('p','fact',t('Effective planning: {mode}',{mode:modeNames[resolution.effective]||t('Not available')})));
      if(resolution.availability==='pending'||resolution.availability==='failed')content.append(n('p','muted',t(resolution.availability==='pending'?'Planning setup is pending.':'Planning setup failed.')));
      if(resolution.cause)content.append(n('p','muted',resolution.cause));
    }
    const scope=select([['home','Home'],['installation','Installation'],['project','Project'],['task','Task']],planningScope);scope.name='planning-scope';
    const target=n('select');target.name='planning-target';
    const mode=select([['native','Native planning'],['speckit','Spec Kit'],['inherit','Inherit']],'native');mode.name='planning-mode';
    const targetLabel=field('Applies to',target);
    const planningStatus=n('p','muted');
    const planningSave=b(t('Save planning mode'),()=>request({action:'planning',scope:scope.value,target:target.value||null,mode:mode.value}));
    const updateScope=()=>{
      const rows=planning.targets?.[scope.value]||[];
      target.replaceChildren(...rows.map(row=>new Option(row.label,row.id)));if(rows.some(row=>row.id===data.selection))target.value=data.selection;targetLabel.hidden=!['project','task'].includes(scope.value);
      const update=()=>{const current=['project','task'].includes(scope.value)?rows.find(row=>row.id===target.value)?.mode:scope.value==='home'?planning.home_default:planning.installation_default;mode.value=current||'inherit';
        planningStatus.textContent=scope.value==='task'?t('Task preferences are pinned in the task brief.'):t('Preferences apply to new tasks. Active tasks retain their pinned brief.');
        enable(planningSave,allowed('planning')&&(!['project','task'].includes(scope.value)||rows.length>0));};
      target.onchange=()=>{update();load(target.value);};update();
    };
    for(const el of [scope,target,mode])enable(el,allowed('planning'));
    scope.addEventListener('change',()=>{planningScope=scope.value;updateScope();load(['project','task'].includes(scope.value)?target.value:'');});updateScope();
    content.append(field('Planning scope',scope),targetLabel,field('Planning mode',mode),planningStatus,planningSave);
    content.append(n('h3','',t('Relay status')));
    const attempts=relay.attempts||[], requests=relay.requests||[];
    if(!relay.activity_available)content.append(n('p','muted',t('Relay activity is not available.')));
    else if(!attempts.length&&!requests.length)content.append(n('p','muted',t('No relay attempts or pending requests recorded.')));
    for(const row of [...requests,...attempts])content.append(n('p','',String(row.at||'')+' · '+String(row.state||t('Not reported'))));
    if(relay.activity_reason)content.append(n('p','muted',relay.activity_reason));
    if(!data.actions?.length)content.append(n('p','notice',t('Settings changes are not available with this extension version.')));
  }
  async function load(selection=''){
    const seq=++generation;source=null;content.replaceChildren(n('p','muted',t('Loading…')));renderReceipts();
    if(!homes.value){render({available:false});return;}
    try{const data=await api(route(homes.value)+(selection?'?selection='+encodeURIComponent(selection):''));if(seq===generation&&dialog.open)render(data);}
    catch{if(seq===generation&&dialog.open)render({available:false});}
  }
  async function request(operation,opener=null){
    if(busy||!source?.available)return;pending(true);
    const seq=generation, home=homes.value, body={...operation,selection:source.selection||'',revision:source.revision,request_id:crypto.randomUUID().replaceAll('-','')};
    try{
      const preview=await api(route(home,'preview'),body);
      if(seq!==generation||!dialog.open||homes.value!==home)return;
      if(preview.allowed!==true||['rejected','conflict','failed'].includes(preview.state)){
        receipts.unshift({home,request_id:body.request_id,state:preview.state||'rejected',message:preview.message});renderReceipts();return;
      }
      body.preview=preview.token;
      if(operation.action==='automatic'){
        const enabling=operation.enabled===true, check=preview.preflight;
        if(enabling&&check?.can_authorize!==true){receipts.unshift({home,request_id:body.request_id,state:'rejected',message:check?.reason||t('The extension cannot authorize automatic relay.')});renderReceipts();return;}
        proposed={home,body,opener};words.value='';disclosure.replaceChildren();
        disclosure.append(n('p','',t(enabling?'When a configured threshold is reached, this session will hand over at a safe point without another confirmation.':'Automatic relay will be disabled. Future handoffs will require assisted confirmation.')));
        if(enabling){
          disclosure.append(n('p','',t('Authorization applies to this whole space. Readiness is checked separately for Claude and Codex; every covered harness must pass.')));
          for(const row of source.relay.thresholds)disclosure.append(n('p','',row.harness+': '+(row.value||t('Not reported'))));
          const limits=check.limits||source.relay.limits;
          if(!limits||!['window_seconds','daily_cap','min_work_seconds','safe_wait_seconds'].every(key=>Number.isFinite(limits[key])&&limits[key]>0)){
            proposed=null;receipts.unshift({home,request_id:body.request_id,state:'rejected',message:t('The extension cannot authorize automatic relay.')});renderReceipts();return;
          }
          disclosure.append(n('p','',t('One attempt per {minutes} minutes, up to {count} per UTC day. Failed attempts count.',{minutes:limits.window_seconds/60,count:limits.daily_cap})),
            n('p','',t('Minimum useful work: {work} seconds. Safe-point wait: {wait} seconds.',{work:limits.min_work_seconds,wait:limits.safe_wait_seconds})),
            n('p','',t('Turn off automatic relay returns to assisted mode.')));
        }
        confirm.textContent=t(enabling?'Confirm automatic relay activation':'Confirm automatic relay deactivation');confirm.disabled=true;
        confirmation.showModal();words.focus();
      }else await apply(home,body);
    }catch(err){receipts.unshift({home,request_id:body.request_id,state:'rejected',message:err.message});renderReceipts();}
    finally{pending(false);}
  }
  async function apply(home,body,existing=null){
    if(existing)planningScope=existing.scope||'home';
    pending(true);const entry=existing||{home,request_id:body.request_id,selection:body.selection||'',scope:planningScope,command:body};entry.state='pending';if(!existing)receipts.unshift(entry);renderReceipts();
    try{Object.assign(entry,await api(route(home,'apply'),body));}
    catch(err){entry.state=err.retry?'uncertain':'rejected';entry.message=err.message;}
    finally{pending(false);renderReceipts();if(dialog.open&&homes.value===home)await load(body.selection||'');}
  }
  words.addEventListener('input',()=>{confirm.disabled=!words.value.trim()||busy;});
  confirm.addEventListener('click',async()=>{
    if(!proposed||confirm.disabled||busy)return;
    const {home,body}=proposed;body.captain_words=words.value;proposed=null;confirmation.close();await apply(home,body);
  });
  $('relay-confirm-cancel').addEventListener('click',()=>confirmation.close());
  confirmation.addEventListener('close',()=>{const opener=proposed?.opener;proposed=null;words.value='';if(opener?.isConnected)opener.focus();});
  for(const modal of [dialog,confirmation])modal.addEventListener('keydown',event=>event.stopPropagation());
  $('relay-settings-open').addEventListener('click',()=>{
    planningScope='home';
    homes.replaceChildren(...(state.board?.homes||[]).map(home=>new Option(home.label,home.id)));
    if(state.board?.home)homes.value=state.board.home;
    dialog.showModal();load();
  });
  homes.addEventListener('change',()=>{planningScope='home';load();});
  $('relay-settings-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{generation++;$('relay-settings-open').focus();});
  return {render};
};
