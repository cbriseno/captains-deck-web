/* Proposal-only renderer and decorations; never loaded by the production app. */
window.proposalProgress = function (x, detail, compact) {
  const el=(tag,cls,text)=>{const v=document.createElement(tag);v.className=cls;v.textContent=text||'';return v;};
  const box=el('div','prog proposal-progress'),state=x.demoState;
  if(!state)return box;
  box.dataset.case=state;box.proposalNode=x;box.proposalDetail=detail;box.proposalCompact=compact;
  const fixed={waiting:['◷','Espera una dependencia'],parked:['Ⅱ','Estacionado · espera revisión'],stale:['?','Actividad sin confirmar']};
  if(fixed[state]){box.append(el('span','p-symbol',fixed[state][0]),el('span','p-label',fixed[state][1]));return box;}
  const measured=state==='measured';box.dataset.measured=String(measured);
  if(measured){
    const bar=el('span','p-measure');bar.append(el('i',''));
    bar.setAttribute('role','progressbar');bar.setAttribute('aria-label','Pasos completados');
    bar.setAttribute('aria-valuenow','2');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','5');
    bar.setAttribute('aria-valuetext','2 de 5 pasos completados');box.append(bar);
  }
  box.append(el('span','p-label',measured?'40% · 2 de 5 pasos':'Trabajando · sin medición'));
  if(detail&&measured){const d=el('details','p-details'),s=el('summary','','Ver los cinco pasos');d.append(s);const list=el('ol','');
    ['✓ Lectura','✓ Diseño','→ Conexión','○ Comprobación','○ Entrega'].forEach(t=>list.append(el('li','',t)));d.append(list);box.append(d);}
  return box;
};
window.installProposalPatterns = function () {
  const board=document.querySelector('#board');
  window.addEventListener('message',event=>{
    if(event.source!==parent||event.data?.proposal!=='appearance')return;
    const {concept,motion,theme}=event.data;
    if(['a','b','c','d','e','f','g','h','i','j'].includes(concept))document.documentElement.dataset.concept=concept;
    document.documentElement.dataset.motion=String(motion===true);
    window.DeckAppearance?.set('mode',theme);
  });
  new ResizeObserver(()=>parent.postMessage({proposal:'height',height:document.body.scrollHeight+20},'*')).observe(document.body);
  const decorate=()=>{for(const row of board.querySelectorAll('.request-row[data-activity=active]')){
    const head=row.querySelector('.request-head');
    if(!head||head.querySelector(':scope > .p-live'))continue;
    const layer=document.createElement('span');layer.className='p-live';layer.setAttribute('aria-hidden','true');
    layer.innerHTML='<i class="p-field"></i><i class="p-echo"></i>';
    head.append(layer);
    const signal=row.querySelector('.request-signal');
    if(signal){const mark=document.createElement('span');mark.className='p-mark';mark.setAttribute('aria-hidden','true');mark.innerHTML='<i></i><i></i><i></i>';signal.prepend(mark);}
  }};
  new MutationObserver(decorate).observe(board,{childList:true,subtree:true});decorate();
};
