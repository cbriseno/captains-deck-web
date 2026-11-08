/* Screenshot presentation only. Originals live in JS, never in replacement markup. */
'use strict';
window.DeckAnonymize = (() => {
  const attributes = ['title', 'aria-label', 'alt', 'placeholder', 'label'];
  const readOnlyActions = '[data-work-allowed],.option-choice,#answer-submit,#explain-request,.deck-removal-send,.change-preview button,#relay-confirm-apply,#relay-settings-content button';
  const words = {en: ['amber', 'cloud', 'orbit', 'tile', 'wave', 'echo'], es: ['ámbar', 'nube', 'órbita', 'pieza', 'onda', 'eco']};
  const provenance = new WeakMap(), records = new Map(), generated = new WeakSet(), roots = new Set();
  const projectAliases = new Map(), times = new Set(), selectWidths = new WeakMap();
  const candidateWidths = new Map(), context = document.createElement('canvas').getContext('2d');
  let active = false, started = false, internal = false, language = 'en', known = new Set(), templates = [];
  let revision = 0, processing = false, savedVisibility = '', metrics = {};
  const pending = new Set(), frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const hash = text => { let n = 2166136261; for (const ch of text) n = Math.imul(n ^ ch.codePointAt(0), 16777619); return n >>> 0; };
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function catalog(locale, messages) {
    language = locale.startsWith('es') ? 'es' : 'en';
    const strings = [...Object.keys(messages), ...Object.values(messages), ...document.querySelectorAll('[data-i18n]')].map(x => typeof x === 'string' ? x : x.dataset.i18n);
    known = new Set(strings.filter(x => !/\{\w+\}/.test(x)));
    // These are closed renderer symbols, not arbitrary producer states or numbers.
    for (const x of ['Deck', '⚓', '↻', '✕', '◎', '●', '▸', '▾', '⋯', '▲', '▼', '—', 'NA', 'Codex', 'Claude Code', 'Pi']) known.add(x);
    templates = [...new Set(strings)].filter(x => /\{\w+\}/.test(x)).map(text => {
      const fixed = text.split(/\{\w+\}/), names = [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      for (const literal of fixed) if (literal.trim()) known.add(literal.trim());
      return {fixed, names, pattern: new RegExp('^' + fixed.map(escape).join('([\\s\\S]*?)') + '$')};
    });
  }
  function parts(text, kind, depth = 0) {
    if (kind && typeof kind === 'object') return text.endsWith(kind.suffix) ? [...parts(text.slice(0, -kind.suffix.length), undefined, depth), ...parts(kind.suffix, kind.kind, depth)] : parts(text, undefined, depth);
    if (!text || known.has(text) || /^[\s·:;,→✓○%/|()[\]–—.\-]+$/u.test(text)) return [{text, safe: true}];
    if (kind === 'count' && /^(?:\d+(?:[.,]\d+)?%?|\d+\/\d+)$/.test(text)) return [{text, safe: true}];
    if (kind === 'time') {
      if (times.has(text)) return [{text, safe: true}];
    }
    if (kind === 'time') for (const stamp of times) { const at = text.indexOf(stamp); if (stamp && at >= 0) return [...parts(text.slice(0, at), undefined, 4), {text: stamp, safe: true}, ...parts(text.slice(at + stamp.length), undefined, 4)]; }
    if (depth < 4) for (const item of templates) {
      if (item.fixed[0] && !text.startsWith(item.fixed[0])) continue;
      if (item.fixed.at(-1) && !text.endsWith(item.fixed.at(-1))) continue;
      const match = item.pattern.exec(text); if (!match) continue;
      const out = [];
      item.fixed.forEach((literal, i) => {
        out.push({text: literal, safe: true});
        if (i < item.names.length) out.push(...parts(match[i + 1], kind === 'count' && ['count', 'done', 'total'].includes(item.names[i]) ? 'count' : kind === 'time' && ['date', 'time', 'ago'].includes(item.names[i]) ? 'time' : undefined, depth + 1));
      });
      return out;
    }
    // UI compositions retain each complete label. Unknown sections stay denied.
    const segments = text.split(/(\s·\s|\n|\s[→✓○]\s)/);
    if (segments.length > 1) return segments.flatMap(x => parts(x, kind, 4));
    if (kind === 'count' && /\s/.test(text.trim())) return text.split(/(\s+)/).flatMap(x => parts(x, kind, 4));
    const trimmed = text.trim();
    if (trimmed !== text) return [{text: text.slice(0, text.indexOf(trimmed)), safe: true}, ...parts(trimmed, kind, depth + 1), {text: text.slice(text.indexOf(trimmed) + trimmed.length), safe: true}];
    return [{text, safe: false}];
  }
  function fake(text) {
    return text.replace(/[\p{L}\p{N}]+/gu, token => {
      const index = hash(token) % words[language].length;
      let replacement = words[language][index];
      if (replacement === token) replacement = words[language][(index + 1) % words[language].length];
      return replacement;
    });
  }
  const plain = (text, kind) => parts(text, kind).map(p => p.safe ? p.text : fake(p.text)).join('');
  function remember(el, key, original, masked) {
    let entry = records.get(el); if (!entry) records.set(el, entry = new Map());
    entry.set(key, {original, masked});
  }
  function property(el, key, value, kind) {
    const old = records.get(el)?.get(key); if (old && old.masked === value) return;
    const masked = plain(value, kind); if (masked === value) return;
    remember(el, key, value, masked); const previous = internal; internal = true;
    if (key === 'value') { el.value = masked; records.get(el).get(key).masked = el.value; } else el.setAttribute(key.replace(/^attribute:/, ''), masked);
    internal = previous;
  }
  // READ: snapshot style and line geometry before any replacement writes.
  function read(node) {
    const parent = node.parentElement || node.parentNode?.host;
    if (generated.has(node) || !parent || parent.closest('script,style,noscript,[data-anon-word]')) return null;
    const source = node.data, kind = provenance.get(parent);
    if (kind?.alias) return {node, parent, source, simple:true, parsed:[{text:kind.alias,safe:true}]};
    const parsed = parts(source, kind);
    if (parsed.every(p => p.safe)) return null;
    const css = getComputedStyle(parent), range = document.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter(r => r.width && r.height);
    let block = parent;
    while (block && !/^(block|flow-root|flex|grid|list-item|table-cell)$/.test(getComputedStyle(block).display)) block = block.parentElement;
    const blockRect = block?.getBoundingClientRect();
    return {node, parent, source, parsed, font: css.font, spacing: parseFloat(css.letterSpacing) || 0, textTransform: css.textTransform,
      block, blockWidth: blockRect?.width, blockHeight: blockRect?.height, available: parent.clientWidth, wrap: css.overflowWrap, wordBreak: css.wordBreak, svgWidth: parent.getComputedTextLength?.(),
      simple: parent.namespaceURI === 'http://www.w3.org/2000/svg' || !!parent.closest('option,textarea')};
  }
  // CALCULATE: measure original words from live text ranges before any mutation.
  function calculate(job) {
    const {parent, source, parsed, font, spacing} = job;
    if (job.simple) return {...job, replacement: parsed.map(p => p.safe ? p.text : fake(p.text)).join('')};
    context.font = font;
    const fragment = document.createDocumentFragment(), nodes = [];
    const sourceWidth = (start, length) => {
      const range = document.createRange(); range.setStart(job.node, start); range.setEnd(job.node, start + length);
      return [...range.getClientRects()].filter(r => r.width && r.height).reduce((sum, r) => sum + r.width, 0);
    };
    const shown = value => job.textTransform === 'uppercase' ? value.toLocaleUpperCase(language) : job.textTransform === 'lowercase' ? value.toLocaleLowerCase(language) : job.textTransform === 'capitalize' ? value.replace(/\b\p{L}/gu, x => x.toLocaleUpperCase(language)) : value;
    const widthOf = value => context.measureText(shown(value)).width + Math.max(0, [...shown(value)].length - 1) * spacing;
    let previousWord = null;
    const reserve = (replacement, width) => {
      const choices = words[language].map((_, i) => words[language][(hash(replacement) + i) % words[language].length]);
      const fitting = choices.filter(value => widthOf(value) <= width + .25);
      const candidate = fitting.find(value => value !== previousWord) || choices.find(value => value !== previousWord) || choices[0];
      previousWord = candidate;
      const scale = Math.min(1, width / Math.max(widthOf(candidate), 1));
      const outer = document.createElement('span'); outer.dataset.anonWord = ''; outer.style.display = 'inline-block'; outer.style.verticalAlign = 'baseline'; outer.style.lineHeight = 'inherit'; outer.style.height = 'auto'; outer.style.width = width + 'px'; outer.style.minWidth = '0'; outer.style.maxWidth = width + 'px'; outer.style.whiteSpace = 'nowrap'; outer.style.fontSize = (scale * 100) + '%'; outer.textContent = candidate;
      fragment.append(outer); nodes.push(outer); generated.add(outer);
    };
    let offset = 0;
    for (const part of parsed) {
      const partStart = offset; offset += part.text.length;
      if (part.safe) { const n = document.createTextNode(part.text); generated.add(n); fragment.append(n); nodes.push(n); continue; }
      const segmenter = new Intl.Segmenter(language, {granularity: 'word'});
      let tokenOffset = 0;
      for (const {segment: token, isWordLike} of segmenter.segment(part.text)) {
        if (!token) continue;
        if (!isWordLike || /^[\s\-\u00ad/]+$/u.test(token)) { const n = document.createTextNode(token); generated.add(n); fragment.append(n); nodes.push(n); tokenOffset += token.length; continue; }
        const width = sourceWidth(partStart + tokenOffset, token.length);
        if (width > 0) reserve(token, width); else { const n = document.createTextNode(fake(token)); generated.add(n); fragment.append(n); nodes.push(n); }
        tokenOffset += token.length;
      }
    }
    const marker = document.createTextNode(''); generated.add(marker); fragment.prepend(marker);
    return {...job, fragment, marker, nodes};
  }
  // WRITE: apply the prepared replacements together, with observation disconnected.
  function write(job) {
    const {node, parent, source} = job; if (!node.isConnected || node.data !== source) return;
    if (job.simple) {
      if (job.svgWidth !== undefined && !records.get(parent)?.has('svg-width')) {
        remember(parent, 'svg-width', [parent.getAttribute('textLength'), parent.getAttribute('lengthAdjust')], job.svgWidth);
        parent.setAttribute('textLength', job.svgWidth); parent.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
      remember(node, 'text', source, job.replacement); node.data = job.replacement;
    } else {
      if (job.block?.isConnected && Number.isFinite(job.blockHeight) && job.blockHeight > 0 && !records.get(job.block)?.has('layout-style')) {
        const style = job.block.style; remember(job.block, 'layout-style', {width:[style.width,style.getPropertyPriority('width')],minWidth:[style.minWidth,style.getPropertyPriority('min-width')],maxWidth:[style.maxWidth,style.getPropertyPriority('max-width')],minHeight:[style.minHeight,style.getPropertyPriority('min-height')],maxHeight:[style.maxHeight,style.getPropertyPriority('max-height')],overflow:[style.overflow,style.getPropertyPriority('overflow')]}, true);
        if (Number.isFinite(job.blockWidth) && job.blockWidth > 0) { style.width = job.blockWidth + 'px'; style.minWidth = job.blockWidth + 'px'; style.maxWidth = job.blockWidth + 'px'; } style.minHeight = job.blockHeight + 'px'; style.maxHeight = job.blockHeight + 'px'; style.overflow = 'clip';
      }
      remember(job.marker, 'nodes', source, job.nodes); node.replaceWith(job.fragment);
    }
  }
  function element(el) {
    if (generated.has(el) || el.closest('script,style,noscript,[data-anon-word]')) return;
    if (el.matches(readOnlyActions)) {
      if (!records.get(el)?.has('aria-disabled')) remember(el, 'aria-disabled', el.getAttribute('aria-disabled'), 'true');
      el.setAttribute('aria-disabled', 'true');
    }
    const defaultValue = /^(INPUT|OPTION)$/.test(el.tagName) ? el.getAttribute('value') : null;
    for (const attr of attributes) if (el.hasAttribute(attr)) property(el, attr, el.getAttribute(attr), attr === 'title' ? provenance.get(el) : undefined);
    if (/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName) ) {
      if (el.tagName === 'SELECT' && !records.get(el)?.has('selection')) remember(el, 'selection', el.selectedIndex, true);
      if (el.tagName === 'SELECT') {
        const old = records.get(el)?.get('value'), original = old?.masked === el.value ? old.original : el.value;
        for (const option of el.options) element(option);
        remember(el, 'value', original, el.value);
        const width = selectWidths.get(el); if (width) { if (!records.get(el)?.has('select-width')) remember(el, 'select-width', el.style.width, width); el.style.width = width; }
      } else property(el, 'value', el.value, provenance.get(el));
      if (el.tagName !== 'OPTION' && el.id !== 'anonymize') {
        if (!records.get(el)?.has('readonly')) remember(el, 'readonly', {readOnly: el.readOnly, aria: el.getAttribute('aria-readonly')}, true);
        if ('readOnly' in el) el.readOnly = true;
        el.setAttribute('aria-readonly', 'true');
      }
    }
    if (defaultValue !== null) property(el, 'attribute:value', defaultValue, provenance.get(el));
    if (el.shadowRoot) observe(el.shadowRoot);
  }
  function collect(root) {
    const nodes = [root], walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    if (root.nodeType !== Node.TEXT_NODE) while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const el of [...nodes]) if (el.shadowRoot) { roots.add(el.shadowRoot); nodes.push(...collect(el.shadowRoot)); }
    return nodes;
  }
  function batch(work) {
    observer.disconnect(); internal = true;
    try { return work(); } finally { internal = false; if (active) for (const root of roots) if (root.isConnected) observe(root); }
  }
  function scan(root) {
    const nodes = collect(root); for (const el of nodes) if (el.tagName === 'SELECT') selectWidths.set(el, getComputedStyle(el).width);
    const jobs = nodes.filter(n => n.nodeType === Node.TEXT_NODE).map(read).filter(Boolean).map(calculate);
    batch(() => { for (const node of nodes) if (node.nodeType === Node.ELEMENT_NODE) element(node); for (const job of jobs) write(job); });
  }
  // Large sweeps yield between bounded read/calculate/write batches while hidden.
  async function sweep(root, token) {
    const nodes = collect(root), texts = nodes.filter(n => n.nodeType === Node.TEXT_NODE && n.data.trim() && !generated.has(n)), jobs = [], prepared = [];
    const staged = texts.length > 180; metrics.staged ||= staged;
    async function phase(items, name, work) {
      const size = name === 'attributes' ? 192 : 48;
      for (let i = 0; i < items.length; i += size) {
        if (token !== revision) return;
        const start = performance.now();
        work(items.slice(i, i + size));
        const elapsed = performance.now() - start; metrics[name] = (metrics[name] || 0) + elapsed; metrics.maxTask = Math.max(metrics.maxTask || 0, elapsed);
        if (staged && i + size < items.length) await frame();
      }
    }
    await phase(nodes.filter(n => n.tagName === 'SELECT'), 'read', chunk => { for (const el of chunk) selectWidths.set(el, getComputedStyle(el).width); });
    await phase(texts, 'read', chunk => { for (const node of chunk) { const job = read(node); if (job) jobs.push(job); } });
    await phase(jobs, 'calculate', chunk => { for (const job of chunk) prepared.push(calculate(job)); });
    await phase(nodes.filter(n => n.nodeType === Node.ELEMENT_NODE), 'attributes', chunk => batch(() => { for (const el of chunk) element(el); }));
    await phase(prepared, 'write', chunk => batch(() => { for (const job of chunk) write(job); }));
  }
  const observer = new MutationObserver(changes => {
    if (!active) return;
    const targets = new Set();
    for (const m of changes) {
      if (m.type === 'childList') for (const node of m.addedNodes) targets.add(node);
      else targets.add(m.target);
    }
    if (processing) { for (const node of targets) pending.add(node); return; }
    if (targets.size > 48) { set(true); return; }
    for (const node of targets) if (node.isConnected) scan(node);
    for (const node of records.keys()) if (!node.isConnected) records.delete(node);
  });
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) {
    const root = attachShadow.call(this, options);
    if (options.mode === 'open') { roots.add(root); if (active) observe(root); }
    return root;
  };
  function observe(root) { roots.add(root); if (!internal) observer.observe(root, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes}); }
  // Value properties do not emit mutations. Handle programmatic updates synchronously.
  for (const type of [HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement, HTMLOptionElement]) {
    const descriptor = Object.getOwnPropertyDescriptor(type.prototype, 'value');
    Object.defineProperty(type.prototype, 'value', {...descriptor, set(value) {
      if (active && !internal && this.tagName === 'SELECT') {
        const option = [...this.options].find(o => records.get(o)?.get('value')?.original === String(value));
        if (option) { descriptor.set.call(this, option.value); remember(this, 'value', String(value), this.value); if (records.get(this)?.has('selection')) records.get(this).get('selection').original = this.selectedIndex; return; }
      }
      descriptor.set.call(this, value);
      if (active && !internal && this.isConnected) batch(() => element(this));
    }});
  }
  function restore() {
    batch(() => {
      for (const [el, entry] of records) for (const [key, r] of entry) {
        if (key === 'nodes') { if (el.isConnected) { for (const n of r.masked) n.remove(); el.replaceWith(document.createTextNode(r.original)); } }
        else if (key === 'text') { if (el.data === r.masked) el.data = r.original; }
        else if (key === 'select-width') { el.style.width = r.original; }
        else if (key === 'layout-style') { for (const [name, saved] of Object.entries(r.original)) { const cssName = name.replace(/[A-Z]/g, x => '-' + x.toLowerCase()); if (saved[0]) el.style.setProperty(cssName, saved[0], saved[1]); else el.style.removeProperty(cssName); } }
        else if (key === 'selection') { /* Restore after all option values. */ }
        else if (key === 'svg-width') { for (const [i, attr] of ['textLength', 'lengthAdjust'].entries()) if (r.original[i] === null) el.removeAttribute(attr); else el.setAttribute(attr, r.original[i]); }
        else if (key === 'readonly') { if ('readOnly' in el) el.readOnly = r.original.readOnly; if (r.original.aria === null) el.removeAttribute('aria-readonly'); else el.setAttribute('aria-readonly', r.original.aria); }
        else if (key === 'value') { if (el.value === r.masked) el.value = r.original; }
        else if (el.getAttribute(key.replace(/^attribute:/, '')) === r.masked) { if (r.original === null) el.removeAttribute(key); else el.setAttribute(key.replace(/^attribute:/, ''), r.original); }
      }
      for (const [el, entry] of records) if (entry.has('selection')) el.selectedIndex = entry.get('selection').original;
      records.clear();
    });
  }
  async function set(enabled) {
    const token = ++revision, start = performance.now();
    let focused = document.activeElement; while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    const selection = typeof focused?.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
    if (!processing) savedVisibility = document.body.style.visibility;
    document.body.style.visibility = 'hidden';
    processing = true; active = !!enabled; pending.clear(); restore();
    const toggle = document.getElementById('anonymize'); if (toggle) toggle.checked = active;
    try { sessionStorage.setItem('deck-anonymize', String(active)); } catch { /* Current page still works. */ }
    metrics = {read: 0, calculate: 0, attributes: 0, write: 0, maxTask: 0, staged: false};
    if (active) {
      roots.add(document.body); observe(document.body);
      await sweep(document.body, token);
      while (pending.size && token === revision) {
        const extra = [...pending]; pending.clear();
        for (const node of extra) if (node.isConnected) await sweep(node, token);
      }
    } else observer.disconnect();
    if (token !== revision) return;
    // One final layout read; no data is revealed until every pending node is scrubbed.
    const layoutStart = performance.now(); document.body.getBoundingClientRect();
    metrics.layout = performance.now() - layoutStart; metrics.maxTask = Math.max(metrics.maxTask, metrics.layout); metrics.total = performance.now() - start;
    processing = false; document.body.style.visibility = savedVisibility; document.documentElement.removeAttribute('data-anon-pending');
    if (focused?.isConnected) { focused.focus({preventScroll: true}); if (selection) focused.setSelectionRange(...selection); }
  }
  function start() {
    if (started) return; started = true;
    provenance.set(document.getElementById('focus-delay'), 'count');
    const toggle = document.getElementById('anonymize'); toggle?.addEventListener('change', () => set(toggle.checked));
    for (const event of ['beforeinput', 'input', 'change', 'submit']) document.addEventListener(event, e => {
      if (active && e.target.id !== 'anonymize' && (e.target.matches('input,textarea,select,form') || e.target.closest('[contenteditable]') || event === 'submit')) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    document.addEventListener('click', e => { if (active && e.target.closest(readOnlyActions)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    for (const event of ['pointerdown', 'mousedown', 'click']) document.addEventListener(event, e => { if (active && e.target.closest('select,[contenteditable=true],input[type=checkbox]:not(#anonymize),input[type=radio]')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    document.addEventListener('keydown', e => { if (active && !['Tab', 'Escape'].includes(e.key) && e.target.matches('select,input[type=checkbox]:not(#anonymize),input[type=radio]')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    let saved = false; try { saved = sessionStorage.getItem('deck-anonymize') === 'true'; } catch { /* Default off. */ }
    window.addEventListener('resize', () => { if (active) set(true); });
    return set(saved);
  }
  return {catalog, start, set, project(el,key) { if(!projectAliases.has(key))projectAliases.set(key,projectAliases.size+1);provenance.set(el,{alias:(language==='es'?'Proyecto ':'Project ')+projectAliases.get(key)});return el; }, value(el) { return records.get(el)?.get('value')?.original ?? el.value; }, formatted(value) { times.add(value); if (times.size > 4096) times.delete(times.values().next().value); return value; }, structural(el, kind) { provenance.set(el, kind); return el; }, get enabled() { return active; }, get metrics() { return {...metrics}; }};
})();
