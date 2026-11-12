/* English source messages are catalog keys. Never translate task data. */
'use strict';
DeckI18n.ready.then(({t, locale, dateFmt, relative, eventTime, exactTime, untilText, ago, creationAge, shortDate}) => {
/* User content is text only. Events update views; explicit buttons can POST. */
const $ = (id) => document.getElementById(id);
const S = { board: null, home: '', online: false, view: 'board', query: '',
  busy: false, csrf: '', modal: null, opener: null, generation: 0, historyGeneration: 0,
  boardRequest: 0, boardApplied: 0,
  lastRead: 0, receipt: null, drafts: new Map(), historyTimer: null, linkHandled: false };
let sessionReady;
const initialSession = new Promise(resolve => { sessionReady = resolve; });
// v14 supersedes the previous Compact preference.
const labels = { charted: t("Up next"), underway: t("Underway"), captains_call: t("Needs you"), landed: t("Delivered") };
const phaseLabels = { human: t("Waiting for your answer"), dependency: t("Waiting on another task"), integration: t("Finishing up"), technical: t("On hold"), active: t("In progress"), unknown: t("Status unclear"), waiting: t("Waiting"), reported: t("Reported done") };
const runLabels = { running: t('Checks running'), fixing: t('Fixing failed checks'), passed: t('Checks passed'), failed: t('Checks failed') };
// Firstmate's crew state and endpoint probe, as projected by the bridge.
const agentLines = { working: t('Agent is working'), validation: t('Checks are running'), open: t('Agent is open'), present: t('Agent is open but idle'), none: t('No agent running'), unknown: t('Agent status unknown') };
// The same states after the agent's name: "Claude Code · working now".
const agentStates = { working: t('working now'), validation: t('running checks'), open: t('open'), present: t('open, not working'), none: t('not running'), unknown: '' };
const staleDraftNote = t("The question changed since you started. Your draft is still here: pick an option or edit it to send.");
const gapLines = { hold_until: t('No end time given for this hold.'), wait_until: t('No end time given for this pause.') };
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
window.DeckAnonymize?.formatted(zone);
window.DeckAnonymize?.structural($('timezone'), 'time');
$('timezone').textContent = t("Times in ") + zone;
function node(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function structural(el, kind = 'count') { window.DeckAnonymize?.structural(el, kind); return el; }
function append(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function button(text, action, cls = '') { const b = node('button', cls, text); b.type = 'button'; b.addEventListener('click', action); return b; }
function prose(text) {
  const root = node('div', 'prose');
  const headings = new Set(['Result', 'Scope', 'Why', 'Evidence', 'Pending', 'Checks', 'Limits', 'What changed', 'Next step', 'Resultado', 'Alcance', 'Por qué', 'Evidencia', 'Pendiente', 'Comprobaciones', 'Límites', 'Qué cambió', t("Next step")]);
  let lines = [], list = null;
  const flush = () => { if (lines.join('\n').trim()) root.append(node('p', '', lines.join('\n').trim())); lines = []; };
  for (const line of (text || t("Nothing to show here yet.")).split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+)/), item = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)/);
    if (heading || headings.has(line.trim())) { flush(); list = null; root.append(node('h3', '', heading ? heading[1] : line.trim())); }
    else if (item) {
      flush(); const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) { list = node(tag); root.append(list); }
      list.append(node('li', '', item[1]));
    }
    else { list = null; if (!line.trim()) flush(); else lines.push(line); }
  }
  flush(); return root;
}
function contextRow(title, text, kind) { const value = node('p', '', text || t("Not recorded.")); if (kind) structural(value, kind); return append(node('div', 'context-row'), node('h3', '', title), value); }
function disclosure(title, ...children) { return append(node('details', 'source-details'), node('summary', '', title), ...children); }
function timeView(event) {
  const time = structural(node('span', 'relative-time', eventTime(event)), 'time');
  time.dataset.event = JSON.stringify(event || null); time.setAttribute('aria-live', 'off');
  return append(node('details', 'event-time'), append(node('summary'), time, node('span', 'sr-only', t(' · Show exact local date'))), structural(node('p', 'exact-time', exactTime(event)), 'time'));
}
// One coordinating space is not news; it is named only when there are several.
const manyHomes = () => (S.board?.homes || []).length > 1;
// Without a recorded time there is nothing to show; Technical details say why.
const timed = (event) => !!event && (event.date || Number.isFinite(event.epoch));
function detailMeta(owner, event, project) { $('detail-meta').replaceChildren(projectTag(project) || '', manyHomes() ? node('span', '', t('Coordinated by {owner}', {owner})) : '', timed(event) ? timeView(event) : ''); }
// A stable small number for a text, so one project keeps one color and one
// stack keeps one element id across reads and views.
function hashOf(text) { let h = 2166136261; for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
// The project Firstmate recorded for a task, in its own color everywhere.
function projectTag(project) {
  if (!project?.label) return null;
  const n = node('span', 'project-tag', deckUI?.projectDisplay?.(project) || project.label); const hue=deckUI?.hueFor?.(project.id) ?? hashOf(project.id)%11;n.dataset.hue=String(hue);n.style.setProperty('--pc', `var(--h${hue})`);
  return window.DeckAnonymize.project(n,project.id);
}
function refreshTimes() {
  for (const n of document.querySelectorAll('.relative-time')) {
    const text = eventTime(JSON.parse(n.dataset.event));
    if (n.textContent !== text) n.textContent = text;
  }
}
// Who's on it, in one line: the agent and, while underway, what it is doing.
function whoText(card) {
  const harness = card.presentation?.executor?.harness, agent = card.activity?.agent || 'unknown';
  const name = harness ? {codex: 'Codex', claude: 'Claude Code', pi: 'Pi'}[harness] || harness : '';
  if (card.bucket !== 'underway') return name;
  // A pane's presence does not establish current agent activity.
  if (activityUnconfirmed(card)) return [name, t('Activity unconfirmed')].filter(Boolean).join(' · ');
  return name ? [name, agentStates[agent]].filter(Boolean).join(' · ') : agent === 'unknown' ? '' : agentLines[agent] || '';
}
// On a card the return date is its own tag, so the chip drops it (short).
function activityText(card, short = false) {
  const a = card.activity || {}, until = a.until && !short ? untilText(a.until) : '';
  if (a.kind === 'idle') return t('No active turn');
  if (a.kind === 'paused') return until ? t('Paused until {date}', {date: until}) : t('Paused');
  if (a.kind === 'deferred') return until ? t('Deferred until {date}', {date: until}) : t('Deferred');
  if (a.kind === 'decision') return card.bucket === 'underway' ? t('Waiting for your answer') : '';
  if (a.kind === 'last_seen_working') return t('Working when last seen') + (a.seen_at ? ' · ' + relative(a.seen_at) : '');
  if (a.kind === 'blocked' || card.context?.phase === 'dependency') {
    const deps = card.dependencies || [];
    if (deps.some(d => d.unresolved !== false && !d.reconciliation_required && d.state !== 'done')) return t('Waiting on another task');
    if (deps.length) return t('Dependencies need a check');
    return t('Status unclear');
  }
  if (a.kind === 'unknown' && ['unknown', 'active'].includes(card.context?.phase)) return t('Activity unconfirmed');
  return { working: t('Working now'), validating: t('Checks running'), validation_gate: t('Checks need approval'), blocked: t('Waiting on another task'),
    held: t('On hold'), finished: t('Done, not closed yet'), stopped: t('Stopped'), ready: t('Ready to start'), queued: t('Queued') }[a.kind] || '';
}
function phaseText(card, short = false) {
  if (card.closure?.kind === 'cancelled') return t('Cancelled');
  if (card.answered) return t('Answer saved');
  if (card.bucket === 'landed') return t('Delivered');
  if (card.activity?.kind === 'paused') return activityText(card, short);
  const run = card.presentation?.run_step;
  if (run) return runLabels[run.state];
  return activityText(card, short) || (card.bucket === 'charted' && card.context.phase === 'unknown' ? t('Queued') : card.context.label || phaseLabels[card.context.phase]);
}
// A task's workflow and the observation of its agent are separate facts.
// Unknown Codex stays unknown even when a pane exists or the last report says working.
function activityUnconfirmed(card) {
  if (card.native && 'unconfirmed' in card.native) return card.native.unconfirmed !== false || !!card.native.retained_at ||
    !['pane', 'current_state.pane', 'agent.activity'].includes(card.native.source);
  return !card.activity || ['unknown', 'last_seen_working'].includes(card.activity.kind);
}
function workingText(cards, short = false) {
  const live = cards.filter(c => !c.answered);
  const working = live.filter(c => c.activity?.kind === 'working').length;
  const unknown = live.filter(c => c.activity?.kind !== 'working' && activityUnconfirmed(c)).length;
  if (unknown && !working) return t('Activity unconfirmed: {count}', {count: unknown});
  const text = short || unknown ? t('{count} working', {count: working}) : t('{count} working now', {count: working});
  return unknown ? text + ' · ' + t('{count} unconfirmed', {count: unknown}) : text;
}
function activityCount(columns, id, kind) { return (columns.find(c => c.id === id)?.cards || []).filter(x => !x.answered && x.activity?.kind === kind).length; }
function dependencyText(card) {
  // The crew is named only when there are several.
  const crew = (d) => manyHomes() ? ' · ' + (d.owner === '(main)' ? card.owner : d.owner || t('crew not recorded')) : '';
  return card.dependencies.map(d => (d.title || d.id) + crew(d) +
    (d.reconciliation_required ? t(' · needs a check') : d.unresolved === false ? t(' · resolved') : '')).join('; ');
}
function notice(text, error = false) {
  const el = $('notice'), name = 'notice' + (error ? ' error' : '');
  if (el.hidden !== !text) el.hidden = !text;
  if (el.className !== name) el.className = name;
  if (el.textContent !== text) el.textContent = text;
}
function syncSubmit() {
  const call = S.modal?.type === 'call' ? S.modal.ticket?.call : null;
  if (!call) return;
  const blocked = !!window.DeckAnonymize?.enabled || S.busy || !S.online || !!S.modal.checkFailed || !!S.receipt || !!document.querySelector('[data-uploading]');
  for (const b of $('detail-content').querySelectorAll('.option-choice')) {
    b.disabled = blocked;
    b.setAttribute('aria-pressed', String(b.dataset.value === S.modal.value));
  }
  const submit = $('answer-submit');
  if (submit) submit.disabled = blocked || !!S.modal.draftNeedsReview || (!$('answer-note')?.value.trim() && !S.modal.attachments?.length) || !!document.querySelector('[data-uploading]');
}
const answerTools=window.createAnswerTools({t,node,button,api,state:S,syncSubmit});
const retryable = (message) => Object.assign(new Error(message), {retry: true});
async function api(path, body) {
  if (body && path !== '/api/diagnostics/trace' && path !== '/api/diagnostics/export' && window.DeckAnonymize?.enabled) throw new Error(t('Editing is unavailable while text is hidden.'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), body ? 100000 : 20000);
  try {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-Deck-CSRF': S.csrf } : {},
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || t('Request failed ({status}).', {status: response.status})), {code:data.code,details:data.details,retry:['receipt-uncertain','timeout'].includes(data.code)});
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw retryable(t('Deck took too long to answer.'));
    if (err instanceof TypeError) throw retryable(t('Couldn’t reach Deck.'));
    if (err instanceof SyntaxError) throw retryable(t('Couldn’t read Deck’s reply.'));
    throw err;
  } finally { clearTimeout(timer); }
}
function sourceStatus() {
  if (!S.board) return;
  const sources = S.board.sources || [];
  // Old only when the Deck couldn't confirm Firstmate for several minutes; the header says so, no banner.
  const latest = sources.map(x => x.checked_at || x.received_at).filter(x => x > 0);
  const at = latest.length ? Math.min(...latest) : 0;
  const stale = at && Date.now() / 1000 - at > 360;
  const failed = S.board.error || sources.some(s => s.error) || (S.board.deck?.sources || []).some(s => !s.available);
  const disabledEvents = (S.board.deck?.sources || []).filter(s => s.code === 'events-disabled');
  const rejectedBootstrap = (S.board.deck?.sources || []).find(s => s.code === 'bootstrap-rejected');
  const disconnected = !S.online;
  // Freshness is one short phrase; the exact read time is on hover.
  const read = {label: 'Source read', epoch: S.lastRead / 1000};
  const retained = (S.board.deck?.sources || []).map(s => s.retained_at).filter(Boolean);
  const staleAt = retained.length ? Math.min(...retained) : at || S.lastRead / 1000;
  const connectionText = (failed || disconnected || stale) && S.board ? t("Out of date since {time}", {time: exactTime({epoch: staleAt})}) : S.board.loading ? t("Loading…") : t('Up to date');
  if ($('connection').textContent !== connectionText) $('connection').textContent = connectionText;
  const level = disconnected || failed ? 'error' : stale ? 'warning' : 'ok';
  if ($('connection').dataset.level !== level) $('connection').dataset.level = level;
  structural($('connection'), 'time');
  $('connection').title = S.lastRead ? t('Source read') + ' · ' + exactTime(read) + ' · ' + t('updated {ago}', {ago: ago(read)}) : '';
  if (disconnected) notice(t("You’re offline. Your draft is safe. Check the question again once you’re back."));
  else if (disabledEvents.length) notice(disabledEvents.map(s => s.error).join('\n'));
  else if (rejectedBootstrap) notice(rejectedBootstrap.error);
  else if (failed) notice(t("Couldn’t refresh one source. Some cards may be out of date."));
  else if (!S.board.loading && !S.board.homes.length) notice(t('Standalone mode. Connect Firstmate to show tasks and enable controls.'));
  else notice('');
  syncSubmit();
}
let deckUI;
let relaySettings;
function renderBoard(mode) {
  if (!S.board) return;
  if (!relaySettings) relaySettings = window.createRelaySettings({t,node,button,api,state:S});
  if (!deckUI) deckUI = window.createDeckUI({t,node,button,append,api,ago,creationAge,exactTime,openCard,showDetail,closeDetail,detailOpen,parkDetail,state:S,
    hashOf,cardLine,phaseText,refreshTimes,sourceStatus,poll,setView,placeDetail,openDelivery,reportLink,answerTools,inlineAnswer,showAnswers:async()=>{await loadReceipts();$('receipts-panel').open=true;closeDetail(false);$('receipts-panel').scrollIntoView({block:'start'});}});
  deckUI.render(false, mode);
}
const flatten = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase(locale);
// One line of what is happening: authored text only, never a placeholder.
// A long text leads with its first full sentence; the title is never cut.
function leadLine(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= 140) return flat;
  for (const end of flat.matchAll(/[.!?](?=\s+[\p{Lu}¿¡]|$)/gu))
    if (end.index >= 40 && !abbreviation(flat.slice(0, end.index))) return flat.slice(0, end.index + 1);
  return flat;
}
function cardLine(card) {
  const p = card.presentation || {};
  if (card.bucket === 'landed') return leadLine(card.summary);
  // A call's line is its question, unless the title already asks it.
  const same = (text) => flatten(text) === flatten(card.title);
  if (card.bucket === 'captains_call') return leadLine([card.question, p.status, p.summary].find(text => text && !same(text)));
  // What is happening now, as Firstmate wrote it for the card, comes first.
  const waiting = repeatsDependencies(card, p.waiting_for) ? '' : p.waiting_for;
  const after = card.dependencies.length ? t('After: {dependency}', {dependency: card.dependencies.map(d => d.title || d.id).join(', ')}) : '';
  return leadLine([p.status, p.summary, waiting || after, p.next_action].find(text => text && !same(text)));
}
// A wait that only names the tasks it depends on says nothing new.
function repeatsDependencies(card, text) {
  if (!text || !card.dependencies.length) return false;
  const names = card.dependencies.map(d => flatten(d.title || d.id));
  return flatten(text).split(/\s*[,;]\s*/).every(part => names.includes(part)) || flatten(text) === names.join(', ');
}
function openCard(card, opener, asTask = false) {
  if (detailOpen() && S.openerKey === (opener?.dataset.key || card.key)) { closeDetail(); return; }
  if (card.bucket === 'landed' && card.home && card.delivery_available !== false) return openDelivery(card.home, card.task, opener); return openTicket(card.key, opener, asTask);
}
function supervisorText(s) {
  if (!s || !s.observed_at) return t("Firstmate hasn’t said what it’s doing.");
  const epoch = Date.parse(s.observed_at) / 1000;
  const ttl = Number(s.ttl || s.ttl_seconds || 0);
  const stale = s.freshness === 'stale' || (ttl > 0 && Date.now() / 1000 - epoch > ttl);
  const state = { coordinating: t("coordination"), waiting: t("waiting"), idle: t("idle") }[s.state] || t("unknown state");
  const unknown = !Number.isFinite(epoch) || ttl <= 0 || s.freshness === 'unknown' || epoch > Date.now() / 1000 + 5;
  return t('{declaration} {summary} {time} Current model activity is unknown.', {declaration: stale ? t("Firstmate’s last update expired.") : unknown ? t("Freshness unconfirmed; current activity is unknown.") : t("Declared ") + state + '.', summary: s.summary || t("No purpose recorded."), time: Number.isFinite(epoch) ? dateFmt.format(new Date(epoch * 1000)) + ' · ' + relative(epoch) + '.' : t("Time cannot be verified.")});
}
function mergeChange(before, patch) {
  if (Object.hasOwn(patch, 'value')) return patch.value;
  if (patch.fields) return Object.fromEntries(Object.entries(before).map(([key,value]) => [key,patch.fields[key] ? mergeChange(value,patch.fields[key]) : value]));
  const key = row => row.id || row.key || ('task' in row ? (row.home || '')+':'+row.task : row.home);
  const rows = new Map((before || []).map(row => [key(row), row]));
  return patch.rows.map(id => patch.values[id] ? mergeChange(rows.get(id),patch.values[id]) : rows.get(id));
}
let stream, streamReading;
function applyBoard(data) {
    if (data.loading && S.board?.columns.some(column => column.cards.length)) { S.online = false; sourceStatus(); return; }
    const selectedCall = S.modal?.type === 'call' ? S.modal.key : null;
    const oldCall = selectedCall && S.board?.columns.flatMap(c => c.cards).find(c => c.key === selectedCall)?.inline_call;
    const firstRead = !S.csrf;
    S.online = true; S.lastRead = Date.now(); S.csrf = data.csrf;
    if (S.csrf) sessionReady();
    if (firstRead) window.DeckTrace?.use('open', 'page');
    // Failed collection must not erase an already useful board.
    if (!(data.error && !data.columns.some(c => c.cards.length) && S.board)) S.board = data;
    else { S.board.error = data.error; S.board.sources = data.sources; }
    const identity = JSON.stringify(data.homes);
    if ($('crew').dataset.homes !== identity) {
      $('crew').dataset.homes = identity;
      $('crew').replaceChildren(new Option(t("All"), ''), ...data.homes.map(h => new Option(h.label, h.id)));
      $('crew').value = S.home;
    }
    // A single coordinating space needs no picker.
    const lone = data.homes.length < 2 && !S.home;
    if ($('crew').parentElement && $('crew').parentElement.hidden !== lone) $('crew').parentElement.hidden = lone;
    S.historyRows = data.history || [];
    // An automatic update changes cards in place: no entrance or move animation.
    renderBoard('refresh');
    if (S.view === 'history') loadHistory();
    if (!S.linkHandled && data.homes.length && !data.loading) {
      S.linkHandled = true;
      const params = new URLSearchParams(location.search);
      if (params.has('task')) openStableLink(params);
    }
    const nextCall = selectedCall && data.columns.flatMap(c => c.cards).find(c => c.key === selectedCall)?.inline_call;
    if (selectedCall && JSON.stringify(oldCall) !== JSON.stringify(nextCall) && !S.busy && !S.receipt) checkCall();
    sourceStatus();
}
async function poll() {
  const selected = S.home, request = ++S.boardRequest;
  stream?.close();
  try {
    const data = await api('api/board' + (selected ? '?home=' + encodeURIComponent(selected) : ''));
    if (selected !== S.home || request !== S.boardRequest) return;
    applyBoard(data);
    if (S.modal?.type === 'call' && !S.busy && !S.receipt) checkCall();
    if (S.modal?.type === 'delivery' && S.modal.explanation) refreshExplanation();
    stream = new EventSource('/api/stream?' + new URLSearchParams({home:selected, cursor:data.cursor}));
    stream.addEventListener('base', event => {
      if (selected === S.home) { streamReading = JSON.parse(event.data); applyBoard(streamReading); }
    });
    stream.addEventListener('change', event => {
      if (selected === S.home) { streamReading = mergeChange(streamReading, JSON.parse(event.data)); applyBoard(streamReading); }
    });
    stream.addEventListener('heartbeat', () => {
      S.lastRead = Date.now();
      for (const source of S.board?.sources || []) if (!source.error) source.checked_at = Date.now()/1000;
      sourceStatus();
    });
    stream.onopen = () => sourceStatus();
    stream.onerror = () => { S.online = false; sourceStatus(); };
  } catch (err) {
    S.online = false; sourceStatus();
    if (!S.board) notice(t("No read has been confirmed. Try Refresh."), true);
  }
}
function setView(view) {
  window.DeckTrace?.use('view', view);
  S.view = view; deckUI?.setView(view);
  $('board-view-panel').hidden = view !== 'board'; $('history-panel').hidden = view !== 'history'; $('projects-panel').hidden = view !== 'projects';
  $('board-search').hidden = view === 'history';
  $('history-view').setAttribute('aria-pressed', String(view === 'history'));
  for (const [id,kind] of [['board-view','board'],['projects-view','projects'],['history-tab','history']]) { $(id).setAttribute('aria-selected',String(view === kind)); $(id).tabIndex = view === kind ? 0 : -1; }
  closeDetail(false);
  if (view === 'history') loadHistory(); else renderBoard();
}
async function loadHistory() {
  const generation = ++S.historyGeneration;
  $('history-status').textContent = t("Searching…");
  try {
    const query = new URLSearchParams({ home: S.home, q: window.DeckAnonymize?.value($('history-search')) ?? $('history-search').value });
    const needle = (query.get('q') || '').toLocaleLowerCase();
    const data = {records:(S.historyRows || []).filter(row => JSON.stringify(row).toLocaleLowerCase().includes(needle)), omitted:0};
    if (generation !== S.historyGeneration) return;
    const records=data.records.filter(row=>S.historyFilter!=='final'||row.outcome?.role==='final');
    // The count goes beside the filters, as in the approved v11b demo; screen readers hear the phrase.
    structural($('history-status'));
    $('history-status').replaceChildren(Object.assign(node('span', '', String(records.length)), {inert: true}), node('span', 'sr-only', records.length === 1 ? t('1 delivery') : t('{count} deliveries', {count: records.length})), data.omitted ? t(' · {count} more results; refine your search', {count: data.omitted}) : '');
    rescueDetail($('history-results'));
    // Grouped by request as the approved v11b demo: chevron, title, count and
    // project; each row with title, ID, «Result» pill, summary, date and «…».
    const groups=new Map();
    for (const row of records.slice().sort((a,b)=>(b.outcome?.role==='final')-(a.outcome?.role==='final')).slice(0,S.historyLimit || 40)) {
      const key = 'history:' + row.home + ':' + row.task, alias = row.alias||deckUI?.aliasFor?.(row.home,row.task)||'', role = row.outcome?.role;
      const b = button('', () => detailOpen() && S.openerKey === key ? closeDetail() : openDelivery(row.home, row.task, b), 'card-open history-row');
      b.dataset.key = key; b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'detail'); b.append(node('span', 'title', row.title));
      const line = append(node('div', 'rt'), b, node('span', 'node-id', alias || t('ID pending')), role === 'final' || role === 'partial' ? node('span', 'rtag', t(role === 'final' ? 'Result' : 'Progress update')) : null, manyHomes() ? node('span', 'card-tag', row.owner) : null);
      const when = structural(node('span', 'hm', row.time?.date ? shortDate(row.time.date) : Number.isFinite(row.time?.epoch) ? creationAge(row.time) + ' · ' + shortDate(new Date(row.time.epoch * 1000).toISOString()) : t('Not reported')), 'time');
      when.title = exactTime(row.time);
      const menu = deckUI?.historyMenu?.({title: row.title, alias}, async () => { if (!(detailOpen() && S.openerKey === key)) await openDelivery(row.home, row.task, b); $('explain-request')?.click(); }) || [];
      const article = append(node('article', 'task-card task-row history-item' + (role === 'final' ? ' result' : '')), append(node('div', 'rmain'), line, row.summary ? node('div', 'rs', row.summary) : null), when, ...menu, append(node('div', 'card-more'), node('div', 'card-more-inner')));
      article.dataset.key = key;
      const groupKey=row.home+':'+(row.request?.id||'legacy');
      if(!groups.has(groupKey)){
        const group=node('details','history-request'),head=node('summary','history-head');group.open=!S.historyClosed?.has(groupKey);
        group.addEventListener('toggle',()=>{S.historyClosed??=new Set();group.open?S.historyClosed.delete(groupKey):S.historyClosed.add(groupKey);});
        append(head,node('span','fold'),node('span','dot'),node('span','st',row.request?.label||t('Request not recorded')),structural(node('span','cnt')),node('span','meta'));
        groups.set(groupKey,{group,head,list:node('div','history-list'),projects:new Map()});append(group,head,groups.get(groupKey).list);
      }
      const g=groups.get(groupKey);g.list.append(article);if(row.project?.label)g.projects.set(row.project.id,deckUI?.projectDisplay?.(row.project)||row.project.label);
    }
    for (const g of groups.values()) { g.head.querySelector('.cnt').textContent = String(g.list.children.length); g.head.querySelector('.meta').append(...[...g.projects].map(([id, label]) => window.DeckAnonymize?.project(node('span', '', label), id) ?? node('span', '', label))); }
    $('history-filters').replaceChildren(...[['all','All history'],['final','Results only']].map(([value,text])=>{const filter=button(t(text),()=>{S.historyFilter=value;S.historyLimit=40;loadHistory();});filter.setAttribute('aria-pressed',String((S.historyFilter||'all')===value));return filter;}));
    $('history-results').replaceChildren(...[...groups.values()].map(g=>g.group));
    if (records.length > (S.historyLimit || 40)) $('history-results').append(structural(button(t('View {count} more', {count:Math.min(40,records.length-(S.historyLimit || 40))}), () => { S.historyLimit = (S.historyLimit || 40) + 40; loadHistory(); }, 'more')));
    if (!records.length) $('history-results').append(node('p', 'empty', t("No matches.")));
    $('history-sources').replaceChildren();
  } catch (err) { if (generation === S.historyGeneration) $('history-status').textContent = t("Could not refresh history. ") + err.message; }
}
// Details expand inside the selected card at every width. A notification
// without a current card keeps its explicit context in the inline fallback.
function detailOpen() { return $('detail').dataset.open === 'true'; }
function hostCard() { return $('detail').parentElement?.parentElement?.closest?.('.task-card') || null; }
const cardFaces = () => [...$('board').querySelectorAll('.card-open'), ...$('history-results').querySelectorAll('.card-open')];
function markCurrent() {
  for (const b of cardFaces()) {
    const current = detailOpen() && b.dataset.key === S.openerKey;
    b.setAttribute('aria-expanded', String(current));
    const card = b.parentElement; if (card) card.dataset.current = String(current);
  }
}
function parkDetail() {
  const detail = $('detail'), old = hostCard();
  if (old) old.dataset.open = 'false';
  if (detail.parentElement !== $('detail-panel')) $('detail-panel').append(detail);
  detail.hidden = !detailOpen(); $('detail-empty').hidden = detailOpen();
  // A phone shows the panel only while it holds a detail with no card.
  $('detail-panel').dataset.active = String(detailOpen());
}
function placeDetail(opener) {
  const detail = $('detail'), card = opener?.closest?.('.task-card');
  const old = hostCard();
  if (!card) { parkDetail(); return; }
  if (old && old !== card) old.dataset.open = 'false';
  detail.hidden = false; $('detail-empty').hidden = false; $('detail-panel').dataset.active = 'false';
  const slot = card.querySelector('.card-more-inner');
  if (detail.parentElement !== slot) { slot.append(detail); void card.offsetHeight; }
  card.dataset.open = 'true';
  const top = card.getBoundingClientRect?.().top;
  if (top > window.innerHeight * 0.6) card.scrollIntoView({block: 'start', behavior: document.documentElement.dataset.animations === 'false' ? 'instant' : 'smooth'});
}
// A card that leaves the board hands its detail back to the panel, so a
// receipt is never lost.
function rescueDetail(n) { if (n.contains($('detail'))) parkDetail(); }
function showDetail(title, meta, kicker, opener) {
  window.DeckTrace?.setResponse('none');
  S.opener = opener || document.activeElement; S.receipt = null;
  S.openerKey = S.opener?.dataset?.key;
  $('detail-title').textContent = title; $('detail-meta').textContent = meta; $('detail-kicker').textContent = kicker;
  $('detail-content').replaceChildren(node('p', 'muted', t("Loading…")));
  $('detail').dataset.open = 'true';
  placeDetail(S.opener); markCurrent();
  // In a card, focus stays on the card and the detail follows it.
  if (!hostCard()) $('detail-title').focus({preventScroll: true});
}
function closeDetail(restoreFocus = true) {
  if (!detailOpen()) return;
  if(S.receipt?.consumed==='consumed')window.DeckTrace?.setResponse('processed');
  saveDraft(); S.modal = null; S.generation++;
  const card = hostCard();
  $('detail').dataset.open = 'false'; markCurrent();
  if (card) { card.dataset.open = 'false'; setTimeout(() => { if (!detailOpen()) parkDetail(); }, 220); }
  else parkDetail();
  if (!restoreFocus) return;
  const current = S.opener?.isConnected && S.opener.tagName !== 'BODY' ? S.opener : cardFaces().find(n => n.dataset.key === S.openerKey) || $('refresh');
  current.focus({ preventScroll: true });
}
function readDraft(key) { try { return JSON.parse(sessionStorage.getItem('deck-draft-' + key)) || {}; } catch { return S.drafts.get(key) || {}; } }
function saveDraft(event) {
  if (window.DeckAnonymize?.enabled) return;
  // In a «Te necesita» card the card's own editor holds the note and files.
  const own = $('answer-note') ? null : hostCard()?.matches('.qcard') ? readDraft(S.modal?.key) : undefined;
  if (S.modal?.type !== 'call' || own === undefined || S.receipt?.saved) return;
  if (event && ['input', 'change'].includes(event.type)) S.modal.draftNeedsReview = false;
  const draft = { note: own ? own.note || '' : $('answer-note').value, value: S.modal.value || '', request: S.modal.request || crypto.randomUUID().replaceAll('-', ''), attachments: own ? own.attachments || [] : S.modal.attachments || [], occurrence: S.modal.draftNeedsReview ? S.modal.previousOccurrence : S.modal.ticket.call.occurrence };
  S.modal.request = draft.request; S.drafts.set(S.modal.key, draft);
  try { sessionStorage.setItem('deck-draft-' + S.modal.key, JSON.stringify(draft)); } catch { /* In-memory draft remains available. */ }
  syncSubmit();
}
async function openTicket(key, opener, asTask = false) {
  window.DeckTrace?.use('open', 'task');
  const gen = ++S.generation;
  showDetail(t("Task"), '', t("DETAILS"), opener);
  S.modal = { type: 'loading', key };
  try {
    const ticket = await api('api/ticket/' + encodeURIComponent(key));
    if (gen !== S.generation || !detailOpen()) return;
    $('detail-title').textContent = ticket.title; detailMeta(ticket.owner, ticket.time, ticket.project);
    if (ticket.attention_kind === 'action') { deckUI.showAction(ticket); return; }
    if (ticket.call && !asTask) renderCall(ticket);
    else {
      S.modal = { type: 'task', key, ticket };
      const c = ticket.context, p = ticket.presentation || {};
      window.DeckAnonymize?.structural($('detail-kicker'), ['paused','deferred','last_seen_working'].includes(ticket.activity?.kind) ? 'time' : null);
      $('detail-kicker').textContent = phaseText(ticket);
      // Only what is recorded: a missing fact is no row, never a placeholder.
      const lead = [p.status, p.summary].filter((text, i, all) => text && all.indexOf(text) === i && flatten(text) !== flatten(ticket.title));
      $('detail-content').replaceChildren(...lead.map(text => prose(text)));
      const who = whoText(ticket);
      if (who) $('detail-content').append(contextRow(t('Who’s on it'), who));
      const a = ticket.activity || {}, until = a.until ? untilText(a.until) : '';
      if (ticket.dependencies.length) $('detail-content').append(contextRow(t('Dependencies'), dependencyText(ticket)));
      const declaredWaiting = repeatsDependencies(ticket, p.waiting_for) ? '' : p.waiting_for;
      const waitingFor = declaredWaiting || (until ? t('Until {date}', {date: until}) : a.kind === 'validation_gate' ? t('Someone to approve its checks.') : '');
      if (!['ready', 'queued'].includes(a.kind) && waitingFor) $('detail-content').append(contextRow(t('Waiting for'), waitingFor, !declaredWaiting && until ? 'time' : null));
      if (gapLines[a.gap]) $('detail-content').append(node('p', 'activity-note', gapLines[a.gap]));
      if (p.next_action) $('detail-content').append(contextRow(t('Next step'), p.next_action));
      // Work that waits for the captain outside a Captain's Call is answered in Firstmate.
      if (a.kind === 'decision') $('detail-content').append(node('p', 'activity-note', t('You can’t answer this one from the web. Answer it in Firstmate.')));
      addTechnical(ticket); addHerdr(ticket);
    }
  } catch (err) { if (gen === S.generation) $('detail-content').replaceChildren(node('p', 'notice error', err.message)); }
}
function addTechnical(ticket, ...extra) {
  const details = disclosure(t('Provenance and record'),
    contextRow(t('Coordinating space'),ticket.owner||'Firstmate'),
    contextRow(t('Recorded agent'),ticket.agent||t('Not recorded.')),
    contextRow(t('Source record'),ticket.task),
    contextRow(t('Date provenance'),ticket.time?.detail||t('Time not recorded')),
    ticket.report?.text ? contextRow(t('Full recorded report'),ticket.report.text) : null,
    ticket.report?.time?.detail ? contextRow(t('Report provenance'),ticket.report.time.detail) : null,
    ...extra);
  if(ticket.original_title!==ticket.title)details.append(contextRow(t('Original title'),ticket.original_title));
  $('detail-content').append(details);
}
function addHerdr(ticket) { if (!ticket.herdr_url) return; const a = node('a', 'herdr-link', t("Open this agent in Herdr Web ↗")); a.href = ticket.herdr_url; a.target = '_blank'; a.rel = 'noopener noreferrer'; $('detail-content').append(a); }
function stableLink(home, task, view) {
  if (!home) return null;
  const url = new URL(location.href); url.search = new URLSearchParams({ home, task, view }).toString(); url.hash = '';
  const a = node('a', 'herdr-link', t("Link to this task ↗")); a.href = url.href;
  return a;
}
function addStableLink(home, task, view) { const a = stableLink(home, task, view); if (a) $('detail-content').append(a); }
async function openStableLink(params) {
  const home = params.get('home') || '', task = params.get('task') || '', view = params.get('view') || '';
  showDetail(t("Opening task"), '', t("FIRSTMATE LINK"));
  const gen = ++S.generation;
  try {
    const result = await api('api/resolve?' + new URLSearchParams({ home, task, view, item: params.get('item') || '' }));
    if (gen !== S.generation || !detailOpen()) return;
    if (result.view === 'call') { setView('board'); await openTicket(result.key, deckUI?.locateCall(result.key)); return; }
    if (result.view === 'delivery') { $('history-search').value = task; setView('history'); await loadHistory(); const opener = [...$('history-results').querySelectorAll('.card-open')].find(n => n.dataset.key === 'history:' + home + ':' + task); await openDelivery(home, task, opener); if (S.modal?.type === 'delivery' && result.notice) { S.modal.linkNotice = result.notice; renderDelivery(); } return; }
    S.modal = { type: 'task' };
    $('detail-title').textContent = t("The question from this notification"); $('detail-meta').textContent = result.owner + ' · ' + result.task;
    $('detail-content').replaceChildren(prose(result.message));
    for (const receipt of result.receipts || []) $('detail-content').append(receiptView(receipt));
    if (result.current_key) $('detail-content').append(button(t("View the current question"), async () => { setView('board'); await openTicket(result.current_key, deckUI?.locateCall(result.current_key)); $('detail-kicker').textContent = t("CURRENT QUESTION"); }));
    $('detail-content').append(button(t("Find this task in history"), () => { $('history-search').value = task; closeDetail(false); setView('history'); }));
  } catch (err) { if (gen === S.generation) $('detail-content').replaceChildren(node('p', 'notice error', err.message)); }
}
// Long authored text leads with one short line; the rest opens on demand.
const abbreviation = (text) => /(?:^|[^\p{L}.])(?:vs|e\.g|i\.e|etc|approx|aprox|mrs?|dra?|sra?|p\. ?ej)$/iu.test(text) || /(?:^|[^\p{L}.])No$/u.test(text);
function shortLine(text, limit = 140) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  for (const end of flat.matchAll(/[.!?](?=\s+[\p{Lu}¿¡]|$)/gu)) {
    if (end.index >= limit) break;
    if (end.index >= 40 && !abbreviation(flat.slice(0, end.index))) return flat.slice(0, end.index + 1);
  }
  return flat.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
}
function leadText(cls, text) {
  const lead = shortLine(text), full = String(text || '').trim();
  if (lead === full.replace(/\s+/g, ' ')) return node('p', cls, full);
  return append(node('div', cls), node('p', '', lead), disclosure(t('Read more'), prose(full)));
}
// A web report opens in a new tab; a report file in the crew's folder opens
// right here, read through Deck like a delivery report.
function reportLink(link, key) {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) {
    const a = node('a', 'report-link', t('See the full report ↗')); a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  const open = button(t('See the full report'), async () => {
    const content = $('detail-content'), saved = Array.from(content.childNodes || content.children || []), title = $('detail-title').textContent, kicker = $('detail-kicker').textContent;
    open.setAttribute('aria-expanded', 'true');
    $('detail-title').textContent = t('Full report'); $('detail-kicker').textContent = t('Report');
    const back = button(t('Back to decision'), () => { content.replaceChildren(...saved); $('detail-title').textContent = title; $('detail-kicker').textContent = kicker; open.setAttribute('aria-expanded', 'false'); open.focus(); }, 'more');
    content.replaceChildren(back, node('p', 'muted', t('Loading…')));
    try { const data = await api('api/ticket/' + encodeURIComponent(key) + '/report'); content.replaceChildren(back, markdown(data.text)); }
    catch (err) { content.replaceChildren(back, node('p', 'notice error', err.message)); }
  }, 'report-link');
  open.setAttribute('aria-expanded', 'false');
  return open;
}
// Card editors share the guarded ticket intake and its durable drafts.
// The last reading of each inline question, so a refresh repaints it at its height.
async function inlineAnswer(card, opener, container) {
  // Options and free answer stay on the card when it opens, as the demo; its detail follows them.
  const editor=node('div','inline-answer'),more=container.querySelector('.card-more');more?more.before(editor):container.append(editor);
  // The card's menu item is added once and answers through the newest reading.
  let answer=null,recheck=false;
  if(card.inline_call) fill({call:card.inline_call});
  function fill(ticket){
    if(ticket.answered||!ticket.call)return;
    const c=ticket.call,draft=readDraft(card.key),items=draft.attachments||[];
    const offered=c.options.filter(o=>o.value!=='reconcile');
    const note=node('input');note.type='text';note.value=draft.note||'';note.placeholder=t(offered.length?'Or write your answer…':'Write your answer…');note.setAttribute('aria-label',t('Answer in my own words'));
    const status=node('p','notice');status.hidden=true;status.setAttribute('role','status');
    let edited=false;
    const store=event=>{if(event)edited=true;const saved={...draft,note:note.value,attachments:items,occurrence:edited?c.occurrence:(draft.occurrence||c.occurrence)};S.drafts.set(card.key,saved);try{sessionStorage.setItem('deck-draft-'+card.key,JSON.stringify(saved));}catch{};sync();};
    const sendAnswer=async value=>{
      if(S.busy||!S.online||window.DeckAnonymize?.enabled||editor.querySelector('[data-uploading]'))return;
      store();await openTicket(card.key,opener);
      if(S.modal?.key!==card.key||S.modal?.type!=='call'||S.receipt)return;
      if((c.identity && S.modal.ticket.call.identity!==c.identity)||S.modal.draftNeedsReview)return;
      if(value)choose(value);else {S.modal.value='';saveDraft();submitAnswer();}
    };
    const choices=node('div','option-list');
    for(const option of offered){
      const label=c.presentation?.options?.find(o=>o.value===option.value)||option;
      const choice=button(label.label,()=>sendAnswer(option.value),'option-choice');
      if(option.value===c.recommend){choice.classList.add('recommended-choice');choice.title=t('Recommended');choice.append(node('small','recommended',t('Recommended')));}
      choices.append(choice);
    }
    answer=sendAnswer;
    if(!recheck&&c.options.some(o=>o.value==='reconcile')){recheck=true;deckUI?.addMenuItem?.(container,'redo',t('Ask to check it again'),()=>answer('reconcile'));}
    const send=button(t('Send'),()=>sendAnswer(''),'primary answer-send');
    const sync=()=>{const blocked=!!window.DeckAnonymize?.enabled||!S.online||S.busy||!!c.error||!!editor.querySelector('[data-uploading]');send.disabled=blocked||(!note.value.trim()&&!items.length);for(const b of choices.children)b.disabled=blocked;};
    note.addEventListener('input',store);note.addEventListener('keydown',event=>{if(event.key==='Enter'&&!send.disabled){event.preventDefault();sendAnswer('');}});
    const free=node('div','own-words');free.append(append(node('label','answer-label'),note),send);editor.append(choices,free,status);
    if(c.attachments)answerTools.composer(free,'api/ticket/'+encodeURIComponent(card.key)+'/upload',items,()=>store(true),()=>editor.isConnected&&!window.DeckAnonymize?.enabled&&!S.busy);
    if(c.error){status.textContent=c.error;status.hidden=false;}sync();
  }
}
function choose(value) {
  if (S.busy || S.receipt || S.modal?.type !== 'call') return;
  S.modal.value = value; S.modal.draftNeedsReview = false; $('call-change').hidden = true;
  saveDraft(); submitAnswer();
}
function renderCall(ticket, draftOverride) {
  const key = ticket.key, c = ticket.call, draft = draftOverride || readDraft(key);
  const staleDraft = !!draft.occurrence && draft.occurrence !== c.occurrence && !!(draft.note || draft.value || draft.attachments?.length);
  S.modal = { type: 'call', key, ticket, value: staleDraft ? '' : draft.value || '', attachments: draft.attachments || [], request: draft.request || crypto.randomUUID().replaceAll('-', ''), draftNeedsReview: staleDraft, previousOccurrence: draft.occurrence, checkFailed: !!c.error };
  $('detail-kicker').textContent = t('Needs you'); $('detail-title').textContent = ticket.title;
  const content = $('detail-content'); content.replaceChildren();
  const decisionOrigin=deckUI?.decisionOrigin?.(ticket.home,ticket.task);
  const originNote=decisionOrigin?.state==='done'?node('p','deck-origin-note',t('This decision is still open. Its origin report has already been delivered; the investigation is not restarting.')):null;
  // The question appears once; the report is its link, not a path in the text.
  const howTo = c.link ? (c.detail || '').split(c.link).join('').replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim() : c.detail;
  const instructions = howTo ? contextRow(t('How to answer'), howTo) : null;
  if (instructions) instructions.className += ' call-instructions';
  const technical = [contextRow(t('Answer limits'), c.attachments ? t('Up to 4096 bytes of text and eight files of 5 MB each. Typing only saves a draft.') : t('One line, up to 512 bytes. Typing only saves a draft. Picking an option sends it right away; Send sends a written answer.'))];
  if (c.background) technical.unshift(contextRow(t('Original question text'), c.background));
  if (ticket.answered) {
    $('detail-kicker').textContent = t('Answer saved');
    content.append(prose(c.presentation?.decide || c.decide), contextRow(t('What happens next'), t('Firstmate has your answer and will pick it up next.')),
      button(t('See answer status'), async () => { await loadReceipts(); $('receipts-panel').open = true; closeDetail(false); $('receipts-panel').scrollIntoView({ block: 'start' }); }));
    answerTools.panel(ticket.home,ticket.task).then(panel=>{if(content.isConnected&&S.modal?.key===key)content.append(panel);});
    if (instructions) content.append(instructions);
    const link = reportLink(c.link, key); if (link) content.append(link);
    addTechnical(ticket, ...technical); addHerdr(ticket); addStableLink(ticket.home, ticket.task, 'call'); return;
  }
  const error = node('p', 'notice', c.error || (staleDraft ? staleDraftNote : '')); error.id = 'call-change'; error.hidden = !c.error && !staleDraft; content.append(error);
  // A «Te necesita» card already shows the question, its options and the free
  // answer, as the approved v11b demo; opened, it adds only the report, the
  // answer status and folded provenance. Re-check and origin are in its «…» menu.
  if (hostCard()?.matches('.qcard')) {
    const summary = ticket.question_summary;
    if (summary?.context) content.append(leadText('call-context', summary.context));
    if (summary?.recommendation) {
      const recommendation = summary.recommendation;
      content.append(node('p', 'call-recommendation', t('Recommended: {choice}', {choice: recommendation.label}) +
        (recommendation.reason ? ' · ' + recommendation.reason : '')));
    }
    deckUI?.questionRelationships?.(ticket.home, ticket.task);
    if (instructions) content.append(instructions);
    const link = reportLink(c.link, key); if (link) content.append(link);
    const state = node('div'); state.id = 'answer-status'; state.setAttribute('role', 'status'); content.append(state);
    addTechnical(ticket, ...technical, stableLink(ticket.home, ticket.task, 'call')); addHerdr(ticket); return;
  }
  const about = c.presentation?.about || c.about, question = c.presentation?.decide || c.decide;
  // The title already asks it when the two read the same.
  if (flatten(question) !== flatten(S.opener?.querySelector?.('.title')?.textContent || ticket.title)) content.append(node('p', 'question', question));
  if (about) content.append(leadText('call-context', about));
  const label = (option) => c.presentation?.options?.find(o => o.value === option.value) || option;
  const choices = c.options.filter(o => o.value !== 'reconcile'), recheck = c.options.find(o => o.value === 'reconcile');
  if (choices.length) {
    const list = node('div', 'option-list'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', t('Pick one'));
    for (const option of choices) {
      const b = button('', () => choose(option.value), 'option-choice'); b.dataset.value = option.value;
      const text = append(node('span', 'option-text'), node('strong', '', label(option).label));
      if (option.value === c.recommend) { b.className += ' recommended-choice'; text.append(' ', node('span', 'recommended', t('Recommended'))); }
      if (option.hint) text.append(node('small', '', label(option).hint || option.hint));
      b.append(text); list.append(b);
    }
    content.append(list);
  }
  // How-to text follows the choices, so the recommended one stays in view.
  if (instructions) content.append(instructions);
  const link = reportLink(c.link, key);
  const note = node('textarea'); note.id = 'answer-note'; note.rows = 3; note.value = draft.note || ''; note.placeholder = t('Write here…'); note.addEventListener('input', saveDraft);
  const noteLabel = append(node('label', 'answer-label', c.freeform ? t('Your answer') : t('Add a note (optional)')), note);
  const send = c.freeform ? button(t('Send'), () => { S.modal.value = ''; saveDraft(); submitAnswer(); }, 'primary') : null;
  if (send) send.id = 'answer-submit';
  const ownWords = append(node('div', 'own-words'), noteLabel, c.freeform ? node('p', 'notice', t('Sending closes this decision. To discuss it, use the supervisor chat.')) : null, send);
  if(c.attachments){const modal=S.modal;answerTools.composer(ownWords,'api/ticket/'+encodeURIComponent(key)+'/upload',modal.attachments,()=>{modal.draftNeedsReview=false;saveDraft();},()=>S.modal===modal&&!S.receipt&&!S.busy);}
  if (choices.length) {
    const fold = disclosure(c.freeform ? t('Answer in my own words') : t('Add a note first (optional)'), ownWords);
    fold.className += ' own-words-fold'; fold.open = true; content.append(fold);
  } else content.append(ownWords);
  if (recheck) {
    // The re-check carries its own one-line meaning.
    const b = button('', () => choose('reconcile'), 'option-choice secondary-choice'); b.dataset.value = 'reconcile';
    append(b, node('strong', '', t('Check again first')), node('small', '', t('Nothing gets decided yet.')));
    content.append(append(node('div', 'recheck'), b));
  }
  if (link) content.append(link);
  if(originNote)content.append(originNote);
  const state = node('div'); state.id = 'answer-status'; state.setAttribute('role', 'status'); content.append(state);
  const origin = button(t('Go to source task'), () => deckUI?.revealTask(ticket.home,ticket.task));
  origin.disabled=!deckUI?.hasOrigin?.(ticket.home,ticket.task);if(origin.disabled)origin.title=t('Question origin not recorded');
  content.append(origin);
  addTechnical(ticket, ...technical); addHerdr(ticket); addStableLink(ticket.home, ticket.task, 'call'); syncSubmit();
}
async function checkCall() {
  const modal = S.modal;
  if (!modal || modal.checking) return;
  modal.checking = true;
  try {
    const latest = await api('api/ticket/' + encodeURIComponent(modal.key));
    const warning = $('call-change');
    if (S.modal !== modal || S.busy || !warning) return;
    const changed = !latest.call || latest.call.occurrence !== modal.ticket.call.occurrence;
    if (changed || latest.call.error) {
      warning.hidden = false; warning.replaceChildren(document.createTextNode(latest.call?.error || t("The question changed. Your draft is still here.")));
      if (changed && latest.call && !latest.call.error) warning.append(button(t("See the new question"), () => { saveDraft(); renderCall(latest); }));
      modal.checkFailed = true;
    } else if (modal.checkFailed) {
      modal.checkFailed = false; warning.hidden = !modal.draftNeedsReview; warning.textContent = modal.draftNeedsReview ? staleDraftNote : '';
    }
    syncSubmit();
  } catch (err) { if (S.modal === modal && $('call-change')) { $('call-change').hidden = false; $('call-change').textContent = t("Couldn’t check the question. Your draft is safe."); modal.checkFailed = true; syncSubmit(); } }
  finally { modal.checking = false; }
}
function receiptView(receipt) {
  const box = node('div', 'receipt'); box.setAttribute('role', 'status');
  append(box, node('h3', '', receipt.saved ? t("Answer saved") : receipt.saved === false ? t("Answer not sent") : t("Not sure it was sent")), node('p', '', t(receipt.message)));
  if(receipt.note)box.append(node('p','answer-text',receipt.note));
  if(receipt.saved&&receipt.home&&receipt.task)answerTools.panel(receipt.home,receipt.task).then(panel=>box.append(panel));
  if (receipt.primary === 'unreachable') append(box, node('p', 'notice', t("Couldn’t reach Firstmate right now. It will see your answer on its next check.")));
  // Each step is a separate fact; none of them proves the agent resumed.
  const dl = node('dl'), no = t("Not yet");
  for (const [label, text] of [[t("Saved"), receipt.saved === true ? t("Yes") : no], [t("Firstmate told"), receipt.primary === 'sent' ? t("Sent to Firstmate") : receipt.notice === 'queued' ? t("Queued") : no], [t("Firstmate got it"), receipt.ack === 'acknowledged' ? t("Yes") : no], [t("Firstmate used it"), receipt.consumed === 'consumed' ? t("Yes") : no]]) append(dl, node('dt', '', label), node('dd', '', text));
  append(box, disclosure(t("Details"), dl, node('p', '', t("Saved doesn’t mean the agent has started again.")), receipt.detail ? prose(receipt.detail) : null));
  return box;
}
async function loadReceipts() {
  try {
    const data = await api('api/receipts');
    $('receipts-panel').hidden = !data.receipts.length;
    const signature = JSON.stringify(data.receipts);
    if ($('receipts').dataset.signature === signature) return;
    const expanded = [...$('receipts').querySelectorAll('details[open]')].map(d => d.dataset.request);
    const focused = $('receipts').contains(document.activeElement) ? document.activeElement.closest('[data-request]')?.dataset.request : '';
    $('receipts').replaceChildren(...data.receipts.map(r => {
      const detail = node('details', 'source-details');
      detail.dataset.request = r.request_id; detail.open = expanded.includes(r.request_id);
      append(detail, structural(node('summary', '', (r.title || r.task) + ' · ' + dateFmt.format(new Date(r.at * 1000))), 'time'), receiptView(r));
      return detail;
    }));
    $('receipts').dataset.signature = signature;
    if (focused) [...$('receipts').children].find(d => d.dataset.request === focused)?.querySelector('summary')?.focus({preventScroll: true});
  } catch { /* The board remains usable; each submit also returns its receipt. */ }
}
async function submitAnswer() {
  if (S.busy || !S.online || S.receipt || S.modal?.type !== 'call') return;
  saveDraft(); const modal = S.modal, draft = readDraft(modal.key);
  window.DeckTrace?.setResponse('sent');
  S.busy = true; syncSubmit();
  let cancelled=false;
  const pending=node('span','',t('Answer not sent yet · Undo is available for 10 s.'));
  $('answer-status').replaceChildren(pending,button(t('Undo'),()=>{cancelled=true;S.busy=false;pending.parentElement?.replaceChildren(node('p','notice',t('Sending cancelled. Your draft is saved.')));syncSubmit();}));
  await new Promise(resolve=>setTimeout(resolve,10000));
  if(cancelled)return;
  if(S.modal!==modal){S.busy=false;syncSubmit();return;}
  $('answer-status').replaceChildren(node('p', 'muted', t("Sending…")));
  try {
    const receipt = await api('api/ticket/' + encodeURIComponent(modal.key) + '/answer', { value: draft.value || '', note: draft.note || '', attachments: (draft.attachments||[]).map(file=>file.id), occurrence: modal.ticket.call.occurrence, request_id: modal.request });
    if (S.modal !== modal) return;
    window.DeckTrace?.setResponse('receipt');
    S.receipt = receipt; $('answer-status').replaceChildren(receiptView(receipt));
    $('answer-status').append(button(t("See answer status"), async () => {
      await loadReceipts(); $('receipts-panel').open = true; closeDetail(false);
      $('receipts-panel').scrollIntoView({ block: 'start' });
    }));
    if (receipt.state === 'conflict') $('answer-status').append(button(t("See the new question"), () => openTicket(modal.key, S.opener)));
    if (receipt.saved) { S.drafts.delete(modal.key); try { sessionStorage.removeItem('deck-draft-' + modal.key); } catch {} await loadReceipts(); }
  } catch (err) {
    if (S.modal !== modal) return;
    // The same request id goes out again, so a retry can never answer twice.
    $('answer-status').replaceChildren(node('p', 'notice error', err.message + (err.retry ? t(" Your draft is safe. Try the same answer again.") : t(" Your draft is safe."))));
  } finally { S.busy = false; syncSubmit(); }
}
async function openDelivery(home, task, opener) {
  window.DeckTrace?.use('open', 'delivery');
  const gen = ++S.generation;
  showDetail(t("Delivered work"), '', t("DELIVERED"), opener);
  S.modal = { type: 'loading' };
  try {
    const data = await api('api/delivery/' + encodeURIComponent(home) + '/' + encodeURIComponent(task));
    if (gen !== S.generation || !detailOpen()) return;
    S.modal = { type: 'delivery', home, task, data, tab: 'summary' };
    $('detail-title').textContent = data.title; detailMeta(data.owner, data.time, data.project);
    renderDelivery(); refreshExplanation();
  } catch (err) { if (gen === S.generation) $('detail-content').replaceChildren(node('p', 'notice error', err.message)); }
}
function renderDelivery() {
  const modal = S.modal, data = modal.data, content = $('detail-content'); content.replaceChildren();
  if (modal.linkNotice) content.append(node('p', 'notice', modal.linkNotice));
  if (data.notice) content.append(node('p', 'notice', data.notice));
  // What changed comes first; without a summary the report opens right away.
  const views = [['summary', t("Summary")], ['report', t("Report")]].filter(([id]) => data[id]);
  if (!views.some(([id]) => id === modal.tab)) modal.tab = views[0]?.[0] || 'summary';
  if (views.length > 1) {
    const tabs = node('nav', 'detail-tabs'); tabs.setAttribute('aria-label', t("Delivery content"));
    for (const [id, label] of views) { const b = button(label, () => { modal.tab = id; renderDelivery(); [...content.querySelectorAll('.detail-tabs button')].find(n => n.getAttribute('aria-pressed') === 'true')?.focus({preventScroll: true}); }); b.setAttribute('aria-pressed', String(modal.tab === id)); tabs.append(b); }
    content.append(tabs);
  }
  if (!views.length) content.append(node('p', 'detail-empty', t("No summary or report for this one.")));
  else if (modal.tab === 'summary') content.append(prose(data.summary));
  else content.append(markdown(data.report_text || data.report), data.report_lead ? disclosure(t("Branch, commits and paths"), markdown(data.report_lead)) : '');
  // A PR address left the title; it opens from here instead.
  for (const link of data.links || []) {
    const a = node('a', 'report-link', link.pr ? t('See PR #{number} ↗', {number: link.pr}) : t('Open link ↗'));
    a.href = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; content.append(a);
  }
  // One control, one line of where the request stands.
  const actions = node('div', 'explain-actions');
  const ask = button(t("Ask Firstmate to explain it"), requestExplanation); ask.id = 'explain-request';
  const text = node('span', 'explain-status'); text.id = 'explain-status'; text.setAttribute('role', 'status');
  const reply = node('div', 'explain-reply'); reply.id = 'explain-reply'; reply.hidden = true;
  append(actions, ask, text); content.append(actions, reply);
  content.append(disclosure(t('Technical details'), prose(data.details), contextRow(t('History sources'), data.sources), contextRow(t('Date provenance'), data.time?.detail),
    data.original_title && data.original_title !== data.title ? contextRow(t('Original title'), data.original_title) : null));
  if (modal.explanation) explanationView(modal.explanation);
  addStableLink(modal.home, modal.task, 'delivery');
  deckUI?.decorateIdentity?.(modal.home,modal.task);
}
// A report's Markdown as plain page elements: nothing in it runs or loads,
// and only a web address becomes a link.
function inline(target, text) {
  let at = 0;
  for (const m of String(text).matchAll(/\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()\[\]]*[^\s<>()\[\].,;:!?'"»])/g)) {
    target.append(text.slice(at, m.index)); at = m.index + m[0].length;
    if (m[1] || m[2]) target.append(node('strong', '', m[1] || m[2]));
    else if (m[3]) target.append(node('code', '', m[3]));
    else {
      const url = m[5] || m[6], label = m[4] || m[6];
      if (!/^https?:\/\//i.test(url)) { target.append(label); continue; }
      const a = node('a', '', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; target.append(a);
    }
  }
  target.append(String(text).slice(at)); return target;
}
function markdown(text) {
  const root = node('div', 'prose report');
  let lines = [], list = null, fence = null, table = null;
  const flush = () => { if (lines.join('\n').trim()) root.append(inline(node('p'), lines.join('\n').trim())); lines = []; };
  for (const line of String(text || '').split('\n')) {
    if (fence) { if (/^\s*(```|~~~)/.test(line)) { root.append(append(node('pre'), node('code', '', fence.join('\n')))); fence = null; } else fence.push(line); continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)[\s#]*$/), item = line.match(/^\s*([-*+]|\d+[.)])\s+(.+)/);
    if (!/^\s*\|/.test(line)) table = null;
    if (/^\s*(```|~~~)/.test(line)) { flush(); list = null; fence = []; }
    else if (/^\s*\|/.test(line)) {
      flush(); list = null;
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) continue;
      if (!table) { table = node('table'); root.append(append(node('div', 'table-scroll'), table)); }
      table.append(append(node('tr'), ...cells.map(cell => inline(node(table.children.length ? 'td' : 'th'), cell))));
    }
    else if (heading) { flush(); list = null; root.append(inline(node(heading[1].length <= 2 ? 'h3' : 'h4'), heading[2])); }
    else if (item) {
      flush(); const tag = /\d/.test(item[1]) ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) { list = node(tag); root.append(list); }
      list.append(inline(node('li'), item[2]));
    }
    else if (!line.trim()) { flush(); list = null; }
    // An indented line goes on with the item above it.
    else if (list && /^\s{2,}\S/.test(line)) inline(list.lastChild, ' ' + line.trim());
    else { list = null; lines.push(line.replace(/^\s*>\s?/, '')); }
  }
  if (fence) root.append(append(node('pre'), node('code', '', fence.join('\n'))));
  flush(); return root;
}
function explanationView(data) {
  if (!$('explain-status')) return;
  const lines = { queued: t("Asked. Firstmate hasn’t seen it yet."), saved_unannounced: t("Asked, but not sure Firstmate was told."), acknowledged: t("Firstmate is on it."), answered: t("Firstmate replied below."), unsupported: data.message || t("This space can’t take explanation requests yet."), error: t("Couldn’t check the request.") };
  const text = lines[data.state] || '';
  if ($('explain-status').textContent !== text) $('explain-status').textContent = text;
  $('explain-status').title = data.state === 'error' ? data.message || '' : '';
  const reply = data.receipt?.reply, box = $('explain-reply');
  box.hidden = !reply?.body;
  if (reply?.body && box.dataset.body !== reply.body + (reply.at || '')) {
    box.dataset.body = reply.body + (reply.at || '');
    box.replaceChildren(markdown(reply.body), reply.at ? structural(node('p', 'muted', dateFmt.format(new Date(reply.at))), 'time') : '');
  }
  const ask = $('explain-request');
  ask.hidden = data.state === 'unsupported';
  ask.disabled = S.busy || !S.online || ['queued', 'acknowledged', 'answered'].includes(data.state);
}
async function refreshExplanation() {
  const modal = S.modal; if (modal?.type !== 'delivery' || modal.readingExplanation) return;
  modal.readingExplanation = true;
  try { const data = await api(`api/delivery/${encodeURIComponent(modal.home)}/${encodeURIComponent(modal.task)}/explanation`); if (S.modal === modal) { modal.explanation = data; explanationView(data); } }
  catch (err) { if (S.modal === modal && $('explain-status')) { $('explain-status').textContent = t("Couldn’t check the request."); $('explain-status').title = err.message; } }
  finally { modal.readingExplanation = false; }
}
async function requestExplanation() {
  const modal = S.modal; if (modal?.type !== 'delivery' || S.busy || !S.online) return;
  S.busy = true; $('explain-request').disabled = true;
  try { const data = await api(`api/delivery/${encodeURIComponent(modal.home)}/${encodeURIComponent(modal.task)}/explanation`, {}); if (S.modal === modal) { modal.explanation = data; explanationView(data); } }
  catch (err) { if (S.modal === modal && $('explain-status')) $('explain-status').textContent = err.message; }
  finally { S.busy = false; if (S.modal === modal && modal.explanation) explanationView(modal.explanation); }
}
$('detail-close').addEventListener('click', () => closeDetail());
// Esc or a tap anywhere outside the detail and the cards closes it.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (detailOpen()) { event.preventDefault(); closeDetail(); return; }

});
document.addEventListener('click', (event) => {
  if (!detailOpen()) return;
  const path = event.composedPath?.() || [];
  if (path.includes($('detail')) || path.includes($('detail-panel')) || path.includes($('change-log')) || path.includes($('changes-toggle')) || path.some(n => n.classList?.contains('card-open') || n.classList?.contains('mix') || n.dataset?.node)) return;
  closeDetail(false);
});

$('crew').addEventListener('change', () => { window.DeckTrace?.use('select', 'space'); S.home = $('crew').value; S.board = null; S.historyRows = []; S.historyFetchedAt = 0; closeDetail(false); $('board').replaceChildren(node('p', 'placeholder', t("Loading this space…"))); poll(); if (S.view === 'history') loadHistory(); });
$('board-view').addEventListener('click', () => setView('board'));
$('projects-view').addEventListener('click', () => setView('projects'));
$('history-tab').addEventListener('click', () => setView('history'));
for (const el of document.querySelectorAll('[data-mode]')) el.addEventListener('click', () => window.DeckAppearance.set('mode',el.dataset.mode));
$('palette').addEventListener('change', () => window.DeckAppearance.set('palette',$('palette').value));
window.DeckAppearance.apply();
$('history-view').addEventListener('click', () => setView(S.view === 'history' ? 'board' : 'history'));
$('refresh').addEventListener('click', () => { window.DeckTrace?.use('refresh', 'board'); poll(); if (S.view === 'history') loadHistory(); });
$('board-search').addEventListener('input', () => { S.query = $('board-search').value.trim().toLocaleLowerCase(locale); renderBoard(); });
$('history-search').addEventListener('input', () => { S.historyLimit = 40; clearTimeout(S.historyTimer); S.historyTimer = setTimeout(loadHistory, 250); });
window.addEventListener('offline', () => { S.online = false; sourceStatus(); });
window.addEventListener('online', poll);
matchMedia('(max-width: 639px)').addEventListener('change', renderBoard);
window.addEventListener('pagehide', () => stream?.close());
window.addEventListener('pageshow', event => { if (event.persisted) poll(); });
setInterval(() => { sourceStatus(); refreshTimes(); deckUI?.refreshAges(); deckUI?.refreshReceipts(); }, 15000);
// Retire an old Deck push/offline worker. It must never intercept actions or
// show stale API success; offline honesty is handled by the visible live view.
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(regs => { for (const reg of regs) if (reg.scope === new URL('./', location.href).href) reg.unregister(); }).catch(() => {});
poll(); loadReceipts();

window.DeckTrace?.setSender(async (events,exporting)=>{
  // Controls can be used while the first board read is still obtaining CSRF.
  await initialSession;
  return api('/api/diagnostics/trace',{events,exporting});
});
for (const [id,target] of [['board-search','board'],['history-search','history']]) {
  $(id).addEventListener('change', () => window.DeckTrace?.use('search', target));
}
for (const el of document.querySelectorAll('[data-mode], #palette')) {
  el.addEventListener(el.id === 'palette' ? 'change' : 'click', () => window.DeckTrace?.use('change', 'appearance'));
}
$('settings-open').addEventListener('click', () => window.DeckTrace?.use('open', 'settings'));
const diagnosticsDialog = document.querySelector('#diagnostics-dialog');
document.querySelector('#diagnostics-open').addEventListener('click', async () => {
  window.DeckTrace?.use('open', 'diagnostics');
  diagnosticsDialog.showModal();
  try { document.querySelector('#diagnostics-preview').textContent = (await api('/api/diagnostics/preview')).preview + ' · browser: ' + JSON.stringify(window.DeckTrace?.counts() || {}); }
  catch (error) { document.querySelector('#diagnostics-preview').textContent = error.message; }
});
document.querySelector('#diagnostics-close').addEventListener('click', () => diagnosticsDialog.close());
document.querySelector('#diagnostics-export').addEventListener('click', async () => {
  try { window.DeckTrace?.use('export', 'diagnostics'); await window.DeckTrace?.flush(true); const result = await api('/api/diagnostics/export', {}); document.querySelector('#diagnostics-preview').textContent = `Saved: ${result.file}`; }
  catch (error) { document.querySelector('#diagnostics-preview').textContent = error.message; }
});

});

const deckSettings = document.getElementById('settings-dialog');
document.getElementById('settings-open').addEventListener('click', () => deckSettings.showModal());
document.getElementById('settings-close').addEventListener('click', () => deckSettings.close());
for (const id of ['relay-settings-open', 'diagnostics-open']) {
  document.getElementById(id).addEventListener('click', () => deckSettings.close(), true);
}
