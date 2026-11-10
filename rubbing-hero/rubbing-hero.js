/* Agolic hero. A crayon rubbing fills the first screen behind the page. Branching paths of a program lie under
   the paper and bugs sit at the ends of some of them. The agent rubs a patch at a time, following lines out to
   their ends; the visitor rubs too, with a mouse or a sideways finger, and an up or down swipe still scrolls. */
(() => {
  'use strict';
  const host = document.querySelector('[data-rubbing-hero]');
  const canvas = host && host.querySelector('canvas');
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return;

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = motion.matches;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(rand) {
    const p = new Uint8Array(512), v = new Float32Array(256);
    const base = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = base[i]; base[i] = base[j]; base[j] = t; }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    for (let i = 0; i < 256; i++) v[i] = rand();
    const fade = t => t * t * (3 - 2 * t);
    const n = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X0 = xi & 255, Y0 = yi & 255;
      const a = v[p[X0 + p[Y0]]], b = v[p[X0 + 1 + p[Y0]]], c = v[p[X0 + p[Y0 + 1]]], d = v[p[X0 + 1 + p[Y0 + 1]]];
      const u = fade(xf), w = fade(yf);
      return lerp(lerp(a, b, u), lerp(c, d, u), w);
    };
    return (x, y, oct = 1) => {
      let s = 0, amp = 0.5, f = 1, norm = 0;
      for (let o = 0; o < oct; o++) { s += n(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
      return s / norm;
    };
  }

  /* Colours come from the page's own custom properties, read through a 1 x 1 canvas so any CSS colour works. */
  const probe = document.createElement('canvas').getContext('2d');
  function rgbOf(css, fallback) {
    probe.fillStyle = fallback;
    probe.fillStyle = css || fallback;
    const v = probe.fillStyle;
    if (v[0] === '#') { const n = parseInt(v.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    const m = v.match(/[\d.]+/g) || [0, 0, 0];
    return [+m[0], +m[1], +m[2]];
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1).toFixed(3)})`;
  const mix = (c, d, t) => [0, 1, 2].map(i => Math.round(lerp(c[i], d[i], t)));
  const lum = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

  function readTokens() {
    const cs = getComputedStyle(host);
    const g = n => cs.getPropertyValue(n).trim();
    const t = {
      paper: rgbOf(g('--rub-paper'), '#ffffff'), ink: rgbOf(g('--rub-ink'), '#14213a'),
      agent: rgbOf(g('--rub-agent'), '#ad1b98'), visitor: rgbOf(g('--rub-visitor'), '#359a58'), bug: rgbOf(g('--rub-bug'), '#c43b46')
    };
    t.dark = lum(t.paper) < 0.4;
    if (t.dark) t.visitor = mix(t.visitor, [255, 255, 255], 0.3);
    t.key = [t.paper, t.ink, t.agent, t.visitor, t.bug].join('|');
    return t;
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function grainPattern(c, strength) {
    const n = 128, g = makeCanvas(n, n), gc = g.getContext('2d'), im = gc.createImageData(n, n);
    for (let i = 0; i < n * n; i++) im.data[i * 4 + 3] = Math.round(255 * Math.pow(Math.random(), 2.3) * strength);
    gc.putImageData(im, 0, 0);
    return c.createPattern(g, 'repeat');
  }

  /* A small insect at the origin, head toward +x, about s long. */
  const LEG_X = [0.13, 0.02, -0.09], LEG_A = [0.85, 1.62, 2.35], LEG_B = [0.75, -0.25, -0.55];
  function insect(c, kind, s, o) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const lw = Math.max(0.45, s * 0.05);
    const phase = o.phase || 0, amp = o.amp || 0;
    const seam = (x0, x1) => {
      if (!o.seam) return;
      c.save();
      if (o.cut) c.globalCompositeOperation = 'destination-out';
      c.strokeStyle = o.cut ? '#000' : o.seam;
      c.lineWidth = Math.max(0.4, s * 0.035);
      c.beginPath(); c.moveTo(x0 * s, 0); c.lineTo(x1 * s, 0); c.stroke();
      c.restore();
    };
    if (kind === 'moth') {
      const f = o.wing == null ? 1 : o.wing;
      c.strokeStyle = o.legs; c.lineWidth = lw * 0.8;
      c.beginPath();
      for (let sd = -1; sd <= 1; sd += 2) { c.moveTo(0.18 * s, sd * 0.03 * s); c.quadraticCurveTo(0.32 * s, sd * 0.05 * s, 0.4 * s, sd * 0.2 * s); }
      c.stroke();
      c.fillStyle = o.body;
      for (let sd = -1; sd <= 1; sd += 2) {
        c.beginPath();
        c.moveTo(0.1 * s, 0);
        c.quadraticCurveTo(0.08 * s, sd * 0.42 * s * f, -0.16 * s, sd * 0.6 * s * f);
        c.quadraticCurveTo(-0.3 * s, sd * 0.5 * s * f, -0.22 * s, sd * 0.27 * s * f);
        c.quadraticCurveTo(-0.4 * s, sd * 0.36 * s * f, -0.45 * s, sd * 0.16 * s * f);
        c.quadraticCurveTo(-0.32 * s, sd * 0.04 * s, -0.1 * s, 0);
        c.closePath();
        c.fill();
      }
      if (o.mark) {
        c.fillStyle = o.mark;
        c.beginPath();
        for (let sd = -1; sd <= 1; sd += 2) { c.moveTo(-0.06 * s, sd * 0.36 * s * f); c.ellipse(-0.12 * s, sd * 0.36 * s * f, 0.06 * s, 0.05 * s * Math.max(0.3, f), 0, 0, TAU); }
        c.fill();
      }
      c.fillStyle = o.dark || o.body;
      c.beginPath(); c.ellipse(-0.06 * s, 0, 0.27 * s, 0.065 * s, 0, 0, TAU); c.fill();
      return;
    }
    c.strokeStyle = o.legs; c.lineWidth = lw;
    c.beginPath();
    for (let k = 0; k < 3; k++) for (let sd = -1; sd <= 1; sd += 2) {
      const sw = Math.sin(phase + k * 2.09 + (sd > 0 ? Math.PI : 0)) * amp;
      const ax = LEG_X[k] * s, ay = sd * 0.08 * s;
      const fa = sd * (LEG_A[k] + sw);
      const fx = ax + Math.cos(fa) * 0.24 * s, fy = ay + Math.sin(fa) * 0.24 * s;
      const ta = fa - sd * LEG_B[k];
      c.moveTo(ax, ay); c.lineTo(fx, fy); c.lineTo(fx + Math.cos(ta) * 0.2 * s, fy + Math.sin(ta) * 0.2 * s);
    }
    c.stroke();
    c.lineWidth = lw * 0.8;
    c.beginPath();
    for (let sd = -1; sd <= 1; sd += 2) { c.moveTo(0.28 * s, sd * 0.04 * s); c.quadraticCurveTo(0.42 * s, sd * 0.05 * s, 0.5 * s, sd * 0.19 * s); }
    c.stroke();
    if (kind === 'ladybird') {
      c.fillStyle = o.dark || o.body;
      c.beginPath(); c.ellipse(0.2 * s, 0, 0.1 * s, 0.15 * s, 0, 0, TAU); c.fill();
      c.fillStyle = o.body;
      c.beginPath(); c.ellipse(-0.07 * s, 0, 0.3 * s, 0.27 * s, 0, 0, TAU); c.fill();
      if (o.spots) {
        c.fillStyle = o.spots;
        c.beginPath();
        for (const [x, y] of [[0.05, 0.14], [-0.13, 0.17], [-0.25, 0.08]]) for (let sd = -1; sd <= 1; sd += 2) { c.moveTo(x * s + 0.05 * s, sd * y * s); c.arc(x * s, sd * y * s, 0.05 * s, 0, TAU); }
        c.fill();
      }
      seam(0.16, -0.36);
      return;
    }
    c.fillStyle = o.dark || o.body;
    c.beginPath(); c.ellipse(0.27 * s, 0, 0.07 * s, 0.09 * s, 0, 0, TAU); c.fill();
    c.fillStyle = o.body;
    c.beginPath(); c.ellipse(0.12 * s, 0, 0.12 * s, 0.15 * s, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(-0.15 * s, 0, 0.31 * s, 0.2 * s, 0, 0, TAU); c.fill();
    seam(0, -0.44);
  }

  const CELL = 6, REV = 0.3, QC = 8, VEIL = 0.9;
  let W = 0, H = 0, scale = 1, rs = 1, built = false, tok = null, time = 0;
  let rand = Math.random, noise = null;
  let X, Y, PAR, KIDS, SUB, WID, DEP, N = 0, maxDep = 1, root = null;
  let bugs = [], marks = [], rings = [], pulses = [];
  let full = null, fullC = null, mask = null, maskC = null, quiet = null;
  let qv = null, qw = 0, qh = 0, spr = null, G = null, gw = 0, gh = 0, agent = null;
  const visitor = { x: 0, y: 0, t: -1e9 };

  const cellAt = (x, y) => {
    const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
    return i < 0 || j < 0 || i >= gw || j >= gh ? -1 : j * gw + i;
  };
  /* How open the paper is at a point: 1 on bare paper, 0 behind text, cards and controls or at the faded bottom. */
  const openAt = (x, y) => {
    const i = Math.floor(x / QC), j = Math.floor(y / QC);
    return i < 0 || j < 0 || i >= qw || j >= qh ? 0 : 1 - qv[j * qw + i];
  };

  /* The quiet map marks where the page sits over the sheet: every line of text and every solid box (cards,
     buttons, images, fields). The rubbing is veiled there so the page keeps its contrast. */
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);
  const SOLID = new Set(['IMG', 'SVG', 'svg', 'VIDEO', 'CANVAS', 'IFRAME', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'PICTURE']);
  function solid(el) {
    if (SOLID.has(el.tagName)) return true;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') return false;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    const m = cs.backgroundColor.match(/[\d.]+/g);
    return !!m && (m.length === 3 || +m[3] >= 0.5);
  }
  function measureQuiet() {
    const hr = host.getBoundingClientRect();
    qw = Math.ceil(W / QC) + 1; qh = Math.ceil(H / QC) + 1;
    let q = new Float32Array(qw * qh);
    const mark = (l, t, r, b, pad) => {
      l -= hr.left + pad; r -= hr.left - pad; t -= hr.top + pad; b -= hr.top - pad;
      if (r <= 0 || b <= 0 || l >= W || t >= H) return;
      const i0 = Math.max(0, Math.floor(l / QC)), i1 = Math.min(qw - 1, Math.floor(r / QC));
      const j0 = Math.max(0, Math.floor(t / QC)), j1 = Math.min(qh - 1, Math.floor(b / QC));
      for (let j = j0; j <= j1; j++) q.fill(1, j * qw + i0, j * qw + i1 + 1);
    };
    const inHero = r => r.width > 2 && r.height > 2 && r.bottom > hr.top && r.top < hr.top + H && r.right > hr.left && r.left < hr.left + W;
    const page = el => el === host || host.contains(el) || SKIP.has(el.tagName);
    const range = document.createRange(), seen = new Map();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const p = n.parentElement;
      if (!p || !/\S/.test(n.data)) continue;
      let ok = seen.get(p);
      if (ok === undefined) { ok = !page(p) && !p.closest('noscript,script,style,template') && inHero(p.getBoundingClientRect()); seen.set(p, ok); }
      if (!ok) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) mark(r.left, r.top, r.right, r.bottom, 9);
    }
    for (const el of document.body.querySelectorAll('*')) {
      if (page(el)) continue;
      const r = el.getBoundingClientRect();
      if (!inHero(r) || (r.width > W * 0.9 && r.height > H * 0.5)) continue;
      if (solid(el)) mark(r.left, r.top, r.right, r.bottom, 5);
    }
    for (let pass = 0; pass < 2; pass++) {
      const o = new Float32Array(q.length);
      for (let j = 0; j < qh; j++) for (let i = 0; i < qw; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= qw || b >= qh) continue;
          s += q[b * qw + a]; n++;
        }
        o[j * qw + i] = Math.max(q[j * qw + i] * 0.85, s / n);
      }
      q = o;
    }
    const band = Math.max(70, H * 0.1), ease = f => f * f * (3 - 2 * f);
    for (let j = 0; j < qh; j++) {
      const y = (j + 0.5) * QC;
      const keep = (1 - ease(clamp((y - H * 0.8) / (H * 0.2), 0, 1))) * ease(clamp(y / band, 0, 1));
      for (let i = 0; i < qw; i++) { const k = j * qw + i; q[k] = 1 - (1 - q[k]) * keep; }
    }
    qv = q;
    quiet = makeCanvas(qw, qh);
    const qc = quiet.getContext('2d'), im = qc.createImageData(qw, qh);
    for (let k = 0; k < q.length; k++) im.data[k * 4 + 3] = Math.round(255 * q[k]);
    qc.putImageData(im, 0, 0);
  }

  function pickRoot() {
    let best = null, bs = -1;
    for (const side of [0, 1]) for (let y = H * 0.14; y <= H * 0.7; y += 14) {
      let s = 0, n = 0;
      for (let yy = y - 56; yy <= y + 56; yy += 14) for (let xx = 6; xx <= 150; xx += 12) { s += openAt(side ? W - xx : xx, yy); n++; }
      s = s / n + rand() * 0.1;
      if (s > bs) { bs = s; best = { x: side ? W : 0, y, dx: side ? -1 : 1 }; }
    }
    return best;
  }

  /* Space colonisation: the paths grow toward scattered points, most of them on open paper. */
  function growTree() {
    const m = Math.min(W, H);
    const step = m < 420 ? 5 : 6;
    const Di = clamp(m * 0.13, 44, 86), Dk = step * 1.6;
    let open = 0;
    for (let k = 0; k < qv.length; k++) open += 1 - qv[k];
    open = Math.max(open * QC * QC, W * H * 0.05);
    const target = clamp(Math.round(open / 430), 360, 2200);
    const cand = Math.min(9000, Math.round(target * W * H / open));
    const cols = Math.max(2, Math.round(Math.sqrt(cand * W / H))), rows = Math.max(2, Math.round(cand / cols));
    const cw = W / cols, ch = H / rows, ax = [], ay = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = (i + 0.1 + 0.8 * rand()) * cw, y = (j + 0.1 + 0.8 * rand()) * ch;
      if (x < 6 || y < 6 || x > W - 6 || y > H - 6) continue;
      if (noise(x / 170 + 3.3, y / 170 + 7.1, 2) < 0.3) continue;
      const v = openAt(x, y);
      if (rand() > 0.04 + 0.96 * v * v) continue;
      ax.push(x); ay.push(y);
    }
    const NA = ax.length;
    const alive = new Uint8Array(NA).fill(1), near = new Int32Array(NA).fill(-1), nearD = new Float32Array(NA).fill(Di * Di);
    const agw = Math.ceil(W / Di) + 2, agh = Math.ceil(H / Di) + 2;
    const agrid = Array.from({ length: agw * agh }, () => []);
    for (let a = 0; a < NA; a++) agrid[(Math.floor(ay[a] / Di) + 1) * agw + Math.floor(ax[a] / Di) + 1].push(a);
    const oc = step * 0.8, ow = Math.ceil(W / oc) + 4, oh = Math.ceil(H / oc) + 4;
    const occ = new Int32Array(ow * oh).fill(-1);
    const nx = [], ny = [], par = [];
    const crowded = (x, y, self) => {
      const ci = Math.floor(x / oc) + 2, cj = Math.floor(y / oc) + 2;
      for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
        if (i < 0 || j < 0 || i >= ow || j >= oh) continue;
        const k = occ[j * ow + i];
        if (k >= 0 && k !== self && (nx[k] - x) * (nx[k] - x) + (ny[k] - y) * (ny[k] - y) < step * step * 0.38) return true;
      }
      return false;
    };
    const add = (x, y, p) => {
      const id = nx.length;
      nx.push(x); ny.push(y); par.push(p);
      const oi = (Math.floor(y / oc) + 2) * ow + Math.floor(x / oc) + 2;
      if (oi >= 0 && oi < occ.length) occ[oi] = id;
      const ci = Math.floor(x / Di) + 1, cj = Math.floor(y / Di) + 1;
      for (let j = cj - 1; j <= cj + 1; j++) {
        if (j < 0 || j >= agh) continue;
        for (let i = ci - 1; i <= ci + 1; i++) {
          if (i < 0 || i >= agw) continue;
          const list = agrid[j * agw + i];
          for (let q = 0; q < list.length; q++) {
            const a = list[q];
            if (!alive[a]) continue;
            const dx = ax[a] - x, dy = ay[a] - y, d2 = dx * dx + dy * dy;
            if (d2 < Dk * Dk) { alive[a] = 0; continue; }
            if (d2 < nearD[a]) { nearD[a] = d2; near[a] = id; }
          }
        }
      }
      return id;
    };
    root = pickRoot();
    let cur = add(root.x, root.y, -1);
    for (let g = 0; g < 120; g++) {
      let any = false;
      for (let a = 0; a < NA; a++) if (alive[a] && near[a] >= 0) { any = true; break; }
      if (any) break;
      cur = add(nx[cur] + root.dx * step, ny[cur] + (rand() - 0.5) * step * 0.4, cur);
    }
    for (let it = 0; it < 900 && nx.length < 7000; it++) {
      const acc = new Map();
      for (let a = 0; a < NA; a++) {
        if (!alive[a] || near[a] < 0) continue;
        const i = near[a], dx = ax[a] - nx[i], dy = ay[a] - ny[i], l = Math.hypot(dx, dy) || 1;
        let v = acc.get(i);
        if (!v) { v = [0, 0, []]; acc.set(i, v); }
        v[0] += dx / l; v[1] += dy / l; v[2].push(a);
      }
      if (!acc.size) break;
      for (const [i, v] of acc) {
        let dx = v[0], dy = v[1], l = Math.hypot(dx, dy);
        if (l < 0.25) { const an = rand() * TAU; dx = Math.cos(an); dy = Math.sin(an); l = 1; }
        dx /= l; dy /= l;
        const jt = (rand() - 0.5) * 0.3, cj = Math.cos(jt), sj = Math.sin(jt);
        const x = nx[i] + (dx * cj - dy * sj) * step, y = ny[i] + (dx * sj + dy * cj) * step;
        if (x < 1 || y < 1 || x > W - 1 || y > H - 1 || crowded(x, y, i)) { for (const a of v[2]) alive[a] = 0; continue; }
        add(x, y, i);
      }
    }
    N = nx.length;
    X = new Float32Array(nx); Y = new Float32Array(ny); PAR = new Int32Array(par);
    KIDS = Array.from({ length: N }, () => []);
    for (let i = 1; i < N; i++) KIDS[PAR[i]].push(i);
    for (let pass = 0; pass < 2; pass++) {
      const sx = X.slice(), sy = Y.slice();
      for (let i = 1; i < N; i++) {
        if (KIDS[i].length !== 1) continue;
        const p = PAR[i], c = KIDS[i][0];
        X[i] = sx[i] * 0.5 + (sx[p] + sx[c]) * 0.25;
        Y[i] = sy[i] * 0.5 + (sy[p] + sy[c]) * 0.25;
      }
    }
    SUB = new Float32Array(N).fill(1);
    for (let i = N - 1; i > 0; i--) SUB[PAR[i]] += SUB[i];
    WID = new Float32Array(N); DEP = new Float32Array(N);
    for (let i = 0; i < N; i++) WID[i] = Math.min(4.6, 0.55 + 0.3 * Math.pow(SUB[i], 0.34));
    maxDep = 1;
    for (let i = 1; i < N; i++) { DEP[i] = DEP[PAR[i]] + Math.hypot(X[i] - X[PAR[i]], Y[i] - Y[PAR[i]]); if (DEP[i] > maxDep) maxDep = DEP[i]; }
  }

  /* Bugs wait just past the ends of deep paths, only where the paper is open so a find is always seen. */
  function placeBugs() {
    bugs = [];
    const s = clamp(Math.min(W, H) * 0.04, 15, 22);
    let open = 0;
    for (let k = 0; k < qv.length; k++) open += 1 - qv[k];
    const want = clamp(Math.round(open * QC * QC / 110000), 2, 5);
    const minSep = clamp(Math.min(W, H) * 0.24, 90, 260);
    const tips = [];
    for (let i = 1; i < N; i++) if (!KIDS[i].length && DEP[i] > Math.min(maxDep * 0.28, 80)) tips.push(i);
    for (let i = tips.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = tips[i]; tips[i] = tips[j]; tips[j] = t; }
    const kinds = ['beetle', 'ladybird', 'moth'], k0 = Math.floor(rand() * 3);
    const spot = i => {
      const p = PAR[i];
      let dx = X[i] - X[p], dy = Y[i] - Y[p];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      return { x: clamp(X[i] + dx * s * 0.5, s * 1.4, W - s * 1.4), y: clamp(Y[i] + dy * s * 0.5, s * 1.4, H - s * 1.4), ang: Math.atan2(dy, dx) };
    };
    const top = Math.max(90, H * 0.12);
    const room = (x, y) => { let t = 0, n = 0; for (let yy = y - 80; yy <= y + 80; yy += 20) for (let xx = x - 80; xx <= x + 80; xx += 20) { t += openAt(xx, yy); n++; } return t / n; };
    const clearance = (x, y, r) => {
      let m = openAt(x, y);
      for (let k = 0; k < 8; k++) m = Math.min(m, openAt(x + Math.cos(k * TAU / 8) * s * r, y + Math.sin(k * TAU / 8) * s * r));
      return m;
    };
    const cands = [];
    for (const i of tips) {
      const b = spot(i);
      if (b.y < top) continue;
      const near = clearance(b.x, b.y, 1.2);
      if (near < 0.2) continue;
      cands.push({ i, b, score: clearance(b.x, b.y, 1.7) + 0.5 * near + 0.6 * room(b.x, b.y) + (DEP[i] > maxDep * 0.7 ? 0.25 : 0) + 0.15 * rand() });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const { i, b } of cands) {
      if (bugs.length >= want) break;
      if (bugs.some(o => Math.hypot(o.x - b.x, o.y - b.y) < minSep)) continue;
      bugs.push({ x: b.x, y: b.y, ang: b.ang, s, tip: i, kind: kinds[(k0 + bugs.length) % 3], found: false, ft: 0 });
    }
  }

  function makeSprites() {
    const make = (lw, lh, striate) => {
      const w = Math.max(2, Math.round(lw * rs * 1.25)), h = Math.max(2, Math.round(lh * rs * 1.25));
      const cv = makeCanvas(w, h), cx = cv.getContext('2d'), im = cx.createImageData(w, h), d = im.data;
      const cols = new Float32Array(w);
      for (let i = 0; i < w; i++) cols[i] = striate ? 0.3 + 0.7 * Math.pow(Math.random(), 0.8) : 1;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const u = ((i + 0.5) / w) * 2 - 1, v = ((j + 0.5) / h) * 2 - 1;
        const e = Math.pow(Math.abs(u), 4) + Math.pow(Math.abs(v), 2.2);
        const edge = e >= 1 ? 0 : Math.pow(1 - e, 0.6);
        d[(j * w + i) * 4 + 3] = Math.round(255 * edge * cols[i] * (0.55 + 0.45 * Math.random()));
      }
      cx.putImageData(im, 0, 0);
      return { cv, lw, lh };
    };
    const hs = clamp(Math.min(W, H) / 520, 1, 1.6);
    return {
      block: [make(16, 5, true), make(16, 5, true), make(16, 5, true)],
      pencil: [make(4.2, 3.4, false), make(4.2, 3.4, false)],
      hand: [make(14 * hs, 5 * hs, true), make(14 * hs, 5 * hs, true), make(14 * hs, 5 * hs, true)]
    };
  }

  /* The relief is what a full rubbing would show: a light tone, the paths and the embossed bugs, with paper grain. */
  function buildRelief() {
    const ink = tok.ink, tmp = makeCanvas(full.width, full.height), tc = tmp.getContext('2d');
    const veins = extra => {
      tc.setTransform(1, 0, 0, 1, 0, 0);
      tc.clearRect(0, 0, tmp.width, tmp.height);
      tc.setTransform(rs, 0, 0, rs, 0, 0);
      tc.strokeStyle = rgba(ink, 1);
      tc.lineCap = 'round';
      tc.lineJoin = 'round';
      const B = 12, buckets = Array.from({ length: B }, () => []);
      for (let i = 1; i < N; i++) buckets[clamp(Math.floor((WID[i] - 0.5) / 0.45), 0, B - 1)].push(i);
      for (let k = 0; k < B; k++) {
        if (!buckets[k].length) continue;
        tc.lineWidth = 0.5 + (k + 0.5) * 0.45 + extra;
        tc.beginPath();
        for (const i of buckets[k]) { const p = PAR[i]; tc.moveTo(X[p], Y[p]); tc.lineTo(X[i], Y[i]); }
        tc.stroke();
      }
    };
    const fc = fullC;
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.globalCompositeOperation = 'source-over';
    fc.globalAlpha = 1;
    fc.clearRect(0, 0, full.width, full.height);
    fc.setTransform(rs, 0, 0, rs, 0, 0);
    fc.fillStyle = rgba(ink, tok.dark ? 0.1 : 0.075);
    fc.fillRect(0, 0, W, H);
    const lw = Math.ceil(W / 18) + 2, lh = Math.ceil(H / 18) + 2;
    const low = makeCanvas(lw, lh), lc = low.getContext('2d'), im = lc.createImageData(lw, lh);
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
      const v = noise(i * 0.21 + 11.3, j * 0.21 + 5.9, 3), o = (j * lw + i) * 4;
      im.data[o] = ink[0]; im.data[o + 1] = ink[1]; im.data[o + 2] = ink[2];
      im.data[o + 3] = Math.round(255 * clamp((v - 0.3) * 0.16, 0, 0.08));
    }
    lc.putImageData(im, 0, 0);
    fc.imageSmoothingEnabled = true;
    fc.drawImage(low, 0, 0, lw * 18, lh * 18);
    fc.setTransform(1, 0, 0, 1, 0, 0);
    veins(2.4);
    fc.globalAlpha = 0.17;
    fc.drawImage(tmp, 0, 0);
    veins(0);
    fc.globalAlpha = 0.84;
    fc.drawImage(tmp, 0, 0);
    fc.globalAlpha = 1;
    fc.setTransform(rs, 0, 0, rs, 0, 0);
    for (const b of bugs) {
      fc.save();
      fc.translate(b.x, b.y);
      fc.rotate(b.ang);
      fc.shadowColor = rgba(ink, 0.4);
      fc.shadowBlur = 2.5 * rs;
      insect(fc, b.kind, b.s, { body: rgba(ink, 0.82), dark: rgba(ink, 0.82), legs: rgba(ink, 0.75), seam: '#000', cut: true });
      fc.restore();
    }
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.globalCompositeOperation = 'destination-out';
    fc.fillStyle = grainPattern(fc, 0.85);
    fc.fillRect(0, 0, full.width, full.height);
    fc.globalCompositeOperation = 'source-over';
  }

  function dab(x, y, ang, set, alpha) {
    const s = set[(Math.random() * set.length) | 0];
    const ca = Math.cos(ang), sa = Math.sin(ang);
    maskC.globalAlpha = alpha;
    maskC.setTransform(ca * rs, sa * rs, -sa * rs, ca * rs, x * rs, y * rs);
    maskC.drawImage(s.cv, -s.lw / 2, -s.lh / 2, s.lw, s.lh);
    const hl = s.lw * 0.5 + CELL * 0.5, hs = s.lh * 0.5 + CELL * 0.5;
    const i0 = Math.max(0, Math.floor((x - hl) / CELL)), i1 = Math.min(gw - 1, Math.floor((x + hl) / CELL));
    const j0 = Math.max(0, Math.floor((y - hl) / CELL)), j1 = Math.min(gh - 1, Math.floor((y + hl) / CELL));
    const a = alpha * 0.6;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = (i + 0.5) * CELL - x, dy = (j + 0.5) * CELL - y;
      const u = (dx * ca + dy * sa) / hl, v = (-dx * sa + dy * ca) / hs;
      if (u * u + v * v > 1) continue;
      const k = j * gw + i;
      G[k] = 1 - (1 - G[k]) * (1 - a);
    }
  }
  function rubSegment(x0, y0, x1, y1, ang, tool, w) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 1.7));
    const set = tool === 'pencil' ? spr.pencil : spr.block, al = (tool === 'pencil' ? 0.3 : 0.12) * (w == null ? 1 : w);
    for (let k = 1; k <= n; k++) dab(lerp(x0, x1, k / n), lerp(y0, y1, k / n), ang, set, al);
  }
  function handRub(x0, y0, x1, y1, alpha) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 0.5) return;
    const n = Math.ceil(d / 1.8), ang = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2;
    const a = alpha * clamp(1.35 - d / 60, 0.45, 1);
    for (let k = 1; k <= n; k++) dab(lerp(x0, x1, k / n), lerp(y0, y1, k / n), ang, spr.hand, a);
  }

  const halfBlock = () => (Math.min(W, H) < 420 ? 17 : 23);
  function polyPlan(pts, tool) {
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    const len = Math.max(8, cum[cum.length - 1]);
    const pencil = tool === 'pencil';
    const sp = clamp(Math.max(W, H) / 1100, 1, 1.45);
    return { tool, pts, cum, k: 0, len, half: pencil ? 3.4 : halfBlock(), freq: pencil ? 11 : 3.6, ph: rand() * TAU, dur: len / ((pencil ? 92 : 64) * sp), cx: pts[0][0], cy: pts[0][1], probe: null };
  }
  function patchPos(p, u, te) {
    const along = p.len * u;
    while (p.k < p.pts.length - 2 && p.cum[p.k + 1] < along) p.k++;
    const a = p.pts[p.k], b = p.pts[p.k + 1] || a;
    const sl = Math.max(1e-6, p.cum[p.k + 1] - p.cum[p.k]);
    const f = clamp((along - p.cum[p.k]) / sl, 0, 1);
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const ph = p.freq * te + 0.25;
    const tri = 4 * Math.abs(ph - Math.floor(ph + 0.5)) - 1;
    const env = 0.5 + 0.5 * Math.sqrt(Math.sin(Math.PI * clamp(u, 0, 1)));
    const lat = p.half * env * (0.86 + 0.14 * Math.sin(te * 1.9 + p.ph)) * tri;
    return { x: lerp(a[0], b[0], f) - ty * lat, y: lerp(a[1], b[1], f) + tx * lat, ang: Math.atan2(ty, tx), w: 1 - 0.55 * Math.pow(Math.abs(tri), 4) };
  }
  function rootPlan() {
    const pts = [[X[0] + root.dx * 2, Y[0]]];
    let k = 0, len = 0;
    while (KIDS[k].length && len < 120) {
      let nb = KIDS[k][0];
      for (const q of KIDS[k]) if (SUB[q] > SUB[nb]) nb = q;
      len += Math.hypot(X[nb] - X[k], Y[nb] - Y[k]);
      k = nb;
      pts.push([X[k], Y[k]]);
    }
    return polyPlan(pts.filter((p, i) => i % 3 === 0 || i === pts.length - 1), 'block');
  }

  /* Each round the agent looks at what is already revealed and picks where a line runs off into blank paper.
     Every other round it dives down one path with the pencil, toward the deepest end it can reach, and sometimes
     it follows a hunch toward a branch that hides a bug; in between it rubs a broad patch with the block. */
  function planNext() {
    const rev = new Uint8Array(N), un = new Int32Array(N), deep = new Float32Array(N).fill(-1), bd = new Float32Array(N).fill(Infinity);
    for (const b of bugs) if (!b.found) bd[b.tip] = 0;
    let anyRev = false;
    for (let i = 0; i < N; i++) {
      const k = cellAt(X[i], Y[i]);
      if (k >= 0 && G[k] > REV) { rev[i] = 1; anyRev = true; }
    }
    for (let i = N - 1; i >= 0; i--) {
      if (!rev[i]) { un[i] += 1; if (!KIDS[i].length && DEP[i] > deep[i]) deep[i] = DEP[i]; }
      const p = PAR[i];
      if (p >= 0) { un[p] += un[i]; if (deep[i] > deep[p]) deep[p] = deep[i]; const d = bd[i] + DEP[i] - DEP[p]; if (d < bd[p]) bd[p] = d; }
    }
    if (!anyRev) return rootPlan();
    const dive = agent.rounds % 2 === 1, hunch = dive && (agent.rounds < 2 || rand() < 0.45);
    const vActive = time - visitor.t < 8;
    const pull = (x, y) => (vActive ? 1 + 2.5 * Math.exp(-Math.hypot(x - visitor.x, y - visitor.y) / 140) : 1);
    let best = null, bestS = 0;
    for (let i = 0; i < N; i++) {
      if (!rev[i]) continue;
      const near = 1 + Math.hypot(X[i] - agent.x, Y[i] - agent.y) / 380;
      for (const c of KIDS[i]) {
        if (rev[c] || un[c] < 3 || openAt(X[c], Y[c]) < 0.15) continue;
        let s = dive ? (Math.max(0, deep[c]) / maxDep) * 40 + Math.pow(un[c], 0.3) + (hunch && bd[c] < Infinity ? 8 + 30 * Math.max(0, 1 - bd[c] / maxDep) : 0) : Math.pow(un[c], 0.7);
        s = (s / near) * pull(X[i], Y[i]) * (0.8 + 0.4 * rand()) * (0.2 + 0.8 * openAt(X[c], Y[c]));
        if (s > bestS) { bestS = s; best = { i, c, up: false }; }
      }
      const p = PAR[i];
      if (p >= 0 && !rev[p] && openAt(X[p], Y[p]) >= 0.15) {
        const s = (5 / near) * pull(X[i], Y[i]) * (0.2 + 0.8 * openAt(X[p], Y[p]));
        if (s > bestS) { bestS = s; best = { i, c: p, up: true }; }
      }
    }
    return best ? buildPatch(best, rev, un, deep, dive, hunch ? bd : null) : null;
  }

  function buildPatch(b, rev, un, deep, dive, bd) {
    const { i, c, up } = b;
    const sx = X[i], sy = Y[i];
    if (up) {
      const pts = [[sx, sy]];
      let k = i, len = 0;
      while (PAR[k] >= 0 && len < 110) { const p = PAR[k]; len += Math.hypot(X[p] - X[k], Y[p] - Y[k]); pts.push([X[p], Y[p]]); k = p; }
      return polyPlan(pts.filter((q, n) => n % 3 === 0 || n === pts.length - 1), 'block');
    }
    if (dive || un[c] < 28) {
      const pts = [[sx, sy]];
      let k = c, len = 0;
      const cap = bd ? 1400 : dive ? clamp(Math.max(W, H) * 0.34, 380, 620) : 150;
      for (let guard = 0; guard < 400; guard++) {
        const prev = pts[pts.length - 1];
        len += Math.hypot(X[k] - prev[0], Y[k] - prev[1]);
        pts.push([X[k], Y[k]]);
        if (len >= cap || !KIDS[k].length) break;
        let nb = -1, nd = -2;
        for (const q of KIDS[k]) if (deep[q] > nd) { nd = deep[q]; nb = q; }
        if (nd < 0) { let mu = -1; for (const q of KIDS[k]) if (un[q] > mu) { mu = un[q]; nb = q; } }
        if (bd) { let bv = Infinity; for (const q of KIDS[k]) if (bd[q] < bv) { bv = bd[q]; nb = q; } }
        if (nb < 0) break;
        k = nb;
      }
      let probe = null;
      if (!KIDS[k].length && PAR[k] >= 0) {
        const p = PAR[k], dx = X[k] - X[p], dy = Y[k] - Y[p], l = Math.hypot(dx, dy) || 1;
        pts.push([clamp(X[k] + (dx / l) * 14, 2, W - 2), clamp(Y[k] + (dy / l) * 14, 2, H - 2)]);
        probe = { x: X[k], y: Y[k], dx: dx / l, dy: dy / l };
      }
      const thin = [pts[0]];
      for (let n = 1; n < pts.length; n++) {
        const q = thin[thin.length - 1];
        if (n === pts.length - 1 || Math.hypot(pts[n][0] - q[0], pts[n][1] - q[1]) > 5) thin.push(pts[n]);
      }
      const plan = polyPlan(thin, 'pencil');
      plan.probe = probe;
      return plan;
    }
    let cx = 0, cy = 0, n = 0;
    const stack = [c];
    while (stack.length && n < 60) {
      const k = stack.pop();
      if (Math.hypot(X[k] - sx, Y[k] - sy) > 140) continue;
      if (!rev[k]) { cx += X[k]; cy += Y[k]; n++; }
      for (const q of KIDS[k]) stack.push(q);
    }
    let dx, dy;
    if (n) { dx = cx / n - sx; dy = cy / n - sy; } else { dx = X[c] - sx; dy = Y[c] - sy; }
    const dl = Math.hypot(dx, dy) || 1, len = clamp(dl * 1.8 + 24, 56, 130);
    return polyPlan([[sx, sy], [clamp(sx + (dx / dl) * len, 2, W - 2), clamp(sy + (dy / dl) * len, 2, H - 2)]], 'block');
  }
  /* At the end of a path the pencil shades a small patch to see what is there. */
  function probePlan(pr) {
    const at = d => [clamp(pr.x + pr.dx * d, 2, W - 2), clamp(pr.y + pr.dy * d, 2, H - 2)];
    const p = polyPlan([at(20), at(-6)], 'pencil');
    p.half = 8.5; p.freq = 8; p.dur = 1.05;
    return p;
  }

  function updateAgent(dt) {
    const a = agent;
    a.t += dt;
    a.show = clamp(a.show + (a.state === 'rest' ? -dt : dt) * 1.6, 0, 1);
    if (a.state === 'rest') return;
    if (a.state === 'look') {
      if (a.t < a.dur) return;
      const plan = a.rounds >= a.budget ? null : planNext();
      if (!plan) { a.state = 'rest'; a.t = 0; return; }
      a.plan = plan; a.state = 'think'; a.t = 0; a.dur = 0.42;
      marks.push({ x: plan.cx, y: plan.cy, r: 14 + rand() * 6, t0: time, ph: rand() * TAU, a0: rand() * TAU });
    } else if (a.state === 'think') {
      if (a.t < a.dur) return;
      const start = patchPos(a.plan, 0, 0);
      a.plan.k = 0;
      a.mv = { x0: a.x, y0: a.y, a0: a.ang, x1: start.x, y1: start.y, a1: start.ang };
      a.state = 'move'; a.t = 0;
      a.dur = clamp(Math.hypot(start.x - a.x, start.y - a.y) / 340, 0.22, 0.9);
      a.tool = a.plan.tool;
    } else if (a.state === 'move') {
      const u = easeInOut(clamp(a.t / a.dur, 0, 1));
      a.x = lerp(a.mv.x0, a.mv.x1, u);
      a.y = lerp(a.mv.y0, a.mv.y1, u);
      a.ang = a.mv.a0 + angDiff(a.mv.a0, a.mv.a1) * u;
      if (a.t >= a.dur) { a.state = 'rub'; a.t = 0; a.dur = a.plan.dur; a.px = a.x; a.py = a.y; }
    } else if (a.state === 'rub') {
      const u = clamp(a.t / a.dur, 0, 1);
      const pos = patchPos(a.plan, u, a.t);
      rubSegment(a.px, a.py, pos.x, pos.y, pos.ang, a.plan.tool, pos.w);
      a.x = pos.x; a.y = pos.y; a.ang = pos.ang; a.px = pos.x; a.py = pos.y;
      if (u >= 1 && a.plan.probe) { a.plan = probePlan(a.plan.probe); a.t = 0; a.dur = a.plan.dur; }
      else if (u >= 1) { a.state = 'look'; a.t = 0; a.dur = 0.28 + rand() * 0.2; a.rounds++; }
    }
  }

  function checkBugs() {
    for (const b of bugs) {
      if (b.found) continue;
      let sum = 0, n = 0;
      const r = b.s * 0.42;
      for (let y = b.y - r; y <= b.y + r; y += CELL) for (let x = b.x - r; x <= b.x + r; x += CELL) {
        const k = cellAt(x, y);
        if (k < 0) continue;
        n++;
        sum += G[k];
      }
      if (n && sum / n > 0.45) {
        b.found = true; b.ft = time;
        const by = time - visitor.t < 1.2 && Math.hypot(visitor.x - b.x, visitor.y - b.y) < 90 ? 'visitor' : 'agent';
        rings.push({ x: b.x, y: b.y, r: b.s * 1.15, by, t0: time, ph: rand() * TAU, a0: rand() * TAU });
        pulses.push({ x: b.x, y: b.y, t: 0 });
      }
    }
  }

  function advance(dt) {
    time += dt;
    updateAgent(dt);
    checkBugs();
    for (const p of pulses) p.t += dt;
    pulses = pulses.filter(p => p.t < 1.4);
    marks = marks.filter(m => time - m.t0 < 3.4);
  }

  function loop(m, col, alpha, prog, width) {
    ctx.strokeStyle = rgba(col, alpha);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const steps = Math.max(2, Math.round(44 * prog));
    for (let k = 0; k <= steps; k++) {
      const th = m.a0 + (k / 44) * TAU * 1.12;
      const r = m.r * (1 + 0.06 * Math.sin(3 * th + m.ph)) * (1 + (0.1 * k) / 44);
      const x = m.x + Math.cos(th) * r, y = m.y + Math.sin(th) * r * 0.92;
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  function drawBug(b) {
    const age = reduce ? 9 : time - b.ft, wig = Math.exp(-age * 1.3);
    const tw = reduce ? 0 : Math.max(0, Math.sin(time * 0.8 + b.s * 3.1) - 0.97) * 30;
    const dark = tok.dark ? [43, 16, 22] : tok.ink;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.ang + Math.sin(age * 9) * 0.1 * wig);
    const sc = 1 + 0.2 * Math.exp(-age * 5);
    ctx.scale(sc, sc);
    ctx.globalAlpha = clamp(age / 0.4, 0, 1);
    insect(ctx, b.kind, b.s, {
      body: rgba(tok.bug, 1), dark: rgba(dark, 1), legs: rgba(tok.ink, 0.85), seam: rgba(tok.paper, 0.75), spots: rgba(dark, 1), mark: rgba(dark, 0.5),
      phase: age * 16 + time * 3 * tw, amp: 0.42 * wig + 0.12 * tw,
      wing: b.kind === 'moth' ? 1 - 0.35 * (wig + 0.5 * tw) * (0.5 + 0.5 * Math.sin(age * 22)) : 1
    });
    ctx.restore();
  }
  function drawCrayon() {
    const a = agent;
    if (!a || a.show <= 0) return;
    ctx.save();
    ctx.globalAlpha = a.show;
    ctx.translate(a.x, a.y);
    if (a.state !== 'rub') {
      ctx.shadowColor = tok.dark ? 'rgba(0,0,0,0.6)' : rgba(tok.ink, 0.28);
      ctx.shadowBlur = 7 * scale; ctx.shadowOffsetX = 2 * scale; ctx.shadowOffsetY = 4 * scale;
    }
    ctx.fillStyle = rgba(tok.agent, 1);
    ctx.beginPath();
    if (a.tool === 'pencil') {
      ctx.rotate(-0.8);
      ctx.moveTo(0, 0); ctx.lineTo(3.4, -1.9); ctx.lineTo(21, -1.9); ctx.lineTo(21, 1.9); ctx.lineTo(3.4, 1.9);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = rgba(tok.paper, 0.35);
      ctx.fillRect(6, -0.6, 13, 1.1);
    } else {
      ctx.rotate(a.ang);
      ctx.moveTo(-6.7, -3.4); ctx.lineTo(6.7, -3.4); ctx.quadraticCurveTo(8.5, -3.4, 8.5, -1.6); ctx.lineTo(8.5, 1.6); ctx.quadraticCurveTo(8.5, 3.4, 6.7, 3.4);
      ctx.lineTo(-6.7, 3.4); ctx.quadraticCurveTo(-8.5, 3.4, -8.5, 1.6); ctx.lineTo(-8.5, -1.6); ctx.quadraticCurveTo(-8.5, -3.4, -6.7, -3.4);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = rgba(tok.paper, 0.32);
      ctx.fillRect(-7, -2.4, 14, 1.1);
    }
    ctx.restore();
  }

  /* One canvas: the rubbing is the relief seen through what has been rubbed so far, the agent's crayon and its
     passing circles sit on it, and the quiet map then takes most of it away wherever the page has text or a box. */
  function render() {
    const cw = canvas.width, ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(mask, 0, 0, cw, ch);
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(full, 0, 0, cw, ch);
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const m of marks) {
      const age = time - m.t0, fade = clamp(1 - (age - 1.3) / 1.6, 0, 1);
      if (fade > 0) loop(m, tok.agent, 0.7 * fade, clamp(age / 0.38, 0, 1), 1.2);
    }
    drawCrayon();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = VEIL;
    ctx.drawImage(quiet, 0, 0, qw * QC * scale, qh * QC * scale);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const b of bugs) if (b.found) drawBug(b);
    for (const r of rings) loop(r, r.by === 'visitor' ? tok.visitor : tok.agent, 0.9, reduce ? 1 : clamp((time - r.t0) / 0.5, 0, 1), 1.5);
    for (const p of pulses) {
      const k = p.t / 1.4;
      ctx.strokeStyle = rgba(tok.bug, 0.85 * (1 - k));
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10 + 30 * Math.sqrt(k), 0, TAU); ctx.stroke();
    }
  }

  let raf = 0, lastT = 0, visible = true, gen = 0, started = false;
  const seed = (Math.random() * 4294967296) >>> 0;
  const busy = () => !reduce && (agent.state !== 'rest' || agent.show > 0 || pulses.length > 0 || marks.length > 0 ||
    rings.some(r => time - r.t0 < 0.6) || bugs.some(b => b.found && time - b.ft < 3));
  function frame(now) {
    raf = 0;
    if (!built) return;
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    lastT = now;
    if (!reduce) advance(dt);
    render();
    if (busy() && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else lastT = 0;
  }
  function kick() { if (!raf && built && visible && !document.hidden) raf = requestAnimationFrame(frame); }

  /* Reduced motion: the agent's whole visit is worked out in short slices and shown once, finished. */
  function still() {
    const g = gen;
    let left = 120 * 30;
    const slice = () => {
      if (g !== gen) return;
      const t0 = performance.now();
      while (left > 0 && agent.state !== 'rest' && performance.now() - t0 < 10) { advance(1 / 30); left--; }
      if (left > 0 && agent.state !== 'rest') { setTimeout(slice, 0); return; }
      agent.state = 'rest'; agent.show = 0; marks = []; pulses = [];
      render();
      host.classList.add('is-on');
    };
    slice();
  }

  function build() {
    const r = host.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    gen++;
    if (raf) cancelAnimationFrame(raf);
    raf = 0; lastT = 0;
    W = Math.round(r.width); H = Math.round(r.height);
    scale = Math.min(window.devicePixelRatio || 1, 2);
    rs = Math.min(scale, Math.sqrt(2.6e6 / (W * H)));
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    tok = readTokens();
    rand = mulberry(seed);
    noise = makeNoise(rand);
    measureQuiet();
    growTree();
    placeBugs();
    full = makeCanvas(W * rs, H * rs); fullC = full.getContext('2d');
    mask = makeCanvas(W * rs, H * rs); maskC = mask.getContext('2d');
    spr = makeSprites();
    buildRelief();
    gw = Math.ceil(W / CELL); gh = Math.ceil(H / CELL);
    G = new Float32Array(gw * gh);
    marks = []; rings = []; pulses = []; time = 0;
    const sx = root.x - root.dx * 18;
    agent = { x: sx, y: root.y, ang: Math.PI / 2, tool: 'block', state: 'look', t: 0, dur: 0.2, plan: null, mv: null, rounds: 0, budget: 56, px: sx, py: root.y, show: 0 };
    built = true;
    if (reduce) { still(); return; }
    for (let n = 0; n < 180; n++) advance(1 / 30);
    render();
    host.classList.add('is-on');
    kick();
  }

  /* The visitor rubs with a mouse (lightly when hovering, harder when pressed) or a finger. A finger rubs only once
     it has moved sideways; a finger that starts up or down is left to the browser, which scrolls the page.
     Links, buttons, fields and anything that scrolls sideways keep their own gestures. */
  const CONTROL = 'a,button,input,select,textarea,label,summary,option,video,audio,iframe,[contenteditable],[role="button"],[role="slider"],[role="tab"],[draggable="true"]';
  const ptrs = new Map();
  let hover = null, lastWake = -1e9;
  const local = e => { const r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  function scroller(el) {
    for (let e = el; e && e.nodeType === 1 && e !== document.body; e = e.parentElement) {
      if (e.scrollWidth > e.clientWidth + 1) { const o = getComputedStyle(e).overflowX; if (o === 'auto' || o === 'scroll') return true; }
    }
    return false;
  }
  function rub(x0, y0, x1, y1, alpha) {
    handRub(x0, y0, x1, y1, alpha);
    visitor.x = x1; visitor.y = y1; visitor.t = time;
    checkBugs();
    if (!reduce && agent.state === 'rest' && time - lastWake > 4) {
      lastWake = time;
      agent.budget = agent.rounds + 6;
      agent.state = 'look'; agent.t = 0; agent.dur = 0.3;
    }
    kick();
  }
  document.addEventListener('pointerdown', e => {
    if (!built || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const [x, y] = local(e), t = e.target instanceof Element ? e.target : null;
    if (!inside(x, y) || (t && (t.closest(CONTROL) || scroller(t)))) return;
    ptrs.set(e.pointerId, { live: e.pointerType !== 'touch', x0: x, y0: y, lx: x, ly: y });
  }, { passive: true });
  document.addEventListener('pointermove', e => {
    if (!built) return;
    const [x, y] = local(e), p = ptrs.get(e.pointerId);
    if (p) {
      if (!p.live) {
        const dx = x - p.x0, dy = y - p.y0;
        if (dx * dx + dy * dy < 81) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.1) { ptrs.delete(e.pointerId); return; }
        p.live = true;
      }
      rub(p.lx, p.ly, x, y, 0.14);
      p.lx = x; p.ly = y;
      return;
    }
    if (e.pointerType !== 'mouse' || e.buttons || !inside(x, y)) { hover = null; return; }
    const now = performance.now();
    if (hover && now - hover.t < 200) rub(hover.x, hover.y, x, y, 0.08);
    hover = { x, y, t: now };
  }, { passive: true });
  const end = e => { ptrs.delete(e.pointerId); };
  document.addEventListener('pointerup', end, { passive: true });
  document.addEventListener('pointercancel', end, { passive: true });

  /* Keep up with the page: size, layout, theme, motion preference, and whether the hero can be seen at all. */
  let rt = 0, qt = 0;
  new ResizeObserver(() => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (!built) { if (started) build(); return; }
      const r = host.getBoundingClientRect();
      if (Math.abs(r.width - W) > 2 || Math.abs(r.height - H) > H * 0.15 || Math.min(window.devicePixelRatio || 1, 2) !== scale) build();
    }, 200);
  }).observe(host);
  const remeasure = () => {
    clearTimeout(qt);
    qt = setTimeout(() => { if (built) { measureQuiet(); kick(); } }, 350);
  };
  new ResizeObserver(remeasure).observe(document.body);
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', remeasure);
  const retheme = () => {
    if (!built) return;
    const t = readTokens();
    if (t.key === tok.key) return;
    tok = t;
    buildRelief();
    kick();
  };
  const watch = { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] };
  new MutationObserver(retheme).observe(document.documentElement, watch);
  new MutationObserver(retheme).observe(document.body, watch);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  motion.addEventListener('change', () => {
    reduce = motion.matches;
    if (!built) return;
    if (reduce) still();
    else { if (agent.state === 'rest') { agent.budget = agent.rounds + 6; agent.state = 'look'; } kick(); }
  });
  new IntersectionObserver(es => {
    visible = es[es.length - 1].isIntersecting;
    if (visible) { lastT = 0; kick(); }
  }).observe(host);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastT = 0; kick(); } });

  /* Start after the page has painted and its fonts have settled, so the first screen is never held up. */
  const begin = () => { if (!started) { started = true; requestAnimationFrame(() => setTimeout(build, 0)); } };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(begin, begin);
  setTimeout(begin, 900);
})();
