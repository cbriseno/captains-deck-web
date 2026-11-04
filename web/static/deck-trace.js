/* Bounded, structural browser diagnostics. Task keys never leave this page. */
'use strict';
window.DeckTrace = (() => {
  const events = [], ids = new Map(), moves = new Map();
  let send = null, lastFlush = 0, timer = 0, serial = 0, response = 'none', focusSince = 0;
  const now = () => Date.now();
  function id(key) { if (!ids.has(key)) {if(ids.size>=4000){ids.clear();moves.clear();}ids.set(key, String(++serial));} return ids.get(key); }
  function add(e, fields = {}) {
    const t = now(); events.push({e, age:0, ...fields, _t:t});
    while (events.length > 2000 || (events[0] && events[0]._t < t - 600000)) events.shift();
  }
  function anomaly() {
    if (timer || now() - lastFlush < 60000) return;
    timer = setTimeout(() => { timer = 0; flush(false).catch(()=>{}); }, 30000);
  }
  async function flush(exporting) {
    if (!send || (!exporting && now() - lastFlush < 60000)) return;
    clearTimeout(timer); timer = 0; lastFlush = now();
    layout();
    const t = now(), available = events.filter(x => exporting || x._t >= t - 60000);
    const selected = new Set();
    for (const name of ['layout','card.move','card.render','anim.start','anim.end','anim.cancel','overlay.show','overlay.hide','reconcile.mismatch']) {
      const latest = [...available].reverse().find(x => x.e === name); if (latest) selected.add(latest);
    }
    for (let i=available.length-1; i>=0 && selected.size<100; i--) selected.add(available[i]);
    const chosen = available.filter(x=>selected.has(x))
      .map(({_t, ...x}) => ({...x, age:Math.min(600, Math.max(0, Math.round((t-_t)/1000)))}));
    if (chosen.length) await send(chosen, exporting);
  }
  function layout() {
    const ua = navigator.userAgent;
    add('layout', {width:innerWidth, height:innerHeight, dpr:Math.round(devicePixelRatio*100)/100,
      reduced:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'yes':'no',
      browser:/Firefox\//.test(ua)?'firefox':/Edg\//.test(ua)?'edge':/Chrome\//.test(ua)?'chrome':/Safari\//.test(ua)?'safari':'other'});
  }
  layout(); addEventListener('resize', layout);
  return {add, anomaly, flush, get response() {return response;}, setResponse(value) {response=value; if(value==='receipt')setTimeout(()=>{if(focusSince||document.querySelector('.deck-motion-layer .qcard'))anomaly();},3000);}, setSender(fn) {send=fn;}, counts() {const c={};for(const x of events)c[x.e]=(c[x.e]||0)+1;return c;},
    focus(active) {if(active&&!focusSince){focusSince=now();add('overlay.show',{overlay:'focus',visible_s:0,response});}else if(!active&&focusSince){add('overlay.hide',{overlay:'focus',visible_s:Math.round((now()-focusSince)/1000),response});focusSince=0;}},
    mismatch(key, from, to) {add('reconcile.mismatch',{task:id(key),from_column:from,to_column:to});anomaly();},
    move(key, from, to, cause) {
      const task=id(key); add('card.move',{task,from_column:from,to_column:to,move_cause:cause});
      const recent=(moves.get(task)||[]).filter(t=>t>now()-5000);recent.push(now());moves.set(task,recent);
      if(recent.length>2) anomaly();
    }};
})();
