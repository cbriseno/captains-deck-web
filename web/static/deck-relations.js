/* Render owner-supplied relationships in measured whitespace. Focus and timing belong to Deck UI. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const caches = new WeakMap();
  const round = n => Math.round(n * 10) / 10;
  const keyOf = edge => JSON.stringify([edge.from, edge.to, !!edge.question, !!edge.completed]);
  const headerSelector = '.mix,.col-h,.sub-h,.request-head';
  const obstacleSelector = '.task-card,.mix,.request-head>*,.col-h>*,.sub-h>*,.mix-tools,.rail-btn,.stack-h,.none,#detail:not([hidden])';

  class Heap {
    constructor() { this.items = []; }
    push(item) {
      const a = this.items; let i = a.length; a.push(item);
      while (i) { const p = (i - 1) >> 1; if (a[p].f <= item.f) break; a[i] = a[p]; i = p; }
      a[i] = item;
    }
    pop() {
      const a = this.items, first = a[0], last = a.pop();
      if (a.length) {
        let i = 0;
        while (i * 2 + 1 < a.length) {
          let j = i * 2 + 1; if (j + 1 < a.length && a[j + 1].f < a[j].f) j++;
          if (a[j].f >= last.f) break; a[i] = a[j]; i = j;
        }
        a[i] = last;
      }
      return first;
    }
  }

  // First index >= value (or > value for an open lower bound).
  function bound(values, value, strict = false) {
    let lo = 0, hi = values.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid] < value || (strict && values[mid] === value)) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function routeGeometry(routes, boxes, width, height, separation = 12) {
    const xs = new Set([4, round(width - 4)]), ys = new Set([4, round(height - 4)]);
    const addX = n => { n = round(n); if (n >= 4 && n <= width - 4) xs.add(n); };
    const addY = n => { n = round(n); if (n >= 4 && n <= height - 4) ys.add(n); };
    for (const box of boxes) {
      // Several independent lanes in each gutter, including the mixer and header gutters.
      for (const d of [8, 16, 24, 32, 40]) { addX(box.left - d); addX(box.right + d); }
      addX(box.left); addX(box.right);
      addY(box.top - 8); addY(box.bottom + 8);
    }
    for (const route of routes) for (const end of ['a', 'b']) {
      const port = route[end + 'p']; addX(port.x); addY(port.y);
      addX(port.x - 8); addX(port.x + 8); addY(port.y - 8); addY(port.y + 8);
    }
    const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
    const nx = X.length, size = nx * Y.length;
    const xi = new Map(X.map((x, i) => [x, i])), yi = new Map(Y.map((y, i) => [y, i]));
    const node = p => xi.has(p.x) && yi.has(p.y) ? yi.get(p.y) * nx + xi.get(p.x) : undefined;
    const point = id => ({x: X[id % nx], y: Y[Math.floor(id / nx)]});
    const blocked = new Uint8Array(size), horizontal = new Uint8Array(size), vertical = new Uint8Array(size);
    // Rasterize obstacles once. Search does O(1) clearance checks rather than scanning every card per step.
    for (const box of boxes) {
      const left = box.left - 5, right = box.right + 5, top = box.top - 5, bottom = box.bottom + 5;
      const x0 = bound(X, left, true), x1 = bound(X, right), y0 = bound(Y, top, true), y1 = bound(Y, bottom);
      for (let y = y0; y < y1; y++) {
        blocked.fill(1, y * nx + x0, y * nx + x1);
        horizontal.fill(1, y * nx + Math.max(0, x0 - 1), y * nx + Math.min(nx - 1, x1));
      }
      for (let y = Math.max(0, y0 - 1); y < Math.min(Y.length - 1, y1); y++) vertical.fill(1, y * nx + x0, y * nx + x1);
    }
    // Numbered circles are obstacles to every other route, including segments that jump across them.
    const portNodes = new Int32Array(size), portHorizontal = new Int32Array(size), portVertical = new Int32Array(size);
    const markPort = (array, from, to, owner) => {
      for (let i = from; i < to; i++) array[i] = array[i] === 0 || array[i] === owner ? owner : -1;
    };
    for (const route of routes) if (!route.crowded) for (const end of ['a', 'b']) {
      const port = route[end + 'p'];
      const x0 = bound(X, port.x - 7, true), x1 = bound(X, port.x + 7);
      const y0 = bound(Y, port.y - 7, true), y1 = bound(Y, port.y + 7);
      for (let y = y0; y < y1; y++) {
        markPort(portNodes, y * nx + x0, y * nx + x1, route.index);
        markPort(portHorizontal, y * nx + Math.max(0, x0 - 1), y * nx + Math.min(nx - 1, x1), route.index);
      }
      for (let y = Math.max(0, y0 - 1); y < Math.min(Y.length - 1, y1); y++) markPort(portVertical, y * nx + x0, y * nx + x1, route.index);
    }
    // A used node records its axes: perpendicular crossings are allowed, turns and endpoints cannot be touched.
    const occupied = new Uint8Array(size);
    const reserve = ids => {
      for (let i = 1; i < ids.length; i++) {
        const axis = Math.floor(ids[i - 1] / nx) === Math.floor(ids[i] / nx) ? 1 : 2;
        const a = ids[i - 1], b = ids[i];
        occupied[a] |= axis; occupied[b] |= axis;
        // Reserve nearby parallel lanes; perpendicular crossings remain available.
        if (axis === 1) {
          const row = Math.floor(a / nx);
          for (let y = bound(Y, Y[row] - separation, true); y < Y.length && Y[y] < Y[row] + separation; y++) {
            for (let x = Math.min(a % nx, b % nx); x <= Math.max(a % nx, b % nx); x++) occupied[y * nx + x] |= 1;
          }
        } else {
          const col = a % nx;
          for (let x = bound(X, X[col] - separation, true); x < nx && X[x] < X[col] + separation; x++) {
            for (let y = Math.min(Math.floor(a / nx), Math.floor(b / nx)); y <= Math.max(Math.floor(a / nx), Math.floor(b / nx)); y++) occupied[y * nx + x] |= 2;
          }
        }
      }
      occupied[ids[0]] = 3; occupied[ids.at(-1)] = 3;
    };
    const unavailable = new Set();
    for (const route of routes) for (const end of ['a', 'b']) {
      if (route.crowded) { unavailable.add(route.key); continue; }
      const port = route[end + 'p'], box = route[end], side = route['s' + end];
      const start = node({x: side === 'right' ? box.right : box.left, y: port.y}), finish = node(port);
      if (start === undefined || finish === undefined || blocked[finish] || route.crowded) { unavailable.add(route.key); continue; }
      const ids = [], step = start < finish ? 1 : -1;
      for (let id = start; ; id += step) { ids.push(id); if (id === finish) break; }
      // Only the owning card may intersect its endpoint stub.
      if (boxes.some(other => other !== box && port.y > other.top - 5 && port.y < other.bottom + 5 &&
          Math.max(port.x, side === 'right' ? box.right : box.left) > other.left - 5 &&
          Math.min(port.x, side === 'right' ? box.right : box.left) < other.right + 5)) unavailable.add(route.key);
      reserve(ids);
    }

    function search(route) {
      const start = node(route.ap), end = node(route.bp);
      if (start === undefined || end === undefined || blocked[start] || blocked[end] ||
          (portNodes[start] && portNodes[start] !== route.index) || (portNodes[end] && portNodes[end] !== route.index)) return null;
      // Direction is part of the A* state: different arrival axes have different future turn costs.
      const best = new Float64Array(size * 2); best.fill(Infinity);
      const previous = new Int32Array(size * 2); previous.fill(-1);
      const target = point(end), heap = new Heap(), startState = start * 2;
      const estimate = id => Math.abs(X[id % nx] - target.x) + Math.abs(Y[Math.floor(id / nx)] - target.y);
      best[startState] = 0; heap.push({state: startState, g: 0, f: estimate(start)});
      while (heap.items.length) {
        const item = heap.pop(), state = item.state, id = Math.floor(state / 2), direction = state % 2;
        if (item.g !== best[state]) continue;
        if (id === end) {
          const path = []; for (let s = state; s !== -1; s = previous[s]) path.push(Math.floor(s / 2));
          return path.reverse();
        }
        const col = id % nx, row = Math.floor(id / nx);
        const neighbors = [];
        if (col) neighbors.push([id - 1, 0, horizontal[id - 1], portHorizontal[id - 1]]);
        if (col + 1 < nx) neighbors.push([id + 1, 0, horizontal[id], portHorizontal[id]]);
        if (row) neighbors.push([id - nx, 1, vertical[id - nx], portVertical[id - nx]]);
        if (row + 1 < Y.length) neighbors.push([id + nx, 1, vertical[id], portVertical[id]]);
        for (const [next, axis, obstructed, portOwner] of neighbors) {
          if (obstructed || blocked[next] || (portOwner && portOwner !== route.index)) continue;
          // Both endpoint labels have straight outward leads; nothing can follow another route's lead.
          if (id === start && (axis !== 0 || (route.sa === 'right' ? next < id : next > id))) continue;
          if (next === end && (axis !== 0 || (route.sb === 'right' ? id < next : id > next))) continue;
          const bit = axis + 1;
          if ((id !== start && (occupied[id] & bit)) || (next !== end && (occupied[next] & bit))) continue;
          const nextState = next * 2 + axis;
          const distance = axis === 0 ? Math.abs(X[col] - X[next % nx]) : Math.abs(Y[row] - Y[Math.floor(next / nx)]);
          const cost = item.g + distance + (axis === direction ? 0 : 14);
          if (cost >= best[nextState]) continue;
          best[nextState] = cost; previous[nextState] = state;
          heap.push({state: nextState, g: cost, f: cost + estimate(next)});
        }
      }
      return null;
    }

    const paths = [], unrouted = []; let gridSegments = 0;
    for (const route of routes) {
      const ids = unavailable.has(route.key) ? null : search(route);
      if (!ids) { unrouted.push(route.key); continue; }
      reserve(ids); gridSegments += ids.length - 1;
      const raw = ids.map(point), points = raw.filter((p, i) => !i || i === raw.length - 1 ||
        !((raw[i - 1].x === p.x && p.x === raw[i + 1].x) || (raw[i - 1].y === p.y && p.y === raw[i + 1].y)));
      paths.push({key: route.key, index: route.index, points, gridSegments: ids.length - 1});
    }
    return {paths, unrouted, sharedSegments: 0, obstacleCount: boxes.length, grid: [nx, Y.length], gridSegments, separation};
  }

  // Explicit gaps in the earlier line make the later line an unambiguous overpass, in every theme.
  function crossingPaths(paths) {
    const segments = paths.map(path => path.points.slice(1).map((b, i) => ({a: path.points[i], b, gaps: []})));
    let crossings = 0;
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      for (const under of segments[i]) for (const over of segments[j]) {
        const h = under.a.y === under.b.y ? under : over, v = h === under ? over : under;
        if (h.a.y !== h.b.y || v.a.x !== v.b.x) continue;
        const x = v.a.x, y = h.a.y;
        if (x <= Math.min(h.a.x, h.b.x) || x >= Math.max(h.a.x, h.b.x) ||
            y <= Math.min(v.a.y, v.b.y) || y >= Math.max(v.a.y, v.b.y)) continue;
        under.gaps.push(under.a.y === under.b.y ? x : y); crossings++;
      }
    }
    const commands = segments.map(list => list.map(({a, b, gaps}) => {
      const horizontal = a.y === b.y, from = horizontal ? a.x : a.y, to = horizontal ? b.x : b.y, sign = Math.sign(to - from);
      const at = n => horizontal ? `${round(n)} ${a.y}` : `${a.x} ${round(n)}`;
      const intervals = gaps.map(n => [Math.max(Math.min(from, to), n - 4), Math.min(Math.max(from, to), n + 4)]).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const interval of intervals) { const last = merged.at(-1); if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]); else merged.push(interval); }
      if (sign < 0) merged.reverse();
      let d = `M ${at(from)}`;
      for (const interval of merged) d += ` L ${at(interval[sign > 0 ? 0 : 1])} M ${at(interval[sign > 0 ? 1 : 0])}`;
      return d + ` L ${at(to)}`;
    }).join(' '));
    return {commands, crossings};
  }

  window.routeDeckRelations = function ({edges, members, focus, root, find, label, t, motion}) {
    const doc = root.ownerDocument;
    root.querySelectorAll('svg.deck-routed-links,.deck-route-status').forEach(el => el.remove());
    if (motion?.animating) return;
    const board = root.querySelector('#board'); if (!board) return;
    const rr = root.getBoundingClientRect();
    // Absolute SVG coordinates start at the root's padding edge, including its own scroll offset.
    const dx = (root.scrollLeft || 0) - (root.clientLeft || 0) - rr.left;
    const dy = (root.scrollTop || 0) - (root.clientTop || 0) - rr.top;
    const visible = el => el && el.getClientRects().length && !el.closest('[hidden]');
    const measure = el => {
      let r = el.getBoundingClientRect();
      if (el.matches(headerSelector)) {
        const parts = [...el.children].filter(child => visible(child) && !child.matches('.group-activity,#detail')).map(child => child.getBoundingClientRect());
        if (parts.length) r = {left: Math.min(...parts.map(p => p.left)), right: Math.max(...parts.map(p => p.right)),
          top: Math.min(r.top, ...parts.map(p => p.top)), bottom: Math.max(r.bottom, ...parts.map(p => p.bottom))};
      }
      return {el, left: round(r.left + dx), right: round(r.right + dx), top: round(r.top + dy), bottom: round(r.bottom + dy),
        width: r.right - r.left, height: r.bottom - r.top};
    };
    // An inline detail is already covered by its card or group row.
    const boxes = [...root.querySelectorAll(obstacleSelector)].filter(el => visible(el) && !el.parentElement?.closest('.task-card,.mix')).map(measure).filter(r => r.width > 0 && r.height > 0);
    const byElement = new Map(boxes.map(box => [box.el, box]));
    const boxFor = el => {
      if (!visible(el)) return null;
      if (!byElement.has(el)) {
        const box = measure(el);
        // A header endpoint replaces its individual parts with their union.
        if (el.matches(headerSelector)) for (let i = boxes.length - 1; i >= 0; i--) if (boxes[i].el.parentElement === el) boxes.splice(i, 1);
        boxes.push(box); byElement.set(el, box);
      }
      return byElement.get(el);
    };
    const width = Math.max(root.clientWidth, root.scrollWidth);
    if (!width) return;
    const seen = new Set(), routes = [];
    for (const edge of [...edges].sort((a, b) => { const ka = keyOf(a), kb = keyOf(b); return ka < kb ? -1 : ka > kb ? 1 : 0; })) {
      const key = keyOf(edge); if (seen.has(key)) continue; seen.add(key);
      const from = find(edge.question ? edge.from : edge.to), to = find(edge.question ? edge.to : edge.from);
      const a = boxFor(from), b = boxFor(to); if (!a || !b || from === to) continue;
      const same = Math.abs(a.left - b.left) < 20;
      const side = same ? (a.right + 48 < width ? 'right' : 'left') : (a.left < b.left ? 'right' : 'left');
      routes.push({key, edge, a, b, sa: side, sb: same ? side : side === 'right' ? 'left' : 'right', index: routes.length + 1,
        cls: edge.question ? 'question-link' : edge.completed ? 'freed-link' : members.has(edge.from) ? 'before-link' : 'after-link'});
    }
    const ports = new Map();
    for (const route of routes) for (const end of ['a', 'b']) {
      const box = route[end];
      if (!ports.has(box)) ports.set(box, {left: [], right: []});
      const sides = ports.get(box), preferred = route['s' + end], alternate = preferred === 'right' ? 'left' : 'right';
      const capacity = box.height < 16 ? 0 : Math.floor((box.height - 16) / 14) + 1;
      const side = sides[preferred].length < capacity ? preferred : alternate;
      if (sides[side].length >= capacity) route.crowded = true;
      route['s' + end] = side; sides[side].push({route, end, box, side});
    }
    for (const sides of ports.values()) for (const list of Object.values(sides)) {
      const visible = list.filter(({route}) => !route.crowded);
      visible.forEach(({route, end, box, side}, i) => {
        route[end + 'p'] = {x: round(side === 'right' ? box.right + 8 : box.left - 8),
          y: round(visible.length === 1 ? (box.top + box.bottom) / 2 : box.top + 8 + (box.height - 16) * i / (visible.length - 1))};
      });
      // Unrouteable crowded links still have stable diagnostics; they never render overlapping numbers.
      for (const {route, end, box, side} of list) if (route.crowded) route[end + 'p'] = {
        x: round(side === 'right' ? box.right + 8 : box.left - 8), y: round((box.top + box.bottom) / 2)};
    }
    const height = Math.max(root.clientHeight, root.scrollHeight, ...boxes.map(box => box.bottom + 12));
    if (!height) return;
    const cacheKey = JSON.stringify([width, height, routes.map(r => [r.key, r.ap, r.bp, !!r.crowded]), boxes.map(r => [r.left, r.top, r.right, r.bottom])]);
    const cached = caches.get(root), cacheHit = cached?.key === cacheKey;
    let result = cacheHit ? cached.result : routeGeometry(routes, boxes, width, height);
    if (!cacheHit && result.unrouted.length) {
      const tight = routeGeometry(routes, boxes, width, height, 0);
      if (tight.unrouted.length < result.unrouted.length) result = tight;
    }
    if (!cacheHit) caches.set(root, {key: cacheKey, result});
    const {commands, crossings} = crossingPaths(result.paths);
    const svg = doc.createElementNS(NS, 'svg'); svg.classList.add('links', 'deck-routed-links');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('width', width); svg.setAttribute('height', height);
    svg.style.width = width + 'px'; svg.style.height = height + 'px';
    const routeMap = new Map(routes.map(route => [route.key, route]));
    const path = (d, cls) => { const el = doc.createElementNS(NS, 'path'); el.setAttribute('d', d); el.setAttribute('class', cls); svg.append(el); return el; };
    result.paths.forEach((routed, i) => {
      const route = routeMap.get(routed.key);
      path(commands[i], 'route-halo'); const line = path(commands[i], route.cls); line.dataset.relation = String(route.index);
      const title = doc.createElementNS(NS, 'title');
      title.textContent = t('Relationship {number}: {from} → {to}', {number: route.index, from: label(route.edge.from), to: label(route.edge.to)}); line.append(title);
    });
    // Labels are drawn last so a crossing halo cannot erase a paired number.
    for (const routed of result.paths) {
      const route = routeMap.get(routed.key);
      for (const end of ['a', 'b']) {
        const port = route[end + 'p'], box = route[end], side = route['s' + end];
        path(`M ${side === 'right' ? box.right : box.left} ${port.y} L ${port.x} ${port.y}`, route.cls).dataset.relation = String(route.index);
        const circle = doc.createElementNS(NS, 'circle'); circle.setAttribute('cx', port.x); circle.setAttribute('cy', port.y); circle.setAttribute('r', '6'); circle.setAttribute('class', 'route-port ' + route.cls); svg.append(circle);
        const number = doc.createElementNS(NS, 'text'); number.setAttribute('x', port.x); number.setAttribute('y', port.y); number.setAttribute('class', 'route-number'); number.textContent = route.index; svg.append(number);
      }
    }
    if (routes.length) {
      root.append(svg);
      const legend = root.querySelector('#connector-key');
      if (legend) {
        const status = doc.createElement('span'); status.className = 'deck-route-status';
        status.textContent = t('{count} relationships · numbered endpoints', {count: result.paths.length}) +
          (result.unrouted.length ? ' · ' + t('{count} unclear routes: check details', {count: result.unrouted.length}) : ''); legend.append(status);
      }
    }
    return {focus, visibleRoutes: routes.length, routed: result.paths.length, ...result, crossings, cacheHit, routeKeys: result.paths.map(p => p.key)};
  };
})();
