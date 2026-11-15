'use strict';
/* Polling never replaces a settings draft. Only explicit buttons submit changes. */
window.createRelaySettings = function ({t, node:n, button:b, api, state}) {
  const $=id=>document.getElementById(id);
  const dialog=$('relay-settings-dialog'), content=$('relay-settings-content'), homes=$('relay-settings-home');
  const resultSlot=$('relay-settings-result');
  let generation=0, source=null, busy=false, receipts=[], planningScope='home';
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
    content.append(n('h3','',t('Context thresholds')),
      n('p','muted',t('Zero disables an axis. Either enabled limit can trigger a relay. The checker needs a reported window to evaluate percentages; without one, the percentage is unknown and the token limit still applies.')));
    for(const role of ['primary','worker']){
      content.append(n('h4','',t(role==='primary'?'Primary':'Worker')));
      for(const harness of ['claude','codex']){
        content.append(n('strong','',harness==='claude'?'Claude':'Codex'));
        for(const axis of ['percent','tokens']){
          const row=relay.thresholds.find(row=>row.role===role&&row.harness===harness&&row.axis===axis);
          const input=n('input');input.type='number';input.min='0';input.step='any';if(axis==='percent')input.max='100';input.value=row.value;input.name=[role,harness,axis].join('-');enable(input,allowed('threshold'));
          const save=enable(b(t('Save threshold'),async()=>{
            if(!input.checkValidity()||input.value===''){input.reportValidity();return;}
            pending(true);try{const result=await api(route(homes.value,'apply'),{action:'threshold',role,harness,axis,value:Number(input.value)});resultSlot.textContent=t(result.message);await load();}catch(err){resultSlot.textContent=err.message;}finally{pending(false);}
          }),allowed('threshold'));
          content.append(field(axis==='percent'?'Percent':'Tokens',input),save,
            n('p','muted',t('Source')+': '+(row.source==='threshold_tokens'?'threshold_tokens (fallback)':row.source==='default'?t('Default: disabled'):row.source)+' · '+t('Effective limit')+': '+t(row.value>0?'Enabled':'Disabled')+' · '+row.value+(axis==='percent'?'%':' '+t('tokens'))));
        }
      }
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
      await apply(home,body);
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
  for(const modal of [dialog])modal.addEventListener('keydown',event=>event.stopPropagation());
  $('relay-settings-open').addEventListener('click',()=>{
    planningScope='home';
    homes.replaceChildren(...(state.board?.homes||[]).map(home=>new Option(home.label,home.id)));
    if(state.board?.home)homes.value=state.board.home;
    dialog.showModal();load();
  });
  homes.addEventListener('change',()=>{planningScope='home';load();});
  $('relay-settings-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{generation++;$('settings-open').focus();});
  return {render};
};
