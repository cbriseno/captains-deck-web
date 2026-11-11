/* Synthetic geometry only: the production router receives no captured runtime data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../static/deck-relations.js'), 'utf8');

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.className = ''; }
  get classList() { return {add: (...names) => { this.className += ' ' + names.join(' '); }}; }
  append(child) { child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = value; }
  getClientRects() { return this.hidden ? [] : [this.rect]; }
  getBoundingClientRect() { return this.rect; }
  matches() { return false; }
  closest(selector) { assert.equal(selector, '[hidden]'); return this.hidden ? this : null; }
}
function fixture(layout, options = {}) {
  const root = new Element('div'), legend = new Element('div'), board = new Element('div');
  const state = {phone: false, shiftX: 0, shiftY: 0};
  Object.assign(root, {clientWidth: 1000, scrollWidth: 1000, clientHeight: 650, scrollHeight: 650, scrollLeft: 0, scrollTop: 0, clientLeft: 0, clientTop: 0}, options);
  root.getBoundingClientRect = () => ({left: state.shiftX, top: state.shiftY, width: root.clientWidth + root.clientLeft * 2, height: root.clientHeight});
  const nodes = new Map(layout.map(([id, x, y, width, height]) => {
    const el = new Element('div'); el.id = id;
    el.rect = {left: x, top: y, right: x + width, bottom: y + height, width, height};
    el.getBoundingClientRect = () => ({...el.rect,
      left: el.rect.left + state.shiftX - root.scrollLeft + root.clientLeft,
      right: el.rect.right + state.shiftX - root.scrollLeft + root.clientLeft,
      top: el.rect.top + state.shiftY - root.scrollTop + root.clientTop,
      bottom: el.rect.bottom + state.shiftY - root.scrollTop + root.clientTop});
    return [id, el];
  }));
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)]);
  root.querySelectorAll = selector => selector.startsWith('.task-card,') ? [...nodes.values()] :
    descendants(root).filter(el => el.className.includes('deck-routed-links') || el.className === 'deck-route-status');
  root.querySelector = selector => selector === '#board' ? board : selector === '#connector-key' ? legend : null;
  root.append(legend);
  root.ownerDocument = {createElementNS: (_, tag) => new Element(tag), createElement: tag => new Element(tag)};
  const window = {innerWidth: root.clientWidth, innerHeight: root.clientHeight, matchMedia: () => ({matches: state.phone})};
  vm.runInNewContext(source, {window});
  const args = {edges: [], members: new Set(), focus: 'a', root, find: id => nodes.get(id), label: id => id,
    t: (s, fields = {}) => s.replace(/\{(\w+)\}/g, (_, key) => fields[key]), motion: {animating: false}};
  return {root, nodes, state, args, descendants, draw: changes => window.routeDeckRelations({...args, ...changes})};
}
const edge = (from, to, extra = {}) => ({from, to, ...extra});
const segments = points => points.slice(1).map((b, i) => [points[i], b]);
function geometry(f, result) {
  const routeSegments = [];
  for (const route of result.paths) {
    const [from, to, question] = JSON.parse(route.key);
    const ends = question ? [from, to] : [to, from];
    const points = route.points;
    for (const [a, b] of segments(points)) {
      assert.ok(a.x === b.x || a.y === b.y, 'orthogonal');
      for (const el of f.nodes.values()) {
        const r = el.rect;
        const intersects = a.y === b.y ? a.y > r.top && a.y < r.bottom && Math.max(a.x, b.x) > r.left && Math.min(a.x, b.x) < r.right :
          a.x > r.left && a.x < r.right && Math.max(a.y, b.y) > r.top && Math.min(a.y, b.y) < r.bottom;
        assert.equal(intersects, false, `card intersection ${el.id}`);
        const length=Math.hypot(b.x-a.x,b.y-a.y), steps=Math.ceil(length/3);
        for(let i=0;i<=steps;i++){
          const x=a.x+(b.x-a.x)*i/steps,y=a.y+(b.y-a.y)*i/steps;
          assert.ok(!(x>r.left-5&&x<r.right+5&&y>r.top-5&&y<r.bottom+5), `3px sample clears ${el.id} by 5px`);
        }
      }
    }
    const full = [...segments(points)];
    for (const [i, port] of [[0, points[0]], [1, points.at(-1)]]) {
      const r = f.nodes.get(ends[i]).rect;
      const attachment = {x: port.x > r.right ? r.right : r.left, y: port.y};
      full.push([attachment, port]);
      assert.ok(port.y > r.top && port.y < r.bottom, 'port within card height');
    }
    routeSegments.push(full);
  }
  for (let i = 0; i < routeSegments.length; i++) for (let j = i + 1; j < routeSegments.length; j++) {
    for (const [a, b] of routeSegments[i]) for (const [c, d] of routeSegments[j]) {
      const horizontal = a.y === b.y && c.y === d.y && a.y === c.y;
      const vertical = a.x === b.x && c.x === d.x && a.x === c.x;
      const overlap = horizontal ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) :
        vertical ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) : 0;
      assert.ok(overlap <= 0, 'no collinear overlap, including stubs');
      if(result.separation===12){
        const h=a.y===b.y&&c.y===d.y,v=a.x===b.x&&c.x===d.x;
        const shared=h?Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)):
          v?Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)):0;
        if(shared>0)assert.ok((h?Math.abs(a.y-c.y):Math.abs(a.x-c.x))>=12,'parallel routes stay 12px apart');
      }
    }
  }
  // A different route must also avoid the visible numbered circles, not just the card bodies.
  for (let i = 0; i < result.paths.length; i++) for (let j = 0; j < result.paths.length; j++) if (i !== j) {
    const other = result.paths[j].points;
    for (const port of [other[0], other.at(-1)]) for (const [a, b] of routeSegments[i]) {
      const x = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), port.x));
      const y = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), port.y));
      assert.ok(Math.hypot(x - port.x, y - port.y) >= 6, 'route avoids another numbered endpoint');
    }
  }
  const numbers = f.descendants(f.root).filter(el => el.tagName === 'text').map(el => Number(el.textContent));
  for (const route of result.paths) assert.equal(numbers.filter(number => number === route.index).length, 2, 'paired endpoint numbers');
}

test('orthogonal fan-out, same column, mixer above board, obstacles and duplicate edges', () => {
  const f = fixture([['a', 40, 110, 170, 100], ['b', 380, 80, 170, 90], ['c', 720, 100, 170, 90],
    ['d', 380, 340, 170, 90], ['block', 240, 70, 90, 200], ['group', 40, 15, 170, 55]]);
  const edges = [edge('a', 'b'), edge('b', 'd'), edge('c', 'a'), edge('group', 'c'), edge('a', 'b')];
  const result = f.draw({edges});
  assert.equal(result.separation, 12);
  assert.equal(result.visibleRoutes, 4); assert.equal(result.routed, 4); assert.equal(result.unrouted.length, 0);
  geometry(f, result);
  assert.equal(f.root.querySelectorAll('svg.deck-routed-links,.deck-route-status').length, 2);
  f.draw({edges}); assert.equal(f.root.querySelectorAll('svg.deck-routed-links,.deck-route-status').length, 2, 'idempotent rendering');
});

test('geometry cache survives document and root scroll; resize, expansion and changed bounds invalidate it', () => {
  const f = fixture([['a', 40, 120, 170, 90], ['b', 550, 260, 170, 90]], {clientLeft: 2, clientTop: 3});
  const edges = [edge('a', 'b')];
  const initial = f.draw({edges}); assert.equal(initial.cacheHit, false);
  assert.equal(f.draw({edges}).cacheHit, true);
  f.state.shiftX = 17; f.state.shiftY = -70; f.root.scrollLeft = 13; f.root.scrollTop = 47;
  const scrolled = f.draw({edges}); assert.equal(scrolled.cacheHit, true);
  assert.equal(JSON.stringify(scrolled.paths), JSON.stringify(initial.paths)); geometry(f, scrolled);
  f.root.clientWidth = f.root.scrollWidth = 800;
  assert.equal(f.draw({edges}).cacheHit, false);
  f.root.scrollHeight += 100; assert.equal(f.draw({edges}).cacheHit, false, 'extent-only change');
  const rect = f.nodes.get('a').rect; rect.height += 30; rect.bottom += 30;
  const expanded = f.draw({edges}); assert.equal(expanded.cacheHit, false); geometry(f, expanded);
});

test('perpendicular routes have explicit crossing gaps and labels stay on top', () => {
  const f = fixture([['a', 60, 150, 130, 70], ['b', 780, 150, 130, 70], ['c', 410, 30, 130, 70], ['d', 410, 350, 130, 70]]);
  const result = f.draw({edges: [edge('a', 'b'), edge('c', 'd')]});
  assert.equal(result.unrouted.length, 0); geometry(f, result);
  assert.ok(result.crossings > 0, 'fixture forces a crossing');
  const lines = f.descendants(f.root).filter(el => el.dataset.relation);
  const moveCount = lines.reduce((n, el) => n + (el.attributes.d.match(/M /g) || []).length, 0);
  assert.ok(moveCount > result.paths.reduce((n, p) => n + p.points.length - 1, 0), 'an extra M cuts a gap');
  const svg = f.descendants(f.root).find(el => el.tagName === 'svg'); assert.equal(svg.children.at(-1).tagName, 'text');
});

test('phone draws as the approved demo; motion suppresses SVG; hidden, self and absent endpoints do not invent routes', () => {
  const f = fixture([['a', 40, 120, 170, 90], ['b', 550, 260, 170, 90]]);
  const edges = [edge('a', 'b')]; f.draw({edges});
  f.state.phone = true; assert.equal(f.draw({edges}).routed, 1);
  f.state.phone = false; assert.equal(f.draw({edges, motion: {animating: true}}), undefined);
  assert.equal(f.descendants(f.root).filter(el => el.tagName === 'svg').length, 0);
  f.nodes.get('b').hidden = true;
  const result = f.draw({edges: [...edges, edge('a', 'missing'), edge('a', 'a')]});
  assert.equal(result.visibleRoutes, 0); assert.equal(f.descendants(f.root).filter(el => el.tagName === 'svg').length, 0);
});

test('off-screen cards do not grow the routing grid; endpoints return on scroll', () => {
  const f = fixture([['a', 40, 120, 170, 90], ['b', 550, 260, 170, 90],
    ...Array.from({length: 480}, (_, i) => ['done:'+i, 30+i%300, 2000+i*120, 170, 90])], {scrollHeight: 60000});
  const result = f.draw({edges: [edge('a', 'b'), edge('a', 'done:0')]});
  assert.equal(result.visibleRoutes, 1); assert.equal(result.obstacleCount, 2);
  assert.ok(result.grid[0] * result.grid[1] < 1000);
  f.state.shiftY = -2000;
  assert.equal(f.draw({edges: [edge('done:0', 'done:1')]}).routed, 1);
});

test('direction, question/completion styles, focus classification and delimited identifiers remain distinct', () => {
  const f = fixture([['a|b', 40, 120, 170, 100], ['c', 400, 120, 170, 100], ['a', 40, 340, 170, 100], ['b|c', 400, 340, 170, 100]]);
  const edges = [edge('a|b', 'c'), edge('a', 'b|c'), edge('c', 'a|b', {question: true}), edge('a', 'b|c', {completed: true})];
  const result = f.draw({edges, members: new Set(['a|b'])}); assert.equal(result.visibleRoutes, 4); assert.equal(result.unrouted.length, 0); geometry(f, result);
  const classes = new Set(f.descendants(f.root).filter(el => el.dataset.relation).map(el => el.className));
  for (const cls of ['before-link', 'after-link', 'question-link', 'freed-link']) assert.ok(classes.has(cls), cls);
  const focused = f.draw({edges, members: new Set(['a']), focus: 'a'}); assert.equal(focused.cacheHit, true, 'focus does not change geometry');
  const titles = f.descendants(f.root).filter(el => el.tagName === 'title'); assert.ok(titles.every(el => el.textContent.includes('→')));
});

test('unrouteable narrow or crowded geometry reports fallback instead of intersecting a body', () => {
  const f = fixture([['a', 40, 120, 170, 16], ['b', 230, 120, 170, 16], ['c', 230, 200, 170, 16], ['d', 230, 300, 170, 16]]);
  const result = f.draw({edges: [edge('a', 'b'), edge('a', 'c'), edge('a', 'd')]});
  assert.ok(result.unrouted.length); geometry(f, result);
  assert.ok(f.descendants(f.root).some(el => String(el.textContent).includes('unclear routes')));
});

test('dense synthetic board spreads fan-out across both sides and reuses unchanged geometry', () => {
  const layout = [];
  for (let col = 0; col < 3; col++) for (let row = 0; row < 8; row++) layout.push([col + ':' + row, 40 + col * 320, 40 + row * 140, 180, 100]);
  const f = fixture(layout, {clientHeight: 1250, scrollHeight: 1250});
  const edges = Array.from({length: 8}, (_, i) => edge('0:0', '2:' + i));
  const result = f.draw({edges});
  assert.equal(result.separation, 0, 'dense fan-out falls back to production spacing to retain every line');
  assert.equal(result.routed, 8); assert.equal(result.unrouted.length, 0); geometry(f, result);
  for (let i = 0; i < 5; i++) assert.equal(f.draw({edges}).cacheHit, true);
});

const {execFile, spawnSync} = require('node:child_process');
const {promisify} = require('node:util');
const http = require('node:http');
const loopbackAddress = Object.values(require('node:os').networkInterfaces()).flat()
  .find(address => address.internal && address.family === 'IPv4').address;
const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';
const browserAvailable = spawnSync(cli, ['--version'], {encoding: 'utf8', timeout: 5000}).status === 0;

test('real browser: SVG endpoints align after scroll, resize and card expansion; phone draws too', {skip: !browserAvailable, timeout: 90000}, async () => {
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;min-height:1800px;padding-top:100px;background:#fafafa}
    #workspace{position:relative;box-sizing:border-box;width:1000px;height:500px;border:3px solid #aaa;padding:12px;overflow:auto;margin-left:30px}
    #board{position:relative;width:1000px;height:900px}
    .task-card{position:absolute;width:140px;height:80px;background:white;border:1px solid black;box-sizing:border-box}
    .links{position:absolute;left:0;top:0;pointer-events:none;overflow:hidden}.links path{fill:none;stroke-width:2;stroke:#357}
    .links .route-halo{stroke:#fafafa;stroke-width:7}.route-port{fill:white;stroke:#357}.route-number{font:8px sans-serif;text-anchor:middle;dominant-baseline:central}
    #connector-key{position:absolute;left:10px;top:870px}
    </style><div id="workspace"><div id="board">
    <div class="task-card" data-node="a" style="left:40px;top:150px"><div id="detail" style="position:absolute;inset:1px">Inline detail</div></div>
    <div class="task-card" data-node="b" style="left:780px;top:150px"></div>
    <div class="task-card" data-node="c" style="left:410px;top:30px"></div>
    <div class="task-card" data-node="d" style="left:410px;top:350px"></div>
    </div><div id="connector-key"></div></div><script src="/deck-relations.js"></script><script>
    window.draw=()=>routeDeckRelations({edges:[{from:'a',to:'b'},{from:'c',to:'d'}],members:new Set(['a']),focus:'a',root:document.querySelector('#workspace'),
      find:id=>document.querySelector('[data-node="'+id+'"]'),label:id=>id,t:(s,f={})=>s.replace(/\\{(\\w+)\\}/g,(_,k)=>f[k]),motion:{animating:false}});
    </script>`;
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/deck-relations.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/deck-relations.js' ? source : html); });
  await new Promise(resolve => server.listen(0, loopbackAddress, resolve));
  const env = {...process.env, CHROME_DEVTOOLS_AXI_SESSION: 'deck-relations-module-' + process.pid};
  const run = async (...args) => (await promisify(execFile)(cli, args, {env, timeout: 30000, maxBuffer: 2 * 1024 * 1024})).stdout;
  const evaluate = async code => {
    const output = await run('eval', '() => JSON.stringify((' + code + ')())');
    const match = output.match(/^result: (.*)$/m); assert.ok(match, output);
    let value = JSON.parse(match[1]); for (let i = 0; i < 4 && typeof value === 'string'; i++) { try { value = JSON.parse(value); } catch { break; } } return value;
  };
  let started = false;
  try {
    started = true; await run('open', 'http://' + loopbackAddress + ':' + server.address().port);
    await run('resize', '1200', '850');
    const checks = await evaluate(`() => {
      const check=()=>{
        const result=draw(),root=document.querySelector('#workspace'),svg=root.querySelector('svg');
        const errors=[];let pairs=0;
        for(const route of result.paths){
          const [from,to,question]=JSON.parse(route.key),ids=question?[from,to]:[to,from];
          const circles=[...svg.querySelectorAll('.route-port')].slice(pairs*2,pairs*2+2);pairs++;
          [route.points[0],route.points.at(-1)].forEach((p,i)=>{
            const card=document.querySelector('[data-node="'+ids[i]+'"]').getBoundingClientRect();
            const center=new DOMPoint(+circles[i].getAttribute('cx'),+circles[i].getAttribute('cy')).matrixTransform(svg.getScreenCTM());
            const expectedX=p.x>card.right-root.getBoundingClientRect().left+root.scrollLeft-root.clientLeft?card.right+8:card.left-8;
            if(Math.abs(center.x-expectedX)>.2||center.y<card.top||center.y>card.bottom)errors.push({center,expectedX,card});
          });
        }
        return {routed:result.routed,unrouted:result.unrouted.length,crossings:result.crossings,cache:result.cacheHit,errors,width:root.scrollWidth,height:root.scrollHeight,svgCount:root.querySelectorAll('svg').length,statusCount:root.querySelectorAll('.deck-route-status').length};
      };
      const initial=check(),cached=check();window.scrollTo(0,75);const pageScroll=check();
      const root=document.querySelector('#workspace');root.scrollTop=110;root.scrollLeft=21;const rootScroll=check();
      root.style.width='900px';document.querySelector('#board').style.width='880px';document.querySelector('[data-node=b]').style.left='680px';const resized=check();document.querySelector('[data-node=a]').style.height='140px';const expanded=check();
      return {initial,cached,pageScroll,rootScroll,resized,expanded};
    }`);
    for (const [phase, result] of Object.entries(checks)) {
      assert.equal(result.routed, 2, phase); assert.equal(result.unrouted, 0, phase); assert.deepEqual(result.errors, [], phase);
      assert.equal(result.svgCount, 1); assert.equal(result.statusCount, 1);
    }
    assert.ok(checks.initial.crossings > 0); assert.equal(checks.cached.cache, true); assert.equal(checks.pageScroll.cache, true); assert.equal(checks.rootScroll.cache, true);
    assert.equal(checks.resized.cache, false); assert.equal(checks.expanded.cache, false);
    assert.equal(checks.initial.height, checks.cached.height, 'SVG must not inflate the root on every call');
    const headerCheck = await evaluate(`()=>{
      const root=document.querySelector('#workspace'),header=document.createElement('div');
      header.className='col-h';header.dataset.node='header';header.style.cssText='position:absolute;left:220px;top:100px;width:100px;height:32px';
      const title=document.createElement('span');title.textContent='Overflowing header';title.style.cssText='position:absolute;left:-30px;width:230px;height:32px';header.append(title);document.querySelector('#board').append(header);
      const hidden=document.querySelector('[data-node=b]');hidden.hidden=true;
      const result=routeDeckRelations({edges:[{from:'a',to:'b'}],members:new Set(['a']),focus:'a',root,
        find:id=>id==='b'?header:document.querySelector('[data-node="'+id+'"]'),label:id=>id,t:s=>s,motion:{animating:false}});
      const port=result.paths[0]?.points[0],rr=root.getBoundingClientRect(),part=title.getBoundingClientRect();
      const expected=part.left-rr.left+root.scrollLeft-root.clientLeft-8;
      const answer={routed:result.routed,unrouted:result.unrouted.length,port,expected};header.remove();hidden.hidden=false;return answer;
    }`);
    assert.equal(headerCheck.routed,1);assert.equal(headerCheck.unrouted,0);assert.ok(Math.abs(headerCheck.port.x-headerCheck.expected)<.2,'header port uses the union of its visible overflowing parts');
    await run('resize', '390', '844');
    assert.equal(await evaluate(`()=>{draw();return document.querySelectorAll('svg.links').length;}`), 0, 'off-screen endpoints leave no lines');
    if (process.env.CD_TEST_EVIDENCE) {
      fs.mkdirSync(process.env.CD_TEST_EVIDENCE, {recursive: true});
      fs.writeFileSync(path.join(process.env.CD_TEST_EVIDENCE, 'relations-browser-checks.json'), JSON.stringify(checks, null, 2));
    }
  } finally {
    if (started) await run('stop');
    await new Promise(resolve => server.close(resolve));
  }
});
