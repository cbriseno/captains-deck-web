/* Proposal-only replacement for progress(). The production renderer is unchanged. */
window.proposalProgress = function (x, detail, compact) {
  const el=(tag,cls,text)=>{const v=document.createElement(tag);v.className=cls;v.textContent=text||'';return v;};
  const box=el('div','prog proposal-progress'),state=x.demoState;
  if(!state)return box;
  box.dataset.case=state;box.proposalNode=x;box.proposalDetail=detail;box.proposalCompact=compact;
  const fixed={waiting:['◷','Espera una dependencia'],parked:['Ⅱ','Estacionado · espera revisión'],stale:['?','Actividad sin confirmar']};
  if(fixed[state]){box.append(el('span','p-symbol',fixed[state][0]),el('span','p-label',fixed[state][1]));return box;}
  const measured=state==='measured',kind=document.documentElement.dataset.concept||'a';
  const glyph=el('span','p-glyph p-'+kind),text=el('span','p-label',measured?'Trabajando':'Trabajando · sin medición');
  box.dataset.measured=String(measured);
  if(measured){
    glyph.setAttribute('role','progressbar');glyph.setAttribute('aria-label','Pasos completados');
    glyph.setAttribute('aria-valuenow','2');glyph.setAttribute('aria-valuemin','0');glyph.setAttribute('aria-valuemax','5');
    glyph.setAttribute('aria-valuetext','2 de 5 pasos completados');
  }else glyph.setAttribute('aria-hidden','true');
  if(kind==='a')glyph.append(el('i','p-fill'));
  if(kind==='b')glyph.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><circle class="p-track" cx="16" cy="16" r="12"/><circle class="p-arc" cx="16" cy="16" r="12"/></svg>';
  if(kind==='c'){if(measured)for(let i=0;i<5;i++)glyph.append(el('i',i<2?'p-step done':'p-step'));else glyph.textContent='…';}
  if(kind==='d')glyph.textContent=measured?'2 / 5':'—';
  if(kind==='e')glyph.textContent=measured?'✓ Diseño → Conexión':'→ Investigación';
  box.append(glyph,text);
  if(measured){text.textContent=kind==='d'?'pasos · Trabajando':kind==='e'?'2 de 5 pasos':kind==='c'?'2 de 5 · Trabajando':'40% · Trabajando';}
  if(detail&&measured){const d=el('details','p-details'),s=el('summary','','Ver los cinco pasos');d.append(s);const list=el('ol','');
    ['✓ Lectura','✓ Diseño','→ Conexión','○ Comprobación','○ Entrega'].forEach(t=>list.append(el('li','',t)));d.append(list);box.append(d);}
  return box;
};
