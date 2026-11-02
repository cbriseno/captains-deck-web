/* Deterministic lifecycle checks of the production module, with controlled WAAPI
   promises so interruption races do not depend on wall-clock timing. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../static/deck-motion.js'), 'utf8');

function harness() {
  const records = [], clones = [], timers = new Map(), events = {}, mediaEvents = {};
  let settled = 0, timer = 0;
  const reduced = {matches:false, addEventListener(type, fn) { mediaEvents[type] = fn; }};
  class Style {
    constructor() { this.values = new Map(); }
    setProperty(key, value, priority = '') { this.values.set(key, {value, priority}); }
    getPropertyValue(key) { return this.values.get(key)?.value || ''; }
    getPropertyPriority(key) { return this.values.get(key)?.priority || ''; }
    removeProperty(key) { this.values.delete(key); }
  }
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.parentElement = null;
      this.style = new Style(); this.dataset = {}; this.attributes = {}; this.className = ''; this.id = '';
      this.rect = {left:0, top:0, width:100, height:70}; this.reads = 0; this.scrollLeft = 0; this.scrollTop = 0;
      this.listeners = {}; this.textContent = '';
    }
    get classList() { return {add: name => { this.className += ' '+name; }, contains: name => this.className.split(/\s+/).includes(name)}; }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
    replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) {
      delete this.attributes[key];
      if (key === 'id') this.id = '';
      if (key.startsWith('data-')) delete this.dataset[key.slice(5)];
    }
    querySelectorAll(selector) {
      const all = this.children.flatMap(n => [n, ...n.querySelectorAll('*')]);
      return all.filter(n => selector === '*' || (selector.startsWith('.') ? n.classList.contains(selector.slice(1)) : n.tagName === selector));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.classList.contains(selector.slice(1))) return node; return null; }
    getBoundingClientRect() { this.reads++; return {...this.rect, right:this.rect.left+this.rect.width, bottom:this.rect.top+this.rect.height}; }
    cloneNode(deep) {
      clones.push(this);
      const copy = new Element(this.tagName);
      Object.assign(copy, {className:this.className, id:this.id, dataset:{...this.dataset}, attributes:{...this.attributes}, rect:{...this.rect}});
      if (deep) copy.append(...this.children.map(n => n.cloneNode(true)));
      return copy;
    }
    animate(frames, options) {
      let resolve, reject;
      const record = {el:this, frames, options, state:'running', finished:new Promise((yes, no) => { resolve = yes; reject = no; }),
        cancel() { if (this.state === 'running') reject(Error('cancelled')); this.state = 'cancelled'; },
        finish() { if (this.state === 'running') { this.state = 'finished'; resolve(); } }};
      records.push(record); return record;
    }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    click() { this.listeners.click?.(); }
    scrollIntoView(options) { this.scrolled = options; }
  }
  const body = new Element('body'), board = new Element(); board.id = 'board'; board.className = 'board'; body.append(board);
  const document = {
    body, createElement: tag => new Element(tag),
    getElementById: id => [body, ...body.querySelectorAll('*')].find(n => n.id === id) || null,
    querySelectorAll: selector => selector === '#board .task-card' ? board.querySelectorAll('.task-card') : body.querySelectorAll(selector),
  };
  const context = vm.createContext({document, innerWidth:1200, innerHeight:800,
    matchMedia: query => query.includes('reduced-motion') ? reduced : {matches:true},
    getComputedStyle: () => ({display:'grid', gridTemplateColumns:'300px 300px', gap:'48px'}),
    setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id),
    addEventListener: (type, fn) => { events[type] = fn; },
  });
  context.window = context; vm.runInContext(source, context);
  const motion = context.createDeckMotion({t:(text, args) => text.replace('{name}', args?.name), settled:() => settled++});
  function column(key) {
    const col = new Element(); col.className = 'col'; col.dataset.k = key; col.id = 'state-column-'+key;
    const heading = new Element('h2'); heading.textContent = key; col.append(heading); board.append(col); return col;
  }
  const now = column('now'), paused = column('paused');
  function card(key, col = now, rect = {}) {
    const el = new Element(); el.className = 'task-card'; el.dataset = {key, state:'active', node:'canonical-'+key};
    Object.assign(el.rect, rect); col.append(el); return el;
  }
  async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  async function finish() { for (let i = 0; i < 3; i++) { records.filter(r => r.state === 'running').forEach(r => r.finish()); await flush(); } }
  function clean() {
    assert.equal(body.querySelectorAll('.deck-motion-layer').length, 0);
    assert.equal(motion.animating, false);
    assert.equal(records.filter(r => r.state === 'running').length, 0);
  }
  return {motion, board, body, now, paused, card, records, clones, document, Element, timers, events, reduced, mediaEvents,
    get settled() { return settled; }, flush, finish, clean};
}

test('bulk filter clones one board, reads no card rectangles, and uses two opacity animations', async () => {
  const h = harness(); for (let i = 0; i < 120; i++) h.card(String(i));
  const old = h.motion.capture('filter');
  assert.equal(h.clones.filter(el => el === h.board).length, 1);
  assert.ok(h.board.querySelectorAll('.task-card').every(el => el.reads === 0));
  const playing = h.motion.play(old);
  assert.equal(h.body.querySelectorAll('.deck-motion-ghost').length, 0);
  assert.equal(h.records.length, 2);
  assert.deepEqual(h.records.map(r => r.options.duration), [150, 180]);
  for (const record of h.records) for (const frame of record.frames) assert.deepEqual(Object.keys(frame), ['opacity']);
  assert.equal(h.settled, 0); await h.finish(); await playing; h.clean(); assert.equal(h.settled, 1);
});

test('snapshot strips identities and accessibility references and retains scroll offsets', async () => {
  const h = harness(), card = h.card('one'); card.id = 'original';
  for (const name of ['aria-controls', 'aria-labelledby', 'aria-describedby', 'aria-owns', 'for']) card.setAttribute(name, 'original');
  h.board.scrollTop = 45; h.now.scrollLeft = 12; h.now.scrollTop = 80;
  const before = h.motion.capture('filter'), playing = h.motion.play(before);
  for (const copy of [before.copy, ...before.copy.querySelectorAll('*')]) {
    assert.equal(copy.id, ''); assert.equal(copy.dataset.key, undefined); assert.equal(copy.dataset.node, undefined);
    assert.deepEqual(Object.keys(copy.attributes).filter(k => k !== 'aria-hidden'), []);
  }
  assert.equal(before.copy.scrollTop, 45); assert.equal(before.copy.querySelector('.col').scrollTop, 80);
  assert.equal(before.copy.inert, true); await h.finish(); await playing;
});

test('state travel labels its destination, hands off to a finite arrival, and routes once', async () => {
  const h = harness(), card = h.card('one'), before = h.motion.capture('state');
  h.paused.append(card); card.dataset.state = 'paused'; card.rect.left = 400;
  const playing = h.motion.play(before);
  assert.equal(card.style.getPropertyValue('visibility'), 'hidden');
  assert.equal(h.body.querySelector('.deck-motion-caption').textContent, '→ paused');
  assert.equal(h.records[0].options.duration, 380);
  assert.ok(h.records[0].frames[1].transform.includes('400px'));
  h.records[0].finish(); await h.flush();
  assert.equal(card.style.getPropertyValue('visibility'), '');
  assert.equal(h.records[1].options.duration, 120); assert.equal(h.motion.animating, true);
  await h.finish(); await playing; h.clean(); assert.equal(h.settled, 1);
  const notice = h.document.getElementById('deck-move-notice');
  assert.equal(notice.hidden, false); notice.querySelector('button').click(); assert.equal(card.scrolled.behavior, 'smooth');
});

test('hidden destination travels toward its visible phone tab and can be revealed', async () => {
  const h = harness(), card = h.card('one'), before = h.motion.capture('state');
  const tab = new h.Element('button'); tab.id = 'state-tab-paused'; tab.rect = {left:250, top:10, width:100, height:30};
  let selected = 0; tab.addEventListener('click', () => selected++); h.body.append(tab);
  h.paused.append(card); card.dataset.state = 'paused'; card.rect.width = 0;
  const playing = h.motion.play(before);
  assert.equal(h.records[0].frames[1].opacity, 0);
  assert.ok(h.records[0].frames[1].transform.includes('250px,-10px'));
  await h.finish(); await playing;
  h.document.getElementById('deck-move-notice').querySelector('button').click(); assert.equal(selected, 1); h.clean();
});

test('empty board arrivals, removals, and width-only reflow animate finitely', async () => {
  const h = harness(), empty = h.motion.capture('state'), card = h.card('one');
  let playing = h.motion.play(empty); assert.equal(h.records[0].options.duration, 220); await h.finish(); await playing;
  let before = h.motion.capture('state'); card.rect.width = 200;
  playing = h.motion.play(before); assert.ok(h.records.at(-1).frames[1].transform.includes('scale(2,1)')); await h.finish(); await playing;
  before = h.motion.capture('state'); card.remove(); playing = h.motion.play(before);
  assert.equal(h.records.at(-1).frames[1].opacity, 0); await h.finish(); await playing; h.clean(); assert.equal(h.settled, 3);
});

test('unchanged renders have no overlay or animations', async () => {
  const h = harness(); h.card('one'); await h.motion.play(h.motion.capture('state'));
  assert.equal(h.records.length, 0); h.clean(); assert.equal(h.settled, 1);
});

test('rapid replacements suppress stale completion, snapshots, and duplicate play', async () => {
  const h = harness(); h.card('one'); const first = h.motion.capture('filter'), playing = h.motion.play(first);
  const second = h.motion.capture('filter'), latest = h.motion.play(second);
  await playing; await h.motion.play(first); await h.motion.play(second);
  assert.equal(h.settled, 0); assert.equal(h.body.querySelectorAll('.deck-motion-layer').length, 1);
  assert.equal(h.records.length, 4); await h.finish(); await latest; assert.equal(h.settled, 1); h.clean();
});

test('cancellation restores prior visibility priority without touching board opacity', async () => {
  const h = harness(), card = h.card('one'); card.style.setProperty('visibility', 'visible', 'important');
  h.board.style.setProperty('opacity', '.8'); const before = h.motion.capture('state'); card.rect.left = 400;
  const playing = h.motion.play(before); h.motion.cancel(); await playing;
  assert.equal(card.style.getPropertyValue('visibility'), 'visible'); assert.equal(card.style.getPropertyPriority('visibility'), 'important');
  assert.equal(h.board.style.getPropertyValue('opacity'), '.8'); assert.equal(h.settled, 1); h.clean();
});

test('reduced motion is immediate and a mid-flight change cancels just once', async () => {
  const h = harness(); h.card('one'); h.reduced.matches = true;
  const before = h.motion.capture('filter'); assert.equal(before, null); await h.motion.play(before);
  assert.equal(h.clones.length, 0); assert.equal(h.records.length, 0); assert.equal(h.settled, 1);
  h.reduced.matches = false; const next = h.motion.capture('filter'), playing = h.motion.play(next);
  h.reduced.matches = true; h.mediaEvents.change(); await playing; assert.equal(h.settled, 2); h.clean();
  await h.motion.play(next); assert.equal(h.settled, 2);
});

test('reduced state moves retain their destination cue without geometry reads or clones', async () => {
  const h = harness(), card = h.card('one'); h.reduced.matches = true;
  const before = h.motion.capture('state'); h.paused.append(card); card.dataset.state = 'paused';
  await h.motion.play(before); assert.equal(h.clones.length, 0); assert.equal(card.reads, 0);
  assert.equal(h.records.length, 0); assert.equal(h.settled, 1); h.clean();
  const notice = h.document.getElementById('deck-move-notice'); assert.equal(notice.hidden, false);
  notice.querySelector('button').click(); assert.equal(card.scrolled.behavior, 'auto');
});

test('a previously offscreen card arrives once and cancelled unplayed snapshots stay stale', async () => {
  const h = harness(), card = h.card('one', undefined, {top:900});
  const stale = h.motion.capture('state'), before = h.motion.capture('state');
  card.rect.top = 50; h.paused.append(card); card.dataset.state = 'paused';
  await h.motion.play(stale); assert.equal(h.records.length, 0); assert.equal(h.settled, 0);
  const playing = h.motion.play(before); assert.equal(h.records.length, 1); assert.equal(h.records[0].options.duration, 220);
  await h.finish(); await playing; h.clean(); assert.equal(h.settled, 1);
  assert.equal(h.document.getElementById('deck-move-notice').hidden, false);
});

test('cancelling during the arrival cannot start another animation or leave a ghost', async () => {
  const h = harness(), card = h.card('one'), before = h.motion.capture('state'); card.dataset.state = 'ready';
  const playing = h.motion.play(before); h.records[0].finish(); await h.flush();
  assert.equal(h.records.length, 2); h.motion.cancel(); await playing;
  assert.equal(h.settled, 1); assert.equal(h.document.getElementById('deck-move-notice'), null); h.clean();
});

test('pagehide clears active effects, notices, and notice timers', async () => {
  const h = harness(), card = h.card('one'), before = h.motion.capture('state'); card.dataset.state = 'ready';
  const playing = h.motion.play(before); await h.finish(); await playing;
  assert.equal(h.timers.size, 1); h.events.pagehide(); assert.equal(h.timers.size, 0);
  assert.equal(h.document.getElementById('deck-move-notice').hidden, true); h.clean();
  const next = h.motion.capture('state'); card.rect.left = 400;
  const active = h.motion.play(next); h.events.pagehide(); await active;
  assert.equal(card.style.getPropertyValue('visibility'), ''); assert.equal(h.settled, 1); h.clean();
});

test('a failed animation still cleans hidden destinations and settles routing', async () => {
  const h = harness(), card = h.card('one'), before = h.motion.capture('state'); card.rect.left = 400;
  before.cards.get('one').ghost.animate = () => { throw Error('animation failed'); };
  await assert.rejects(h.motion.play(before), /animation failed/);
  assert.equal(card.style.getPropertyValue('visibility'), ''); assert.equal(h.settled, 1); h.clean();
});
