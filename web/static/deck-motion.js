/* Visual continuity after a real render. This module never changes work state. */
'use strict';
window.createDeckMotion = function ({t, settled}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const visible = r => r && r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
  let generation = 0, layer = null, animations = [], hidden = new Map(), pending = false;
  let notice = null, noticeTimer, layerStarted = 0;
  const api = {animating:false, capture, play, cancel};

  function reveal(el) {
    const value = hidden.get(el);
    if (!value) return;
    if (value.value) el.style.setProperty('visibility', value.value, value.priority);
    else el.style.removeProperty('visibility');
    hidden.delete(el);
  }

  // A replacement capture owns the next routing update. Old promise finalizers
  // must never remove a newer layer or restore its hidden destination cards.
  function cleanup() {
    generation++;
    for (const animation of animations) animation.cancel();
    animations = [];
    for (const el of hidden.keys()) reveal(el);
    if(layer)window.DeckTrace?.add('overlay.hide',{overlay:'motion',visible_s:Math.round(((globalThis.performance?.now?.() ?? Date.now())-layerStarted)/1000),response:window.DeckTrace.response});
    layer?.remove(); layer = null;
    api.animating = false;
    pending = false;
    clearTimeout(noticeTimer);
    if (notice) notice.hidden = true;
  }
  function cancel() {
    const notify = pending;
    cleanup();
    if (notify) settled();
  }
  function clone(el) {
    const copy = el.cloneNode(true);
    for (const child of [copy, ...copy.querySelectorAll('*')]) {
      for (const key of ['id', 'data-node', 'data-key', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'aria-owns', 'for']) child.removeAttribute(key);
    }
    copy.inert = true;
    copy.setAttribute('aria-hidden', 'true');
    return copy;
  }
  function capture(mode) {
    cleanup();
    const board = document.getElementById('board');
    if (!board || (reduced.matches && mode === 'filter')) return null;
    pending = true;
    const snapshot = {mode, board, generation, cards:new Map(), immediate:reduced.matches, played:false};
    if (mode === 'filter') {
      // Exactly one board snapshot: no card measurements or duplicate clones.
      const style = getComputedStyle(board);
      snapshot.copy = clone(board);
      snapshot.rect = board.getBoundingClientRect();
      snapshot.grid = style.gridTemplateColumns;
      snapshot.display = style.display;
      snapshot.gap = style.gap;
      snapshot.scroll = [board, ...board.querySelectorAll('*')].map(el => [el.scrollLeft, el.scrollTop]);
    } else {
      for (const el of board.querySelectorAll('.task-card')) {
        const rect = reduced.matches ? null : el.getBoundingClientRect();
        snapshot.cards.set(el.dataset.key, {rect, ghost:visible(rect) ? clone(el) : null,
          column:el.closest('.col')?.dataset.k, state:el.dataset.state});
      }
    }
    return snapshot;
  }
  function overlay() {
    if (!layer) {
      layerStarted=(globalThis.performance?.now?.() ?? Date.now());window.DeckTrace?.add('overlay.show',{overlay:'motion',visible_s:0,response:window.DeckTrace.response});
      layer = document.createElement('div'); layer.className = 'deck-motion-layer';
      layer.inert = true; layer.setAttribute('aria-hidden', 'true'); document.body.append(layer);
    }
    return layer;
  }
  function animate(el, frames, duration) {
    const trace=window.DeckTrace, started=(globalThis.performance?.now?.() ?? Date.now());trace?.add('anim.start',{animation:'motion',duration_ms:duration});
    const animation = el.animate(frames, {duration, easing:'cubic-bezier(.2,.7,.2,1)', fill:'forwards'});
    animations.push(animation);
    return animation.finished.then(()=>trace?.add('anim.end',{animation:'motion',duration_ms:Math.round((globalThis.performance?.now?.() ?? Date.now())-started)}),()=>{trace?.add('anim.cancel',{animation:'motion',duration_ms:Math.round((globalThis.performance?.now?.() ?? Date.now())-started)});trace?.anomaly();});
  }
  function destination(el, key) {
    const column = el.closest('.col')?.dataset.k;
    const label = el.dataset.state === 'ready' ? t('Follow') : document.getElementById('state-column-'+column)?.querySelector('h2')?.textContent || t('Updated');
    return {column, key, label};
  }
  function showDestination(target) {
    if (!notice) {
      notice = document.createElement('div'); notice.id = 'deck-move-notice'; notice.className = 'deck-move-notice';
      notice.setAttribute('role', 'status'); document.body.append(notice);
    }
    const text = document.createElement('span'); text.textContent = t('Moved to {name}', {name:target.label});
    const button = document.createElement('button'); button.type = 'button'; button.textContent = t('View card');
    button.addEventListener('click', () => {
      if (matchMedia('(max-width:640px)').matches) document.getElementById('state-tab-'+target.column)?.click();
      [...document.querySelectorAll('#board .task-card')].find(el => el.dataset.key === target.key)?.scrollIntoView({block:'nearest', behavior:reduced.matches ? 'auto' : 'smooth'});
    });
    notice.replaceChildren(text, button); notice.hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.hidden = true; }, 4200);
  }
  async function play(before, keepVisible=null) {
    if (before && (before.generation !== generation || before.played)) return;
    if (!before) { cleanup(); settled(); return; }
    before.played = true;
    const token = generation, board = document.getElementById('board');
    if (board !== before.board) { cancel(); return; }
    if (reduced.matches || before.immediate) {
      let target;
      for (const el of board.querySelectorAll('.task-card')) {
        const old = before.cards.get(el.dataset.key);
        if (old && (old.column !== el.closest('.col')?.dataset.k || old.state !== el.dataset.state)) target = destination(el, el.dataset.key);
      }
      cleanup(); settled();
      if (target) showDestination(target);
      return;
    }
    api.animating = true;
    let target;
    try {
      if (before.mode === 'filter') {
        const copy = before.copy, r = before.rect; copy.classList.add('deck-board-snapshot');
        Object.assign(copy.style, {position:'absolute', left:r.left+'px', top:r.top+'px', width:r.width+'px', height:r.height+'px',
          margin:'0', display:before.display, gridTemplateColumns:before.grid, gap:before.gap});
        overlay().append(copy);
        [copy, ...copy.querySelectorAll('*')].forEach((el, i) => { [el.scrollLeft, el.scrollTop] = before.scroll[i]; });
        await Promise.all([animate(copy, [{opacity:1}, {opacity:0}], 150), animate(board, [{opacity:0}, {opacity:1}], 180)]);
      } else {
        // Read all destination geometry before hiding cards or inserting ghosts.
        const after = new Map([...board.querySelectorAll('.task-card')].map(el => [el.dataset.key, {el, rect:el.getBoundingClientRect()}]));
        const moving = [];
        for (const [key, old] of before.cards) {
          const current = after.get(key), el = current?.el, r = current?.rect;
          // A board refresh keeps its open editor live, including focus.
          if(keepVisible&&el?.contains(keepVisible))continue;
          const changed = el && (old.column !== el.closest('.col')?.dataset.k || old.state !== el.dataset.state);
          if (!old.ghost) continue;
          if (visible(r) && !changed && Math.abs(old.rect.left-r.left)<1 && Math.abs(old.rect.top-r.top)<1 &&
              Math.abs(old.rect.width-r.width)<1 && Math.abs(old.rect.height-r.height)<2) continue;
          const ghost = old.ghost; ghost.classList.add('deck-motion-ghost');
          Object.assign(ghost.style, {left:old.rect.left+'px', top:old.rect.top+'px', width:old.rect.width+'px', height:old.rect.height+'px'});
          overlay().append(ghost);
          let frames;
          if (changed) {
            target = destination(el, key);
            const caption = document.createElement('span'); caption.className = 'deck-motion-caption'; caption.textContent = '→ '+target.label; ghost.append(caption);
          }
          if (visible(r)) {
            hidden.set(el, {value:el.style.getPropertyValue('visibility'), priority:el.style.getPropertyPriority('visibility')});
            el.style.setProperty('visibility', 'hidden');
            frames = [{transform:'translate(0,0) scale(1)', opacity:1},
              {transform:`translate(${r.left-old.rect.left}px,${r.top-old.rect.top}px) scale(${r.width/old.rect.width},${r.height/old.rect.height})`, opacity:1}];
          } else if (changed) {
            const tab = document.getElementById('state-tab-'+target.column)?.getBoundingClientRect();
            const x = visible(tab) ? tab.left+tab.width/2 : Math.max(24, Math.min(innerWidth-24, (r?.left ?? old.rect.left)+40));
            const y = visible(tab) ? tab.top+tab.height/2 : Math.max(24, Math.min(innerHeight-24, r?.top || innerHeight-24));
            ghost.style.transformOrigin = 'center';
            frames = [{transform:'translate(0,0) scale(1)', opacity:1},
              {transform:`translate(${x-old.rect.left-old.rect.width/2}px,${y-old.rect.top-old.rect.height/2}px) scale(.12)`, opacity:0}];
          } else frames = [{opacity:1, transform:'translateY(0)'}, {opacity:0, transform:'translateY(-14px) scale(.94)'}];
          moving.push(animate(ghost, frames, changed ? 380 : 240).then(() => {
            if (token !== generation) return;
            ghost.remove();
            if (visible(r)) {
              reveal(el);
              if (changed) return animate(el, [{opacity:.45}, {opacity:1}], 120);
            }
          }));
        }
        for (const [key, {el, rect}] of after) {
          if(keepVisible&&el.contains(keepVisible))continue;
          const old = before.cards.get(key);
          if (old?.ghost || !visible(rect)) continue;
          if (old && (old.column !== el.closest('.col')?.dataset.k || old.state !== el.dataset.state)) target = destination(el, key);
          moving.push(animate(el, [{opacity:0, transform:'translateY(10px)'}, {opacity:1, transform:'translateY(0)'}], 220));
        }
        await Promise.all(moving);
      }
    } finally {
      if (token === generation) {
        cleanup(); settled();
        if (target) showDestination(target);
      }
    }
  }
  reduced.addEventListener('change', cancel);
  window.addEventListener('pagehide', () => { cleanup(); });
  return api;
};
