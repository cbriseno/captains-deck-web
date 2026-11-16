/* Proposal-only layer: real Deck rows; no production import. */
window.proposalProgress = function(x, detail) {
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;n.textContent=text||'';return n;};
  const box=el('div','prog proposal-progress');box.proposalNode=x;
  const fixed={waiting:'Espera una dependencia',parked:'Estacionado · espera revisión',stale:'Actividad sin confirmar · dato viejo'};
  if(fixed[x.demoState]){box.append(el('span','p-state',fixed[x.demoState]));return box;}
  const measured=x.progress_evidence?.current===true&&x.progress_evidence?.freshness==='current'&&x.progress?.total;
  if(measured){
    const bar=el('span','p-measure');bar.append(el('i',''));bar.setAttribute('role','progressbar');
    Object.entries({'aria-label':'Pasos completados','aria-valuenow':'2','aria-valuemin':'0','aria-valuemax':'5','aria-valuetext':'2 de 5 pasos completados'}).forEach(([k,v])=>bar.setAttribute(k,v));
    box.append(bar,el('span','p-label','2 de 5 pasos · 40%'));
  }else box.append(el('span','p-label','Avance sin medir'));
  if(detail&&measured){const d=el('details',''),s=el('summary','','Ver pasos');d.append(s);const l=el('ol','');['✓ Lectura','✓ Diseño','→ Conexión','○ Comprobación','○ Entrega'].forEach(t=>l.append(el('li','',t)));d.append(l);box.append(d);}
  return box;
};
window.installProposalPatterns = function(){
  const root=document.documentElement,board=document.querySelector('#board');
  const names={a:'Trabajando',b:'Trabajando',c:'En curso',d:'',e:'Trabajando',f:'Trabajando'};
  function decorate(){for(const row of board.querySelectorAll('.request-row')){
    const x=row.querySelector('.proposal-progress')?.proposalNode;if(!x)continue;
    const signal=row.querySelector('.request-signal');if(!signal)continue;
    const active=x.demoState.startsWith('active');row.dataset.proposalActive=String(active);
    const text=active?(root.dataset.concept==='d'?x.demoVerb:names[root.dataset.concept]||names.a):({waiting:'En espera',parked:'Estacionado',stale:'Sin confirmar'}[x.demoState]);
    if(signal.textContent!==text)signal.textContent=text;
    const meta=row.querySelector('.request-meta');let trace=meta.querySelector('.p-trace');
    let next=row.querySelector('.p-next');
    if(!next){next=document.createElement('span');next.className='p-next';row.querySelector('.request-stage').append(next);}
    const steps=x.progress_evidence?.current===true?x.progress?.steps||[]:[];
    const current=steps.findIndex(s=>s.state==='active');
    const upcoming=current<0?null:steps.slice(current+1).find(s=>s.state==='todo');
    const nextText=active?'Sigue: '+(upcoming?.label||upcoming?.title||'sin declarar'):'';
    if(next.textContent!==nextText)next.textContent=nextText;
    if(!trace){trace=document.createElement('span');trace.className='p-trace';meta.append(trace);}
    const traceText=active?'Último: '+x.demoEvent+' · hace 2 min':'';
    if(trace.textContent!==traceText)trace.textContent=traceText;
  }}
  window.addEventListener('message',event=>{
    if(event.source!==parent||event.data?.proposal!=='appearance')return;
    const {concept,theme}=event.data;if(Object.hasOwn(names,concept))root.dataset.concept=concept;
    window.DeckAppearance?.set('mode',theme);decorate();
  });
  new ResizeObserver(()=>parent.postMessage({proposal:'height',height:document.querySelector('.app').scrollHeight+20},'*')).observe(document.body);
  new MutationObserver(decorate).observe(board,{childList:true,subtree:true});decorate();
};
