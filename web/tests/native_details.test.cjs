/* Run the real board script against a minimal DOM. Only the board transitions are asserted. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

class Element {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parentElement = null;
    this.style = {setProperty() {}}; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.className = ''; this.id = ''; this.value = ''; this.open = false; this.text = ''; }
  get classList() { return {contains: (name) => this.className.split(/\s+/).includes(name)}; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children.at(-1) || null; }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this.text; }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  detach() { if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body; if (this.parentElement) { const list = this.parentElement.children; list.splice(list.indexOf(this), 1); this.parentElement = null; } }
  insert(node, index) { node = typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node; node.detach(); node.parentElement = this; this.children.splice(index, 0, node); }
  append(...nodes) { for (const n of nodes) this.insert(n, this.children.length); }
  replaceChildren(...nodes) { for (const c of this.children) c.parentElement = null; this.children = []; this.append(...nodes); }
  insertBefore(node, ref) { this.insert(node, ref ? this.children.indexOf(ref) : this.children.length); }
  replaceWith(node) { const parent = this.parentElement, index = parent.children.indexOf(this); this.detach(); parent.insert(node, index); }
  remove() { this.detach(); }
  contains(node) { for (let n = node; n; n = n.parentElement) if (n === this) return true; return false; }
  closest(selector) { for (let n = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; }
  matches(selector) { if(selector === '[data-uploading]') return this.dataset.uploading !== undefined; const m = selector.match(/^([a-z0-9]*)((?:\.[\w-]+)*)$/); if (!m) throw new Error('Unsupported selector ' + selector);
    const classes = (m[2] || '').split('.').filter(Boolean); const own = this.className.split(/\s+/);
    return (!m[1] || this.tagName === m[1].toUpperCase()) && classes.every(c => own.includes(c)); }
  querySelectorAll(selector) {
    const direct = selector.startsWith(':scope > '), target = direct ? selector.slice(10) : selector, out = [];
    const walk = (node) => { for (const c of node.children) { if (c.matches(target) && (!direct || c.parentElement === this)) out.push(c); walk(c); } };
    walk(this); return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
}

function makeDom() {
  const doc = { byId: new Map(), activeElement: null, hidden: false, documentElement: new Element('html', null) };
  doc.documentElement.ownerDocument = doc;
  doc.body = new Element('body', doc); doc.activeElement = doc.body;
  doc.createElement = (tag) => new Element(tag, doc);
  doc.createTextNode = (text) => { const n = new Element('#text', doc); n.text = String(text); return n; };
  const descendants = (node) => [node, ...node.children.flatMap(descendants)];
  doc.getElementById = (id) => {
    for (const root of doc.byId.values()) { const found = descendants(root).find(n => n.id === id); if (found) return found; }
    const el = new Element('div', doc); el.id = id; doc.byId.set(id, el); return el;
  };
  doc.querySelectorAll = () => [];
  doc.querySelector = (selector) => {
    if (/^#[\w-]+$/.test(selector)) return doc.getElementById(selector.slice(1));
    const nodes = [...doc.byId.values()].flatMap(descendants);
    if (selector === 'input[name="answer"]:checked') return nodes.find(n => n.tagName === 'INPUT' && n.name === 'answer' && n.checked) || null;
    return nodes.find(n => n.matches(selector)) || null;
  };
  doc.listeners = {};
  doc.addEventListener = (type, fn) => { (doc.listeners[type] ||= []).push(fn); };
  return doc;
}

function card(key, summary) {
  return { key, title: 'Synthetic task ' + key, bucket: 'underway', home: '/tmp/example/space', task: key, owner: 'Coordinator', answered: false,
    summary, context: { reason: '', phase: 'active', firstmate_action: null }, dependencies: [], presentation: null, supervisor: null, time: null };
}

function board(underway) {
  const columns = [['charted', []], ['underway', underway], ['captains_call', []], ['landed', []]].map(([id, cards]) => ({ id, title: id, cards }));
  return { homes: [{ id: '/tmp/example/space', label: 'example' }], columns, sources: [], source_ttl: 60, error: null, loading: false, csrf: 'synthetic' };
}

async function mountBoard(initial, clock = Date.UTC(2026, 0, 15, 12), tickets = {}, messages = {}, setup = {}) {
  const doc = makeDom(), timers = [], requests = [], storage = new Map(), local = setup.local || new Map();
  class FixedDate extends Date { constructor(...args) { args.length ? super(...args) : super(clock); } static now() { return clock; } }
  let current = initial;
  const fetch = async (url, options = {}) => {
    requests.push({url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null});
    if (url.startsWith('api/locale')) return { ok: true, json: async () => ({ locale: Object.keys(messages).length ? 'es' : 'en', messages }) };
    if (url.startsWith('api/board')) return { ok: true, json: async () => ({...JSON.parse(JSON.stringify(current)), history:setup.history?.records || []}) };
    if (url.startsWith('api/history')) return { ok: true, json: async () => JSON.parse(JSON.stringify(setup.history || {records: [], details: [], omitted: 0, scope: ''})) };
    if (setup.explanation && url.endsWith('/explanation')) return { ok: true, json: async () => JSON.parse(JSON.stringify(setup.explanation)) };
    if (setup.delivery && url.startsWith('api/delivery/') && !url.endsWith('/explanation')) return { ok: true, json: async () => JSON.parse(JSON.stringify(setup.delivery)) };
    if (url.startsWith('api/ticket/')) {
      const entry = tickets[decodeURIComponent(url.slice('api/ticket/'.length))];
      return typeof entry === 'function' ? entry() : { ok: true, json: async () => JSON.parse(JSON.stringify(entry)) };
    }
    return { ok: true, json: async () => ({ receipts: [] }) };
  };
  const answerTimers=[];
  const context = vm.createContext({ document: doc, fetch, navigator: {}, location: { href: 'http://example.test/', search: '' },
    matchMedia: (query) => ({ matches: !!setup.phone && /max-width/.test(query), addEventListener() {} }), setInterval: (fn) => timers.push(fn), setTimeout: (fn,ms,...args) => ms===10000 ? answerTimers.push(fn) : setTimeout(fn,ms,...args), clearTimeout,
    localStorage: { getItem(key) { return local.get(key) ?? null; }, setItem(key, value) { local.set(key, value); } },
    EventSource: class {addEventListener() {} close() {}}, AbortController, URL, URLSearchParams, Intl, Date: FixedDate, JSON, Map, Set, Promise, crypto: require('node:crypto').webcrypto, Option: function Option(text, value) { return Object.assign(new Element('option', doc), { text, value }); },
    sessionStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } } });
  context.window = context;
  context.addEventListener = () => {};
  context.DeckAppearance = {apply() {},set() {}};
  context.createRelaySettings = () => ({});
  // Isolate the retained question/report renderer. Real board behavior is
  // exercised separately through Chrome, rather than simulated by this DOM.
  context.createDeckUI = (host) => ({render() {
    const root = doc.getElementById('board'), detail = doc.getElementById('detail');
    const open = host.detailOpen(); if (open) host.parkDetail();
    root.replaceChildren(...host.state.board.columns.map(col => {
      const section = doc.createElement('section'); section.dataset.kind = col.id;
      const list = doc.createElement('div'); list.className = 'cards';
      for (const card of col.cards) {
        const article = doc.createElement('article'); article.className = 'task-card'; article.dataset.key = card.key;
        const face = doc.createElement('button'); face.className = 'card-open'; face.dataset.key = card.key;
        face.addEventListener('click', () => host.openCard(card,face));
        const more = doc.createElement('div'); more.className = 'card-more';const inner = doc.createElement('div');inner.className='card-more-inner';more.append(inner);
        article.append(face,more); list.append(article);
      }
      section.append(list);return section;
    }));
    if(open){const face=root.querySelectorAll('.card-open').find(x=>x.dataset.key===host.state.openerKey);if(face){host.state.opener=face;host.placeDetail(face);}}
    host.sourceStatus();
  },setView() {},refreshAges() {},model:{nodes:[]}});

  vm.runInContext(fs.readFileSync(path.join(root, 'static/i18n.js'), 'utf8') + '\nthis.DeckI18n = DeckI18n;', context);
  vm.runInContext(fs.readFileSync(path.join(root, 'static/deck-answers.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'static/app.js'), 'utf8'), context);
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  await flush();
  return { doc, flush, finishAnswer:async()=>{for(const fn of answerTimers.splice(0))fn();await flush();}, requests, local, poll: () => doc.getElementById('refresh').listeners.click[0](), setBoard(next) { current = next; } };
}

const underwayList = (doc) => doc.getElementById('board').children.find(s => s.dataset.kind === 'underway').querySelector('.cards');
const placeholders = (list) => list.children.filter(n => n.className === 'empty');
const cardsIn = (list) => list.children.filter(n => n.className === 'task-card');


const supervisorClock = Date.UTC(2026, 0, 15, 12);
const supervisorRow = (view) => view.doc.getElementById('supervisors').children[0];
const disclosure = (row, role) => [...row.querySelectorAll('details')].find(d => d.dataset.role === role);
const sourceSnapshot = (overrides = {}) => [{home: '/tmp/example/space', label: 'example', received_at: supervisorClock / 1000 - 3600,
  error: null, generated: new Date(supervisorClock - 7200000).toISOString(), supervisor: null, ...overrides}];


test('drawer shows the full recorded report and the registered executor without the raw evidence bundle', async () => {
  const report = 'Informe completo\n\n' + 'Detalle de evidencia sintética. '.repeat(40) + 'FIN_DEL_INFORME';
  const ticket = {key: 'web', task: 'web', title: 'Synthetic task web', bucket: 'underway', owner: 'Example home', home: '/tmp/example/space',
    context: {phase: 'active', reason: '', firstmate_action: null}, presentation: {summary: 'Short synthetic summary.', waiting_for: '', next_action: 'Next step', executor: {harness: 'codex'}},
    dependencies: [], time: null, report: {state: 'durable', text: report, time: null}, native: {state: 'working', detail: 'Synthetic', herdr: 'working'},
    agent: 'Codex', supervisor: null, original_title: 'Synthetic task web', herdr_url: ''};
  const view = await mountBoard({...board([card('web', 'Short synthetic summary.')])}, undefined, {web: ticket});
  view.doc.getElementById('detail').showModal = function () { this.open = true; };
  underwayList(view.doc).querySelector('.card-open').listeners.click[0]();
  await view.flush();
  const content = view.doc.getElementById('detail-content');
  const all = (n) => [n, ...n.children.flatMap(all)];
  assert.ok(all(content).some(e => e.tagName === 'P' && e.textContent === report));
  // One row says who is on it; there is no second "Agent" row.
  const rows = all(content).filter(e => e.className === 'context-row').map(n => n.children[0].textContent);
  assert.ok(all(content).some(e => e.tagName === 'P' && e.textContent === 'Codex'));
  assert.equal(rows.filter(r => r === 'Who’s on it' || r === 'Agent').length, 1);
  assert.ok(all(content).some(e => e.textContent === 'web'));
  assert.equal(all(content).some(e => e.className === 'technical-evidence'), false);
});

test('a ready or queued card detail does not claim a missing resume condition', async () => {
  const gate = (key, kind) => ({...card(key, 'Summary ' + key), bucket: 'charted', activity: {kind, agent: '', until: '', gap: ''},
    context: {phase: 'unknown', reason: '', firstmate_action: null}, presentation: {summary: 'Summary ' + key, waiting_for: '', next_action: null, executor: {harness: ''}},
    native: {}, report: null, agent: '', herdr_url: ''});
  const tickets = {r: gate('r', 'ready'), q: gate('q', 'queued'), h: gate('h', 'held')};
  const data = board([]); data.columns[0].cards = Object.values(tickets);
  const view = await mountBoard(data, undefined, tickets);
  const detail = async (key) => {
    const list = view.doc.getElementById('board').children.find(s => s.dataset.kind === 'charted').querySelector('.cards');
    list.children.find(n => n.dataset.key === key).querySelector('.card-open').listeners.click[0]();
    await view.flush();
    const content = view.doc.getElementById('detail-content'), kicker = view.doc.getElementById('detail-kicker').textContent;
    const rows = Object.fromEntries(descendants(content).filter(n => n.className === 'context-row').map(n => [n.children[0].textContent, n.children[1].textContent]));
    view.doc.getElementById('detail-close').listeners.click[0]();
    return [kicker, rows, content.textContent];
  };
  const missing = 'Not recorded. Firstmate hasn’t said what it needs to continue.';
  for (const [key, chip] of [['r', 'Ready to start'], ['q', 'Queued']]) {
    const [kicker, rows, text] = await detail(key);
    assert.equal(kicker, chip);
    assert.equal('Waiting for' in rows, false, key);
    assert.equal(text.includes(missing), false, key);
  }
  // Nothing recorded is no row at all, not a placeholder.
  const [kicker, rows, text] = await detail('h');
  assert.equal(kicker, 'On hold');
  assert.equal('Waiting for' in rows, false);
  assert.equal(text.includes(missing), false);
});

const descendants = (node) => [node, ...node.children.flatMap(descendants)];
function questionTicket(key, title, question, detail) {
  return {...card(key, ''), title, original_title: title, bucket: 'captains_call', agent: 'Codex',
    context: {phase: 'human'}, native: {}, call: {title: question, about: 'A sample decision is needed.',
      decide: 'Choose a sample option.', detail, options: [{value: 'sample', label: 'Sample option'}],
      freeform: true, freeform_hint: 'Sample context', close: 'release', identity: 'synthetic-hold-' + key,
      occurrence: 'synthetic-occurrence-' + key, error: ''}};
}
async function questionView(tickets, messages) {
  const data = board([]); data.columns.find(c => c.id === 'captains_call').cards = Object.values(tickets);
  const view = await mountBoard(data, undefined, tickets, messages);
  view.open = async (key) => {
    const list = view.doc.getElementById('board').children.find(n => n.dataset.kind === 'captains_call').querySelector('.cards');
    list.children.find(n => n.dataset.key === key).querySelector('.card-open').listeners.click[0]();
    await view.flush();
  };
  return view;
}

test('question context retains each work title and complete safe instructions after its options', async () => {
  const tickets = {
    alpha: questionTicket('alpha', 'Prepare sample release', 'Confirm sample workspace', 'Run sample-cli status --scope example.\n' + 'Keep the sample output. '.repeat(40) + '<script>sample()</script>'),
    beta: questionTicket('beta', 'Review sample guide', 'Choose sample format', 'Read docs/example.md, then choose a format.')
  };
  const view = await questionView(tickets);
  for (const ticket of Object.values(tickets)) {
    await view.open(ticket.key);
    assert.equal(view.requests.filter(r => r.url.startsWith('api/ticket/')).at(-1).url, 'api/ticket/' + ticket.key);
    assert.equal(view.doc.getElementById('detail-title').textContent, ticket.title);
    const content = view.doc.getElementById('detail-content'), nodes = descendants(content);
    assert.ok(nodes.some(n => n.textContent === ticket.task));
    assert.equal(nodes.some(n => n.className === 'technical-evidence'), false);
    // The question shows once; the call's own short title is not a second heading.
    assert.equal(nodes.filter(n => n.textContent === ticket.call.decide && n.tagName === 'P').length, 1);
    assert.equal(nodes.some(n => n.textContent === ticket.call.title), false);
    const instructions = nodes.find(n => n.tagName === 'P' && n.textContent === ticket.call.detail);
    assert.ok(instructions);
    assert.equal(instructions.closest('details'), null);
    // How-to text follows the choices, so the recommended one stays in view.
    assert.ok(nodes.indexOf(instructions) > nodes.findIndex(n => n.className === 'option-list'));
    assert.equal(nodes.filter(n => n.tagName === 'P' && n.textContent === ticket.call.detail).length, 1);
    assert.equal(nodes.some(n => n.tagName === 'SCRIPT'), false);
    view.doc.getElementById('detail-close').listeners.click[0]();
  }
  assert.ok(view.requests.every(r => r.method === 'GET'));
});

test('question context avoids a duplicate equal title and permits absent instructions', async () => {
  const ticket = questionTicket('same', 'Choose sample scope', 'Choose sample scope', '');
  const view = await questionView({same: ticket}); await view.open('same');
  assert.equal(view.doc.getElementById('detail-title').textContent, ticket.title);
  assert.equal(descendants(view.doc.getElementById('detail-content')).some(n => n.textContent === ticket.title), false);
  assert.ok(descendants(view.doc.getElementById('detail-content')).some(n => n.className === 'option-list'), view.doc.getElementById('detail-content').textContent);
});

test('question context never adds the call title as a second question', async () => {
  const tickets = {
    markdown: {...questionTicket('markdown', 'Decide on deploy target', 'Decide on `deploy` target', ''), original_title: 'Decide on `deploy` target'},
    report: {...questionTicket('report', 'Choose release scope', 'Choose release scope data/reports/sample.md', ''), original_title: 'Choose release scope data/reports/sample.md'},
    authored: {...questionTicket('authored', 'Deploy sample: pick a target', 'Deploy sample', '')},
    distinct: {...questionTicket('distinct', 'Prepare sample release', 'Confirm sample workspace', ''), original_title: 'Prepare sample release data/reports/sample.md'},
  };
  const view = await questionView(tickets);
  for (const ticket of Object.values(tickets)) {
    await view.open(ticket.key);
    assert.equal(view.doc.getElementById('detail-title').textContent, ticket.title);
    const nodes = descendants(view.doc.getElementById('detail-content'));
    assert.equal(nodes.some(n => n.className === 'call-question-title'), false, ticket.key);
    assert.equal(nodes.filter(n => n.className === 'question').map(n => n.textContent).join('|'), ticket.call.decide, ticket.key);
    view.doc.getElementById('detail-close').listeners.click[0]();
  }
});

test('question draft and occurrence guard survive refreshed question context without sending', async () => {
  const ticket = questionTicket('draft', 'Prepare sample release', 'Confirm sample workspace', 'Read the sample instructions.');
  const view = await questionView({draft: ticket}); await view.open('draft');
  const note = view.doc.getElementById('answer-note'); note.value = 'Retain my sample draft';
  note.listeners.input[0]({type: 'input'});
  assert.equal(view.doc.getElementById('answer-submit').disabled, false);
  await view.poll(); await view.flush();
  assert.equal(view.doc.getElementById('answer-note'), note);
  ticket.call.occurrence = 'synthetic-new-occurrence'; ticket.call.identity = 'synthetic-new-hold';
  await view.poll(); await view.flush();
  assert.equal(view.doc.getElementById('answer-submit').disabled, true);
  assert.equal(note.value, 'Retain my sample draft');
  assert.equal(view.doc.getElementById('call-change').hidden, false);
  assert.ok(view.requests.every(r => r.method === 'GET'));
});

test('answer receipt says whether Firstmate was pointed at the answer or sees it next turn', async () => {
  const note = 'Couldn’t reach Firstmate right now. It will see your answer on its next check.';
  const answer = async (primary) => {
    const tickets = {ask: questionTicket('ask', 'Prepare sample release', 'Confirm sample workspace', '')};
    const view = await questionView(tickets); await view.open('ask');
    tickets['ask/answer'] = {saved: true, state: 'saved', message: 'Answer saved by Firstmate.', notice: 'unknown',
      ack: 'unknown', consumed: 'unknown', ...(primary ? {primary} : {})};
    const field = view.doc.getElementById('answer-note'); field.value = 'Sample answer';
    field.listeners.input[0]({type: 'input'});
    const send = descendants(view.doc.getElementById('detail-content')).find(n => n.id === 'answer-submit');
    send.listeners.click[0](); await view.finishAnswer();
    assert.ok(view.requests.some(r => r.url === 'api/ticket/ask/answer' && r.method === 'POST'));
    return view.doc.getElementById('answer-status').textContent;
  };
  const unreachable = await answer('unreachable');
  assert.ok(unreachable.includes('Answer saved')); assert.ok(unreachable.includes(note));
  const sent = await answer('sent');
  assert.ok(sent.includes('Sent to Firstmate')); assert.ok(!sent.includes(note));
  assert.ok(!(await answer('')).includes(note));
});

function structuredTicket(key, options, extra = {}) {
  const ticket = questionTicket(key, 'Pick the sample rollout', 'Pick the sample rollout', '');
  Object.assign(ticket.call, {about: 'The sample flag is ready.', decide: 'Which rollout should ship?', options, recommend: 'staged', close: '', ...extra});
  return ticket;
}
const reconcile = {value: 'reconcile', label: 'Check again first', hint: ''};

test('structured options are one-click choices with the recommended one marked', async () => {
  const tickets = {pick: structuredTicket('pick', [{value: 'staged', label: 'Staged rollout', hint: 'Ten percent first'},
    {value: 'all', label: 'Everyone at once', hint: ''}, reconcile], {link: 'https://example.com/report'})};
  const view = await questionView(tickets); await view.open('pick');
  const nodes = descendants(view.doc.getElementById('detail-content'));
  const list = nodes.find(n => n.className === 'option-list');
  assert.equal(list.getAttribute('role'), 'group');
  const choices = descendants(list).filter(n => n.tagName === 'BUTTON');
  assert.deepEqual(choices.map(b => b.dataset.value), ['staged', 'all']);
  assert.deepEqual(choices.map(b => b.querySelector('strong').textContent), ['Staged rollout', 'Everyone at once']);
  assert.equal(choices[0].querySelector('small').textContent, 'Ten percent first');
  assert.equal(choices[1].querySelector('small'), null);
  assert.deepEqual(choices.map(b => b.querySelector('.recommended')?.textContent || ''), ['Recommended', '']);
  assert.ok(choices[0].className.includes('recommended-choice'));
  // Re-check stays available, below the real choices and out of the primary list.
  const recheck = nodes.find(n => n.tagName === 'BUTTON' && n.dataset.value === 'reconcile');
  // Its one-line meaning sits on the button itself, not in a loose note.
  assert.equal(recheck.querySelector('strong').textContent, 'Check again first');
  assert.equal(recheck.querySelector('small').textContent, 'Nothing gets decided yet.'); assert.equal(list.contains(recheck), false);
  assert.equal(nodes.some(n => n.className === 'answer-help'), false);
  // Free text stays visible beside the options.
  const fold = nodes.find(n => n.tagName === 'DETAILS' && n.className.includes('own-words-fold'));
  assert.equal(fold.open, true); assert.ok(fold.contains(view.doc.getElementById('answer-note')));
  const link = nodes.find(n => n.tagName === 'A' && n.textContent === 'See the full report ↗');
  assert.equal(link.href, 'https://example.com/report'); assert.equal(link.rel, 'noopener noreferrer');
  assert.ok(view.requests.every(r => r.method === 'GET'));
  tickets['pick/answer'] = {saved: true, state: 'saved', message: 'Answer saved by Firstmate.', notice: 'unknown', ack: 'unknown', consumed: 'unknown'};
  choices[1].listeners.click[0](); await view.finishAnswer();
  const posts = view.requests.filter(r => r.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'api/ticket/pick/answer');
  assert.equal(posts[0].body.value, 'all'); assert.equal(posts[0].body.occurrence, tickets.pick.call.occurrence);
  assert.ok(view.doc.getElementById('answer-status').textContent.includes('Answer saved'));
  assert.ok(choices.every(b => b.disabled));
  choices[0].listeners.click[0](); await view.flush();
  assert.equal(view.requests.filter(r => r.method === 'POST').length, 1);
});

test('Undo cancels a pending answer before Firstmate is called and preserves the draft', async () => {
  const view=await questionView({ask:questionTicket('ask','Choose scope','Choose scope','')});await view.open('ask');
  const note=view.doc.getElementById('answer-note');note.value='Keep this draft';note.listeners.input[0]({type:'input'});
  view.doc.getElementById('answer-submit').listeners.click[0]();await view.flush();
  assert.equal(view.requests.some(r=>r.method==='POST'),false);
  view.doc.getElementById('answer-status').querySelector('button').listeners.click[0]();await view.finishAnswer();
  assert.equal(view.requests.some(r=>r.method==='POST'),false);assert.equal(note.value,'Keep this draft');
  assert.equal(view.doc.getElementById('answer-submit').disabled,false);
});

test('a failed send offers a retry only when the request itself failed', async () => {
  const tickets = {pick: structuredTicket('pick', [{value: 'staged', label: 'Staged rollout', hint: ''}, reconcile])};
  const view = await questionView(tickets); await view.open('pick');
  const nodes = descendants(view.doc.getElementById('detail-content'));
  const staged = nodes.find(n => n.tagName === 'BUTTON' && n.dataset.value === 'staged');
  const status = () => view.doc.getElementById('answer-status').textContent;
  tickets['pick/answer'] = () => { throw Object.assign(new Error('aborted'), {name: 'AbortError'}); };
  staged.listeners.click[0](); await view.finishAnswer();
  assert.equal(status(), 'Deck took too long to answer. Your draft is safe. Try the same answer again.');
  assert.equal(staged.disabled, false);
  const refusal = 'That answer is too long. Shorten it and send again.';
  tickets['pick/answer'] = () => ({ok: false, status: 400, json: async () => ({error: refusal})});
  staged.listeners.click[0](); await view.finishAnswer();
  assert.equal(status(), refusal + ' Your draft is safe.');
  const posts = view.requests.filter(r => r.method === 'POST');
  assert.equal(posts.length, 2); assert.equal(posts[0].body.request_id, posts[1].body.request_id);
});

test('a call without options keeps the plain own-words flow and the re-check choice', async () => {
  const tickets = {free: structuredTicket('free', [reconcile], {recommend: ''})};
  const view = await questionView(tickets); await view.open('free');
  const nodes = descendants(view.doc.getElementById('detail-content'));
  assert.equal(nodes.some(n => n.className === 'option-list'), false);
  assert.equal(nodes.some(n => n.className === 'recommended'), false);
  assert.equal(nodes.some(n => n.tagName === 'DETAILS' && n.className.includes('own-words-fold')), false);
  const note = view.doc.getElementById('answer-note'), send = view.doc.getElementById('answer-submit');
  assert.equal(note.closest('details'), null);
  assert.equal(send.disabled, true);
  note.value = 'Ship it next week'; note.listeners.input[0]({type: 'input'});
  assert.equal(send.disabled, false);
  tickets['free/answer'] = {saved: true, state: 'saved', message: 'Answer saved by Firstmate.', notice: 'unknown', ack: 'unknown', consumed: 'unknown'};
  send.listeners.click[0](); await view.finishAnswer();
  const post = view.requests.find(r => r.method === 'POST');
  assert.deepEqual([post.body.value, post.body.note], ['', 'Ship it next week']);
  assert.ok(nodes.some(n => n.tagName === 'BUTTON' && n.dataset.value === 'reconcile'));
  // Byte limits and draft mechanics stay in the technical details, not the primary copy.
  const technical = nodes.find(n => n.tagName === 'DETAILS' && n.className === 'source-details');
  const primary = nodes.filter(n => n.tagName === 'P' && !technical.contains(n)).map(n => n.textContent).join(' ');
  assert.equal(/512|bytes|intake|reconcil/i.test(primary), false, primary);
  assert.ok(technical.textContent.includes('512 bytes'));
});


// ---- U1-U4: one top line, even cards, no dialogs, answer in place ----
const columnOf = (view, kind) => view.doc.getElementById('board').children.find(s => s.dataset.kind === kind);
const fullBoard = (extra = {}) => {
  const data = board([card('w', 'Working summary.')]);
  data.columns = [['captains_call', [{...questionTicket('q', 'Pick the sample scope', 'Pick the sample scope', ''), question: 'Which scope ships first?',
      time: {label: 'Asked', epoch: Date.UTC(2026, 0, 15, 9) / 1000, date: null}}]],
    ['underway', data.columns[1].cards], ['charted', [{...card('later', ''), bucket: 'charted', title: 'Filed without a summary',
      time: {label: 'Filed', epoch: null, date: '2026-01-14'}}]], ['landed', [{...card('done', ''), bucket: 'landed', summary: 'Shipped it.'}]]]
    .map(([id, cards]) => ({id, title: id, cards}));
  return Object.assign(data, extra);
};


test('a report path on a call becomes a link that opens the report here, not a path in the how-to', async () => {
  const link = 'data/sample-task/report.md';
  const tickets = {rep: structuredTicket('rep', [{value: 'staged', label: 'Staged rollout', hint: ''}, reconcile], {link, detail: 'Read ' + link + ' first, then pick.'})};
  tickets['rep/report'] = {path: link, text: '# Sample report\n\nEverything checked.'};
  const view = await questionView(tickets); await view.open('rep');
  const nodes = descendants(view.doc.getElementById('detail-content'));
  assert.equal(nodes.some(n => n.textContent.includes(link)), false);
  assert.ok(nodes.some(n => n.tagName === 'P' && n.textContent === 'Read first, then pick.'));
  const open = nodes.find(n => n.tagName === 'BUTTON' && n.textContent === 'See the full report');
  assert.equal(open.getAttribute('aria-expanded'), 'false');
  await open.listeners.click[0](); await view.flush();
  assert.equal(open.getAttribute('aria-expanded'), 'true');
  assert.ok(view.requests.some(r => r.url === 'api/ticket/rep/report' && r.method === 'GET'));
  assert.ok(descendants(view.doc.getElementById('detail-content')).some(n => n.textContent === 'Everything checked.'));
  assert.ok(view.requests.every(r => r.method === 'GET'));
});

test('a Spanish call shows no English interface text outside its technical details', async () => {
  const en = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'));
  const es = JSON.parse(fs.readFileSync(path.join(root, 'locales/es.json'), 'utf8'));
  const english = new Set(Object.keys(en).filter(k => es[k] !== en[k]).map(k => en[k].trim()).filter(text => text.length > 2));
  const tickets = {es: structuredTicket('es', [{value: 'staged', label: 'Por etapas', hint: 'Primero el diez por ciento'}, reconcile], {link: 'https://example.com/informe'})};
  const view = await questionView(tickets, es); await view.open('es');
  const content = view.doc.getElementById('detail-content');
  const technical = descendants(content).find(n => n.tagName === 'DETAILS' && n.className === 'source-details');
  const shown = descendants(content).filter(n => !technical.contains(n) && !n.children.length).map(n => n.textContent.trim()).filter(Boolean);
  assert.deepEqual(shown.filter(text => english.has(text)), []);
  assert.equal(view.doc.getElementById('detail-kicker').textContent, 'Te necesita');
  assert.ok(shown.includes('Ver informe completo ↗'));
});


// ---- U11: the phone opens where the captain is needed ----
const pressedTab = (view) => view.doc.getElementById('columns-nav').children.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.kind);
const selectedColumns = (view) => view.doc.getElementById('board').children.filter(s => s.dataset.selected === 'true').map(s => s.dataset.kind);


// ---- U6: a project tag on every card, and questions from one project in one stack ----
const callsSection = (view) => view.doc.getElementById('board').children.find(s => s.dataset.kind === 'captains_call');
const relay = {id: 'relay', label: 'Relay'}, garden = {id: 'garden app', label: 'Garden app'};
function projectCall(key, title, project, extra = {}) {
  const ticket = structuredTicket(key, [{value: 'yes', label: 'Yes', hint: ''}, {value: 'no', label: 'No', hint: ''}]);
  return Object.assign(ticket, {title, original_title: title, project, question: '', time: {label: 'Asked', epoch: Date.UTC(2026, 0, 15, 9) / 1000, date: null}}, extra);
}
function stackBoard(calls) {
  const data = fullBoard(); data.columns[0].cards = calls;
  data.columns[1].cards = [{...card('w', 'Working summary.'), project: relay}];
  return data;
}
const gardenCalls = () => [projectCall('r1', 'Start relay phase one?', relay), projectCall('g1', 'Animate moving tasks?', garden),
  projectCall('solo', 'Pick the beta scope', null), projectCall('g2', 'One group or several per task?', garden),
  projectCall('g3', 'How many lines per task?', garden, {time: {label: 'Asked', epoch: Date.UTC(2026, 0, 15, 11) / 1000, date: null}})];


const ES = JSON.parse(fs.readFileSync(path.join(root, 'locales/es.json'), 'utf8'));


test('a delivery without a summary opens its formatted report and one explanation control', async () => {
  const delivery = {task: 'old', home: 'h', title: 'Delivered', summary: '', report: 'fallback',
    report_text: '## What changed\n\nYou can **read** it. [Unsafe](javascript:alert) <script>boom()</script>\n\n- One\n- Two\n\n| Name | Value |\n| --- | --- |\n| Safe | Yes |\n\n```\nconst sample = true;\n```',
    report_lead: 'Branch: fm/example', details: '', sources: ''};
  const history = {records: [{task: 'old', home: 'h', title: 'Delivered'}], details: [], omitted: 0, scope: ''};
  const view = await mountBoard(board([]), undefined, {}, {}, {history, delivery});
  await view.doc.getElementById('history-view').listeners.click[0](); await view.flush();
  await view.doc.getElementById('history-results').querySelector('.history-row').listeners.click[0](); await view.flush();
  const content = view.doc.getElementById('detail-content');
  assert.equal(content.querySelector('.detail-tabs'), null);
  assert.equal(content.querySelector('h3').textContent, 'What changed');
  assert.equal(content.querySelector('strong').textContent, 'read');
  assert.equal(content.querySelectorAll('li').length, 2);
  assert.equal(content.querySelectorAll('th').length, 2);
  assert.equal(content.querySelector('pre').textContent, 'const sample = true;');
  assert.equal(content.querySelector('script'), null);
  assert.equal(content.querySelector('.report').querySelector('a'), null);
  assert.equal(content.querySelector('.explain-actions').querySelectorAll('button').length, 1);
  assert.equal(content.querySelector('.explain-status').textContent, '');
});


test('explanation states share one control and one status line, with a safe formatted reply', async () => {
  for (const [state, line, disabled] of [['absent', '', false], ['queued', 'Asked. Firstmate hasn’t seen it yet.', true],
    ['acknowledged', 'Firstmate is on it.', true], ['answered', 'Firstmate replied below.', true]]) {
    const delivery = {task: 'old', home: 'h', title: 'Delivered', summary: 'You can read deliveries.', report: '', details: '', sources: ''};
    const history = {records: [{task: 'old', home: 'h', title: 'Delivered'}], details: [], omitted: 0, scope: ''};
    const explanation = {state, receipt: {reply: state === 'answered' ? {body: '**Done** <script>boom()</script>'} : null}};
    const view = await mountBoard(board([]), undefined, {}, {}, {history, delivery, explanation});
    view.doc.getElementById('history-view').listeners.click[0](); await view.flush();
    view.doc.getElementById('history-results').querySelector('.history-row').listeners.click[0](); await view.flush();
    const content = view.doc.getElementById('detail-content');
    assert.equal(content.querySelector('.explain-status').textContent, line);
    assert.equal(content.querySelector('.explain-actions').querySelectorAll('button').length, 1);
    assert.equal(view.doc.getElementById('explain-request').disabled, disabled);
    assert.equal(view.requests.some(r => r.method === 'POST'), false);
    if (state === 'answered') {
      const reply = content.querySelector('.explain-reply');
      assert.equal(reply.hidden, false);
      assert.equal(reply.querySelector('strong').textContent, 'Done');
      assert.equal(reply.querySelector('script'), null);
    }
  }
});
