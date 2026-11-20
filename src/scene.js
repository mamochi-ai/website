/* うつろい暦 — scene.js
 * 一枚の屏風としての情景を Canvas 2D で描く。
 * 空 → 星・月・日 → 金霞 → 山 → 水 → 前景（草花・枝・舞うもの）→ 光るもの、の順。
 */
(function () {
  var U = window.UTSUROI = window.UTSUROI || {};
  var TAU = Math.PI * 2;

  // ---------- 小道具 ----------
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function hex(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgb(c, a) {
    var r = c[0] | 0, g = c[1] | 0, b = c[2] | 0;
    return a == null ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + (+a).toFixed(3) + ')';
  }
  function lum(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  function gray(c) { var l = lum(c) * 255; return [l, l, l]; }
  function rng(seed) {
    var s = seed | 0;
    return function () {
      s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function noise1(seed) {
    var r = rng(seed), v = []; for (var i = 0; i < 256; i++) v.push(r());
    return function (x) { var i = Math.floor(x), f = x - i, a = v[i & 255], b = v[(i + 1) & 255]; var u = f * f * (3 - 2 * f); return a + (b - a) * u; };
  }
  function fbm(n, x, oct) { var s = 0, a = 0.5, f = 1, t = 0; for (var o = 0; o < oct; o++) { s += a * n(x * f + o * 37.1); t += a; a *= 0.5; f *= 2.03; } return s / t; }
  function mk(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  function wrap72(s) { return ((s % 72) + 72) % 72; }

  // ---------- 季節の色（昼）: s は 0..72（0 = 立春） ----------
  var PAL_KEYS = [
    { s: 0, skyTop: '#7f9cba', skyBot: '#e7e3dc', far: '#a2aec0', mid: '#7a8896', near: '#525f6b', water: '#89a2b3', deep: '#4b6476', mist: '#eef0f2', foliage: '#8a8f7a', ground: '#7d7a64' },
    { s: 7.5, skyTop: '#86a9c8', skyBot: '#efe6df', far: '#b2b0c4', mid: '#8a9884', near: '#5d7156', water: '#8fb0bf', deep: '#557689', mist: '#f4eeee', foliage: '#b9c48f', ground: '#8f9a62' },
    { s: 10.5, skyTop: '#90b6d8', skyBot: '#f6e6e6', far: '#c4b5c8', mid: '#98a98a', near: '#62805b', water: '#97b9c6', deep: '#5b7f90', mist: '#f8eef0', foliage: '#f0c6cf', ground: '#8fae63' },
    { s: 17, skyTop: '#5f9fd6', skyBot: '#e9f1e4', far: '#9ebcb0', mid: '#6c9a5e', near: '#3f6e40', water: '#6ea6b5', deep: '#3d6f80', mist: '#eef4ea', foliage: '#9ccc6a', ground: '#6e9b45' },
    { s: 25.5, skyTop: '#8c9ea7', skyBot: '#dfe5e0', far: '#93a8a0', mid: '#58805d', near: '#335b42', water: '#6f8f90', deep: '#41605f', mist: '#e8ece8', foliage: '#5f9a52', ground: '#4f7d3c' },
    { s: 33, skyTop: '#2f78c4', skyBot: '#eef2e2', far: '#7ea6b8', mid: '#3f7d50', near: '#285a37', water: '#4b93ad', deep: '#245f78', mist: '#f2f4e8', foliage: '#3f7d48', ground: '#4b7a35' },
    { s: 41.5, skyTop: '#5a96cf', skyBot: '#f1ead6', far: '#a1acaa', mid: '#768c55', near: '#4f6a39', water: '#6d9aac', deep: '#3d6779', mist: '#f3efe2', foliage: '#8c9a48', ground: '#8a8a45' },
    { s: 48.5, skyTop: '#5689c4', skyBot: '#f2e4cb', far: '#a39aa6', mid: '#9a7a42', near: '#5e4a2c', water: '#6489a3', deep: '#33536d', mist: '#f5eddd', foliage: '#d2a23a', ground: '#9a8448' },
    { s: 52.5, skyTop: '#4f82bd', skyBot: '#f3dfc3', far: '#9d8fa1', mid: '#ad653a', near: '#6e3527', water: '#5f84a0', deep: '#2f4f6b', mist: '#f5ebdc', foliage: '#c84a2c', ground: '#8f6a3e' },
    { s: 58, skyTop: '#6c8aae', skyBot: '#ebdcca', far: '#918ea0', mid: '#8a6c50', near: '#4c3a35', water: '#5f7890', deep: '#334a60', mist: '#efe8de', foliage: '#9a5a3a', ground: '#7d6a52' },
    { s: 64, skyTop: '#768dab', skyBot: '#e5e3df', far: '#a7b0c0', mid: '#6f7989', near: '#404958', water: '#6b8097', deep: '#3a4b60', mist: '#eef0f3', foliage: '#e6eaef', ground: '#d9dee5' },
    { s: 69, skyTop: '#7d95b1', skyBot: '#ebebe8', far: '#b0b9c9', mid: '#7a8494', near: '#495161', water: '#869db1', deep: '#4a6175', mist: '#f0f2f4', foliage: '#e8ecf0', ground: '#e2e6ec' }
  ];
  PAL_KEYS.forEach(function (k) { for (var n in k) if (n !== 's') k[n] = hex(k[n]); });
  function paletteAt(s) {
    s = wrap72(s);
    var n = PAL_KEYS.length, a = PAL_KEYS[n - 1], b = PAL_KEYS[0], sa = a.s - 72, sb = b.s;
    for (var i = 0; i < n; i++) {
      var k1 = PAL_KEYS[i], k2 = PAL_KEYS[(i + 1) % n], e = i + 1 < n ? k2.s : k2.s + 72;
      if (s >= k1.s && s < e) { a = k1; b = k2; sa = k1.s; sb = e; break; }
    }
    if (s < PAL_KEYS[0].s) { a = PAL_KEYS[n - 1]; b = PAL_KEYS[0]; sa = a.s - 72; sb = b.s; }
    var t = (s - sa) / (sb - sa); t = 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
    var o = {}; for (var key in a) if (key !== 's') o[key] = mix(a[key], b[key], t);
    return o;
  }
  // 富士の雪・山の雪の量（季節）
  function snowAmount(s) { s = wrap72(s); var v = 0.5 + 0.5 * Math.cos((s - 66) / 72 * TAU); return sstep(0.25, 0.95, v); }

  var TONES = ['bud', 'young', 'green', 'deep', 'yellow', 'red', 'brown'];
  function toneNum(t) { var i = TONES.indexOf(t); return i < 0 ? 2 : i; }

  // ---------- 候のデータを s で混ぜる ----------
  function koBlend(s) {
    var KO = U.KO || [];
    var u = s - 0.5, i = Math.floor(u), f = u - i; f = f * f * (3 - 2 * f);
    var a = KO[((i % 72) + 72) % 72] || {}, b = KO[(((i + 1) % 72) + 72) % 72] || {};
    var o = { weather: {}, flora: {}, water: {}, sfx: {}, blossom: {}, fruit: {}, a: a, b: b, f: f };
    function add(dst, arr, w) { if (!arr) return; if (typeof arr === 'string') arr = [arr]; for (var k = 0; k < arr.length; k++) if (arr[k]) dst[arr[k]] = (dst[arr[k]] || 0) + w; }
    add(o.weather, a.weather, 1 - f); add(o.weather, b.weather, f);
    add(o.flora, a.flora, 1 - f); add(o.flora, b.flora, f);
    add(o.water, a.water, 1 - f); add(o.water, b.water, f);
    var sa = a.sfx || [], sb = b.sfx || [];
    add(o.sfx, sa, 1 - f); add(o.sfx, sb, f);
    var ba = a.branch || {}, bb = b.branch || {};
    if (ba.blossom) o.blossom[ba.blossom] = (o.blossom[ba.blossom] || 0) + (1 - f);
    if (bb.blossom) o.blossom[bb.blossom] = (o.blossom[bb.blossom] || 0) + f;
    if (ba.fruit) o.fruit[ba.fruit] = (o.fruit[ba.fruit] || 0) + (1 - f);
    if (bb.fruit) o.fruit[bb.fruit] = (o.fruit[bb.fruit] || 0) + f;
    var wa = ba.blossom ? 1 - f : 0, wb = bb.blossom ? f : 0;
    o.bloom = (wa + wb) > 0 ? ((ba.bloom || 0) * wa + (bb.bloom || 0) * wb) / (wa + wb) : 0;
    o.leaf = lerp(ba.leaf || 0, bb.leaf || 0, f);
    var la = (ba.leaf || 0) * (1 - f) + 1e-4, lb = (bb.leaf || 0) * f + 1e-4;
    o.tone = (toneNum(ba.leafTone) * la + toneNum(bb.leafTone) * lb) / (la + lb);
    o.snow = lerp(ba.snow || 0, bb.snow || 0, f);
    o.temp = lerp(a.temp || 0, b.temp || 0, f);
    o.color = mix(hex((a.color && a.color.hex) || '#c9a14a'), hex((b.color && b.color.hex) || '#c9a14a'), f);
    return o;
  }

  // ---------- 予備のモチーフ（motifs.js が無い場合） ----------
  function fallbackDraw(ctx, s, opts) {
    ctx.save(); ctx.fillStyle = (opts && opts.color) || '#e9c9cf';
    ctx.beginPath(); ctx.arc(0, 0, Math.max(1, s * 0.5), 0, TAU); ctx.fill(); ctx.restore();
  }
  function motif(name) {
    var M = U.Motifs;
    return (M && typeof M[name] === 'function') ? M[name] : fallbackDraw;
  }

  // ---------- 金箔テクスチャ ----------
  function leafTile(dpr, sq, cols, seed, soft) {
    var size = sq * 12, c = mk(size * dpr, size * dpr), x = c.getContext('2d'), r = rng(seed);
    x.scale(dpr, dpr);
    x.fillStyle = rgb(cols[1]); x.fillRect(0, 0, size, size);
    for (var gy = 0; gy < 12; gy++) for (var gx = 0; gx < 12; gx++) {
      var t = soft ? 0.5 + r() * 0.1 : 0.42 + r() * 0.22 + (r() < 0.07 ? 0.16 : 0);
      x.fillStyle = rgb(mix(cols[0], cols[2], t));
      x.fillRect(gx * sq, gy * sq, sq, sq);
      // 箔の重なり
      if (r() < 0.35) { x.fillStyle = rgb(mix(cols[0], cols[2], t + 0.08), 0.6); x.fillRect(gx * sq + r() * 3, gy * sq + r() * 3, sq * (0.3 + r() * 0.5), sq * (0.2 + r() * 0.4)); }
    }
    for (var bm = 0; bm < 14; bm++) {
      var mx = r() * size, my = r() * size, mr = sq * (1.5 + r() * 3), mg = x.createRadialGradient(mx, my, 0, mx, my, mr);
      var mc = r() < 0.5 ? cols[2] : cols[0];
      mg.addColorStop(0, rgb(mc, 0.16)); mg.addColorStop(1, rgb(mc, 0));
      x.fillStyle = mg; x.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    }
    x.lineWidth = 0.7;
    for (var gy2 = 0; gy2 <= 12; gy2++) { x.strokeStyle = rgb(cols[0], soft ? 0.12 : 0.28); x.beginPath(); x.moveTo(0, gy2 * sq + 0.35); x.lineTo(size, gy2 * sq + 0.35); x.stroke(); }
    for (var gx2 = 0; gx2 <= 12; gx2++) { x.strokeStyle = rgb(cols[0], soft ? 0.1 : 0.22); x.beginPath(); x.moveTo(gx2 * sq + 0.35, 0); x.lineTo(gx2 * sq + 0.35, size); x.stroke(); }
    for (var k = 0; k < 900; k++) { x.fillStyle = rgb(r() < 0.5 ? cols[0] : cols[2], 0.12 + r() * 0.25); x.fillRect(r() * size, r() * size, 0.6 + r() * 1.2, 0.6 + r() * 1.2); }
    x.strokeStyle = rgb(cols[2], 0.35); x.lineWidth = 0.5;
    for (var m = 0; m < 10; m++) { var px = r() * size, py = r() * size; x.beginPath(); x.moveTo(px, py); for (var j = 0; j < 4; j++) { px += (r() - 0.5) * 18; py += (r() - 0.5) * 10; x.lineTo(px, py); } x.stroke(); }
    return c;
  }
  var GOLD = [hex('#94661a'), hex('#d1a33e'), hex('#f7dc86')];
  var SILVER = [hex('#8a909c'), hex('#c3c8d1'), hex('#eef1f6')];

  // =====================================================================
  function Scene(canvas, opt) {
    opt = opt || {};
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.world = mk(4, 4); this.wctx = this.world.getContext('2d');
    this.quality = 1; this.t = 0; this.s = 0; this.timeMs = Date.now();
    this.reduced = !!opt.reduced;
    this.dialH = opt.dialH || 0;
    this.parts = []; this.rings = []; this.fishes = []; this.bolts = []; this.flash = 0;
    this.nextBolt = 3; this.birds = []; this.geese = null; this.nextGeese = 4;
    this.tilt = { x: 0, y: 0 }; this.gust = { x: 0, y: 0, px: -999, py: -999, v: 0 };
    this.sprites = {}; this._spriteN = 0; this.branchKey = ''; this.branchAt = 0; this._tq = '';
    this.onThunder = null;
    this.ss = 0; // 状態の更新回数
  }
  var P = Scene.prototype;

  P.resize = function (w, h, dpr, dialH) {
    this.w = w; this.h = h; this.dpr = dpr; if (dialH != null) this.dialH = dialH;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.portrait = h >= w;
    this._mc = null; this._wc = null;
    this.unit = Math.min(w, h);
    this.horizon = h * (this.portrait ? 0.62 : 0.68);
    this.sunR = clamp(this.unit * 0.06, 20, 58);
    this.sprites = {};
    this._buildMountains(); this._buildBands(); this._buildStars(); this._buildWater(); this._buildBranch(); this._buildBanks();
    this.fgTop = Math.max(0, Math.floor(this.banks.base - this.h * 0.36));
    this.world.width = this.canvas.width; this.world.height = Math.ceil((h - this.fgTop) * dpr);
    this.branchKey = '';
  };

  // ---------- 山 ----------
  P._buildMountains = function () {
    var w = this.w, h = this.h, H = this.horizon, n1 = noise1(11), n2 = noise1(23), n3 = noise1(37);
    var x0 = -0.12 * w, x1 = 1.12 * w, step = Math.max(3, w / 160);
    var self = this;
    function ridge(fn) { var pts = []; for (var x = x0; x <= x1 + step; x += step) pts.push([x, fn(x)]); return pts; }
    var fujiX = (this.portrait ? 0.30 : 0.36) * w, fujiH = h * (this.portrait ? 0.25 : 0.33), fujiW = Math.max(w * (this.portrait ? 0.62 : 0.34), h * 0.5);
    this.fuji = { x: fujiX, top: H - fujiH, w: fujiW };
    var far = ridge(function (x) {
      var base = H - h * 0.085 - h * 0.07 * fbm(n1, x / w * 3.2, 4);
      var d = Math.abs(x - fujiX) / fujiW;
      var cone = d < 1 ? H - fujiH * Math.pow(1 - d, 1.55) : H;
      if (d < 0.035) cone = H - fujiH * Math.pow(1 - 0.035, 1.55);
      return Math.min(base, cone);
    });
    var mid = ridge(function (x) { return H - h * 0.03 - h * 0.085 * Math.pow(fbm(n2, x / w * 4.5 + 3, 5), 1.4) * 1.6; });
    var near = ridge(function (x) {
      var t = x / w;
      var hill = Math.max(0, 1 - Math.pow((t - 0.88) / 0.38, 2)) * h * 0.075 + Math.max(0, 1 - Math.pow((t + 0.02) / 0.22, 2)) * h * 0.045;
      return H - hill - h * 0.012 * fbm(n3, t * 9, 3) + 2;
    });
    function toPath(pts) {
      var p = new Path2D(); p.moveTo(x0, H + 4);
      for (var i = 0; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
      p.lineTo(x1 + step, H + 4); p.closePath(); return p;
    }
    function top(pts) { var m = 1e9; for (var i = 0; i < pts.length; i++) m = Math.min(m, pts[i][1]); return m; }
    this.mtn = [
      { pts: far, path: toPath(far), top: top(far), z: 0.12 },
      { pts: mid, path: toPath(mid), top: top(mid), z: 0.28 },
      { pts: near, path: toPath(near), top: top(near), z: 0.5 }
    ];
    // 富士の雪形
    var snow = new Path2D(), r = rng(5), sl = this.fuji.top + fujiH * 0.36;
    var pts = far.filter(function (p) { return Math.abs(p[0] - fujiX) < fujiW * 0.5 && p[1] < sl; });
    if (pts.length > 2) {
      snow.moveTo(pts[0][0], pts[0][1]);
      for (var i = 0; i < pts.length; i++) snow.lineTo(pts[i][0], pts[i][1]);
      var last = pts[pts.length - 1];
      for (var k = 12; k >= 0; k--) {
        var xx = lerp(pts[0][0], last[0], k / 12);
        var depth = (k % 2 ? 0.12 : 0.02) + r() * 0.08;
        var ry = 1e9; for (var j = 0; j < far.length; j++) if (Math.abs(far[j][0] - xx) <= step) ry = Math.min(ry, far[j][1]);
        snow.lineTo(xx, Math.max(sl - fujiH * 0.05, ry) + fujiH * depth * (1 - Math.abs(k - 6) / 9));
      }
      snow.closePath();
    }
    this.fujiSnow = snow;
    // 山肌の木々（点描）
    var rr = rng(77), trees = [];
    [[1, 170], [2, 90]].forEach(function (L) {
      var layer = self.mtn[L[0]];
      for (var i = 0; i < L[1] * self.quality; i++) {
        var x = x0 + rr() * (x1 - x0), idx = Math.round((x - x0) / step), py = layer.pts[clamp(idx, 0, layer.pts.length - 1)][1];
        var y = py + 3 + Math.pow(rr(), 1.6) * (H - py) * 0.9;
        if (y > H - 2) continue;
        trees.push({ L: L[0], x: x, y: y, r: (L[0] === 2 ? 3.2 : 2.2) * (0.7 + rr() * 0.8) * (self.unit / 390), v: rr(), k: rr() });
      }
    });
    this.trees = trees;
    // 近景の松
    var pines = [], pr = rng(91);
    for (var p = 0; p < 7; p++) {
      var t = 0.66 + pr() * 0.36, x = t * w, idx2 = Math.round((x - x0) / step), y2 = near[clamp(idx2, 0, near.length - 1)][1];
      if (y2 > H - 6) continue;
      pines.push({ x: x, y: y2 + 2, s: (0.022 + pr() * 0.02) * h, lean: (pr() - 0.5) * 0.5, seed: pr() * 1e6 | 0 });
    }
    this.pines = pines;
  };

  // ---------- 金霞（すやり霞） ----------
  P._buildBands = function () {
    var w = this.w, h = this.h, H = this.horizon, dpr = this.dpr, r = rng(3), self = this;
    var sq = Math.max(12, this.unit * 0.045);
    var gold = leafTile(dpr, sq, GOLD, 9), silver = leafTile(dpr, sq, SILVER, 9, true);
    var specs = this.portrait ? [
      { y: 0.27, x0: -0.25, x1: 0.52, th: 0.034, z: 0.10, layer: 'sky' },
      { y: 0.40, x0: 0.52, x1: 1.30, th: 0.030, z: 0.16, layer: 'sky' },
      { y: 0.745, x0: -0.30, x1: 0.62, th: 0.036, z: 0.26, layer: 'far' },
      { y: 0.985, x0: 0.42, x1: 1.35, th: 0.034, z: 0.45, layer: 'shore' },
      { y: 1.17, x0: -0.40, x1: 0.30, th: 0.040, z: 0.65, layer: 'water' }
    ] : [
      { y: 0.25, x0: -0.15, x1: 0.42, th: 0.042, z: 0.10, layer: 'sky' },
      { y: 0.36, x0: 0.58, x1: 1.20, th: 0.036, z: 0.16, layer: 'sky' },
      { y: 0.74, x0: -0.20, x1: 0.48, th: 0.044, z: 0.26, layer: 'far' },
      { y: 0.985, x0: 0.50, x1: 1.25, th: 0.040, z: 0.45, layer: 'shore' },
      { y: 1.16, x0: -0.30, x1: 0.26, th: 0.048, z: 0.65, layer: 'water' }
    ];
    this.bands = specs.map(function (sp, i) {
      var th = sp.th * h, y = sp.y * H, xa = sp.x0 * w, xb = sp.x1 * w, len = xb - xa;
      var caps = [{ x: xa, y: y, w: len, h: th }];
      var n = 1 + (r() * 2 | 0);
      for (var k = 0; k < n; k++) {
        var cw = len * (0.35 + r() * 0.3), dx = (r() < 0.5 ? 0.05 : 0.55) * len + r() * len * 0.1;
        caps.push({ x: xa + dx, y: y + (r() < 0.5 ? -1 : 1) * th * (0.55 + r() * 0.25), w: cw, h: th * (0.75 + r() * 0.3) });
      }
      var bx = 1e9, by = 1e9, bx2 = -1e9, by2 = -1e9;
      caps.forEach(function (c) { bx = Math.min(bx, c.x); by = Math.min(by, c.y - c.h / 2); bx2 = Math.max(bx2, c.x + c.w); by2 = Math.max(by2, c.y + c.h / 2); });
      bx -= 3; by -= 3; bx2 += 3; by2 += 3;
      var path = new Path2D();
      caps.forEach(function (c) { var rr = c.h / 2; path.moveTo(c.x + rr, c.y - rr); path.arcTo(c.x + c.w, c.y - rr, c.x + c.w, c.y + rr, rr); path.arcTo(c.x + c.w, c.y + rr, c.x, c.y + rr, rr); path.arcTo(c.x, c.y + rr, c.x, c.y - rr, rr); path.arcTo(c.x, c.y - rr, c.x + c.w, c.y - rr, rr); path.closePath(); });
      function sprite(tile, cols) {
        var cv = mk((bx2 - bx) * dpr, (by2 - by) * dpr), x = cv.getContext('2d');
        x.scale(dpr, dpr); x.translate(-bx, -by);
        x.lineWidth = 2.2; x.strokeStyle = rgb(cols[0], 0.75); x.stroke(path);
        var pat = x.createPattern(tile, 'repeat');
        try { pat.setTransform(new DOMMatrix().scale(1 / dpr).translate((i * 53) % 97, 0)); } catch (e) { }
        x.fillStyle = pat; x.fill(path);
        var g = x.createLinearGradient(0, by, 0, by2);
        g.addColorStop(0, 'rgba(255,250,235,0.22)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(60,40,10,0.18)');
        x.fillStyle = g; x.fill(path);
        return cv;
      }
      return { spec: sp, path: path, bx: bx, by: by, bw: bx2 - bx, bh: by2 - by, gold: sprite(gold, GOLD), silver: sprite(silver, SILVER), z: sp.z, phase: r() * TAU, layer: sp.layer };
    });
  };

  // ---------- 星 ----------
  P._buildStars = function () {
    var r = rng(17), st = [], n = Math.round(240 * Math.min(1.4, this.w * this.h / 330000));
    for (var i = 0; i < n; i++) st.push({ x: r() * this.w, y: Math.pow(r(), 1.3) * this.horizon * 0.95, s: 0.4 + Math.pow(r(), 3) * 1.5, p: r() * TAU, sp: 0.6 + r() * 2.2 });
    this.stars = st;
    // 天の川
    var mw = mk(this.w * this.dpr * 0.5, this.horizon * this.dpr * 0.5), x = mw.getContext('2d'), sc = this.dpr * 0.5;
    x.scale(sc, sc);
    var cx = this.w * 0.62, cy = this.horizon * 0.42, ang = -1.15, len = Math.hypot(this.w, this.horizon) * 0.75;
    for (var k = 0; k < 1800; k++) {
      var tt = (r() - 0.5) * len, off = (r() + r() + r() - 1.5) * this.unit * 0.09 * (1 + 0.4 * Math.sin(tt / 60));
      var px = cx + Math.cos(ang) * tt - Math.sin(ang) * off, py = cy + Math.sin(ang) * tt + Math.cos(ang) * off;
      x.fillStyle = 'rgba(225,230,255,' + (0.05 + r() * 0.35) + ')'; x.fillRect(px, py, 0.6 + r(), 0.6 + r());
    }
    for (var m = 0; m < 26; m++) {
      var t2 = (r() - 0.5) * len, px2 = cx + Math.cos(ang) * t2, py2 = cy + Math.sin(ang) * t2, rad = this.unit * (0.05 + r() * 0.09);
      var g = x.createRadialGradient(px2, py2, 0, px2, py2, rad); g.addColorStop(0, 'rgba(200,210,255,0.08)'); g.addColorStop(1, 'rgba(200,210,255,0)');
      x.fillStyle = g; x.fillRect(px2 - rad, py2 - rad, rad * 2, rad * 2);
    }
    this.milky = mw;
  };

  // ---------- 水 ----------
  P._buildWater = function () {
    var r = rng(29), w = this.w, H = this.horizon, h = this.h, lines = [];
    for (var i = 0; i < 70; i++) {
      var d = Math.pow(r(), 1.5);
      lines.push({ x: r() * w * 1.2 - w * 0.1, y: H + 4 + d * (h - H), len: (12 + r() * 30) * (0.4 + d * 1.6) * (w / 390), sp: (3 + r() * 6) * (0.5 + d), p: r() * TAU, d: d });
    }
    this.wlines = lines;
    // 氷のひび
    var cracks = new Path2D();
    for (var c = 0; c < 18; c++) {
      var x = r() * w, y = H + 6 + r() * (h - H) * 0.85; cracks.moveTo(x, y);
      for (var j = 0; j < 4; j++) { x += (r() - 0.5) * w * 0.25; y += (r() - 0.3) * (h - H) * 0.12; cracks.lineTo(x, Math.max(H + 4, y)); }
    }
    this.cracks = cracks;
    var floes = [];
    for (var f = 0; f < 14; f++) {
      var fx = r() * w, fy = H + 8 + Math.pow(r(), 0.8) * (h - H) * 0.8, rad = (0.04 + r() * 0.08) * w * (0.5 + (fy - H) / (h - H));
      var pth = new Path2D(), n = 6 + (r() * 4 | 0);
      for (var q = 0; q < n; q++) { var a = q / n * TAU, rr = rad * (0.6 + r() * 0.5); var px = fx + Math.cos(a) * rr, py = fy + Math.sin(a) * rr * 0.32; if (q) pth.lineTo(px, py); else pth.moveTo(px, py); }
      pth.closePath(); floes.push(pth);
    }
    this.floes = floes;
    var pads = [];
    for (var pd = 0; pd < 9; pd++) { var dd = r(); pads.push({ x: (0.08 + r() * 0.84) * w, y: H + (0.12 + dd * 0.6) * (h - H - this.dialH * 0.5), s: (0.03 + dd * 0.05) * w, seed: r() * 1e6 | 0, flower: r() < 0.45, k: r() }); }
    this.pads = pads;
  };

  // ---------- 前景の土手 ----------
  P._buildBanks = function () {
    var w = this.w, h = this.h, base = h - this.dialH * 0.35, r = rng(61);
    var left = new Path2D(), right = new Path2D();
    var lh = h * 0.05, rh = h * 0.04;
    left.moveTo(-10, h + 10); left.lineTo(-10, base - lh);
    left.bezierCurveTo(w * 0.12, base - lh * 1.25, w * 0.26, base - lh * 0.6, w * 0.42, base + 4);
    left.lineTo(w * 0.42, h + 10); left.closePath();
    right.moveTo(w + 10, h + 10); right.lineTo(w + 10, base - rh);
    right.bezierCurveTo(w * 0.9, base - rh * 1.2, w * 0.78, base - rh * 0.5, w * 0.6, base + 4);
    right.lineTo(w * 0.6, h + 10); right.closePath();
    this.banks = { left: left, right: right, base: base, lh: lh, rh: rh };
    // 草花の置き場所
    var slots = [];
    var L = [0.04, 0.13, 0.22, 0.31], R = [0.70, 0.80, 0.9, 0.97];
    L.forEach(function (t, i) { slots.push({ x: t * w, y: base - lh * (1 - Math.pow(t / 0.42, 1.4)) * 0.9 + 2, side: 0, i: i, k: r() }); });
    R.forEach(function (t, i) { slots.push({ x: t * w, y: base - rh * (1 - Math.pow((1 - t) / 0.4, 1.4)) * 0.9 + 2, side: 1, i: i, k: r() }); });
    this.floraSlots = slots;
  };

  // ---------- 枝 ----------
  P._buildBranch = function () {
    var w = this.w, h = this.h, r = rng(2024), segs = [], slots = [];
    var U0 = Math.min(w, h * 0.75);
    var rootX = -0.03 * w, rootY = (this.portrait ? 0.105 : 0.12) * h;
    var self = this;
    function limb(x, y, ang, len, thick, depth) {
      var n = depth === 0 ? 5 : 3;
      for (var i = 0; i < n; i++) {
        var l = len / n * (0.8 + r() * 0.4);
        var a2 = ang + (r() - 0.5) * (depth === 0 ? 0.55 : 0.7);
        var nx = x + Math.cos(a2) * l, ny = y + Math.sin(a2) * l;
        var t2 = thick * (depth === 0 ? 0.82 : 0.7);
        segs.push({ x0: x, y0: y, x1: nx, y1: ny, w0: thick, w1: t2, d: depth });
        // 花・葉の置き場所
        var count = Math.max(1, Math.round(l / (U0 * 0.045)));
        if (depth >= 1 || i >= 2) for (var k = 0; k < count; k++) {
          var tt = (k + 0.5) / count, sx = lerp(x, nx, tt), sy = lerp(y, ny, tt);
          var side = (k % 2 ? 1 : -1), nrm = a2 + side * Math.PI / 2;
          var off = lerp(thick, t2, tt) * 0.45;
          slots.push({ x: sx + Math.cos(nrm) * off, y: sy + Math.sin(nrm) * off, ang: nrm, size: U0 * (0.032 + r() * 0.018) * (depth >= 2 ? 0.85 : 1), r1: r(), r2: r(), r3: r(), r4: r(), r5: r(), seed: r() * 1e6 | 0, top: Math.sin(nrm) < -0.3, d: depth, tip: false });
        }
        // 枝分かれ
        if (depth < 3 && r() < (depth === 0 ? 0.85 : 0.6)) {
          var sgn = r() < 0.5 ? -1 : 1;
          limb(nx, ny, a2 + sgn * (0.45 + r() * 0.5), len * (0.42 + r() * 0.2), t2 * 0.62, depth + 1);
        }
        // 徒長枝（まっすぐ上へ伸びる若枝）
        if (depth <= 1 && r() < 0.35) {
          var sl = len * (0.25 + r() * 0.25), sa = -Math.PI / 2 + (r() - 0.5) * 0.35;
          var ex = nx + Math.cos(sa) * sl, ey = ny + Math.sin(sa) * sl;
          segs.push({ x0: nx, y0: ny, x1: ex, y1: ey, w0: t2 * 0.35, w1: 0.8, d: 3, shoot: true });
          var cnt = 3 + (r() * 3 | 0);
          for (var q = 0; q < cnt; q++) { var tq = (q + 0.7) / (cnt + 0.4); slots.push({ x: lerp(nx, ex, tq) + (q % 2 ? 2 : -2), y: lerp(ny, ey, tq), ang: sa + (q % 2 ? 1 : -1) * 1.2, size: U0 * (0.026 + r() * 0.012), r1: r(), r2: r(), r3: r(), r4: r(), r5: r(), seed: r() * 1e6 | 0, top: false, d: 3, tip: q === cnt - 1 }); }
        }
        x = nx; y = ny; ang = a2; thick = t2;
      }
      slots.push({ x: x, y: y, ang: ang, size: U0 * 0.034, r1: r() * 0.5, r2: r() * 0.5, r3: r() * 0.6, r4: r(), r5: r(), seed: r() * 1e6 | 0, top: false, d: depth, tip: true });
    }
    limb(rootX, rootY, this.portrait ? 0.2 : 0.12, this.portrait ? 0.6 * w : Math.min(0.46 * w, 0.78 * h), U0 * 0.05, 0);
    var bx = 1e9, by = 1e9, bx2 = -1e9, by2 = -1e9;
    segs.forEach(function (s) { bx = Math.min(bx, s.x0, s.x1); by = Math.min(by, s.y0, s.y1); bx2 = Math.max(bx2, s.x0, s.x1); by2 = Math.max(by2, s.y0, s.y1); });
    var pad = U0 * 0.08;
    this.branch = { segs: segs, slots: slots, bx: bx - pad, by: by - pad, bw: bx2 - bx + pad * 2, bh: by2 - by + pad * 2, rootX: rootX, rootY: rootY };
    // 苔点・たらし込み
    var moss = [];
    segs.forEach(function (s) { if (s.d <= 1) { var n = Math.round(Math.hypot(s.x1 - s.x0, s.y1 - s.y0) / 12); for (var i = 0; i < n; i++) if (r() < 0.45) moss.push({ s: s, t: r(), o: (r() - 0.5) * 0.8, r: 0.8 + r() * 1.8, c: r() }); } });
    this.branch.moss = moss;
    this.branch.sprite = mk(this.branch.bw * this.dpr, this.branch.bh * this.dpr);
  };

  P._renderBranch = function (B) {
    var br = this.branch, c = br.sprite, x = c.getContext('2d'), dpr = this.dpr, M = U.Motifs;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
    x.setTransform(dpr, 0, 0, dpr, -br.bx * dpr, -br.by * dpr);
    var ink = [43, 35, 31], ink2 = [70, 62, 48];
    // 幹
    var path = new Path2D();
    br.segs.forEach(function (s) {
      var a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0), nx = -Math.sin(a), ny = Math.cos(a);
      path.moveTo(s.x0 + nx * s.w0 / 2, s.y0 + ny * s.w0 / 2);
      path.lineTo(s.x1 + nx * s.w1 / 2, s.y1 + ny * s.w1 / 2);
      path.lineTo(s.x1 - nx * s.w1 / 2, s.y1 - ny * s.w1 / 2);
      path.lineTo(s.x0 - nx * s.w0 / 2, s.y0 - ny * s.w0 / 2); path.closePath();
      path.moveTo(s.x1 + s.w1 / 2, s.y1); path.arc(s.x1, s.y1, s.w1 / 2, 0, TAU);
      path.moveTo(s.x0 + s.w0 / 2, s.y0); path.arc(s.x0, s.y0, s.w0 / 2, 0, TAU);
    });
    x.fillStyle = rgb(ink); x.fill(path);
    // たらし込み（滲み）
    x.save(); x.clip(path);
    var r = rng(8);
    for (var i = 0; i < 46; i++) {
      var s = br.segs[(r() * br.segs.length) | 0]; if (s.d > 1) continue;
      var t = r(), px = lerp(s.x0, s.x1, t), py = lerp(s.y0, s.y1, t), rad = s.w0 * (0.5 + r() * 0.9);
      var g = x.createRadialGradient(px, py, 0, px, py, rad);
      var col = r() < 0.5 ? mix(ink2, [92, 104, 72], r()) : [24, 20, 18];
      g.addColorStop(0, rgb(col, 0.55)); g.addColorStop(0.7, rgb(col, 0.25)); g.addColorStop(1, rgb(col, 0));
      x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    x.restore();
    // 苔点
    var mossCol = B.snow > 0.4 ? [210, 218, 226] : [96, 128, 70];
    br.moss.forEach(function (m) {
      var s = m.s, a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0), px = lerp(s.x0, s.x1, m.t) - Math.sin(a) * m.o * s.w0 * 0.5, py = lerp(s.y0, s.y1, m.t) + Math.cos(a) * m.o * s.w0 * 0.5;
      x.fillStyle = rgb(mix(mossCol, [150, 170, 90], m.c * 0.5), 0.85); x.beginPath(); x.arc(px, py, m.r, 0, TAU); x.fill();
    });
    // 雪
    if (B.snow > 0.02) {
      x.save(); x.lineCap = 'round';
      br.segs.forEach(function (s) {
        var a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
        if (Math.abs(a) > 1.2) return;
        var k = B.snow * (0.55 + 0.45 * Math.cos(a)), nx = Math.sin(a), ny = -Math.cos(a);
        var o0 = s.w0 * 0.45, o1 = s.w1 * 0.45;
        x.strokeStyle = 'rgba(248,250,252,' + clamp(k * 1.1, 0, 0.95) + ')';
        x.lineWidth = Math.max(1, (s.w0 + s.w1) * 0.32 * k);
        x.beginPath(); x.moveTo(s.x0 + nx * o0, s.y0 + ny * o0); x.lineTo(s.x1 + nx * o1, s.y1 + ny * o1); x.stroke();
        x.strokeStyle = 'rgba(170,190,215,' + clamp(k * 0.5, 0, 0.5) + ')'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(s.x0 + nx * o0 * 0.3, s.y0 + ny * o0 * 0.3); x.lineTo(s.x1 + nx * o1 * 0.3, s.y1 + ny * o1 * 0.3); x.stroke();
      });
      x.restore();
    }
    // 飾り（花・葉・実）
    var bl = B.blossom, kinds = Object.keys(bl), P0 = 0; kinds.forEach(function (k) { P0 += bl[k]; });
    var fr = B.fruit, fk = Object.keys(fr), F0 = 0; fk.forEach(function (k) { F0 += fr[k]; });
    var leafF = motif('leafCluster'), blossomF = motif('blossom'), fruitF = motif('fruit'), capF = motif('snowCap'), kiriF = motif('kiri');
    var items = [];
    br.slots.forEach(function (sl) {
      // 葉
      if (sl.r2 < B.leaf * 0.9) {
        var tn = clamp(Math.round(B.tone + (sl.r5 - 0.5) * (B.tone > 3.3 ? 1.8 : 0.85)), 0, 6);
        items.push({ z: 0, sl: sl, f: leafF, s: sl.size * (0.8 + B.leaf * 0.4), o: { tone: TONES[tn], seed: sl.seed, phase: sl.r4 }, rot: sl.ang + Math.PI / 2 });
      }
      // 花
      var kind = kinds[0];
      if (P0 > 0.01) { var acc = 0, pick = sl.r4 * P0; for (var i = 0; i < kinds.length; i++) { acc += bl[kinds[i]]; if (pick <= acc) { kind = kinds[i]; break; } } }
      var dens = { ume: 0.85, momo: 0.8, sakura: 0.9, tsubaki: 0.34, kiri: 1 }[kind] || 0.8;
      if (P0 > 0.01 && sl.r1 < P0 * dens) {
        var open = clamp(B.bloom + (sl.r5 - 0.5) * 0.5, 0, 1);
        if (kind === 'kiri') { if (sl.tip || sl.r3 < 0.25) items.push({ z: 1, sl: sl, f: kiriF, s: sl.size * 1.7, o: { open: open, seed: sl.seed }, rot: 0 }); }
        else items.push({ z: 1, sl: sl, f: blossomF, s: sl.size * (0.55 + open * 0.5) * (kind === 'tsubaki' ? 1.25 : 1), o: { kind: kind, open: open, seed: sl.seed }, rot: sl.r3 * TAU });
      }
      // 実
      if (F0 > 0.01 && sl.r3 < F0 * 0.4 && sl.d >= 1) {
        var kk = fk[0]; if (fk.length > 1 && sl.r5 * F0 > fr[fk[0]]) kk = fk[1];
        items.push({ z: 2, sl: sl, f: fruitF, s: sl.size * (kk === 'tachibana' || kk === 'kaki' ? 0.95 : 0.7), o: { kind: kk, seed: sl.seed }, rot: 0, hang: true });
      }
      // 雪の塊
      if (B.snow > 0.15 && sl.top && sl.r4 < B.snow * 0.7) items.push({ z: 3, sl: sl, f: capF, s: sl.size * (0.6 + B.snow * 0.6), o: { seed: sl.seed }, rot: 0 });
    });
    items.sort(function (a, b) { return a.z - b.z; });
    items.forEach(function (it) {
      x.save(); x.translate(it.sl.x, it.sl.y + (it.hang ? it.s * 0.6 : 0)); if (it.rot) x.rotate(it.rot);
      try { it.f(x, it.s, it.o); } catch (e) { }
      x.restore();
    });
    this._tintCanvas(x, c, 1);
  };

  // 夜・夕・曇りの色を、描いた部分にだけ焼き込む
  P._tintCanvas = function (x, cv, k) {
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-atop';
    var T = [this.tintO, this.tintN, this.tintD];
    for (var i = 0; i < 3; i++) if (T[i].a * k > 0.01) { x.fillStyle = rgb(T[i].c, T[i].a * k); x.fillRect(0, 0, cv.width, cv.height); }
    x.restore();
  };

  // ---------- 状態 ----------
  P.setState = function (st) {
    this.s = wrap72(st.s);
    this.timeMs = st.timeMs;
    if (st.tilt) { this.tilt.x = st.tilt.x; this.tilt.y = st.tilt.y; }
    this.B = koBlend(this.s);
    this.pal = paletteAt(this.s);
    this.sky = U.Astro.sky(this.timeMs);
    this._light();
  };

  P._light = function () {
    var sk = this.sky, B = this.B, W = B.weather, alt = sk.sunAlt;
    var day = sstep(-6, 8, alt), dusk = Math.exp(-Math.pow((alt - 1.5) / 6.5, 2)), night = 1 - sstep(-15, -3, alt);
    var morning = sk.sunH < 0;
    var ov = clamp((W.rain || 0) * 0.75 + (W['rain-heavy'] || 0) * 1.1 + (W.drizzle || 0) * 0.55 + (W.mist || 0) * 0.45 + (W.snow || 0) * 0.7 + (W['snow-light'] || 0) * 0.3 + (W.lightning || 0) * 0.2, 0, 1);
    var moonUp = sstep(-2, 8, sk.moonAlt) * sk.moonIllum;
    this.L = { day: day, dusk: dusk * (1 - ov * 0.6), night: night, morning: morning, ov: ov, moonUp: moonUp };
    // 世界にかける色（夜の藍・夕の茜）
    var nA = night * (0.78 - 0.22 * moonUp) + (1 - day) * (1 - night) * 0.35;
    this.tintN = { c: mix([10, 18, 44], [24, 36, 70], moonUp), a: clamp(nA, 0, 0.82) };
    this.tintD = { c: morning ? [255, 150, 160] : [255, 140, 70], a: this.L.dusk * 0.26 };
    this.tintO = { c: [120, 128, 138], a: ov * 0.22 * day };
  };
  P.lit = function (c) {
    var o = mix(c, this.tintO.c, this.tintO.a); o = mix(o, this.tintN.c, this.tintN.a); o = mix(o, this.tintD.c, this.tintD.a); return o;
  };

  // ---------- 空の色 ----------
  P.skyColors = function () {
    var L = this.L, p = this.pal, W = this.B.weather;
    var nightTop = [7, 12, 32], nightBot = [24, 34, 68];
    if (L.moonUp > 0) { nightTop = mix(nightTop, [16, 28, 62], L.moonUp * 0.8); nightBot = mix(nightBot, [44, 58, 96], L.moonUp * 0.7); }
    var top = mix(nightTop, p.skyTop, L.day), bot = mix(nightBot, p.skyBot, L.day);
    var dTop = L.morning ? [92, 104, 158] : [70, 72, 130], dMid = L.morning ? [236, 170, 170] : [226, 120, 110], dBot = L.morning ? [252, 214, 182] : [250, 168, 92];
    var mid = mix(top, bot, 0.55);
    top = mix(top, dTop, L.dusk * 0.55); mid = mix(mid, dMid, L.dusk * 0.6); bot = mix(bot, dBot, L.dusk * 0.85);
    var ov = L.ov;
    if (ov > 0) {
      var heavy = clamp((W['rain-heavy'] || 0) + (W.lightning || 0) * 0.5, 0, 1);
      top = mix(top, mix(gray(top), [70, 78, 88], heavy * 0.6), ov * 0.75);
      mid = mix(mid, gray(mid), ov * 0.7); bot = mix(bot, mix(gray(bot), [200, 204, 206], 0.3), ov * 0.6);
    }
    var haze = (W.haze || 0) + (W.mist || 0) * 0.6 + (W.heat || 0) * 0.5;
    if (haze > 0) { mid = mix(mid, bot, haze * 0.4); bot = mix(bot, [250, 246, 236], haze * 0.25 * L.day); }
    if (W.heat) { bot = mix(bot, [252, 230, 170], W.heat * 0.3 * L.day); }
    return { top: top, mid: mid, bot: bot };
  };

  // ---------- 位置（太陽・月） ----------
  P.celestialPos = function (alt, H) {
    var x = this.w * (0.5 + clamp(H / 180, -1, 1) * (this.portrait ? 0.62 : 0.5));
    var y = this.horizon - (alt / 72) * (this.horizon - this.h * 0.07);
    return { x: x, y: y };
  };
  P.hitCelestial = function (px, py) {
    var sk = this.sky; if (!sk) return null;
    var sp = this.celestialPos(sk.sunAlt, sk.sunH), mp = this.celestialPos(sk.moonAlt, sk.moonH);
    var R = this.sunR * 1.7 + 14;
    if (sk.sunAlt > -3 && Math.hypot(px - sp.x, py - sp.y) < R) return 'sun';
    if (sk.moonAlt > -3 && Math.hypot(px - mp.x, py - mp.y) < R) return 'moon';
    return null;
  };

  // ---------- 粒子 ----------
  var KINDS = {
    snow: { n: 170, layer: 'fall' }, 'snow-light': { n: 55, layer: 'fall', as: 'snow' },
    rain: { n: 150, layer: 'rain' }, 'rain-heavy': { n: 300, layer: 'rain', as: 'rain', heavy: 1 }, drizzle: { n: 170, layer: 'rain', as: 'drizzle' },
    'petals-ume': { n: 46, layer: 'fall', as: 'petal', kind: 'ume' }, 'petals-momo': { n: 46, layer: 'fall', as: 'petal', kind: 'momo' }, 'petals-sakura': { n: 70, layer: 'fall', as: 'petal', kind: 'sakura' },
    maple: { n: 42, layer: 'fall', as: 'maple' }, ginkgo: { n: 36, layer: 'fall', as: 'ginkgo' }, leaves: { n: 44, layer: 'fall', as: 'leaf' },
    fluff: { n: 34, layer: 'fall', as: 'fluff' }, fireflies: { n: 34, layer: 'glow', as: 'firefly' },
    butterflies: { n: 5, layer: 'fly', as: 'butterfly' }, dragonflies: { n: 7, layer: 'fly', as: 'dragonfly' }, swallows: { n: 3, layer: 'fly', as: 'swallow' },
    dew: { n: 46, layer: 'spark', as: 'dew' }, frost: { n: 56, layer: 'spark', as: 'frost' }, wind: { n: 14, layer: 'streak', as: 'streak' }
  };

  P._spawn = function (tag, k, initial) {
    var w = this.w, h = this.h, H = this.horizon, r = Math.random, as = k.as || tag;
    var p = { tag: tag, as: as, k: k, a: 1, dying: false, z: 0.45 + r() * 0.55, ph: r(), seed: (r() * 1e6) | 0, rot: r() * TAU, vr: (r() - 0.5) * 3 };
    switch (as) {
      case 'snow': p.x = r() * w * 1.2 - w * 0.1; p.y = initial ? r() * h : -10 - r() * 40; p.size = (1.2 + r() * r() * 3.6) * p.z * (this.unit / 390) * 1.3; p.vy = (26 + r() * 30) * p.z; p.big = r() < 0.06; break;
      case 'rain': case 'drizzle': p.x = r() * w * 1.3 - w * 0.15; p.y = initial ? r() * h : -30 - r() * h * 0.3; p.vy = (as === 'drizzle' ? 240 : 720) * (0.7 + p.z * 0.5) * (k.heavy ? 1.2 : 1); p.len = (as === 'drizzle' ? 6 : 16 + r() * 10) * p.z * (k.heavy ? 1.3 : 1); break;
      case 'petal': case 'maple': case 'ginkgo': case 'leaf':
        p.x = r() * w * 1.2 - w * 0.1; p.y = initial ? r() * h : -20 - r() * 60;
        if (!initial && r() < 0.35 && as === 'petal') { p.x = this.branch.rootX + r() * w * 0.6; p.y = this.branch.rootY + (r() - 0.5) * h * 0.08; }
        p.size = (as === 'petal' ? 5 : 8) * (0.7 + r() * 0.6) * p.z * (this.unit / 390) * 1.25; p.vy = (as === 'petal' ? 22 : 34) * (0.6 + r() * 0.6) * (0.5 + p.z * 0.5); p.vph = 0.4 + r() * 0.9; break;
      case 'fluff': p.x = r() * w; p.y = initial ? H * 0.3 + r() * (h - H * 0.3) : h + 10; p.size = (5 + r() * 5) * p.z; p.vy = -(10 + r() * 12); p.vph = 0.3 + r() * 0.4; break;
      case 'firefly': p.x = r() * w; p.y = H + r() * (h - H) * 0.8 - h * 0.08 * r(); p.size = 2.2 + r() * 1.6; p.vx = 0; p.vy = 0; p.vph = 0.25 + r() * 0.5; break;
      case 'butterfly': case 'dragonfly': p.x = r() * w; p.y = H * (0.55 + r() * 0.4) + (h - H) * r() * 0.3; p.size = (as === 'butterfly' ? 9 : 11) * (0.7 + p.z * 0.6) * (this.unit / 390); p.vx = (r() - 0.5) * 40; p.vy = 0; p.vph = as === 'butterfly' ? 5 + r() * 3 : 18; p.tx = r() * w; p.ty = p.y; break;
      case 'swallow': p.dir = r() < 0.5 ? 1 : -1; p.x = p.dir > 0 ? -40 - r() * w : w + 40 + r() * w; p.y = H * (0.25 + r() * 0.55); p.size = 13 * (0.7 + p.z * 0.6) * (this.unit / 390); p.vx = p.dir * (180 + r() * 120); p.vy = 0; p.vph = 3; p.amp = 30 + r() * 60; p.base = p.y; break;
      case 'dew': case 'frost': p.x = r() * w; p.y = this.banks.base - r() * h * 0.07 + (r() < 0.5 ? 0 : -r() * 10); p.size = 1 + r() * 2.2; p.vph = 0.5 + r(); break;
      case 'streak': p.x = -r() * w; p.y = r() * h * 0.95; p.len = 30 + r() * 90; p.vx = 380 + r() * 300; break;
    }
    if (p.vx == null) p.vx = 0;
    return p;
  };

  P._manageParticles = function (dt) {
    var W = this.B.weather, counts = {}, parts = this.parts, q = this.quality * (this.reduced ? 0.35 : 1);
    for (var i = 0; i < parts.length; i++) { var p = parts[i]; if (!p.dying) counts[p.tag] = (counts[p.tag] || 0) + 1; }
    for (var tag in KINDS) {
      var k = KINDS[tag], target = Math.round((W[tag] || 0) * k.n * q), have = counts[tag] || 0;
      if (have < target) {
        var add = this._prewarm ? target - have : Math.min(target - have, Math.max(1, Math.ceil(target * dt * 2)), 8);
        for (var j = 0; j < add; j++) { var np = this._spawn(tag, k, true); np.a = this._prewarm ? 1 : 0; parts.push(np); }
      } else if (have > target) {
        var kill = have - target;
        for (var m = 0; m < parts.length && kill > 0; m++) if (parts[m].tag === tag && !parts[m].dying) { parts[m].dying = true; kill--; }
      }
    }
  };

  P.update = function (dt) {
    dt = clamp(dt, 0, 0.05);
    this.t += dt;
    var w = this.w, h = this.h, H = this.horizon, W = this.B.weather, t = this.t;
    var windBase = 6 + (W.wind || 0) * 150 + (this.B.temp < -0.3 ? 14 : 0) + (W['rain-heavy'] || 0) * 60;
    var wind = windBase + Math.sin(t * 0.27) * 10 + Math.sin(t * 0.71) * 6;
    this.wind = wind;
    var g = this.gust; g.v *= Math.pow(0.04, dt); g.x *= Math.pow(0.1, dt); g.y *= Math.pow(0.1, dt);
    this._manageParticles(dt);
    var parts = this.parts, out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.a = p.dying ? p.a - dt * 1.6 : Math.min(1, p.a + dt * 1.2);
      if (p.a <= 0 && p.dying) continue;
      // 指でかき混ぜる風
      var dx = p.x - g.px, dy = p.y - g.py, d2 = dx * dx + dy * dy, R = 150;
      var push = d2 < R * R ? (1 - Math.sqrt(d2) / R) * g.v : 0;
      var alive = true;
      switch (p.as) {
        case 'snow':
          p.x += (wind * 0.5 * p.z + Math.sin(t * 0.8 + p.seed) * 14 * p.z + p.vx) * dt; p.y += p.vy * dt;
          if (push) { p.vx += g.x * push * 0.9 * dt * 60; } p.vx *= Math.pow(0.3, dt);
          if (p.y > h + 10) { if (p.dying) alive = false; else { p.y = -10; p.x = Math.random() * w * 1.2 - w * 0.1; } }
          break;
        case 'rain': case 'drizzle':
          p.x += (wind * 1.5 + p.vx) * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.2, dt); if (push) p.vx += g.x * push * 0.5;
          var floorY = H + (h - H) * (0.05 + (p.seed % 100) / 100 * 0.9);
          if (p.y > floorY) {
            if (p.as === 'rain' && Math.random() < 0.5 && this.rings.length < 80) this.rings.push({ x: p.x, y: p.y, r: 0, life: 0, max: 6 + Math.random() * 10, sp: 26 });
            if (p.dying) alive = false; else { p.y = -20 - Math.random() * 100; p.x = Math.random() * w * 1.3 - w * 0.15; }
          }
          break;
        case 'petal': case 'maple': case 'ginkgo': case 'leaf':
          p.ph = (p.ph + dt * p.vph) % 1; p.rot += p.vr * dt;
          p.x += (wind * 0.8 + Math.sin(t * 0.9 + p.seed) * 18 + p.vx) * dt; p.y += (p.vy + Math.sin(t * 1.7 + p.seed) * 8 + (p.vy2 || 0)) * dt;
          if (push) { p.vx += g.x * push * 1.4; p.vy2 = (p.vy2 || 0) + g.y * push * 0.6; p.vr += (Math.random() - 0.5) * push * 4; }
          p.vx *= Math.pow(0.35, dt); if (p.vy2) p.vy2 *= Math.pow(0.3, dt);
          if (p.y > h + 20 || p.x > w + 60 || p.x < -80) { if (p.dying) alive = false; else { var np = this._spawn(p.tag, p.k, false); np.a = 1; parts[i] = p = np; } }
          break;
        case 'fluff':
          p.ph = (p.ph + dt * p.vph) % 1; p.x += (wind * 0.6 + Math.sin(t * 0.5 + p.seed) * 12 + p.vx) * dt; p.y += (p.vy + Math.sin(t + p.seed) * 6) * dt;
          if (push) p.vx += g.x * push * 1.2; p.vx *= Math.pow(0.4, dt);
          if (p.y < -20 || p.x > w + 30) { if (p.dying) alive = false; else { p.y = h + 10; p.x = Math.random() * w; } }
          break;
        case 'firefly':
          p.ph += dt * p.vph;
          var ax = Math.sin(t * 0.6 + p.seed) * 8, ay = Math.cos(t * 0.5 + p.seed * 1.3) * 6;
          if (g.v > 0.05 && d2 < 260 * 260) { ax -= dx * 0.3 * g.v; ay -= dy * 0.3 * g.v; }
          p.vx = (p.vx + ax * dt) * Math.pow(0.5, dt); p.vy = (p.vy + ay * dt) * Math.pow(0.5, dt);
          p.x += p.vx * dt * 6; p.y += p.vy * dt * 6;
          if (p.y < H - h * 0.2) p.vy += 4 * dt * 6; if (p.y > h - this.dialH * 0.3) p.vy -= 6 * dt * 6;
          if (p.x < -10) p.x = w + 8; if (p.x > w + 10) p.x = -8;
          break;
        case 'butterfly': case 'dragonfly':
          p.ph = (p.ph + dt * p.vph) % 1;
          if (Math.random() < dt * (p.as === 'dragonfly' ? 0.7 : 0.35)) { p.tx = Math.random() * w; p.ty = H * (0.5 + Math.random() * 0.45) + (h - H) * Math.random() * 0.3; }
          var k2 = p.as === 'dragonfly' ? 2.2 : 0.9;
          p.vx += ((p.tx - p.x) * 0.5 - p.vx) * dt * k2 + (push ? g.x * push * 2 : 0); p.vy += ((p.ty - p.y) * 0.5 - p.vy) * dt * k2 + Math.sin(t * 3 + p.seed) * (p.as === 'butterfly' ? 50 : 4) * dt + (push ? g.y * push * 2 : 0);
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.dying && p.a <= 0) alive = false;
          break;
        case 'swallow':
          p.ph = (p.ph + dt * p.vph) % 1; p.x += p.vx * dt; p.y = p.base + Math.sin(p.x / w * 5 + p.seed) * p.amp;
          if ((p.vx > 0 && p.x > w + 60) || (p.vx < 0 && p.x < -60)) { if (p.dying) alive = false; else { var ns = this._spawn(p.tag, p.k, false); ns.a = 1; parts[i] = p = ns; } }
          break;
        case 'dew': case 'frost': p.ph += dt * p.vph; break;
        case 'streak': p.x += (p.vx + wind) * dt; if (p.x > w + 100) { if (p.dying) alive = false; else { p.x = -p.len - Math.random() * w * 0.5; p.y = Math.random() * h * 0.95; } } break;
      }
      if (alive) out.push(p);
    }
    this.parts = out;
    // 水の輪
    var rings = this.rings, nr = [];
    for (var j = 0; j < rings.length; j++) { var rg = rings[j]; rg.life += dt; rg.r += rg.sp * dt; if (rg.r < rg.max) nr.push(rg); }
    this.rings = nr;
    // 魚
    if ((W.fish || 0) > 0.05 && this.fishes.length < 2 && Math.random() < dt * 0.35 * W.fish) {
      this.fishes.push({ x: this.w * (0.15 + Math.random() * 0.7), y: H + (h - H - this.dialH) * (0.25 + Math.random() * 0.5), t: 0, dur: 0.9 + Math.random() * 0.4, dir: Math.random() < 0.5 ? -1 : 1, s: this.unit * 0.045 * (0.7 + Math.random() * 0.5) });
    }
    var nf = [];
    for (var f = 0; f < this.fishes.length; f++) {
      var fi = this.fishes[f]; fi.t += dt;
      if (fi.t < fi.dur) nf.push(fi);
      else for (var rr = 0; rr < 3; rr++) this.rings.push({ x: fi.x + fi.dir * fi.s * 1.6, y: fi.y, r: rr * 4, life: 0, max: 22 + rr * 8, sp: 30 });
    }
    this.fishes = nf;
    // 雷
    var lt = (W.lightning || 0);
    if (lt > 0.1 && !this._static) {
      this.nextBolt -= dt * lt;
      if (this.nextBolt <= 0) { this._bolt(); this.nextBolt = 4 + Math.random() * 9; }
    }
    this.flash = Math.max(0, this.flash - dt * 2.8);
    var nb = []; for (var b = 0; b < this.bolts.length; b++) { this.bolts[b].life -= dt; if (this.bolts[b].life > 0) nb.push(this.bolts[b]); } this.bolts = nb;
    // 雁の列
    var gw = W.geese || 0;
    if (this.geese) { this.geese.x += this.geese.v * dt; if (this.geese.x > this.w + 300 || this.geese.x < -300) this.geese = null; }
    else if (gw > 0.1) { this.nextGeese -= dt * gw; if (this.nextGeese <= 0) { var dir = Math.random() < 0.5 ? 1 : -1; this.geese = { x: dir > 0 ? -220 : this.w + 220, y: H * (0.18 + Math.random() * 0.25), v: dir * (34 + Math.random() * 16), n: 7 + (Math.random() * 5 | 0), ph: Math.random() }; this.nextGeese = 14 + Math.random() * 16; } }
    // 枝の小鳥
    this._updateBirds(dt);
  };

  P._updateBirds = function (dt) {
    var want = (this.B.weather.birds || 0) > 0.35 ? (this.B.weather.birds > 0.8 ? 2 : 1) : 0;
    var birds = this.birds, slots = this.branch.slots, self = this;
    while (birds.length < want) {
      var cand = slots.filter(function (s) { return s.top && s.d >= 1; }); if (!cand.length) cand = slots;
      var sl = cand[(Math.random() * cand.length) | 0];
      birds.push({ sl: sl, x: -40, y: sl.y - 60, state: 'in', t: 0, kind: ['sparrow', 'wagtail', 'warbler'][(Math.random() * 3) | 0], ph: 0, flip: Math.random() < 0.5 });
    }
    for (var i = 0; i < birds.length; i++) {
      var b = birds[i]; b.t += dt;
      if (birds.length > want && b.state === 'perch') { b.state = 'out'; b.t = 0; }
      if (b.state === 'in') { var k = Math.min(1, b.t / 1.4); var e = 1 - Math.pow(1 - k, 3); b.x = lerp(-40, b.sl.x, e); b.y = lerp(b.sl.y - 80, b.sl.y - 4, e) - Math.sin(k * Math.PI) * 30; b.ph = (b.ph + dt * 6) % 1; if (k >= 1) { b.state = 'perch'; b.t = 0; } }
      else if (b.state === 'perch') { b.x = b.sl.x; b.y = b.sl.y - 4; b.ph = 0.2 + 0.1 * Math.sin(b.t * 2); if (Math.random() < dt * 0.15) b.flip = !b.flip; }
      else if (b.state === 'out') { b.x += (b.flip ? -1 : 1) * 260 * dt; b.y -= 140 * dt; b.ph = (b.ph + dt * 7) % 1; }
    }
    this.birds = birds.filter(function (b) { return !(b.state === 'out' && (b.y < -60 || b.x < -80 || b.x > self.w + 80)); });
  };

  P._bolt = function () {
    var x = this.w * (0.15 + Math.random() * 0.7), y = this.h * 0.02, pts = [[x, y]], end = this.horizon - this.h * (0.08 + Math.random() * 0.06);
    while (y < end) { x += (Math.random() - 0.5) * this.w * 0.08; y += this.h * (0.02 + Math.random() * 0.035); pts.push([x, Math.min(y, end)]); }
    this.bolts.push({ pts: pts, life: 0.32, max: 0.32 });
    this.flash = this.reduced ? 0.15 : 0.7;
    if (this.onThunder) this.onThunder(0.5 + Math.random() * 0.5);
  };

  // ---------- 指の動き ----------
  P.stir = function (x, y, vx, vy) {
    var g = this.gust, sp = Math.hypot(vx, vy);
    g.px = x; g.py = y; g.x = lerp(g.x, vx, 0.5); g.y = lerp(g.y, vy, 0.5); g.v = clamp(Math.max(g.v, sp / 900), 0, 1.2);
  };
  P.tap = function (x, y) {
    // 小鳥に触れると飛び立つ
    for (var i = 0; i < this.birds.length; i++) { var b = this.birds[i]; if (b.state === 'perch' && Math.hypot(b.x - x, b.y - y) < 40) { b.state = 'out'; b.t = 0; return 'bird'; } }
    if (y > this.horizon + 4) { for (var k = 0; k < 3; k++) this.rings.push({ x: x, y: y, r: k * 7, life: 0, max: 40 + k * 16, sp: 46, touch: true }); return 'water'; }
    this.gust.px = x; this.gust.py = y; this.gust.v = 1; this.gust.x = (Math.random() - 0.5) * 300; this.gust.y = -200;
    return 'air';
  };

  // ---------- 描画 ----------
  P.render = function () {
    var c = this.ctx, w = this.w, h = this.h, H = this.horizon, dpr = this.dpr, t = this.t, L = this.L, W = this.B.weather, B = this.B, pal = this.pal, self = this;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    var tx = this.tilt.x, ty = this.tilt.y;
    function px(z) { return tx * z * 18; }

    // 空
    var sc = this.skyColors();
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(sc.top)); g.addColorStop(0.62, rgb(sc.mid)); g.addColorStop(1, rgb(sc.bot));
    c.fillStyle = g; c.fillRect(0, 0, w, H + 2);
    this.info = { skyTop: sc.top, skyBot: sc.bot, lumTop: lum(sc.top) };

    // 星・天の川
    var starA = L.night * (1 - L.ov * 0.9) * (1 + (W.clear || 0) * 0.3);
    if (starA > 0.02) {
      var milkyW = sstep(26, 31, this.s) * (1 - sstep(44, 49, this.s));
      if (milkyW > 0.01) { c.globalAlpha = starA * milkyW * 0.9 * (1 - L.moonUp * 0.7); c.globalCompositeOperation = 'lighter'; c.drawImage(this.milky, 0, 0, w, H); c.globalCompositeOperation = 'source-over'; }
      c.fillStyle = '#fffaf0';
      for (var i = 0; i < this.stars.length; i++) {
        var st = this.stars[i], tw = 0.55 + 0.45 * Math.sin(t * st.sp + st.p);
        c.globalAlpha = clamp(starA * tw * (st.y / H < 0.85 ? 1 : 0.4) * (1 - L.moonUp * 0.35), 0, 1);
        c.fillRect(st.x + px(0.05), st.y, st.s, st.s);
      }
      c.globalAlpha = 1;
    }

    // 虹
    if ((W.rainbow || 0) > 0.02 && L.day > 0.3) {
      var sp0 = this.celestialPos(this.sky.sunAlt, this.sky.sunH);
      var rx = clamp(w - sp0.x, w * 0.2, w * 0.8), rr = Math.max(w, H) * 0.62;
      var cols = ['#c8463e', '#e2873a', '#e8c64a', '#7fae5a', '#4f8fbf', '#4b5fa6', '#7a5c9e'];
      c.save(); c.globalAlpha = 0.22 * W.rainbow * L.day * (1 - L.ov * 0.5); c.lineWidth = Math.max(3, w * 0.011);
      for (var ri = 0; ri < cols.length; ri++) { c.strokeStyle = cols[ri]; c.beginPath(); c.arc(rx, H + rr * 0.18, rr - ri * c.lineWidth, Math.PI * 1.05, Math.PI * 1.95); c.stroke(); }
      c.restore();
    }

    // 太陽
    var sk = this.sky;
    if (sk.sunAlt > -6) {
      var sp = this.celestialPos(sk.sunAlt, sk.sunH), sr = this.sunR, hi = sstep(-2, 18, sk.sunAlt);
      var core = mix([228, 64, 40], [255, 246, 222], hi), ovk = 1 - L.ov * 0.65;
      var gr = c.createRadialGradient(sp.x, sp.y, sr * 0.6, sp.x, sp.y, sr * (4 + 3 * (1 - hi)));
      gr.addColorStop(0, rgb(mix(core, [255, 220, 170], 0.3), 0.45 * ovk)); gr.addColorStop(1, rgb(core, 0));
      c.fillStyle = gr; c.fillRect(sp.x - sr * 8, sp.y - sr * 8, sr * 16, sr * 16);
      c.fillStyle = rgb(core, (0.35 + 0.65 * ovk)); c.beginPath(); c.arc(sp.x, sp.y, sr, 0, TAU); c.fill();
      this.sunPos = sp;
    } else this.sunPos = null;

    // 月
    if (sk.moonAlt > -5) {
      var mp = this.celestialPos(sk.moonAlt, sk.moonH), mr = this.sunR * 0.78, e = sk.moonElong * Math.PI / 180;
      var dayDim = 1 - L.day * 0.55, ovm = 1 - L.ov * 0.7;
      var mg = c.createRadialGradient(mp.x, mp.y, mr * 0.8, mp.x, mp.y, mr * 5);
      mg.addColorStop(0, 'rgba(236,236,220,' + (0.28 * sk.moonIllum * (1 - L.day) * ovm).toFixed(3) + ')'); mg.addColorStop(1, 'rgba(236,236,220,0)');
      c.fillStyle = mg; c.fillRect(mp.x - mr * 5, mp.y - mr * 5, mr * 10, mr * 10);
      c.save(); c.translate(mp.x, mp.y);
      var toSun = this.sunPos ? Math.atan2(this.sunPos.y - mp.y, this.sunPos.x - mp.x) : (sk.moonElong < 180 ? 0.35 : Math.PI - 0.35);
      if (!this.sunPos) { var spp = this.celestialPos(sk.sunAlt, sk.sunH); toSun = Math.atan2(spp.y - mp.y, spp.x - mp.x); }
      c.rotate(toSun);
      c.fillStyle = rgb(mix([40, 52, 86], sc.top, 0.4), 0.55 * dayDim * ovm); c.beginPath(); c.arc(0, 0, mr, 0, TAU); c.fill();
      var kx = Math.cos(e);
      c.fillStyle = rgb(L.day > 0.5 ? [250, 250, 246] : [250, 244, 222], dayDim * ovm);
      c.beginPath(); c.arc(0, 0, mr, -Math.PI / 2, Math.PI / 2, false);
      c.ellipse(0, 0, Math.max(0.01, mr * Math.abs(kx)), mr, 0, Math.PI / 2, -Math.PI / 2, kx > 0);
      c.fill();
      c.restore();
      this.moonPos = mp;
    } else this.moonPos = null;

    // 金霞（空）
    this._bands('sky', px);

    // 山
    var haze = (W.haze || 0), mist = (W.mist || 0), heat = W.heat || 0;
    var fogTo = mix(sc.bot, [255, 255, 255], 0.2);
    var mt = [
      mix(mix(pal.far, sc.bot, 0.18 + haze * 0.4 + mist * 0.45 + heat * 0.25), pal.mist, 0.05),
      mix(pal.mid, sc.bot, haze * 0.22 + mist * 0.38 + heat * 0.1),
      mix(pal.near, sc.bot, mist * 0.25)
    ];
    var snowK = snowAmount(this.s);
    for (var li = 0; li < 3; li++) {
      var m = this.mtn[li], col = this.lit(mt[li]);
      var ms = this._mtnLayer(li, col, this.lit(fogTo), snowK, mist, sc, pal);
      c.drawImage(ms.c, ms.x + px(m.z), ms.y, ms.w, ms.h);
      if (li === 0) {
        this._bands('far', px);
        if (haze + mist > 0.05) { this._fog(c, H - h * 0.11, h * 0.07, (haze * 0.5 + mist * 0.7), sc); }
      }
    }

    // 水
    this._water(c, sc, px);
    this._bands('shore', px);
    this._bands('water', px);
    if (mist > 0.05) this._fog(c, H + h * 0.02, h * 0.06, mist * 0.6, sc);

    // 前景の土手と草花（下の帯だけを別に描き、夜・夕・曇りの色を重ねる）
    var wc = this.wctx, fgTop = this.fgTop;
    wc.setTransform(1, 0, 0, 1, 0, 0); wc.clearRect(0, 0, this.world.width, this.world.height);
    wc.setTransform(dpr, 0, 0, dpr, 0, -fgTop * dpr);
    this._banks(wc, px);
    this._flora(wc, px);
    wc.setTransform(1, 0, 0, 1, 0, 0);
    wc.globalCompositeOperation = 'source-atop';
    if (this.tintO.a > 0.01) { wc.fillStyle = rgb(this.tintO.c, this.tintO.a); wc.fillRect(0, 0, this.world.width, this.world.height); }
    if (this.tintN.a > 0.01) { wc.fillStyle = rgb(this.tintN.c, this.tintN.a); wc.fillRect(0, 0, this.world.width, this.world.height); }
    if (this.tintD.a > 0.01) { wc.fillStyle = rgb(this.tintD.c, this.tintD.a); wc.fillRect(0, 0, this.world.width, this.world.height); }
    wc.globalCompositeOperation = 'source-over';
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(this.world, 0, Math.round(fgTop * dpr)); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 舞うもの・枝（スプライトに夜色を焼き込んである）
    this._tq = [this.tintN.c.map(Math.round).join(','), Math.round(this.tintN.a * 16), this.tintD.c.join(','), Math.round(this.tintD.a * 16), Math.round(this.tintO.a * 16)].join('/');
    this._drawParticles(c, 'back');
    this._drawBranch(c, px);
    this._drawBirds(c);
    this._drawParticles(c, 'front');

    // 光るもの
    this._drawParticles(c, 'glow');
    this._drawParticles(c, 'spark');
    if (heat > 0.05) { c.fillStyle = 'rgba(255,214,140,' + (heat * 0.08 * L.day).toFixed(3) + ')'; c.fillRect(0, 0, w, h); }
    if (this.bolts.length) {
      c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
      this.bolts.forEach(function (b) {
        var a = b.life / b.max, fl = a > 0.5 ? 1 : (Math.sin(b.life * 60) > 0 ? 0.8 : 0.3);
        c.strokeStyle = 'rgba(200,215,255,' + (0.35 * a * fl) + ')'; c.lineWidth = 7;
        c.beginPath(); b.pts.forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,' + (0.95 * a * fl) + ')'; c.lineWidth = 1.6; c.stroke();
      });
      c.restore();
    }
    if (this.flash > 0.01) { c.fillStyle = 'rgba(235,240,255,' + (this.flash * 0.35).toFixed(3) + ')'; c.fillRect(0, 0, w, h); }
  };

  // 山の層を取り置きの絵にする（色・季節が変わったときだけ描き直す）
  P._mtnLayer = function (li, col, fog, snowK, mist, sc, pal) {
    var m = this.mtn[li], H = this.horizon, w = this.w, dpr = this.dpr, self = this;
    var x0 = -0.12 * w, x1 = 1.12 * w + 8, top = Math.floor(m.top - 4), hh = Math.ceil(H + 6 - top);
    function q(c) { return (c[0] >> 2) + ',' + (c[1] >> 2) + ',' + (c[2] >> 2); }
    var key = [q(col), q(fog), q(pal.foliage), q(sc.bot), Math.round(snowK * 20), Math.round(this.s * 2), Math.round(mist * 10), Math.round(this.tintN.a * 20)].join('|');
    var cache = this._mc || (this._mc = []), e = cache[li];
    if (!e) e = cache[li] = { c: mk((x1 - x0) * dpr, hh * dpr), x: x0, y: top, w: x1 - x0, h: hh, key: '', at: -9 };
    if (e.key === key || (this.t - e.at < 0.12 && e.key)) return e;
    e.key = key; e.at = this.t;
    var x = e.c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, e.c.width, e.c.height);
    x.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -top * dpr);
    var g = x.createLinearGradient(0, m.top, 0, H);
    g.addColorStop(0, rgb(mix(col, [0, 0, 0], li === 0 ? 0.04 : 0.1)));
    g.addColorStop(0.55, rgb(col));
    g.addColorStop(1, rgb(mix(col, fog, li === 0 ? 0.55 : 0.45)));
    x.fillStyle = g; x.fill(m.path);
    if (li === 0 && snowK > 0.01) {
      x.globalAlpha = snowK * (0.9 - mist * 0.4);
      var sg = x.createLinearGradient(0, this.fuji.top, 0, this.fuji.top + (H - this.fuji.top) * 0.6);
      sg.addColorStop(0, rgb(this.lit([250, 251, 253]))); sg.addColorStop(1, rgb(this.lit([214, 222, 236])));
      x.save(); x.clip(m.path); x.fillStyle = sg; x.fill(this.fujiSnow); x.restore(); x.globalAlpha = 1;
    }
    if (li >= 1) {
      var fol = pal.foliage, trees = this.trees;
      var autumn = this.s > 47 && this.s < 58 ? 0.35 * sstep(47, 51, this.s) * (1 - sstep(55, 58, this.s)) : 0;
      for (var ti = 0; ti < trees.length; ti++) {
        var tr = trees[ti]; if (tr.L !== li) continue;
        var tc = mix(col, this.lit(mix(fol, li === 1 ? sc.bot : col, li === 1 ? 0.15 + mist * 0.4 : 0.25)), 0.45 + tr.v * 0.45);
        if (autumn) tc = mix(tc, this.lit(tr.k < 0.5 ? [214, 160, 50] : [180, 60, 40]), autumn);
        x.fillStyle = rgb(tc, 0.85);
        x.beginPath(); x.ellipse(tr.x, tr.y, tr.r * 1.25, tr.r, 0, 0, TAU); x.fill();
      }
    }
    if (li === 2) this._pines(x, col, snowK);
    return e;
  };

  P._bands = function (layer, px) {
    var c = this.ctx, L = this.L, t = this.t, dpr = this.dpr, self = this, B = this.B;
    var silverK = clamp(L.night * 0.85 + (1 - L.day) * 0.2, 0, 1);
    var veil = 1 - clamp(L.ov * 0.35 + (B.weather.mist || 0) * 0.25, 0, 0.6);
    this.bands.forEach(function (b) {
      if (b.layer !== layer) return;
      var dx = Math.sin(t * 0.05 + b.phase) * 14 + px(b.z) * 1.4, dy = Math.sin(t * 0.07 + b.phase * 2) * 2;
      c.save(); c.translate(dx, dy);
      c.globalAlpha = veil;
      if (silverK < 0.98) c.drawImage(b.gold, b.bx, b.by, b.bw, b.bh);
      if (silverK > 0.02) { c.globalAlpha = veil * silverK; c.drawImage(b.silver, b.bx, b.by, b.bw, b.bh); }
      c.globalAlpha = 1;
      // 光の照り（指や傾きで動く）
      c.clip(b.path);
      var shx = (0.5 + self.tilt.x * 0.9) * self.w + Math.sin(t * 0.12 + b.phase) * self.w * 0.35;
      var gw = self.w * 0.22, gg = c.createLinearGradient(shx - gw, b.by, shx + gw, b.by + b.bh);
      var shine = 0.32 * (1 - L.night * 0.6) * veil;
      gg.addColorStop(0, 'rgba(255,248,220,0)'); gg.addColorStop(0.5, 'rgba(255,248,220,' + shine.toFixed(3) + ')'); gg.addColorStop(1, 'rgba(255,248,220,0)');
      c.globalCompositeOperation = 'lighter'; c.fillStyle = gg; c.fillRect(b.bx, b.by, b.bw, b.bh);
      c.globalCompositeOperation = 'source-over';
      // 夜・夕の色
      var tn = self.tintN, td = self.tintD;
      if (tn.a > 0.01) { c.fillStyle = rgb(tn.c, tn.a * (0.42 - 0.12 * L.moonUp)); c.fillRect(b.bx, b.by, b.bw, b.bh); }
      if (td.a > 0.01) { c.fillStyle = rgb(td.c, td.a * 0.8); c.fillRect(b.bx, b.by, b.bw, b.bh); }
      c.restore();
    });
  };

  P._fog = function (c, y, th, a, sc) {
    var t = this.t, w = this.w;
    var col = this.lit(mix(sc.bot, [255, 255, 255], 0.35));
    for (var i = 0; i < 3; i++) {
      var yy = y + (i - 1) * th * 0.5, x = ((t * (6 + i * 3) + i * w * 0.4) % (w * 1.6)) - w * 0.3;
      var g = c.createRadialGradient(x, yy, 0, x, yy, w * 0.7);
      g.addColorStop(0, rgb(col, a * 0.55)); g.addColorStop(1, rgb(col, 0));
      c.save(); c.translate(x, yy); c.scale(1, th / (w * 0.7) * 1.6); c.translate(-x, -yy);
      c.fillStyle = g; c.fillRect(x - w * 0.7, yy - w * 0.7, w * 1.4, w * 1.4); c.restore();
    }
    var lg = c.createLinearGradient(0, y - th, 0, y + th);
    lg.addColorStop(0, rgb(col, 0)); lg.addColorStop(0.5, rgb(col, a * 0.5)); lg.addColorStop(1, rgb(col, 0));
    c.fillStyle = lg; c.fillRect(0, y - th, w, th * 2);
  };

  P._pines = function (c, col, snowK) {
    var dark = mix(col, [10, 20, 16], 0.35), self = this;
    this.pines.forEach(function (p) {
      c.save(); c.translate(p.x, p.y); c.rotate(p.lean * 0.3);
      c.strokeStyle = rgb(mix(dark, [40, 30, 24], 0.5)); c.lineWidth = Math.max(1, p.s * 0.07); c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(p.lean * p.s * 0.4, -p.s * 0.5, p.lean * p.s * 0.2, -p.s); c.stroke();
      var r = rng(p.seed);
      for (var k = 0; k < 4; k++) {
        var yy = -p.s * (0.45 + k * 0.2), xx = p.lean * p.s * 0.25 + (r() - 0.5) * p.s * 0.5, ww = p.s * (0.55 - k * 0.08) * (0.8 + r() * 0.4), hh = p.s * 0.12;
        c.fillStyle = rgb(dark); c.beginPath(); c.ellipse(xx, yy, ww, hh, 0, 0, TAU); c.fill();
        if (snowK > 0.3) { c.fillStyle = rgb(self.lit([244, 247, 250]), (snowK - 0.3) * 1.2); c.beginPath(); c.ellipse(xx, yy - hh * 0.4, ww * 0.8, hh * 0.45, 0, Math.PI, TAU); c.fill(); }
      }
      c.restore();
    });
  };

  P._water = function (c, sc, px) {
    var w = this.w, h = this.h, H = this.horizon, pal = this.pal, B = this.B, t = this.t, L = this.L, Wt = B.water;
    var top = this.lit(mix(sc.bot, pal.water, 0.45)), bot = this.lit(pal.deep);
    var wb = this._waterBase(top, bot, pal);
    c.drawImage(wb.c, 0, H, w, wb.h);
    c.save(); c.beginPath(); c.rect(0, H, w, h - H); c.clip();
    // 太陽・月の光の道
    var src = this.sunPos && this.sky.sunAlt > 0 ? { p: this.sunPos, c: mix([255, 120, 70], [255, 250, 230], sstep(0, 20, this.sky.sunAlt)), a: 0.5 * (1 - L.ov * 0.8) } :
      (this.moonPos && this.sky.moonAlt > 0 ? { p: this.moonPos, c: [250, 244, 220], a: 0.55 * this.sky.moonIllum * (1 - L.day) * (1 - L.ov * 0.8) } : null);
    if (src && src.a > 0.02) {
      var n = 26;
      for (var i = 0; i < n; i++) {
        var d = i / n, yy = H + 3 + Math.pow(d, 1.3) * (h - H) * 0.9;
        var wd = (this.sunR * (0.5 + d * 1.6)) * (0.6 + 0.4 * Math.sin(t * 2.2 + i * 1.7));
        c.fillStyle = rgb(src.c, src.a * (1 - d) * (0.5 + 0.5 * Math.sin(t * 3 + i)));
        c.fillRect(src.p.x - wd / 2 + Math.sin(t + i) * 3, yy, wd, 1.5 + d * 2);
      }
    }
    // 波線
    var wl = this.lit(mix(pal.water, [255, 255, 255], 0.55)), calm = (Wt.calm || 0) + (Wt.mist || 0), flow = (Wt.flow || 0) + (Wt.ripple || 0) * 0.7;
    c.strokeStyle = rgb(wl, 0.38 * (1 - (Wt.ice || 0))); c.lineCap = 'round';
    for (var k = 0; k < this.wlines.length; k++) {
      var l = this.wlines[k], x = ((l.x + t * l.sp * (1 + flow * 2)) % (w * 1.2 + 60)) - 30;
      var a = 0.5 + 0.5 * Math.sin(t * 0.8 + l.p);
      c.globalAlpha = a * (1 - calm * 0.4); c.lineWidth = 0.6 + l.d * 1.4;
      c.beginPath(); c.moveTo(x, l.y); c.quadraticCurveTo(x + l.len / 2, l.y - 1.5 - l.d * 3 * (1 + flow), x + l.len, l.y); c.stroke();
    }
    c.globalAlpha = 1;
    // 輪
    for (var r = 0; r < this.rings.length; r++) {
      var rg = this.rings[r], ra = 1 - rg.r / rg.max;
      c.strokeStyle = rgb(wl, (rg.touch ? 0.7 : 0.45) * ra); c.lineWidth = rg.touch ? 1.4 : 0.9;
      if (rg.r > 0) { c.beginPath(); c.ellipse(rg.x, rg.y, rg.r, rg.r * 0.3, 0, 0, TAU); c.stroke(); }
    }
    // 蓮
    var lotusW = B.flora.lotus || 0;
    if (lotusW > 0.02) {
      var padF = motif('lotusPad'), lotF = motif('lotus');
      for (var pi = 0; pi < this.pads.length; pi++) {
        var pd = this.pads[pi]; if (pd.k > lotusW) continue;
        c.save(); c.translate(pd.x, pd.y); c.globalAlpha = sstep(pd.k, pd.k + 0.2, lotusW);
        try { padF(c, pd.s, { seed: pd.seed }); if (pd.flower) { c.translate(pd.s * 0.1, -pd.s * 0.15); lotF(c, pd.s * 1.1, { open: clamp(lotusW * 1.2 - 0.1, 0, 1), seed: pd.seed }); } } catch (e) { }
        c.restore();
      }
      c.globalAlpha = 1;
    }
    // 魚
    var fishF = motif('fish');
    for (var f = 0; f < this.fishes.length; f++) {
      var fi = this.fishes[f], k2 = fi.t / fi.dur, fx = fi.x + fi.dir * (k2 - 0.5) * fi.s * 3, fy = fi.y - Math.sin(k2 * Math.PI) * fi.s * 2.2;
      c.save(); c.translate(fx, fy); c.scale(fi.dir, 1); c.rotate((k2 - 0.5) * 1.6);
      try { fishF(c, fi.s, { phase: k2, color: rgb(this.lit([190, 120, 110])) }); } catch (e) { }
      c.restore();
    }
    // 氷
    var ice = (Wt.ice || 0), thin = (Wt['thin-ice'] || 0);
    if (ice > 0.01) {
      var ig = c.createLinearGradient(0, H, 0, h);
      ig.addColorStop(0, rgb(this.lit([236, 242, 246]), 0.85 * ice)); ig.addColorStop(1, rgb(this.lit([196, 212, 226]), 0.8 * ice));
      c.fillStyle = ig; c.fillRect(0, H, w, h - H);
      c.strokeStyle = rgb(this.lit([150, 172, 196]), 0.55 * ice); c.lineWidth = 0.8; c.stroke(this.cracks);
      c.strokeStyle = rgb([255, 255, 255], 0.5 * ice); c.lineWidth = 0.5; c.save(); c.translate(0.8, 0.8); c.stroke(this.cracks); c.restore();
    }
    if (thin > 0.01) {
      c.fillStyle = rgb(this.lit([232, 240, 246]), 0.75 * thin);
      c.strokeStyle = rgb(this.lit([255, 255, 255]), 0.6 * thin); c.lineWidth = 0.8;
      for (var fl = 0; fl < this.floes.length; fl++) { c.fill(this.floes[fl]); c.stroke(this.floes[fl]); }
    }
    c.restore();
    // 岸辺の線
    c.fillStyle = rgb(this.lit(mix(pal.near, pal.ground, 0.5)), 0.9);
    c.fillRect(0, H - 1, w, 2);
  };

  // 水面の地と山の映り込み（取り置き）
  P._waterBase = function (top, bot, pal) {
    var w = this.w, h = this.h, H = this.horizon, dpr = this.dpr;
    function q(c) { return (c[0] >> 2) + ',' + (c[1] >> 2) + ',' + (c[2] >> 2); }
    var r0 = this.lit(mix(pal.mid, pal.deep, 0.3)), r1 = this.lit(mix(pal.far, pal.deep, 0.3));
    var key = [q(top), q(bot), q(r0), q(r1)].join('|');
    var e = this._wc;
    if (!e) e = this._wc = { c: mk(w * dpr, (h - H) * dpr), h: h - H, key: '', at: -9 };
    if (e.key === key || (this.t - e.at < 0.12 && e.key)) return e;
    e.key = key; e.at = this.t;
    var x = e.c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, -H * dpr);
    var g = x.createLinearGradient(0, H, 0, h);
    g.addColorStop(0, rgb(top)); g.addColorStop(0.45, rgb(mix(top, bot, 0.6))); g.addColorStop(1, rgb(bot));
    x.fillStyle = g; x.fillRect(0, H, w, h - H);
    for (var li = 1; li >= 0; li--) {
      var m = this.mtn[li];
      x.save(); x.translate(0, H * (1 + 0.55)); x.scale(1, -0.55); x.translate(0, -H);
      x.globalAlpha = 0.16 + li * 0.05; x.fillStyle = rgb(li ? r0 : r1); x.fill(m.path);
      x.restore();
    }
    x.globalAlpha = 1;
    return e;
  };

  P._banks = function (c, px) {
    var b = this.banks, pal = this.pal, snow = this.B.snow, col = mix(pal.ground, [36, 40, 30], 0.35);
    if (snow > 0.05) col = mix(col, [236, 240, 246], clamp(snow * 1.1, 0, 0.92));
    c.save(); c.translate(px(0.9), 0);
    var g = c.createLinearGradient(0, b.base - b.lh * 1.3, 0, this.h);
    g.addColorStop(0, rgb(col)); g.addColorStop(1, rgb(mix(col, [18, 18, 16], 0.55)));
    c.fillStyle = g; c.fill(b.left); c.fill(b.right);
    c.restore();
  };

  var PLANTS = {
    'grass-young': { f: 'grass', h: 0.06, o: { tone: 'young' }, n: 4 }, grass: { f: 'grass', h: 0.08, o: { tone: 'green' }, n: 4 },
    'grass-dry': { f: 'grass', h: 0.07, o: { tone: 'dry' }, n: 4 }, 'frost-grass': { f: 'grass', h: 0.065, o: { tone: 'frost' }, n: 4 },
    reeds: { f: 'reeds', h: 0.24, n: 3 }, seri: { f: 'seri', h: 0.06, n: 3 }, fuki: { f: 'fuki', h: 0.05, n: 3 },
    iris: { f: 'iris', h: 0.2, n: 3 }, peony: { f: 'peonyPlant', h: 0.13, n: 2 }, 'bamboo-shoot': { f: 'bambooShoot', h: 0.1, n: 3 },
    wheat: { f: 'wheat', h: 0.22, n: 4 }, rice: { f: 'rice', h: 0.18, n: 4 }, safflower: { f: 'safflower', h: 0.17, n: 3 },
    susuki: { f: 'susuki', h: 0.27, n: 3 }, chrysanthemum: { f: 'chrysanthemum', h: 0.12, n: 3, head: true }, narcissus: { f: 'narcissus', h: 0.15, n: 3 },
    cotton: { f: 'cotton', h: 0.17, n: 3 }, utsubogusa: { f: 'utsubogusa', h: 0.09, n: 3 }
  };

  P._flora = function (c, px) {
    var fl = this.B.flora, slots = this.floraSlots, t = this.t, h = this.h, self = this, idx = 0;
    var tags = Object.keys(fl).filter(function (k) { return PLANTS[k] && fl[k] > 0.02; });
    tags.sort();
    tags.forEach(function (tag, ti) {
      var spec = PLANTS[tag], wgt = fl[tag], fn = motif(spec.f);
      for (var i = 0; i < slots.length; i++) {
        var sl = slots[i];
        if (((i + ti * 3) % 8) >= spec.n * 2) continue;
        var vis = sstep(sl.k * 0.5, sl.k * 0.5 + 0.45, wgt); if (vis <= 0.01) continue;
        var hh = spec.h * h * (0.75 + sl.k * 0.5) * (0.55 + 0.45 * vis);
        var sway = Math.sin(t * 0.9 + i * 1.3) * 0.03 + self.wind * 0.0006 + clamp(self.gust.x * self.gust.v * 0.0004, -0.15, 0.15) * (Math.abs(self.gust.px - sl.x) < 160 ? 1 : 0);
        c.save(); c.translate(sl.x + px(0.9), sl.y); c.rotate(sway); c.globalAlpha = vis;
        var o = { seed: (i + 1) * 977 + ti * 131, phase: (t * 0.15 + i * 0.13) % 1 };
        for (var key in spec.o) o[key] = spec.o[key];
        if (tag === 'utsubogusa') o.withered = self.s > 25 && self.s < 31;
        try {
          if (spec.head) { c.strokeStyle = '#4f6b3a'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(hh * 0.1, -hh * 0.5, 0, -hh); c.stroke(); c.translate(0, -hh); fn(c, hh * 0.32, o); }
          else fn(c, hh, o);
        } catch (e) { }
        c.restore();
      }
    });
    c.globalAlpha = 1;
  };

  P._drawBranch = function (c, px) {
    var B = this.B, br = this.branch, now = this.t;
    var key = [Math.round(B.bloom * 20), Math.round(B.leaf * 20), Math.round(B.tone * 10), Math.round(B.snow * 10),
      JSON.stringify(B.blossom, function (k, v) { return typeof v === 'number' ? Math.round(v * 10) : v; }),
      JSON.stringify(B.fruit, function (k, v) { return typeof v === 'number' ? Math.round(v * 10) : v; }), this._tq].join('|');
    if (key !== this.branchKey && (now - this.branchAt > 0.09 || !this.branchKey)) { this._renderBranch(B); this.branchKey = key; this.branchAt = now; }
    var sway = Math.sin(now * 0.6) * 0.006 + Math.sin(now * 1.7) * 0.002 + this.wind * 0.00006 + clamp(this.gust.x * this.gust.v * 0.00002, -0.02, 0.02);
    c.save(); c.translate(br.rootX + px(0.8), br.rootY); c.rotate(sway); c.translate(-br.rootX, -br.rootY);
    c.drawImage(br.sprite, br.bx, br.by, br.bw, br.bh);
    c.restore();
    this._sway = sway;
  };

  P._drawBirds = function (c) {
    if (!this.birds.length) return;
    var fn = motif('smallBird');
    for (var i = 0; i < this.birds.length; i++) {
      var b = this.birds[i]; c.save(); c.translate(b.x, b.y); if (b.flip) c.scale(-1, 1);
      try { fn(c, this.unit * 0.05, { kind: b.kind, phase: b.state === 'perch' ? 0.25 : 0.5 + b.ph * 0.5, seed: 3 }); } catch (e) { }
      c.restore();
    }
  };

  // スプライト（粒子）
  P._sprite = function (as, kind, frame, size) {
    var key = as + kind + frame + '|' + size + '|' + this._tq, sp = this.sprites[key];
    if (sp) return sp;
    if (++this._spriteN > 600) { this.sprites = {}; this._spriteN = 0; }
    var dpr = this.dpr, S = Math.ceil(size * 2.6 + 4), cv = mk(S * dpr, S * dpr), x = cv.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, S * dpr / 2, S * dpr / 2);
    var ph = frame / 8, fname = { petal: 'petal', maple: 'mapleLeaf', ginkgo: 'ginkgoLeaf', leaf: 'leaf', snow: 'snowflake', fluff: 'fluff', firefly: 'firefly' }[as];
    var o = { phase: ph, seed: frame * 7 + 1 };
    if (as === 'petal') { o.kind = kind; }
    if (as === 'snow') { o.kind = kind === 'big' ? 'crystal' : 'soft'; }
    if (as === 'leaf') { o.color = ['#a0703a', '#8a5a2e', '#b08a4a', '#7a5a3a'][frame % 4]; }
    if (as === 'maple') { o.color = ['#c8402a', '#d8642a', '#b02a2a', '#e08a2a'][frame % 4]; }
    if (as === 'firefly') { o.glow = 1; }
    try { motif(fname)(x, size, o); } catch (e) { }
    this._tintCanvas(x, cv, as === 'snow' ? 0.45 : as === 'petal' || as === 'fluff' ? 0.7 : 1);
    sp = { c: cv, S: S }; this.sprites[key] = sp; return sp;
  };

  P._drawParticles = function (c, pass) {
    var parts = this.parts, dpr = this.dpr, t = this.t, L = this.L, self = this, w = this.w;
    if (pass === 'back' || pass === 'front') {
      // 雨
      var rainA = 0;
      c.save(); c.lineCap = 'round';
      c.beginPath();
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i]; if ((p.as !== 'rain' && p.as !== 'drizzle') || (pass === 'back') !== (p.z < 0.7)) continue;
        var ang = Math.atan2(p.vy, this.wind * 1.5 + p.vx), lx = Math.cos(ang) * p.len, ly = Math.sin(ang) * p.len;
        c.moveTo(p.x, p.y); c.lineTo(p.x - lx, p.y - ly); rainA = Math.max(rainA, p.a);
      }
      c.strokeStyle = rgb(mix([210, 222, 236], [160, 176, 200], 1 - L.day), (pass === 'back' ? 0.28 : 0.42) * rainA); c.lineWidth = pass === 'back' ? 0.7 : 1; c.stroke();
      c.restore();
      // 雪・花びら・葉
      for (var j = 0; j < parts.length; j++) {
        var q = parts[j], as = q.as;
        if (as !== 'snow' && as !== 'petal' && as !== 'maple' && as !== 'ginkgo' && as !== 'leaf' && as !== 'fluff' && as !== 'butterfly' && as !== 'dragonfly' && as !== 'swallow' && as !== 'streak') continue;
        if ((pass === 'back') !== (q.z < 0.72)) continue;
        if (as === 'streak') { c.strokeStyle = 'rgba(255,255,255,' + (0.18 * q.a) + ')'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x + q.len, q.y + q.len * 0.04); c.stroke(); continue; }
        if (as === 'butterfly' || as === 'dragonfly' || as === 'swallow') {
          c.save(); c.globalAlpha = q.a; c.translate(q.x, q.y);
          if (as === 'swallow' || as === 'dragonfly') { if (q.vx < 0) c.scale(-1, 1); c.rotate(as === 'swallow' ? Math.cos(q.x / w * 5 + q.seed) * 0.25 : clamp(q.vy * 0.004, -0.4, 0.4)); }
          try { motif(as)(c, q.size, { phase: q.ph, seed: q.seed % 9 }); } catch (e) { }
          c.restore(); continue;
        }
        var frame = (q.ph * 8) | 0, kind = as === 'petal' ? q.k.kind : (as === 'snow' && q.big ? 'big' : '');
        var sz = as === 'snow' ? (q.big ? 7 : Math.max(1.5, Math.round(q.size * 2) / 2)) : Math.max(3, Math.round(q.size));
        var sp = this._sprite(as, kind, as === 'snow' ? 0 : frame, sz), S = sp.S;
        var cs = Math.cos(q.rot), sn = Math.sin(q.rot);
        c.globalAlpha = q.a * (as === 'snow' ? 0.95 : 1);
        c.setTransform(cs * dpr, sn * dpr, -sn * dpr, cs * dpr, q.x * dpr, q.y * dpr);
        c.drawImage(sp.c, -S / 2, -S / 2, S, S);
      }
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalAlpha = 1;
      // 雁
      if (pass === 'back' && this.geese) {
        var G = this.geese, gf = motif('goose'), gs = this.unit * 0.032;
        for (var n = 0; n < G.n; n++) {
          var row = Math.ceil(n / 2), side = n % 2 ? 1 : -1, gx = G.x - Math.sign(G.v) * row * gs * 2.1, gy = G.y + side * row * gs * 1.3;
          c.save(); c.translate(gx, gy + Math.sin(t * 2 + n) * 2); if (G.v < 0) c.scale(-1, 1);
          try { gf(c, gs, { phase: (t * 1.6 + n * 0.17) % 1 }); } catch (e) { }
          c.restore();
        }
      }
    } else if (pass === 'glow') {
      var vis = 1 - L.day * 0.85;
      if (vis < 0.03) return;
      c.save(); c.globalCompositeOperation = 'lighter';
      for (var k = 0; k < parts.length; k++) {
        var f = parts[k]; if (f.as !== 'firefly') continue;
        var bl = Math.pow(Math.max(0, Math.sin(f.ph * TAU)), 3);
        var r = f.size * 6, g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, 'rgba(230,255,150,' + (0.9 * bl * f.a * vis).toFixed(3) + ')'); g.addColorStop(0.2, 'rgba(190,240,110,' + (0.35 * bl * f.a * vis).toFixed(3) + ')'); g.addColorStop(1, 'rgba(160,220,90,0)');
        c.fillStyle = g; c.fillRect(f.x - r, f.y - r, r * 2, r * 2);
      }
      c.restore();
    } else if (pass === 'spark') {
      c.save(); c.globalCompositeOperation = 'lighter';
      var morning = this.L.morning ? 1 : 0.5;
      for (var m = 0; m < parts.length; m++) {
        var d = parts[m]; if (d.as !== 'dew' && d.as !== 'frost') continue;
        var tw = Math.pow(Math.max(0, Math.sin(d.ph * TAU)), 6), a = tw * d.a * (0.4 + 0.6 * morning) * (0.4 + 0.6 * L.day);
        if (a < 0.02) continue;
        var s2 = d.size * (1 + tw);
        c.fillStyle = d.as === 'frost' ? 'rgba(235,245,255,' + a + ')' : 'rgba(255,255,240,' + a + ')';
        c.fillRect(d.x - s2 * 2, d.y - 0.4, s2 * 4, 0.8); c.fillRect(d.x - 0.4, d.y - s2 * 2, 0.8, s2 * 4);
      }
      c.restore();
    }
  };

  // 粒子を前もって散らしておく（絵葉書用）
  P.prewarm = function (sec) {
    this._prewarm = true; this.update(0.016); this._prewarm = false;
    for (var i = 0; i < sec * 30; i++) this.update(1 / 30);
  };

  U.Scene = Scene;
  U.koBlend = koBlend;
  U.paletteAt = paletteAt;
  U.color = { hex: hex, mix: mix, rgb: rgb, lum: lum };
})();
