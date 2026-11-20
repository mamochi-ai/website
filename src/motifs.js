/*
 * motifs.js — うつろい暦 painted motif library
 * Rinpa / ukiyo-e inspired Canvas 2D motifs (flat colour fields, one bokashi, no outlines).
 *
 * Calling convention: M.name(ctx, s, opts)
 *   - particles / ornaments: centred on the origin, s = bounding radius (CSS px)
 *   - plants: base at the origin, growing toward -y, s = total height
 *   - flying creatures face +x (heading 0 rad); rotate by atan2(vy, vx) to steer.
 *   - opts.seed -> deterministic variation, opts.phase (0..1 cyclic) -> animation.
 * Every function saves/restores ctx state.
 */
(function () {
  'use strict';
  var U = window.UTSUROI = window.UTSUROI || {};
  var M = U.Motifs = {};

  var PI = Math.PI, TAU = PI * 2;
  var sin = Math.sin, cos = Math.cos, abs = Math.abs, sqrt = Math.sqrt;
  var mmin = Math.min, mmax = Math.max, floor = Math.floor, round = Math.round;

  /* ------------------------------------------------------------------ utils */
  function opt(o, k, d) { var v = o ? o[k] : undefined; return (v === undefined || v === null) ? d : v; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function frac(x) { return x - floor(x); }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function smooth(t) { return t * t * (3 - 2 * t); }

  // mulberry32 seeded PRNG
  function rng(seed) {
    var a = (floor((seed === undefined || seed === null ? 1 : +seed || 0) * 2654435761) ^ 0x6d2b79f5) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- colour helpers (hex / rgb / rgba; anything else passes through)
  var _pc = {}, _pcN = 0;
  function parseColor(c) {
    var r = _pc[c];
    if (r !== undefined) return r;
    r = null;
    if (typeof c === 'string') {
      var s = c.trim(), m;
      if (s.charAt(0) === '#') {
        var h = s.slice(1);
        if (h.length === 3 || h.length === 4) h = h.replace(/./g, '$&$&');
        if (h.length === 6 || h.length === 8) {
          r = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
            h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
          if (isNaN(r[0] + r[1] + r[2] + r[3])) r = null;
        }
      } else if ((m = /^rgba?\(([^)]*)\)$/i.exec(s))) {
        var p = m[1].split(/[\s,\/]+/).filter(Boolean);
        if (p.length >= 3) {
          r = [parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2]),
            p.length > 3 ? (p[3].indexOf('%') > 0 ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1];
          if (isNaN(r[0] + r[1] + r[2] + r[3])) r = null;
        }
      }
    }
    if (_pcN > 512) { _pc = {}; _pcN = 0; }
    _pc[c] = r; _pcN++;
    return r;
  }
  var _mc = {}, _mcN = 0;
  function mix(a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    var k = a + '|' + b + '|' + ((t * 200 + 0.5) | 0);
    var r = _mc[k];
    if (r) return r;
    var A = parseColor(a), B = parseColor(b);
    if (!A || !B) r = t < 0.5 ? a : b;
    else r = 'rgba(' + round(A[0] + (B[0] - A[0]) * t) + ',' + round(A[1] + (B[1] - A[1]) * t) + ',' +
      round(A[2] + (B[2] - A[2]) * t) + ',' + (+(A[3] + (B[3] - A[3]) * t).toFixed(3)) + ')';
    if (_mcN > 2048) { _mc = {}; _mcN = 0; }
    _mc[k] = r; _mcN++;
    return r;
  }
  function fade(c, a) {
    var A = parseColor(c);
    if (!A) return c;
    return 'rgba(' + A[0] + ',' + A[1] + ',' + A[2] + ',' + (+(A[3] * a).toFixed(3)) + ')';
  }
  var INK = '#1f1726';
  function dark(c, t) { return mix(c, INK, t); }
  function light(c, t) { return mix(c, '#ffffff', t); }

  // per-context gradient cache (gradients are built in unit space, so any size reuses them)
  var _gc = typeof WeakMap === 'function' ? new WeakMap() : null;
  function gcache(ctx, key, make) {
    if (!_gc) return make();
    var m = _gc.get(ctx);
    if (!m || m.n > 400) { m = { n: 0, g: {} }; _gc.set(ctx, m); }
    var g = m.g[key];
    if (!g) { g = m.g[key] = make(); m.n++; }
    return g;
  }
  function linGrad(ctx, x0, y0, x1, y1, stops) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (var i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    return g;
  }
  function radGrad(ctx, x, y, r0, r1, stops, fx, fy) {
    var g = ctx.createRadialGradient(fx === undefined ? x : fx, fy === undefined ? y : fy, r0, x, y, r1);
    for (var i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    return g;
  }

  // ---- path helpers
  function circ(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  function ell(ctx, x, y, rx, ry, rot) {
    rot = rot || 0;
    ctx.moveTo(x + rx * cos(rot), y + rx * sin(rot));
    ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  }

  // local transform for symmetric shapes: local (x, y) with the shape pointing toward -y
  var T_ox = 0, T_oy = 0, T_c = 1, T_s = 0, T_w = 1, T_l = 1;
  function setT(ox, oy, a, w, l) { T_ox = ox; T_oy = oy; T_c = cos(a); T_s = sin(a); T_w = w; T_l = l; }
  function tx(x, y) { return T_ox + x * T_w * T_c - y * T_l * T_s; }
  function ty(x, y) { return T_oy + x * T_w * T_s + y * T_l * T_c; }
  // half = [x0,y0, (c1x,c1y,c2x,c2y,px,py)*]; left half (x<=0) from base on the axis to tip on the axis
  function symPath(ctx, half) {
    var n = half.length, i;
    ctx.moveTo(tx(half[0], half[1]), ty(half[0], half[1]));
    for (i = 2; i < n; i += 6) {
      ctx.bezierCurveTo(tx(half[i], half[i + 1]), ty(half[i], half[i + 1]),
        tx(half[i + 2], half[i + 3]), ty(half[i + 2], half[i + 3]),
        tx(half[i + 4], half[i + 5]), ty(half[i + 4], half[i + 5]));
    }
    for (i = n - 6; i >= 2; i -= 6) {
      ctx.bezierCurveTo(tx(-half[i + 2], half[i + 3]), ty(-half[i + 2], half[i + 3]),
        tx(-half[i], half[i + 1]), ty(-half[i], half[i + 1]),
        tx(-half[i - 2], half[i - 1]), ty(-half[i - 2], half[i - 1]));
    }
    ctx.closePath();
  }
  // shape(ctx, half, ox, oy, angle, width, length)
  function shape(ctx, half, ox, oy, a, w, l) { setT(ox, oy, a, w, l); symPath(ctx, half); }

  // tapered blade along a quadratic curve
  function blade(ctx, x0, y0, cx, cy, x1, y1, w0, w1, k) {
    var dx0 = cx - x0, dy0 = cy - y0, l0 = sqrt(dx0 * dx0 + dy0 * dy0) || 1;
    var dx1 = x1 - cx, dy1 = y1 - cy, l1 = sqrt(dx1 * dx1 + dy1 * dy1) || 1;
    var n0x = -dy0 / l0, n0y = dx0 / l0, n1x = -dy1 / l1, n1y = dx1 / l1;
    var nmx = n0x + n1x, nmy = n0y + n1y, lm = sqrt(nmx * nmx + nmy * nmy) || 1;
    nmx /= lm; nmy /= lm;
    var h0 = w0 / 2, h1 = (w1 || 0) / 2;
    k = k === undefined ? 0.8 : k;
    var hm = k * h0 + (1 - k) * h1;
    ctx.moveTo(x0 + n0x * h0, y0 + n0y * h0);
    ctx.quadraticCurveTo(cx + nmx * hm, cy + nmy * hm, x1 + n1x * h1, y1 + n1y * h1);
    if (h1 > 0) ctx.lineTo(x1 - n1x * h1, y1 - n1y * h1);
    ctx.quadraticCurveTo(cx - nmx * hm, cy - nmy * hm, x0 - n0x * h0, y0 - n0y * h0);
    ctx.closePath();
  }
  // point / tangent on quadratic
  function qpt(x0, y0, cx, cy, x1, y1, t) {
    var u = 1 - t;
    return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1,
      2 * u * (cx - x0) + 2 * t * (x1 - cx), 2 * u * (cy - y0) + 2 * t * (y1 - cy)];
  }

  // palmate leaf: lobes = [[angle(rad, clockwise from up), length, halfWidthFrac], ...] ascending
  function palmate(ctx, cx, cy, lobes, sinusR, stemSinus) {
    var n = lobes.length, i;
    ctx.moveTo(cx, cy + stemSinus);
    for (i = 0; i < n; i++) {
      var a = lobes[i][0], L = lobes[i][1], hw = lobes[i][2] * L;
      var ux = sin(a), uy = -cos(a), vx = cos(a), vy = sin(a);
      ctx.bezierCurveTo(cx + ux * L * 0.36 - vx * hw, cy + uy * L * 0.36 - vy * hw,
        cx + ux * L * 0.8 - vx * hw * 0.42, cy + uy * L * 0.8 - vy * hw * 0.42,
        cx + ux * L, cy + uy * L);
      var sa, sr;
      if (i < n - 1) { sa = (a + lobes[i + 1][0]) / 2; sr = sinusR * mmin(L, lobes[i + 1][1]); }
      else { sa = PI; sr = stemSinus; }
      ctx.bezierCurveTo(cx + ux * L * 0.8 + vx * hw * 0.42, cy + uy * L * 0.8 + vy * hw * 0.42,
        cx + ux * L * 0.36 + vx * hw, cy + uy * L * 0.36 + vy * hw,
        cx + sin(sa) * sr, cy - cos(sa) * sr);
    }
    ctx.closePath();
  }
  function palmVeins(ctx, cx, cy, lobes, f) {
    for (var i = 0; i < lobes.length; i++) {
      var a = lobes[i][0], L = lobes[i][1] * f;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + sin(a) * L, cy - cos(a) * L);
    }
  }
  function lw(ctx, w, scale, minPx) {
    ctx.lineWidth = mmax(w, (minPx === undefined ? 0.6 : minPx) / scale);
  }

  // ---- shared shapes (left halves; base (0,0) -> tip (0,-1))
  var UME_H = [0, 0, -0.3, -0.02, -0.5, -0.3, -0.5, -0.56, -0.5, -0.84, -0.26, -1.0, 0, -1.0];
  var SAKURA_H = [0, 0, -0.18, -0.1, -0.44, -0.42, -0.46, -0.72, -0.47, -0.9, -0.34, -0.99, -0.14, -0.99,
    -0.08, -0.985, -0.03, -0.95, 0, -0.88];
  var MOMO_H = [0, 0, -0.22, -0.06, -0.44, -0.36, -0.4, -0.64, -0.36, -0.88, -0.12, -0.97, 0, -1.0];
  var TSUBAKI_H = [0, 0, -0.34, -0.04, -0.56, -0.4, -0.53, -0.7, -0.5, -0.95, -0.24, -1.02, 0, -0.99];
  var LEAF_H = [0, 0, -0.3, -0.1, -0.44, -0.42, -0.32, -0.68, -0.22, -0.84, -0.08, -0.93, 0, -1.0];
  var LANCE_H = [0, 0, -0.2, -0.12, -0.26, -0.5, -0.16, -0.75, -0.08, -0.9, -0.02, -0.97, 0, -1.0];
  var LOTUS_H = [0, 0, -0.24, -0.06, -0.5, -0.38, -0.46, -0.66, -0.42, -0.88, -0.14, -0.95, 0, -1.0];
  var STRAP_H = [0, 0, -0.5, -0.02, -0.5, -0.5, -0.5, -0.82, -0.48, -0.95, -0.2, -1.0, 0, -1.0];
  var CHRYS_H = [0, 0, -0.3, -0.2, -0.45, -0.55, -0.48, -0.8, -0.5, -0.97, -0.25, -1.0, 0, -0.98];
  var SERRATE_H = [0, 0, -0.3, -0.05, -0.46, -0.24, -0.44, -0.42, -0.38, -0.46, -0.34, -0.47, -0.32, -0.5,
    -0.38, -0.6, -0.32, -0.72, -0.22, -0.76, -0.18, -0.77, -0.16, -0.79, -0.15, -0.8,
    -0.15, -0.9, -0.06, -0.96, 0, -1.0];

  /* ============================================================ PARTICLES */

  // tumble: returns horizontal foreshortening (never 0) and whether the back is shown
  function tumble(ph) {
    var c = cos(ph * TAU), sx = abs(c);
    return { sx: sx < 0.07 ? 0.07 : sx, back: c < 0, sy: 0.93 + 0.07 * cos(ph * TAU * 2 + 0.7) };
  }

  var PETAL = {
    ume:     { half: UME_H,     w: 1.6,  col: '#fbf3f1', base: '#e2a7b3', tipL: 0.55 },
    sakura:  { half: SAKURA_H,  w: 1.22, col: '#f8d3dc', base: '#e5859f', tipL: 0.5 },
    momo:    { half: MOMO_H,    w: 1.2,  col: '#f08aa7', base: '#c63b6a', tipL: 0.32 },
    tsubaki: { half: TSUBAKI_H, w: 1.45, col: '#c8243c', base: '#6e0c22', tipL: 0.12 }
  };

  M.petal = function (ctx, s, o) {
    var kind = opt(o, 'kind', 'sakura'), P = PETAL[kind] || PETAL.sakura;
    var col = opt(o, 'color', P.col), tb = tumble(opt(o, 'phase', 0)), back = tb.back;
    ctx.save();
    ctx.scale(s * tb.sx, s * tb.sy);
    ctx.fillStyle = gcache(ctx, 'pe' + kind + col + back, function () {
      var b = mix(col, P.base, 0.6), t = light(col, P.tipL), m = col;
      if (back) { b = light(mix(b, col, 0.5), 0.2); m = light(col, 0.22); t = light(t, 0.2); }
      return linGrad(ctx, 0, 0.95, 0, -0.95, [0, b, 0.5, m, 1, t]);
    });
    ctx.beginPath();
    shape(ctx, P.half, 0, 0.95, 0, P.w, 1.9);
    ctx.fill();
    if (s >= 9 && kind !== 'ume') {
      ctx.beginPath();
      ctx.moveTo(0, 0.8);
      ctx.quadraticCurveTo(0.04, 0.1, 0, -0.4);
      ctx.strokeStyle = fade(mix(col, P.base, 0.8), back ? 0.18 : 0.3);
      ctx.lineWidth = 0.04;
      ctx.stroke();
    }
    ctx.restore();
  };

  // 紅葉 — iroha-momiji, seven lobes
  var MAPLE_C = [0, 0.12];
  var MAPLE_LOBES = [[-2.3, 0.46, 0.3], [-1.55, 0.8, 0.27], [-0.78, 0.98, 0.26], [0, 1.0, 0.26],
    [0.78, 0.98, 0.26], [1.55, 0.8, 0.27], [2.3, 0.46, 0.3]];
  M.mapleLeaf = function (ctx, s, o) {
    var col = opt(o, 'color', '#c8372a'), col2 = opt(o, 'color2', '#e9902e');
    var tb = tumble(opt(o, 'phase', 0)), back = tb.back;
    var cx = MAPLE_C[0], cy = MAPLE_C[1];
    ctx.save();
    ctx.scale(s * tb.sx, s * tb.sy);
    // petiole
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(0.02, 0.6, 0.1, 0.98);
    ctx.strokeStyle = dark(col, 0.25);
    ctx.lineWidth = 0.045;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.fillStyle = gcache(ctx, 'mp' + col + col2 + back, function () {
      var a = col2, b = col;
      if (back) { a = light(mix(col2, '#d9b48a', 0.25), 0.1); b = light(mix(col, '#d9b48a', 0.2), 0.08); }
      return radGrad(ctx, cx, cy, 0, 0.95, [0, a, 0.42, mix(a, b, 0.55), 0.78, b, 1, b]);
    });
    ctx.beginPath();
    palmate(ctx, cx, cy, MAPLE_LOBES, 0.36, 0.07);
    ctx.fill();
    if (s >= 7) {
      ctx.beginPath();
      palmVeins(ctx, cx, cy, MAPLE_LOBES, 0.84);
      ctx.strokeStyle = fade(dark(col, 0.35), back ? 0.25 : 0.42);
      ctx.lineWidth = 0.022;
      ctx.stroke();
    }
    ctx.restore();
  };

  // 銀杏 — fan leaf with central notch
  var GINKGO_H = [0, 0.38, -0.3, 0.13, -0.64, -0.08, -0.955, -0.26,
    -0.852, -0.414, -0.713, -0.54, -0.551, -0.629,
    -0.406, -0.708, -0.245, -0.755, -0.08, -0.767,
    -0.055, -0.7, -0.02, -0.6, 0, -0.5];
  M.ginkgoLeaf = function (ctx, s, o) {
    var col = opt(o, 'color', '#e8b526');
    var tb = tumble(opt(o, 'phase', 0)), back = tb.back;
    ctx.save();
    ctx.scale(s * tb.sx, s * tb.sy);
    ctx.beginPath();
    ctx.moveTo(0, 0.38);
    ctx.quadraticCurveTo(0.02, 0.7, 0.09, 0.97);
    ctx.strokeStyle = dark(col, 0.3);
    ctx.lineWidth = 0.045;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.fillStyle = gcache(ctx, 'gk' + col + back, function () {
      var c = back ? light(col, 0.2) : col;
      return radGrad(ctx, 0, 0.38, 0, 1.18, [0, mix(c, '#9aa23a', 0.4), 0.35, mix(c, '#c79a1c', 0.25), 0.75, c, 1, light(c, 0.18)]);
    });
    ctx.beginPath();
    setT(0, 0, 0, 1, 1);
    symPath(ctx, GINKGO_H);
    ctx.fill();
    if (s >= 10) {
      ctx.beginPath();
      for (var i = 0; i < 9; i++) {
        var a = -0.86 + i * 0.215;
        if (abs(a) < 0.05) continue;
        ctx.moveTo(sin(a) * 0.12, 0.38 - cos(a) * 0.12);
        ctx.lineTo(sin(a) * 1.0, 0.38 - cos(a) * 1.0);
      }
      ctx.strokeStyle = fade(dark(col, 0.3), 0.14);
      ctx.lineWidth = 0.016;
      ctx.stroke();
    }
    ctx.restore();
  };

  // generic dry leaf with midrib
  M.leaf = function (ctx, s, o) {
    var col = opt(o, 'color', '#b36d38'), col2 = opt(o, 'color2', '#74431f');
    var tb = tumble(opt(o, 'phase', 0)), back = tb.back;
    ctx.save();
    ctx.scale(s * tb.sx, s * tb.sy);
    ctx.fillStyle = gcache(ctx, 'lf' + col + col2 + back, function () {
      var a = back ? light(col, 0.18) : col, b = back ? light(mix(col, col2, 0.3), 0.15) : mix(col, col2, 0.45);
      return linGrad(ctx, -0.45, -0.2, 0.45, 0.2, [0, a, 0.5, mix(a, b, 0.4), 1, b]);
    });
    ctx.beginPath();
    shape(ctx, LEAF_H, 0, 0.62, -0.06, 0.95, 1.56);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0.05, 0.97);
    ctx.quadraticCurveTo(0.01, 0.75, tx(0, 0), ty(0, 0));
    ctx.quadraticCurveTo(tx(0.025, -0.5), ty(0.025, -0.5), tx(0, -0.93), ty(0, -0.93));
    if (s >= 8) {
      for (var i = 0; i < 4; i++) {
        var y = -0.14 - i * 0.18, l = 0.3 - i * 0.055;
        for (var sd = -1; sd <= 1; sd += 2) {
          ctx.moveTo(tx(0.012, y), ty(0.012, y));
          ctx.quadraticCurveTo(tx(sd * l * 0.55, y - 0.05), ty(sd * l * 0.55, y - 0.05), tx(sd * l, y - 0.17), ty(sd * l, y - 0.17));
        }
      }
    }
    ctx.strokeStyle = fade(col2, back ? 0.28 : 0.45);
    ctx.lineWidth = 0.026;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  };

  // 雪 — soft round flake / six-armed crystal
  var CRYSTAL = (function () {
    var segs = [], i, a, ca, sa;
    function arm(r0, r1, ang) { segs.push([cos(ang) * r0, sin(ang) * r0, cos(ang) * r1, sin(ang) * r1]); }
    for (i = 0; i < 6; i++) {
      a = -PI / 2 + i * PI / 3; ca = cos(a); sa = sin(a);
      arm(0.16, 0.8, a);
      var b1 = [ca * 0.42, sa * 0.42], b2 = [ca * 0.62, sa * 0.62];
      segs.push([b1[0], b1[1], b1[0] + cos(a - 1.0) * 0.24, b1[1] + sin(a - 1.0) * 0.24]);
      segs.push([b1[0], b1[1], b1[0] + cos(a + 1.0) * 0.24, b1[1] + sin(a + 1.0) * 0.24]);
      segs.push([b2[0], b2[1], b2[0] + cos(a - 1.0) * 0.14, b2[1] + sin(a - 1.0) * 0.14]);
      segs.push([b2[0], b2[1], b2[0] + cos(a + 1.0) * 0.14, b2[1] + sin(a + 1.0) * 0.14]);
    }
    return segs;
  })();
  M.snowflake = function (ctx, s, o) {
    var kind = opt(o, 'kind', 'soft'), col = opt(o, 'color', '#ffffff');
    ctx.save();
    ctx.scale(s, s);
    if (kind === 'crystal') {
      ctx.fillStyle = gcache(ctx, 'sfh' + col, function () {
        return radGrad(ctx, 0, 0, 0, 1, [0, fade(col, 0.3), 0.6, fade(col, 0.1), 1, fade(col, 0)]);
      });
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
      ctx.beginPath();
      for (var i = 0; i < CRYSTAL.length; i++) {
        var g = CRYSTAL[i];
        ctx.moveTo(g[0], g[1]); ctx.lineTo(g[2], g[3]);
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(140,165,200,0.2)';
      lw(ctx, 0.13, s, 1.0);
      ctx.stroke();
      ctx.strokeStyle = fade(col, 0.95);
      lw(ctx, 0.06, s, 0.6);
      ctx.stroke();
      // centre plate + arm-tip plates (雪華)
      ctx.beginPath();
      for (i = 0; i <= 6; i++) {
        var a = -PI / 2 + i * PI / 3;
        if (i === 0) ctx.moveTo(cos(a) * 0.19, sin(a) * 0.19); else ctx.lineTo(cos(a) * 0.19, sin(a) * 0.19);
      }
      for (i = 0; i < 6; i++) {
        var b = -PI / 2 + i * PI / 3, px = cos(b) * 0.86, py = sin(b) * 0.86;
        ctx.moveTo(px + cos(b) * 0.1, py + sin(b) * 0.1);
        ctx.lineTo(px + cos(b + PI / 2) * 0.06, py + sin(b + PI / 2) * 0.06);
        ctx.lineTo(px - cos(b) * 0.08, py - sin(b) * 0.08);
        ctx.lineTo(px - cos(b + PI / 2) * 0.06, py - sin(b + PI / 2) * 0.06);
        ctx.closePath();
      }
      ctx.fillStyle = fade(col, 0.95);
      ctx.fill();
    } else {
      ctx.fillStyle = gcache(ctx, 'sfs' + col, function () {
        return radGrad(ctx, 0, 0, 0, 1, [0, fade(col, 0.95), 0.35, fade(col, 0.8), 0.68, fade(col, 0.28), 1, fade(col, 0)]);
      });
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    }
    ctx.restore();
  };

  // 綿毛 — seed fluff with pappus
  M.fluff = function (ctx, s, o) {
    var ph = opt(o, 'phase', 0), col = opt(o, 'color', '#fbf9f1');
    ctx.save();
    ctx.scale(s, s);
    ctx.rotate(sin(ph * TAU) * 0.18);
    ctx.fillStyle = gcache(ctx, 'fh' + col, function () {
      return radGrad(ctx, 0, -0.25, 0, 0.9, [0, fade(col, 0.32), 0.6, fade(col, 0.12), 1, fade(col, 0)]);
    });
    ctx.beginPath(); ctx.arc(0, -0.25, 0.9, 0, TAU); ctx.fill();
    var n = 17, spread = 1.45 + 0.12 * cos(ph * TAU), cy = 0.02, i;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var a = -spread + 2 * spread * i / (n - 1), L = 0.68 + 0.16 * ((i * 7) % 5) / 4;
      var ex = sin(a) * L, ey = cy - cos(a) * L;
      ctx.moveTo(0, cy);
      ctx.quadraticCurveTo(sin(a + 0.25) * L * 0.5, cy - cos(a + 0.25) * L * 0.5, ex, ey);
    }
    ctx.strokeStyle = fade(col, 0.85);
    ctx.lineCap = 'round';
    lw(ctx, 0.016, s, 0.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(0, 0.62);
    ctx.strokeStyle = fade(col, 0.75);
    ctx.stroke();
    ctx.beginPath();
    ell(ctx, 0, 0.74, 0.055, 0.14, 0);
    ctx.fillStyle = '#8a7656';
    ctx.fill();
    ctx.restore();
  };

  // 蛍 — glowing firefly (additive glow)
  M.firefly = function (ctx, s, o) {
    var glow = clamp(opt(o, 'glow', 1), 0, 1), col = opt(o, 'color', '#d8ff72');
    ctx.save();
    ctx.scale(s, s);
    if (glow > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      var r = 0.45 + 0.55 * glow;
      ctx.fillStyle = gcache(ctx, 'ff' + col, function () {
        return radGrad(ctx, 0, 0, 0, 1, [0, fade(col, 0.95), 0.12, fade(col, 0.7), 0.35, fade(col, 0.22), 0.7, fade(col, 0.06), 1, fade(col, 0)]);
      });
      ctx.globalAlpha *= glow;
      ctx.save(); ctx.scale(r, r);
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.globalAlpha /= glow;
      ctx.globalCompositeOperation = 'source-over';
    }
    // body: dark wings, orange pronotum, glowing tail
    ctx.beginPath(); ell(ctx, -0.02, 0, 0.13, 0.055, 0);
    ctx.fillStyle = '#2b261c'; ctx.fill();
    ctx.beginPath(); ell(ctx, 0.12, 0, 0.04, 0.045, 0);
    ctx.fillStyle = '#d0522c'; ctx.fill();
    ctx.beginPath(); ell(ctx, -0.13, 0, 0.05, 0.042, 0);
    ctx.fillStyle = mix('#8a8a5a', col, glow); ctx.fill();
    ctx.restore();
  };

  /* ------------------------------------------------ flying creatures (+x) */

  // 紋白蝶 — top view, head toward +x; phase flaps (wings foreshorten across the body axis)
  M.butterfly = function (ctx, s, o) {
    var col = opt(o, 'color', '#f7f5ec'), col2 = opt(o, 'color2', '#4f4d49'), ph = opt(o, 'phase', 0);
    var f = 0.5 + 0.5 * cos(ph * TAU), fh = 0.5 + 0.5 * cos(ph * TAU - 0.55);
    var wf = 0.1 + 0.9 * f, wh = 0.1 + 0.9 * fh;
    ctx.save();
    ctx.scale(s, s);
    ctx.rotate(PI / 2); // designed head-up; rotate so head faces +x
    var gF = gcache(ctx, 'bfF' + col + col2, function () {
      return linGrad(ctx, 0.04, -0.12, 0.8, -0.72, [0, mix(col, col2, 0.22), 0.14, col, 0.7, col, 0.79, mix(col, col2, 0.85), 1, col2]);
    });
    var gH = gcache(ctx, 'bfH' + col + col2, function () {
      return linGrad(ctx, 0.04, 0, 0.5, 0.5, [0, mix(col, col2, 0.2), 0.22, col, 1, light(col, 0.3)]);
    });
    for (var side = -1; side <= 1; side += 2) {
      ctx.save();
      ctx.scale(side * wh, 1);
      ctx.beginPath();
      ctx.moveTo(0.04, -0.08);
      ctx.bezierCurveTo(0.28, -0.14, 0.58, -0.06, 0.62, 0.14);
      ctx.bezierCurveTo(0.65, 0.38, 0.44, 0.56, 0.26, 0.52);
      ctx.bezierCurveTo(0.12, 0.48, 0.05, 0.28, 0.04, 0.1);
      ctx.closePath();
      ctx.fillStyle = gH; ctx.fill();
      ctx.beginPath(); ell(ctx, 0.42, -0.04, 0.04, 0.035, 0);
      ctx.fillStyle = fade(col2, 0.75); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.scale(side * wf, 1);
      ctx.beginPath();
      ctx.moveTo(0.04, -0.24);
      ctx.bezierCurveTo(0.2, -0.5, 0.48, -0.72, 0.8, -0.7);
      ctx.bezierCurveTo(0.88, -0.5, 0.84, -0.24, 0.7, -0.04);
      ctx.bezierCurveTo(0.5, 0.0, 0.2, -0.02, 0.04, -0.06);
      ctx.closePath();
      ctx.fillStyle = gF; ctx.fill();
      ctx.beginPath();
      ell(ctx, 0.47, -0.32, 0.06, 0.055, 0);
      ell(ctx, 0.42, -0.1, 0.04, 0.035, 0);
      ctx.fillStyle = col2; ctx.fill();
      ctx.restore();
    }
    // body
    ctx.fillStyle = '#3b3934';
    ctx.beginPath();
    ell(ctx, 0, -0.1, 0.055, 0.13, 0);
    ell(ctx, 0, 0.17, 0.04, 0.19, 0);
    circ(ctx, 0, -0.27, 0.055);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-0.02, -0.3); ctx.quadraticCurveTo(-0.06, -0.48, -0.15, -0.62);
    ctx.moveTo(0.02, -0.3); ctx.quadraticCurveTo(0.06, -0.48, 0.15, -0.62);
    ctx.strokeStyle = '#3b3934';
    lw(ctx, 0.02, s, 0.5);
    ctx.stroke();
    if (s >= 12) {
      ctx.beginPath(); circ(ctx, -0.15, -0.62, 0.028); circ(ctx, 0.15, -0.62, 0.028); ctx.fill();
    }
    ctx.restore();
  };

  // 赤とんぼ — top view, head toward +x, translucent wings with shimmer
  M.dragonfly = function (ctx, s, o) {
    var col = opt(o, 'color', '#cf3f28'), ph = opt(o, 'phase', 0);
    var q = ((frac(ph) * 8) | 0) / 8; // quantised shimmer for gradient caching
    var fl = sin(ph * TAU);
    ctx.save();
    ctx.scale(s, s);
    ctx.rotate(PI / 2);
    var wingG = gcache(ctx, 'dfw' + q, function () {
      var p = 0.3 + 0.5 * (0.5 + 0.5 * sin(q * TAU));
      return linGrad(ctx, 0, 0, 1, 0, [0, 'rgba(226,160,80,0.42)', 0.16, 'rgba(236,240,248,0.16)',
        p, 'rgba(205,232,255,0.3)', mmin(p + 0.18, 0.99), 'rgba(250,236,214,0.18)', 1, 'rgba(255,255,255,0.13)']);
    });
    var i, side;
    for (i = 0; i < 2; i++) { // 0 = hind, 1 = fore
      for (side = -1; side <= 1; side += 2) {
        ctx.save();
        if (i === 1) { ctx.translate(0, -0.6); ctx.rotate(side * fl * 0.07 - side * 0.04); }
        else { ctx.translate(0, -0.47); ctx.rotate(-side * fl * 0.07 + side * 0.1); }
        ctx.scale(side, 1);
        ctx.beginPath();
        if (i === 1) {
          ctx.moveTo(0.02, -0.03);
          ctx.bezierCurveTo(0.25, -0.1, 0.62, -0.12, 0.9, -0.1);
          ctx.bezierCurveTo(0.99, -0.09, 1.0, -0.01, 0.93, 0.01);
          ctx.bezierCurveTo(0.65, 0.06, 0.3, 0.08, 0.02, 0.05);
        } else {
          ctx.moveTo(0.02, -0.02);
          ctx.bezierCurveTo(0.25, -0.07, 0.6, -0.06, 0.86, -0.03);
          ctx.bezierCurveTo(0.95, -0.02, 0.95, 0.06, 0.87, 0.08);
          ctx.bezierCurveTo(0.55, 0.13, 0.25, 0.26, 0.03, 0.15);
        }
        ctx.closePath();
        ctx.fillStyle = wingG; ctx.fill();
        ctx.strokeStyle = 'rgba(90,70,60,0.28)';
        lw(ctx, 0.01, s, 0.35);
        ctx.stroke();
        if (s >= 10) {
          ctx.beginPath();
          if (i === 1) { ctx.moveTo(0.8, -0.1); ctx.lineTo(0.87, -0.097); }
          else { ctx.moveTo(0.76, -0.04); ctx.lineTo(0.83, -0.033); }
          ctx.strokeStyle = 'rgba(70,40,30,0.75)';
          lw(ctx, 0.028, s, 0.6);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    // abdomen
    ctx.beginPath();
    ctx.moveTo(-0.045, -0.4);
    ctx.quadraticCurveTo(-0.06, 0.25, -0.028, 0.93);
    ctx.quadraticCurveTo(0, 1.0, 0.028, 0.93);
    ctx.quadraticCurveTo(0.06, 0.25, 0.045, -0.4);
    ctx.closePath();
    ctx.fillStyle = gcache(ctx, 'dfa' + col, function () {
      return linGrad(ctx, -0.06, 0, 0.06, 0, [0, dark(col, 0.2), 0.45, light(col, 0.12), 1, dark(col, 0.25)]);
    });
    ctx.fill();
    if (s >= 14) {
      ctx.beginPath();
      for (i = 0; i < 7; i++) { var y = -0.22 + i * 0.16, w = 0.05 - i * 0.003; ctx.moveTo(-w, y); ctx.lineTo(w, y); }
      ctx.strokeStyle = fade(dark(col, 0.5), 0.45);
      lw(ctx, 0.012, s, 0.4);
      ctx.stroke();
    }
    // thorax + head
    ctx.beginPath(); ell(ctx, 0, -0.53, 0.085, 0.14, 0);
    ctx.fillStyle = mix(col, '#6a3a26', 0.55); ctx.fill();
    ctx.beginPath(); ell(ctx, 0, -0.7, 0.115, 0.075, 0);
    ctx.fillStyle = dark(col, 0.35); ctx.fill();
    if (s >= 14) {
      ctx.beginPath(); ell(ctx, -0.05, -0.72, 0.03, 0.02, -0.4); ell(ctx, 0.05, -0.72, 0.03, 0.02, 0.4);
      ctx.fillStyle = 'rgba(255,220,200,0.35)'; ctx.fill();
    }
    ctx.restore();
  };

  // crescent wing: root leading S, root trailing B, tip T; bulge of leading / trailing edges
  function wing(ctx, sx, sy, bx, by, txx, tyy, lead, trail, roundTip) {
    var dx = txx - sx, dy = tyy - sy, L = sqrt(dx * dx + dy * dy) || 1e-6;
    var ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    if ((bx - sx) * nx + (by - sy) * ny > 0) { nx = -nx; ny = -ny; }
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(sx + dx * 0.25 + nx * lead * L, sy + dy * 0.25 + ny * lead * L,
      sx + dx * 0.7 + nx * lead * 0.7 * L, sy + dy * 0.7 + ny * lead * 0.7 * L, txx, tyy);
    var mx = (txx + bx) / 2, my = (tyy + by) / 2;
    if (roundTip) {
      ctx.bezierCurveTo(txx - nx * roundTip * L, tyy - ny * roundTip * L,
        mx + nx * trail * L - ux * 0.1 * L, my + ny * trail * L - uy * 0.1 * L, bx, by);
    } else {
      ctx.quadraticCurveTo(mx + nx * trail * L, my + ny * trail * L, bx, by);
    }
    ctx.closePath();
  }

  // 燕 — 3/4 side silhouette heading +x, forked tail, red throat
  M.swallow = function (ctx, s, o) {
    var col = opt(o, 'color', '#1d2744'), throat = opt(o, 'color2', '#b8382b'), ph = opt(o, 'phase', 0);
    var w = cos(ph * TAU);
    ctx.save();
    ctx.scale(s, s);
    var far = mix(col, '#7b88a6', 0.28);
    // far wing
    ctx.beginPath();
    wing(ctx, 0.2, -0.08, 0.02, -0.07, 0.2 - 0.52 - 0.1 * (1 - abs(w)), -0.08 - (w > 0 ? 0.68 : 0.5) * w - 0.24, 0.13, 0.05);
    ctx.fillStyle = far; ctx.fill();
    // body + tail
    ctx.beginPath();
    ctx.moveTo(0.68, -0.005);
    ctx.quadraticCurveTo(0.62, -0.1, 0.5, -0.11);
    ctx.bezierCurveTo(0.3, -0.13, 0.0, -0.09, -0.28, -0.04);
    ctx.quadraticCurveTo(-0.62, -0.1, -1.0, -0.2);
    ctx.quadraticCurveTo(-0.7, -0.07, -0.5, -0.005);
    ctx.quadraticCurveTo(-0.7, 0.03, -0.98, 0.12);
    ctx.quadraticCurveTo(-0.6, 0.08, -0.26, 0.045);
    ctx.bezierCurveTo(0.0, 0.1, 0.3, 0.1, 0.48, 0.065);
    ctx.quadraticCurveTo(0.6, 0.05, 0.68, -0.005);
    ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.beginPath(); ell(ctx, 0.56, 0.03, 0.075, 0.04, -0.35);
    ctx.fillStyle = throat; ctx.fill();
    // near wing
    ctx.beginPath();
    wing(ctx, 0.16, -0.05, -0.08, -0.03, 0.16 - 0.5 - 0.14 * (1 - abs(w)), -0.05 - (w > 0 ? 0.9 : 0.6) * w + 0.26, 0.14, 0.055);
    ctx.fillStyle = col; ctx.fill();
    ctx.restore();
  };

  // 雁 — goose in flight, long neck, broad slow wings, heading +x
  M.goose = function (ctx, s, o) {
    var col = opt(o, 'color', '#3b3631'), ph = opt(o, 'phase', 0);
    var w = cos(ph * TAU);
    ctx.save();
    ctx.scale(s, s);
    var far = mix(col, '#8a8478', 0.25);
    ctx.beginPath();
    wing(ctx, 0.14, -0.08, -0.18, -0.07, 0.14 - 0.42 - 0.1 * (1 - abs(w)), -0.08 - (w > 0 ? 0.66 : 0.48) * w - 0.22, 0.06, -0.09, 0.1);
    ctx.fillStyle = far; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(1.0, -0.035);
    ctx.lineTo(0.9, -0.06);
    ctx.quadraticCurveTo(0.85, -0.1, 0.8, -0.085);
    ctx.quadraticCurveTo(0.74, -0.07, 0.7, -0.04);
    ctx.bezierCurveTo(0.6, -0.03, 0.46, -0.05, 0.34, -0.09);
    ctx.bezierCurveTo(0.1, -0.15, -0.3, -0.13, -0.5, -0.06);
    ctx.lineTo(-0.66, -0.035);
    ctx.lineTo(-0.52, 0.02);
    ctx.bezierCurveTo(-0.3, 0.12, 0.05, 0.14, 0.3, 0.06);
    ctx.bezierCurveTo(0.44, 0.02, 0.6, 0.005, 0.72, 0.0);
    ctx.quadraticCurveTo(0.8, -0.005, 0.86, -0.02);
    ctx.lineTo(1.0, -0.035);
    ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.beginPath();
    wing(ctx, 0.12, -0.06, -0.24, -0.04, 0.12 - 0.4 - 0.12 * (1 - abs(w)), -0.06 - (w > 0 ? 0.82 : 0.56) * w + 0.24, 0.07, -0.1, 0.12);
    ctx.fillStyle = col; ctx.fill();
    ctx.restore();
  };

  // small perching birds, facing +x. phase < .5 perched (tail flick), >= .5 hop.
  var BIRDS = {
    sparrow: { back: '#8b6545', belly: '#ddd1bb', wing: '#6b4a2f', wingbar: '#eadfc6', cap: '#7c4a2a', cheek: '#f1ece0',
      bib: '#2a2320', leg: '#a8826a', beak: '#3a3028', body: [0.42, 0.31, -0.32], head: [0.3, -0.3, 0.23],
      tail: [0.16, 0.48, 0.12], tailAmp: 0.12, beakL: 0.13, beakW: 0.075 },
    wagtail: { back: '#3d3e42', belly: '#f3f1ea', wing: '#2c2d30', wingbar: '#f3f1ea', cap: '#2c2d30', cheek: '#f3f1ea',
      bib: '#232326', leg: '#2a2a2a', beak: '#232326', body: [0.42, 0.21, -0.12], head: [0.36, -0.22, 0.17],
      tail: [0.09, 0.72, 0.06], tailAmp: 0.38, beakL: 0.16, beakW: 0.04 },
    warbler: { back: '#77703f', belly: '#cfc9a0', wing: '#6a6334', wingbar: '#77703f', cap: '#77703f', cheek: '#e6dfbc',
      bib: null, leg: '#c9a690', beak: '#5a5032', body: [0.38, 0.24, -0.24], head: [0.32, -0.25, 0.18],
      tail: [0.11, 0.58, 0.08], tailAmp: 0.16, beakL: 0.15, beakW: 0.045 }
  };
  M.smallBird = function (ctx, s, o) {
    var kind = opt(o, 'kind', 'sparrow'), B = BIRDS[kind] || BIRDS.sparrow;
    var ph = frac(opt(o, 'phase', 0)), hop = ph >= 0.5, t = hop ? (ph - 0.5) * 2 : ph * 2;
    var lift = hop ? sin(PI * t) : 0;
    var yoff = -0.3 * lift;
    var anchorFeet = opt(o, 'anchor', 'center') === 'feet';
    ctx.save();
    ctx.scale(s, s);
    if (anchorFeet) ctx.translate(-0.03, -0.7);
    ctx.translate(0, yoff);
    var bx = 0, by = 0.05, brx = B.body[0], bry = B.body[1], tilt = B.body[2] - lift * 0.12;
    var hx = B.head[0], hy = B.head[1] + (hop ? 0 : 0.015 * sin(t * TAU * 2)), hr = B.head[2];
    // legs
    var legLen = hop ? 0.36 - 0.18 * lift : 0.36;
    ctx.beginPath();
    var lx = 0.02, ly = by + bry * 0.8;
    ctx.moveTo(lx, ly); ctx.lineTo(lx + (hop ? -0.1 * lift : 0.01), ly + legLen);
    ctx.moveTo(lx + 0.07, ly - 0.02); ctx.lineTo(lx + 0.06 + (hop ? -0.08 * lift : 0.0), ly + legLen);
    var fy = ly + legLen;
    ctx.moveTo(lx - 0.08, fy); ctx.lineTo(lx + 0.14, fy);
    ctx.strokeStyle = B.leg;
    ctx.lineCap = 'round';
    lw(ctx, 0.035, s, 0.6);
    ctx.stroke();
    // tail
    var ta = (hop ? -0.25 * lift : sin(t * TAU) * B.tailAmp) + 0.42;
    ctx.save();
    ctx.translate(-brx * 0.72, by + bry * 0.35);
    ctx.rotate(ta);
    ctx.beginPath();
    ctx.moveTo(0.06, -B.tail[0] * 0.6);
    ctx.lineTo(-B.tail[1], -B.tail[2]);
    ctx.lineTo(-B.tail[1] - 0.02, B.tail[2] * 0.6);
    ctx.lineTo(0.06, B.tail[0] * 0.6);
    ctx.closePath();
    ctx.fillStyle = kind === 'wagtail' ? B.wing : dark(B.back, 0.12);
    ctx.fill();
    if (kind === 'wagtail' && s >= 12) {
      ctx.beginPath(); ctx.moveTo(0, B.tail[0] * 0.55); ctx.lineTo(-B.tail[1] - 0.01, B.tail[2] * 0.55);
      ctx.strokeStyle = B.belly; lw(ctx, 0.025, s, 0.5); ctx.stroke();
    }
    ctx.restore();
    // body + head (one silhouette, back -> belly bokashi)
    ctx.fillStyle = gcache(ctx, 'sb' + kind, function () {
      return linGrad(ctx, 0.1, -0.3, -0.05, 0.36, [0, B.back, 0.48, B.back, 0.62, mix(B.back, B.belly, 0.7), 0.75, B.belly, 1, B.belly]);
    });
    ctx.beginPath();
    ell(ctx, bx, by, brx, bry, tilt);
    circ(ctx, hx, hy, hr);
    // neck bridge
    ctx.moveTo(hx - hr * 0.9, hy + hr * 0.3);
    ctx.quadraticCurveTo(hx - hr * 0.4, hy + hr * 1.2, hx + hr * 0.6, hy + hr * 0.8);
    ctx.lineTo(bx + brx * 0.6, by - bry * 0.1);
    ctx.lineTo(bx - brx * 0.2, by - bry * 0.9);
    ctx.closePath();
    ctx.fill();
    // cap
    ctx.beginPath();
    ctx.arc(hx, hy, hr, PI * 1.05, PI * 1.95);
    ctx.closePath();
    ctx.fillStyle = B.cap; ctx.fill();
    // face markings
    if (s >= 10) {
      if (kind === 'sparrow') {
        ctx.beginPath(); ell(ctx, hx + 0.02, hy + 0.08, 0.13, 0.08, 0.2);
        ctx.fillStyle = B.cheek; ctx.fill();
        ctx.beginPath(); circ(ctx, hx + 0.0, hy + 0.1, 0.035);
        ell(ctx, hx + 0.1, hy + hr * 0.95, 0.07, 0.05, 0.4);
        ctx.fillStyle = B.bib; ctx.fill();
      } else if (kind === 'wagtail') {
        ctx.beginPath(); ell(ctx, hx + 0.03, hy + 0.02, 0.13, 0.1, 0);
        ctx.fillStyle = B.cheek; ctx.fill();
        ctx.beginPath(); ell(ctx, hx + 0.02, hy + hr + 0.06, 0.13, 0.08, 0.3);
        ctx.fillStyle = B.bib; ctx.fill();
        ctx.beginPath(); ctx.moveTo(hx - 0.1, hy - 0.01); ctx.lineTo(hx + 0.14, hy - 0.01);
        ctx.strokeStyle = B.bib; lw(ctx, 0.03, s, 0.5); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(hx - 0.08, hy - 0.06); ctx.quadraticCurveTo(hx + 0.04, hy - 0.1, hx + 0.16, hy - 0.06);
        ctx.strokeStyle = B.cheek; lw(ctx, 0.028, s, 0.5); ctx.stroke();
      }
    }
    // wing
    var wa = -0.32 - (hop ? 0.55 * lift : 0);
    ctx.save();
    ctx.translate(0.14, by - 0.1);
    ctx.rotate(wa);
    ctx.beginPath();
    ctx.moveTo(0.04, -0.06);
    ctx.bezierCurveTo(-0.2, -0.16, -0.48, -0.06, -0.58, 0.04);
    ctx.bezierCurveTo(-0.4, 0.12, -0.1, 0.14, 0.04, 0.08);
    ctx.closePath();
    ctx.fillStyle = B.wing; ctx.fill();
    if (s >= 12 && B.wingbar !== B.back) {
      ctx.beginPath(); ctx.moveTo(-0.06, 0.02); ctx.quadraticCurveTo(-0.25, 0.0, -0.42, 0.05);
      ctx.strokeStyle = B.wingbar; lw(ctx, 0.025, s, 0.5); ctx.stroke();
    }
    ctx.restore();
    // beak + eye
    ctx.beginPath();
    ctx.moveTo(hx + hr * 0.78, hy - B.beakW * 0.7);
    ctx.lineTo(hx + hr + B.beakL, hy + 0.02);
    ctx.lineTo(hx + hr * 0.78, hy + B.beakW * 0.7);
    ctx.closePath();
    ctx.fillStyle = B.beak; ctx.fill();
    ctx.beginPath(); circ(ctx, hx + hr * 0.38, hy - hr * 0.1, mmax(0.035, 0.6 / s));
    ctx.fillStyle = '#17120f'; ctx.fill();
    ctx.restore();
  };

  // 鮭 — fish leaping in an arc; phase 0 leaving water (nose up) -> 1 re-entering (nose down)
  var FISH_X = [-0.72, -0.5, -0.25, 0, 0.25, 0.5, 0.68, 0.82, 0.92, 0.97];
  var FISH_W = [0.05, 0.1, 0.15, 0.18, 0.18, 0.16, 0.13, 0.095, 0.055, 0.0];
  M.fish = function (ctx, s, o) {
    var ph = frac(opt(o, 'phase', 0.5)), col = opt(o, 'color', '#5a6470');
    var belly = opt(o, 'color2', '#ebe6dc'), blush = opt(o, 'blush', '#c8574c');
    var ang = lerp(-0.95, 0.95, ph), bend = 0.24 + 0.08 * sin(PI * ph);
    var flick = 0.12 * sin(ph * TAU * 2);
    var i, n = FISH_X.length;
    ctx.save();
    ctx.scale(s, s);
    // splash accents (world frame)
    var sa = mmax(0, 1 - ph / 0.32), sb = mmax(0, (ph - 0.68) / 0.32);
    if (sa > 0 || sb > 0) {
      ctx.fillStyle = 'rgba(232,242,248,0.85)';
      ctx.strokeStyle = 'rgba(232,242,248,0.7)';
      lw(ctx, 0.03, s, 0.5);
      for (var k = 0; k < 2; k++) {
        var amt = k === 0 ? sa : sb;
        if (amt <= 0) continue;
        var ex = k === 0 ? -1.0 : 1.0, ey = bend * 0.75;
        var px = ex * cos(ang) - ey * sin(ang), py = ex * sin(ang) + ey * cos(ang) + 0.12;
        var spread = 1 - amt;
        ctx.globalAlpha *= amt;
        ctx.beginPath();
        for (i = 0; i < 6; i++) {
          var da = -PI / 2 + (i - 2.5) * 0.42, dd = 0.1 + spread * 0.35 + (i % 2) * 0.08;
          circ(ctx, px + cos(da) * dd, py + sin(da) * dd * 1.2 + spread * spread * 0.2, 0.03 + (i % 3) * 0.012);
        }
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(px, py + 0.04, 0.22 + spread * 0.2, 0.05, 0, PI, TAU);
        ctx.stroke();
        ctx.globalAlpha /= amt;
      }
    }
    ctx.rotate(ang);
    function yc(x) { var b = bend * (x * x - 0.25); return x < -0.4 ? b + flick * (x + 0.4) * (x + 0.4) * 3 : b; }
    function slope(x) { return (yc(x + 0.01) - yc(x - 0.01)) / 0.02; }
    var tx0 = FISH_X[0], ty0 = yc(tx0), sl = slope(tx0), tl = sqrt(1 + sl * sl), ux = 1 / tl, uy = sl / tl;
    // tail fin
    ctx.beginPath();
    ctx.moveTo(tx0 + 0.04 * ux + 0.05 * uy, ty0 + 0.04 * uy - 0.05 * ux);
    ctx.quadraticCurveTo(tx0 - 0.2 * ux + 0.1 * uy, ty0 - 0.2 * uy - 0.1 * ux, tx0 - 0.36 * ux + 0.25 * uy, ty0 - 0.36 * uy - 0.25 * ux);
    ctx.quadraticCurveTo(tx0 - 0.24 * ux, ty0 - 0.24 * uy, tx0 - 0.36 * ux - 0.24 * uy, ty0 - 0.36 * uy + 0.24 * ux);
    ctx.quadraticCurveTo(tx0 - 0.2 * ux - 0.1 * uy, ty0 - 0.2 * uy + 0.1 * ux, tx0 + 0.04 * ux - 0.05 * uy, ty0 + 0.04 * uy + 0.05 * ux);
    ctx.closePath();
    ctx.fillStyle = dark(col, 0.12); ctx.fill();
    // fins
    ctx.beginPath();
    var dX = 0.08, dY = yc(dX) - FISH_W[3] * 1.02;
    ctx.moveTo(dX + 0.14, dY + 0.01); ctx.quadraticCurveTo(dX - 0.02, dY - 0.16, dX - 0.14, dY - 0.13);
    ctx.lineTo(dX - 0.12, dY + 0.03);
    var aX = -0.4, aY = yc(aX) + 0.12;
    ctx.moveTo(aX + 0.1, aY - 0.03); ctx.lineTo(aX - 0.06, aY + 0.08); ctx.lineTo(aX - 0.08, aY - 0.03);
    var pX = -0.05, pY = yc(pX) + 0.16;
    ctx.moveTo(pX + 0.1, pY - 0.03); ctx.lineTo(pX - 0.05, pY + 0.08); ctx.lineTo(pX - 0.06, pY - 0.03);
    ctx.fillStyle = dark(col, 0.1); ctx.fill();
    // body outline from sampled spine
    var top = [], bot = [];
    for (i = 0; i < n; i++) {
      var x = FISH_X[i], y = yc(x), m = slope(x), nl = sqrt(1 + m * m), nx = -m / nl, ny = 1 / nl, hw = FISH_W[i];
      top.push(x - nx * hw * 1.05, y - ny * hw * 1.05);
      bot.push(x + nx * hw * 0.95, y + ny * hw * 0.95);
    }
    ctx.beginPath();
    ctx.moveTo(top[0], top[1]);
    for (i = 1; i < n - 1; i++) ctx.quadraticCurveTo(top[i * 2], top[i * 2 + 1], (top[i * 2] + top[i * 2 + 2]) / 2, (top[i * 2 + 1] + top[i * 2 + 3]) / 2);
    ctx.quadraticCurveTo(top[(n - 1) * 2] + 0.01, top[(n - 1) * 2 + 1] - 0.01, top[(n - 1) * 2] + 0.01, top[(n - 1) * 2 + 1]);
    for (i = n - 2; i > 0; i--) ctx.quadraticCurveTo(bot[i * 2], bot[i * 2 + 1], (bot[i * 2] + bot[i * 2 - 2]) / 2, (bot[i * 2 + 1] + bot[i * 2 - 1]) / 2);
    ctx.lineTo(bot[0], bot[1]);
    ctx.closePath();
    ctx.fillStyle = gcache(ctx, 'fi' + col + belly + blush, function () {
      return linGrad(ctx, 0, -0.18, 0, 0.2, [0, dark(col, 0.2), 0.36, col, 0.5, mix(col, blush, 0.35), 0.6, mix(blush, belly, 0.55), 0.74, belly, 1, belly]);
    });
    ctx.fill();
    if (s >= 14) {
      // gill line + eye
      var gx = 0.6, gy = yc(gx);
      ctx.beginPath(); ctx.moveTo(gx + 0.02, gy - 0.1); ctx.quadraticCurveTo(gx - 0.05, gy, gx + 0.03, gy + 0.11);
      ctx.strokeStyle = fade(dark(col, 0.4), 0.45); lw(ctx, 0.016, s, 0.4); ctx.stroke();
    }
    var ex2 = 0.76, ey2 = yc(ex2) - 0.035;
    ctx.beginPath(); circ(ctx, ex2, ey2, mmax(0.028, 0.5 / s));
    ctx.fillStyle = '#1a1716'; ctx.fill();
    ctx.restore();
  };

  /* ============================================================ ORNAMENTS */

  var BL = {
    ume:     { color: '#fbf7f1', color2: '#d9919c', calyx: '#7a2a2d', fil: '#cbb98a', anther: '#d9a22a', center: '#a9b35a',
               half: UME_H, inner: 0.25, n: 12, sl: [0.34, 0.52] },
    sakura:  { color: '#f9dbe2', color2: '#e1849c', calyx: '#a3465a', fil: '#d98095', anther: '#e5b54a', center: '#cf4f6c',
               half: SAKURA_H, w: 0.86, inner: 0.5, n: 14, sl: [0.32, 0.48] },
    momo:    { color: '#f290aa', color2: '#c43566', calyx: '#6a7a3a', fil: '#d9507a', anther: '#f2c94c', center: '#a8234f',
               half: MOMO_H, w: 1.2, inner: 0.45, n: 18, sl: [0.38, 0.6] },
    tsubaki: { color: '#c8233d', color2: '#6e0c22', calyx: '#556f38', fil: '#f6eed6', anther: '#efc02e', center: '#f4e3a6',
               half: UME_H, w: 1.45, inner: 0.55, n: 16, sl: [0.26, 0.3] }
  };

  function blossomGrad(ctx, kind, K, col, col2) {
    return gcache(ctx, 'bl' + kind + col + col2, function () {
      return radGrad(ctx, 0, 0, 0, 0.95, [0, mix(col, col2, K.inner), 0.4, mix(col, col2, K.inner * 0.3), 1, light(col, kind === 'tsubaki' ? 0.06 : 0.16)]);
    });
  }

  function blossomFront(ctx, kind, K, open, col, col2, R) {
    var rot = R() * TAU, i, a, N = 5;
    if (open < 0.22) {
      var u = open / 0.22, rb = 0.26 + 0.14 * u;
      ctx.beginPath();
      for (i = 0; i < N; i++) shape(ctx, MOMO_H, 0, 0, rot + i * TAU / N, 0.8 * rb, rb + 0.07);
      ctx.fillStyle = K.calyx; ctx.fill();
      ctx.beginPath(); circ(ctx, 0, 0, rb);
      ctx.fillStyle = radGrad(ctx, 0, 0, 0, rb, [0, light(col, 0.3), 0.6, col, 1, mix(col, col2, 0.35)], -rb * 0.35, -rb * 0.4);
      ctx.fill();
      ctx.beginPath();
      for (i = 0; i < N; i++) {
        a = rot + i * TAU / N;
        ctx.moveTo(cos(a) * rb * 0.3, sin(a) * rb * 0.3);
        ctx.quadraticCurveTo(cos(a + 0.7) * rb * 0.7, sin(a + 0.7) * rb * 0.7, cos(a + 1.1) * rb * 0.88, sin(a + 1.1) * rb * 0.88);
      }
      ctx.strokeStyle = fade(mix(col, col2, 0.6), 0.25);
      ctx.lineWidth = 0.02;
      ctx.stroke();
      return;
    }
    var e = easeOut((open - 0.22) / 0.78);
    // sepals peeking between petals
    ctx.beginPath();
    for (i = 0; i < N; i++) shape(ctx, MOMO_H, 0, 0, rot + PI / N + i * TAU / N, 0.32, 0.42 + 0.14 * e);
    ctx.fillStyle = K.calyx; ctx.fill();
    var g = blossomGrad(ctx, kind, K, col, col2);
    if (kind === 'ume') {
      var pr = lerp(0.22, 0.41, e), dd = lerp(0.12, 0.5, e);
      ctx.beginPath();
      for (i = 0; i < N; i++) { a = rot + i * TAU / N; circ(ctx, sin(a) * dd, -cos(a) * dd, pr); }
      ctx.fillStyle = g; ctx.fill();
    } else {
      var L = lerp(0.42, 0.95, e), W = K.w * lerp(1.25, 1, e) * L, off = (kind === 'sakura' ? 0.08 : 0.05) * e;
      var edge = fade(light(col, 0.55), kind === 'tsubaki' ? 0.5 : 0.4);
      var rings = kind === 'tsubaki' ? 2 : 1;
      for (var rr0 = 0; rr0 < rings; rr0++) {
        var L2 = rr0 ? L * 0.62 : L, W2 = rr0 ? W * 0.62 : W;
        for (i = 0; i < N; i++) {
          a = rot + (i + rr0 * 0.5) * TAU / N;
          ctx.beginPath();
          shape(ctx, K.half, sin(a) * off, -cos(a) * off, a, W2, L2);
          ctx.fillStyle = g; ctx.fill();
          ctx.strokeStyle = edge; ctx.lineWidth = 0.018; ctx.stroke();
        }
      }
    }
    // stamens
    var se = clamp((e - 0.15) / 0.85, 0, 1);
    if (se <= 0) return;
    if (kind === 'tsubaki') {
      var rr = 0.3 * (0.5 + 0.5 * se);
      ctx.beginPath(); circ(ctx, 0, 0, rr);
      ctx.fillStyle = K.fil; ctx.fill();
      ctx.beginPath();
      for (i = 0; i < K.n; i++) { a = rot + i * TAU / K.n; circ(ctx, cos(a) * rr * 0.86, sin(a) * rr * 0.86, 0.045); }
      circ(ctx, 0, 0, rr * 0.32);
      ctx.fillStyle = K.anther; ctx.fill();
      return;
    }
    var n = K.n;
    ctx.beginPath();
    var tips = [];
    for (i = 0; i < n; i++) {
      a = rot + (i + R() * 0.6) * TAU / n;
      var l = lerp(K.sl[0], K.sl[1], R()) * se;
      var ex = cos(a) * l, ey = sin(a) * l;
      ctx.moveTo(cos(a) * 0.05, sin(a) * 0.05);
      ctx.quadraticCurveTo(cos(a + 0.12) * l * 0.55, sin(a + 0.12) * l * 0.55, ex, ey);
      tips.push(ex, ey);
    }
    ctx.strokeStyle = K.fil;
    ctx.lineWidth = 0.018;
    ctx.stroke();
    ctx.beginPath();
    for (i = 0; i < tips.length; i += 2) circ(ctx, tips[i], tips[i + 1], 0.034);
    ctx.fillStyle = K.anther; ctx.fill();
    ctx.beginPath(); circ(ctx, 0, 0, 0.075);
    ctx.fillStyle = K.center; ctx.fill();
  }

  function blossomSide(ctx, kind, K, open, col, col2, R) {
    var e = smooth(open), i;
    var bx = 0, by = 0.38;
    var spread = lerp(0.04, 1.25, e), L = lerp(0.5, 0.85, e);
    var W = (kind === 'ume' ? 1.3 : kind === 'tsubaki' ? 1.2 : 0.95) * L * lerp(kind === 'ume' ? 0.85 : 1.1, 1, e);
    var half = K.half;
    var g = gcache(ctx, 'bls' + kind + col + col2, function () {
      return linGrad(ctx, 0, by, 0, by - 0.9, [0, mix(col, col2, K.inner + 0.1), 0.5, col, 1, light(col, 0.18)]);
    });
    var edge = fade(light(col, 0.55), 0.45);
    // back petals
    var backA = [-0.5, 0.5, 0];
    for (i = 0; i < 3; i++) {
      ctx.beginPath();
      shape(ctx, half, bx, by, backA[i] * spread * 1.1, W * 0.9, L * (i === 2 ? 1.02 : 0.95));
      ctx.fillStyle = g; ctx.fill();
    }
    // stamens rising from the cup
    if (e > 0.35) {
      var se = (e - 0.35) / 0.65, n = kind === 'tsubaki' ? 9 : 9;
      ctx.beginPath();
      var tips = [];
      for (i = 0; i < n; i++) {
        var a = (i / (n - 1) - 0.5) * (0.6 + 0.9 * e), l = (kind === 'tsubaki' ? 0.42 : 0.55) * se * (0.8 + 0.2 * R());
        var ex = bx + sin(a) * l, ey = by - 0.12 - cos(a) * l;
        ctx.moveTo(bx + sin(a) * 0.05, by - 0.12);
        ctx.lineTo(ex, ey);
        tips.push(ex, ey);
      }
      ctx.strokeStyle = K.fil; ctx.lineWidth = kind === 'tsubaki' ? 0.04 : 0.018; ctx.stroke();
      ctx.beginPath();
      for (i = 0; i < tips.length; i += 2) circ(ctx, tips[i], tips[i + 1], 0.035);
      ctx.fillStyle = K.anther; ctx.fill();
    }
    // front petals
    var frontA = [-1, 1];
    for (i = 0; i < 2; i++) {
      ctx.beginPath();
      shape(ctx, half, bx, by, frontA[i] * spread * 1.2, W, L * 0.9);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = 0.018; ctx.stroke();
    }
    if (e < 0.85) {
      ctx.beginPath();
      shape(ctx, half, bx, by, 0.05, W * 1.05, L * lerp(0.85, 0.35, e / 0.85));
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = 0.018; ctx.stroke();
    }
    // calyx cup with reflexed sepal tips
    ctx.beginPath();
    shape(ctx, MOMO_H, bx - 0.05, by + 0.08, -2.1 + e * 0.3, 0.13, 0.2);
    shape(ctx, MOMO_H, bx + 0.05, by + 0.08, 2.1 - e * 0.3, 0.13, 0.2);
    ctx.moveTo(bx - 0.15, by - 0.02);
    ctx.quadraticCurveTo(bx - 0.13, by + 0.18, bx, by + 0.2);
    ctx.quadraticCurveTo(bx + 0.13, by + 0.18, bx + 0.15, by - 0.02);
    ctx.closePath();
    ctx.fillStyle = K.calyx; ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx, by + 0.18); ctx.lineTo(bx + 0.02, by + 0.34);
    ctx.strokeStyle = K.calyx; ctx.lineWidth = 0.05; ctx.lineCap = 'round'; ctx.stroke();
  }

  M.blossom = function (ctx, s, o) {
    var kind = opt(o, 'kind', 'ume'), K = BL[kind] || BL.ume;
    var open = clamp(opt(o, 'open', 1), 0, 1);
    var col = opt(o, 'color', K.color), col2 = opt(o, 'color2', K.color2);
    var R = rng(opt(o, 'seed', 1));
    ctx.save();
    ctx.scale(s, s);
    if (opt(o, 'view', 'front') === 'side') blossomSide(ctx, kind, K, open, col, col2, R);
    else blossomFront(ctx, kind, K, open, col, col2, R);
    ctx.restore();
  };

  // 桐 — upright panicle of pale-purple tubular flowers (open 0 = velvety buds)
  M.kiri = function (ctx, s, o) {
    var open = clamp(opt(o, 'open', 1), 0, 1), R = rng(opt(o, 'seed', 1));
    var col = opt(o, 'color', '#a68ac8'), col2 = opt(o, 'color2', '#e6daf0');
    var bud = '#8f6f52';
    ctx.save();
    ctx.scale(s, s);
    // stalk with side branches
    ctx.beginPath();
    ctx.moveTo(0, 0.98);
    ctx.quadraticCurveTo(0.03, 0.2, 0, -0.82);
    var tiers = 6, i, k, nodes = [];
    for (i = 0; i < tiers; i++) {
      var t = i / (tiers - 1), y = lerp(0.55, -0.7, t), side = i % 2 ? 1 : -1, len = lerp(0.36, 0.12, t);
      var ex = side * len, ey = y - len * 0.45;
      ctx.moveTo(0.01, y); ctx.quadraticCurveTo(side * len * 0.5, y - 0.02, ex, ey);
      nodes.push([ex, ey, side, lerp(1, 0.55, t)]);
      ctx.moveTo(0.01, y - 0.08); ctx.quadraticCurveTo(-side * len * 0.4, y - 0.1, -side * len * 0.75, y - 0.08 - len * 0.4);
      nodes.push([-side * len * 0.75, y - 0.08 - len * 0.4, -side, lerp(0.85, 0.5, t)]);
    }
    nodes.push([0, -0.86, 0, 0.5]);
    ctx.strokeStyle = '#7a5e45';
    lw(ctx, 0.022, s, 0.6);
    ctx.lineCap = 'round';
    ctx.stroke();
    var fo = clamp((open - 0.2) / 0.8, 0, 1);
    // flowers: drawn top to bottom so lower ones overlap
    for (i = nodes.length - 1; i >= 0; i--) {
      var nd = nodes[i], sc = nd[3] * 0.24;
      var dir = nd[2] === 0 ? -PI / 2 : (nd[2] > 0 ? -0.35 - R() * 0.4 : PI + 0.35 + R() * 0.4);
      for (k = 0; k < (nd[2] === 0 ? 1 : 2); k++) {
        var da = dir + (k ? 0.55 : 0) * (nd[2] > 0 ? 1 : -1) * (nd[2] === 0 ? 0 : 1);
        var px = nd[0], py = nd[1];
        if (fo <= 0) {
          ctx.beginPath(); ell(ctx, px + cos(da) * sc * 0.25, py + sin(da) * sc * 0.25, sc * 0.3, sc * 0.26, da);
          ctx.fillStyle = bud; ctx.fill();
          continue;
        }
        var Ln = sc * (0.7 + 0.5 * fo), mw = sc * (0.18 + 0.32 * fo);
        var ux = cos(da), uy = sin(da), vx = -uy, vy = ux;
        // calyx
        ctx.beginPath(); ell(ctx, px + ux * sc * 0.12, py + uy * sc * 0.12, sc * 0.18, sc * 0.15, da);
        ctx.fillStyle = bud; ctx.fill();
        // tube flaring to mouth
        ctx.beginPath();
        ctx.moveTo(px + ux * sc * 0.15 + vx * sc * 0.08, py + uy * sc * 0.15 + vy * sc * 0.08);
        ctx.quadraticCurveTo(px + ux * Ln * 0.65 + vx * sc * 0.1, py + uy * Ln * 0.65 + vy * sc * 0.1,
          px + ux * Ln + vx * mw, py + uy * Ln + vy * mw);
        ctx.quadraticCurveTo(px + ux * (Ln + mw * 0.6), py + uy * (Ln + mw * 0.6), px + ux * Ln - vx * mw, py + uy * Ln - vy * mw);
        ctx.quadraticCurveTo(px + ux * Ln * 0.65 - vx * sc * 0.1, py + uy * Ln * 0.65 - vy * sc * 0.1,
          px + ux * sc * 0.15 - vx * sc * 0.08, py + uy * sc * 0.15 - vy * sc * 0.08);
        ctx.closePath();
        ctx.fillStyle = col; ctx.fill();
        if (fo > 0.3) {
          ctx.beginPath(); ell(ctx, px + ux * (Ln + mw * 0.12), py + uy * (Ln + mw * 0.12), mw * 0.42, mw * 1.02, da);
          ctx.fillStyle = col2; ctx.fill();
          if (s >= 30) {
            ctx.beginPath(); ell(ctx, px + ux * (Ln + mw * 0.05), py + uy * (Ln + mw * 0.05), mw * 0.18, mw * 0.4, da);
            ctx.fillStyle = mix(col, '#6a4a8a', 0.5); ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  };

  // fruit: ume (green), ume-ripe, tachibana, kaki
  var FRUIT = {
    'ume':      { c: '#9cbf4c', hi: '#d4e48c', lo: '#5f8a2e', r: [0.68, 0.72] },
    'ume-ripe': { c: '#e9c445', hi: '#f8e79a', lo: '#c98d26', blush: '#e0583a', r: [0.68, 0.72] },
    'tachibana':{ c: '#f2a21e', hi: '#ffe3a0', lo: '#c8700f', r: [0.74, 0.66] },
    'kaki':     { c: '#e8702a', hi: '#f9b277', lo: '#b5461a', r: [0.8, 0.68] }
  };
  M.fruit = function (ctx, s, o) {
    var kind = opt(o, 'kind', 'ume'), F = FRUIT[kind] || FRUIT.ume, R = rng(opt(o, 'seed', 1));
    var col = opt(o, 'color', F.c);
    var cy = 0.14, rx = F.r[0], ry = F.r[1];
    ctx.save();
    ctx.scale(s, s);
    ctx.rotate((R() - 0.5) * 0.3);
    // stem
    ctx.beginPath();
    ctx.moveTo(0, cy - ry + 0.08);
    ctx.quadraticCurveTo(0.02, cy - ry - 0.15, 0.08, cy - ry - 0.3);
    ctx.strokeStyle = '#5a4630'; ctx.lineCap = 'round';
    lw(ctx, kind === 'kaki' ? 0.07 : 0.045, s, 0.7);
    ctx.stroke();
    // leaf
    if (kind !== 'kaki') {
      ctx.beginPath();
      shape(ctx, LEAF_H, 0.06, cy - ry - 0.2, 1.05 + (R() - 0.5) * 0.3, 0.42, 0.62);
      ctx.fillStyle = kind === 'tachibana' ? '#2f5a33' : '#5b8a37';
      ctx.fill();
      ctx.beginPath();
      setT(0.06, cy - ry - 0.2, 1.05, 0.42, 0.62);
      ctx.moveTo(0.06, cy - ry - 0.2); ctx.lineTo(tx(0, -0.85), ty(0, -0.85));
      ctx.strokeStyle = 'rgba(255,255,240,0.25)'; lw(ctx, 0.02, s, 0.4); ctx.stroke();
    }
    // body
    ctx.beginPath();
    if (kind === 'kaki') {
      ctx.moveTo(0, cy - ry);
      ctx.bezierCurveTo(rx * 0.75, cy - ry * 1.02, rx * 1.02, cy - ry * 0.6, rx, cy);
      ctx.bezierCurveTo(rx * 0.98, cy + ry * 0.75, rx * 0.6, cy + ry, 0, cy + ry);
      ctx.bezierCurveTo(-rx * 0.6, cy + ry, -rx * 0.98, cy + ry * 0.75, -rx, cy);
      ctx.bezierCurveTo(-rx * 1.02, cy - ry * 0.6, -rx * 0.75, cy - ry * 1.02, 0, cy - ry);
    } else {
      ell(ctx, 0, cy, rx, ry, 0);
    }
    ctx.fillStyle = gcache(ctx, 'fr' + kind + col, function () {
      return radGrad(ctx, 0, cy, 0, rx * 1.05, [0, light(col, 0.12), 0.55, col, 1, mix(col, F.lo, 0.7)], -rx * 0.3, cy - ry * 0.35);
    });
    ctx.fill();
    if (F.blush) {
      ctx.fillStyle = gcache(ctx, 'frb' + kind, function () {
        return radGrad(ctx, rx * 0.35, cy - ry * 0.05, 0, rx * 0.75, [0, fade(F.blush, 0.7), 1, fade(F.blush, 0)]);
      });
      ctx.fill();
    }
    if (kind === 'ume' || kind === 'ume-ripe') {
      ctx.beginPath(); ctx.moveTo(0.08, cy - ry + 0.04); ctx.bezierCurveTo(0.32, cy - 0.3, 0.32, cy + 0.3, 0.1, cy + ry - 0.04);
      ctx.strokeStyle = fade(F.lo, 0.45); lw(ctx, 0.025, s, 0.4); ctx.stroke();
    }
    // glossy highlight
    ctx.beginPath(); ell(ctx, -rx * 0.38, cy - ry * 0.42, rx * 0.2, ry * 0.12, -0.6);
    ctx.fillStyle = kind === 'tachibana' || kind === 'kaki' ? 'rgba(255,252,235,0.6)' : 'rgba(255,255,240,0.35)';
    ctx.fill();
    if (kind === 'kaki') {
      ctx.beginPath();
      var cx0 = 0, cy0 = cy - ry + 0.06;
      var CA = [-1.85, -1.25, 1.25, 1.85, PI];
      for (var i = 0; i < CA.length; i++) shape(ctx, UME_H, cx0, cy0, CA[i], i === 4 ? 0.42 : 0.36, i === 4 ? 0.2 : 0.34);
      ctx.fillStyle = '#5e6a2a'; ctx.fill();
      ctx.beginPath(); ell(ctx, cx0, cy0, 0.1, 0.06, 0);
      ctx.fillStyle = '#4a4422'; ctx.fill();
    }
    ctx.restore();
  };

  // leaf cluster at a branch tip: origin = attachment point, leaves fan toward -y
  var LEAF_TONES = {
    bud:    ['#8f4f36', '#b7bf62'],
    young:  ['#a6c64a', '#d9ea8e'],
    green:  ['#4f8236', '#77a54c'],
    deep:   ['#2c5530', '#45703c'],
    yellow: ['#cfa431', '#ecd06a'],
    red:    ['#b8322a', '#e0623a'],
    brown:  ['#83532f', '#a8784a']
  };
  M.leafCluster = function (ctx, s, o) {
    var tone = opt(o, 'tone', 'green'), C = LEAF_TONES[tone] || LEAF_TONES.green;
    var R = rng(opt(o, 'seed', 1)), ph = opt(o, 'phase', 0);
    var c1 = opt(o, 'color', C[0]), c2 = opt(o, 'color2', C[1]);
    var n = 2 + floor(R() * 3), i;
    ctx.save();
    ctx.scale(s, s);
    if (tone === 'bud') {
      ctx.fillStyle = gcache(ctx, 'lcb' + c1 + c2, function () { return linGrad(ctx, 0, 0, 0, -0.5, [0, c1, 0.55, mix(c1, c2, 0.5), 1, c2]); });
      ctx.beginPath();
      for (i = 0; i < 3; i++) {
        var a = (i - 1) * 0.35 + (R() - 0.5) * 0.15 + sin(ph * TAU + i) * 0.04;
        shape(ctx, LANCE_H, 0, 0, a, 0.42, (i === 1 ? 0.55 : 0.4) + R() * 0.08);
      }
      ctx.fill();
      ctx.restore();
      return;
    }
    var spread = 0.75 + R() * 0.25;
    var leaves = [];
    for (i = 0; i < n; i++) {
      var t = n === 1 ? 0.5 : i / (n - 1);
      leaves.push([(t - 0.5) * 2 * spread + (R() - 0.5) * 0.2 + sin(ph * TAU + i * 1.7) * 0.06,
        0.75 + R() * 0.25, 0.5 + R() * 0.15, R()]);
    }
    leaves.sort(function (A, B) { return abs(B[0]) - abs(A[0]); }); // outer first, centre on top
    ctx.beginPath();
    ctx.lineCap = 'round';
    for (i = 0; i < n; i++) {
      ctx.moveTo(0, 0); ctx.lineTo(sin(leaves[i][0]) * 0.1, -cos(leaves[i][0]) * 0.1);
    }
    ctx.strokeStyle = dark(c1, 0.25); lw(ctx, 0.035, s, 0.6); ctx.stroke();
    var g = gcache(ctx, 'lc' + c1 + c2, function () { return radGrad(ctx, 0, 0, 0.05, 1, [0, dark(c1, 0.08), 0.45, c1, 1, c2]); });
    for (i = 0; i < n; i++) {
      var L = leaves[i], bx = sin(L[0]) * 0.08, by = -cos(L[0]) * 0.08;
      ctx.beginPath();
      shape(ctx, LEAF_H, bx, by, L[0], L[2] * L[1], L[1] * 0.95);
      ctx.fillStyle = g; ctx.fill();
      if (s >= 10) {
        ctx.beginPath();
        setT(bx, by, L[0], L[2] * L[1], L[1] * 0.95);
        ctx.moveTo(bx, by); ctx.quadraticCurveTo(tx(0.03, -0.5), ty(0.03, -0.5), tx(0, -0.9), ty(0, -0.9));
        ctx.strokeStyle = fade(tone === 'young' ? light(c2, 0.4) : dark(c1, 0.3), 0.5);
        lw(ctx, 0.018, s, 0.4); ctx.stroke();
      }
    }
    ctx.restore();
  };

  // snow resting on a branch: origin = bottom centre, s = half width
  M.snowCap = function (ctx, s, o) {
    var R = rng(opt(o, 'seed', 1));
    var h1 = 0.38 + R() * 0.16, h2 = 0.5 + R() * 0.18, h3 = 0.34 + R() * 0.16, sk = (R() - 0.5) * 0.3;
    ctx.save();
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(-1, 0.02);
    ctx.bezierCurveTo(-1.0, -h1 * 0.6, -0.8, -h1, -0.5 + sk * 0.3, -h1);
    ctx.bezierCurveTo(-0.35, -h2 * 1.02, -0.2 + sk, -h2, 0.05 + sk, -h2);
    ctx.bezierCurveTo(0.35 + sk, -h2, 0.45, -h3 * 1.1, 0.62, -h3);
    ctx.bezierCurveTo(0.85, -h3 * 0.95, 1.02, -h3 * 0.4, 1, 0.02);
    ctx.bezierCurveTo(0.6, 0.14, -0.6, 0.14, -1, 0.02);
    ctx.closePath();
    ctx.fillStyle = gcache(ctx, 'scap', function () {
      return linGrad(ctx, 0, -0.65, 0, 0.12, [0, '#ffffff', 0.45, '#f7f9fb', 0.78, '#dfe7f0', 1, '#bccbdd']);
    });
    ctx.fill();
    ctx.restore();
  };

  // 蓮の葉 — flat lotus pad in perspective, centred, s = radius
  M.lotusPad = function (ctx, s, o) {
    var R = rng(opt(o, 'seed', 1));
    var col = opt(o, 'color', '#4f7c3a'), col2 = opt(o, 'color2', '#94b55a');
    var notch = opt(o, 'notch', true), ry = opt(o, 'tilt', 0.42);
    var a0 = PI / 2 + (R() - 0.5) * 1.2, d = notch ? 0.09 : 0, ph = R() * TAU, i;
    var N = 22, pts = [];
    for (i = 0; i <= N; i++) {
      var th = a0 + d + (TAU - 2 * d) * i / N, r = 1 + 0.035 * sin(th * 5 + ph);
      pts.push(cos(th) * r, sin(th) * r * ry);
    }
    ctx.save();
    ctx.scale(s, s);
    var cx = 0.02, cy = -0.03;
    ctx.beginPath();
    if (notch) ctx.moveTo(cx, cy); else ctx.moveTo(pts[0], pts[1]);
    ctx.lineTo(pts[0], pts[1]);
    for (i = 1; i < N; i++) ctx.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], (pts[i * 2] + pts[i * 2 + 2]) / 2, (pts[i * 2 + 1] + pts[i * 2 + 3]) / 2);
    ctx.lineTo(pts[N * 2], pts[N * 2 + 1]);
    ctx.closePath();
    ctx.fillStyle = gcache(ctx, 'lp' + col + col2 + ry, function () {
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1);
      g.addColorStop(0, col2); g.addColorStop(0.35, mix(col2, col, 0.6)); g.addColorStop(0.85, col); g.addColorStop(1, dark(col, 0.12));
      return g;
    });
    ctx.save(); ctx.scale(1, 1); ctx.fill(); ctx.restore();
    // upturned far rim
    ctx.beginPath();
    for (i = 0; i <= N; i++) {
      var th2 = PI + 0.25 + (PI - 0.5) * i / N;
      var x = cos(th2) * 0.985, y = sin(th2) * ry * 0.985;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = fade(light(col2, 0.25), 0.55);
    lw(ctx, 0.03, s, 0.6); ctx.stroke();
    if (s >= 12) {
      ctx.beginPath();
      for (i = 0; i < 13; i++) {
        var va = a0 + 0.35 + i * (TAU - 0.7) / 12;
        ctx.moveTo(cx, cy); ctx.lineTo(cos(va) * 0.88, sin(va) * 0.88 * ry);
      }
      ctx.strokeStyle = fade(light(col2, 0.3), 0.35);
      lw(ctx, 0.012, s, 0.4); ctx.stroke();
      ctx.beginPath(); ell(ctx, cx, cy, 0.05, 0.05 * ry, 0);
      ctx.fillStyle = fade(light(col2, 0.4), 0.7); ctx.fill();
    }
    ctx.restore();
  };

  // ruffled petal fan between radii r0..r1 around angle a
  function ruffle(ctx, a, r0, r1, hw, R, cy) {
    var a0 = a - hw, a1 = a + hw, j;
    ctx.moveTo(cos(a) * r0, cy + sin(a) * r0);
    ctx.quadraticCurveTo(cos(a0) * r1 * 0.62, cy + sin(a0) * r1 * 0.62, cos(a0) * r1 * 0.94, cy + sin(a0) * r1 * 0.94);
    for (j = 0; j < 3; j++) {
      var am = a0 + (j + 0.5) * (a1 - a0) / 3, ae = a0 + (j + 1) * (a1 - a0) / 3;
      var rr = r1 * (1.06 + 0.06 * R()), re = j === 2 ? r1 * 0.94 : r1 * (0.92 + 0.05 * R());
      ctx.quadraticCurveTo(cos(am) * rr, cy + sin(am) * rr, cos(ae) * re, cy + sin(ae) * re);
    }
    ctx.quadraticCurveTo(cos(a1) * r1 * 0.62, cy + sin(a1) * r1 * 0.62, cos(a) * r0, cy + sin(a) * r0);
    ctx.closePath();
  }

  // 牡丹 — layered bloom, centred, slightly tilted (3/4 view)
  M.peony = function (ctx, s, o) {
    var col = opt(o, 'color', '#d9587f'), R = rng(opt(o, 'seed', 1)), i, k;
    var col2 = opt(o, 'color2', dark(col, 0.32));
    var rot = R() * TAU;
    var rings = [[8, 0.2, 1.0, 0.5, 0], [7, 0.15, 0.8, 0.52, -0.06], [6, 0.1, 0.6, 0.55, -0.11], [5, 0.06, 0.4, 0.62, -0.15]];
    ctx.save();
    ctx.scale(s, s * opt(o, 'tilt', 0.86));
    var edge = fade(light(col, 0.55), 0.45);
    for (k = 0; k < rings.length; k++) {
      var rg = rings[k], cy = rg[4];
      var g = gcache(ctx, 'pn' + col + col2 + k, function () {
        return radGrad(ctx, 0, rg[4], 0, rg[2], [0, col2, 0.45, mix(col2, col, 0.6), 0.85, light(col, 0.08 + k * 0.03), 1, light(col, 0.25)]);
      });
      var off = rot + k * 0.45;
      for (i = 0; i < rg[0]; i++) {
        var a = off + i * TAU / rg[0] + (R() - 0.5) * 0.2;
        ctx.beginPath();
        ruffle(ctx, a, rg[1], rg[2] * (0.92 + R() * 0.1), rg[3], R, cy);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = edge; ctx.lineWidth = 0.014; ctx.stroke();
      }
    }
    // stamens
    ctx.beginPath();
    for (i = 0; i < 16; i++) {
      var sa = rot + i * TAU / 16, sr = 0.1 + 0.07 * R();
      circ(ctx, cos(sa) * sr, -0.17 + sin(sa) * sr, 0.03);
    }
    ctx.fillStyle = '#f2c742'; ctx.fill();
    ctx.beginPath(); circ(ctx, 0, -0.17, 0.06);
    ctx.fillStyle = '#c9d27a'; ctx.fill();
    ctx.restore();
  };

  // 菊 — many thin rounded petals in three rings, centred
  M.chrysanthemum = function (ctx, s, o) {
    var col = opt(o, 'color', '#f0c232'), R = rng(opt(o, 'seed', 1)), i, k;
    var col2 = opt(o, 'color2', mix(col, '#b85a10', 0.45));
    var rot = R() * TAU;
    var rings = [[24, 1.0, 0.115], [20, 0.76, 0.12], [14, 0.5, 0.13]];
    ctx.save();
    ctx.scale(s, s);
    ctx.fillStyle = gcache(ctx, 'ch' + col + col2, function () {
      return radGrad(ctx, 0, 0, 0, 1, [0, col2, 0.3, mix(col2, col, 0.5), 0.7, col, 1, light(col, 0.3)]);
    });
    var edge = fade(dark(col2, 0.2), 0.35);
    for (k = 0; k < rings.length; k++) {
      var n = rings[k][0], L = rings[k][1], w = rings[k][2];
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        var a = rot + (i + (k % 2) * 0.5) * TAU / n + (R() - 0.5) * 0.04;
        shape(ctx, CHRYS_H, sin(a) * 0.08, -cos(a) * 0.08, a, w * 2, L * (0.94 + R() * 0.08) - 0.08);
      }
      ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = 0.012; ctx.stroke();
    }
    ctx.beginPath(); circ(ctx, 0, 0, 0.17);
    ctx.fillStyle = gcache(ctx, 'chc' + col2, function () { return radGrad(ctx, 0, 0, 0, 0.17, [0, mix(col2, '#7a8a2a', 0.3), 1, col2]); });
    ctx.fill();
    if (s >= 16) {
      ctx.beginPath();
      for (i = 0; i < 10; i++) { var da = i * 2.4, dr = 0.04 + 0.1 * sqrt(i / 10); circ(ctx, cos(da) * dr, sin(da) * dr, 0.018); }
      ctx.fillStyle = fade(light(col, 0.4), 0.7); ctx.fill();
    }
    ctx.restore();
  };

  /* ============================================================== PLANTS */
  // all plants: base at origin, height h, drawn in unit space (y from 0 to -1)

  function stroke(ctx, col, w, h, minPx) { ctx.strokeStyle = col; lw(ctx, w, h, minPx); ctx.stroke(); }

  // 葦 — clump of reeds with drooping plumes
  M.reeds = function (ctx, h, o) {
    var col = opt(o, 'color', '#6f8a46'), plume = clamp(opt(o, 'plume', 0.6), 0, 1);
    var ph = opt(o, 'phase', 0), R = rng(opt(o, 'seed', 1));
    var pc = opt(o, 'color2', '#9a7f74');
    var n = 5 + floor(R() * 3), i, j, st = [];
    for (i = 0; i < n; i++) {
      var x0 = (R() - 0.5) * 0.16, ht = 0.72 + 0.28 * R(), lean = (R() - 0.5) * 0.22 + x0 * 0.8;
      var sw = sin(ph * TAU + i * 0.9) * 0.05 * ht;
      st.push([x0, 0, x0 + lean * 0.3 + sw * 0.25, -ht * 0.55, x0 + lean + sw, -ht, R() < 0.5 ? -1 : 1]);
    }
    ctx.save();
    ctx.scale(h, h);
    ctx.lineCap = 'round';
    // leaves
    var gl = gcache(ctx, 'rdl' + col, function () { return linGrad(ctx, 0, 0, 0, -1, [0, dark(col, 0.25), 1, light(col, 0.12)]); });
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var S = st[i];
      for (j = 0; j < 3; j++) {
        var f = 0.22 + j * 0.2 + R() * 0.06, p = qpt(S[0], S[1], S[2], S[3], S[4], S[5], f);
        var side = (j % 2 ? 1 : -1) * S[6], ll = 0.24 + R() * 0.12, sw2 = sin(ph * TAU + i + j) * 0.02;
        var ex = p[0] + side * ll * 0.75 + sw2, ey = p[1] - ll * 0.35 + ll * 0.25;
        blade(ctx, p[0], p[1], p[0] + side * ll * 0.35, p[1] - ll * 0.55, ex, ey, 0.022, 0, 0.7);
      }
    }
    ctx.fillStyle = gl; ctx.fill();
    // stems
    ctx.beginPath();
    for (i = 0; i < n; i++) { var T = st[i]; ctx.moveTo(T[0], T[1]); ctx.quadraticCurveTo(T[2], T[3], T[4], T[5]); }
    stroke(ctx, dark(col, 0.12), 0.008, h, 0.8);
    // plumes
    if (plume > 0.02) {
      var gp = gcache(ctx, 'rdp' + pc, function () { return linGrad(ctx, 0, -1, 0, -0.75, [0, light(pc, 0.2), 1, pc]); });
      for (i = 0; i < n; i++) {
        var P = st[i], dir = P[4] - P[2] >= 0 ? 1 : -1, pl = 0.2 * plume * (0.8 + 0.2 * R());
        var px = P[4], py = P[5];
        ctx.beginPath();
        blade(ctx, px, py + 0.02, px + dir * pl * 0.45, py - pl * 0.35, px + dir * pl * 0.75, py + pl * 0.25, 0.05 * plume, 0, 0.9);
        ctx.fillStyle = gp; ctx.fill();
        ctx.beginPath();
        for (j = 0; j < 4; j++) {
          var dj = (j - 1.5) * 0.05;
          ctx.moveTo(px, py); ctx.quadraticCurveTo(px + dir * pl * (0.4 + dj), py - pl * (0.45 + dj), px + dir * pl * (0.85 + dj * 0.5), py + pl * (0.35 + dj * 2));
        }
        stroke(ctx, fade(pc, 0.7), 0.006, h, 0.5);
      }
    }
    ctx.restore();
  };

  // 草 — a tuft of grass blades
  var GRASS = { young: ['#7fae3c', '#cfe57e'], green: ['#3a6e32', '#76a44a'], dry: ['#9a7f48', '#d8c27e'], frost: ['#5f7c74', '#eef4f4'] };
  M.grass = function (ctx, h, o) {
    var tone = opt(o, 'tone', 'green'), C = GRASS[tone] || GRASS.green;
    var ph = opt(o, 'phase', 0), R = rng(opt(o, 'seed', 1));
    var n = 9 + floor(R() * 5), i;
    ctx.save();
    ctx.scale(h, h);
    var g = gcache(ctx, 'gr' + tone, function () { return linGrad(ctx, 0, 0, 0, -1, [0, dark(C[0], 0.15), 0.4, C[0], 1, C[1]]); });
    var back = [], front = [];
    for (i = 0; i < n; i++) {
      var a = (R() - 0.5) * 1.5, len = (0.45 + 0.55 * R()) * (1 - abs(a) * 0.25);
      var x0 = (R() - 0.5) * 0.12, sway = sin(ph * TAU + i * 1.3) * 0.06 * len;
      var tipx = x0 + sin(a) * len * (1 + abs(a) * 0.3) + sway, tipy = -cos(a) * len * (1 - 0.35 * abs(a));
      var b = [x0, 0, x0 + sin(a) * len * 0.3, -len * 0.62, tipx, tipy, 0.03 + 0.02 * R()];
      (R() < 0.45 ? back : front).push(b);
    }
    ctx.fillStyle = g;
    for (var pass = 0; pass < 2; pass++) {
      var arr = pass ? front : back;
      ctx.beginPath();
      for (i = 0; i < arr.length; i++) { var B = arr[i]; blade(ctx, B[0], B[1], B[2], B[3], B[4], B[5], B[6], 0, 0.75); }
      ctx.fill();
      if (!pass) { ctx.fillStyle = fade(dark(C[0], 0.3), 0.35); ctx.fill(); ctx.fillStyle = g; }
    }
    ctx.restore();
  };

  // 芹 — water dropwort sprigs with toothed trifoliate leaves
  M.seri = function (ctx, h, o) {
    var ph = opt(o, 'phase', 0), R = rng(opt(o, 'seed', 1));
    var col = opt(o, 'color', '#4f8d38'), col2 = opt(o, 'color2', '#86ba57');
    var n = 4 + floor(R() * 2), i, j, k;
    ctx.save();
    ctx.scale(h, h);
    ctx.lineCap = 'round';
    var stems = [];
    for (i = 0; i < n; i++) {
      var x0 = (R() - 0.5) * 0.12, ht = 0.55 + 0.45 * R(), lean = (i / (n - 1) - 0.5) * 0.6 + (R() - 0.5) * 0.15;
      var sw = sin(ph * TAU + i * 1.1) * 0.04 * ht;
      stems.push([x0, 0, x0 + lean * 0.25, -ht * 0.5, x0 + lean * ht * 0.6 + sw, -ht]);
    }
    ctx.beginPath();
    for (i = 0; i < n; i++) { var S = stems[i]; ctx.moveTo(S[0], S[1]); ctx.quadraticCurveTo(S[2], S[3], S[4], S[5]); }
    ctx.strokeStyle = gcache(ctx, 'srs', function () { return linGrad(ctx, 0, 0, 0, -0.5, [0, '#d8c9b0', 0.25, '#9a8a6a', 0.6, '#6a8a3e']); });
    lw(ctx, 0.016, h, 0.7); ctx.stroke();
    for (i = 0; i < n; i++) {
      var T = stems[i];
      for (j = 0; j < 2; j++) {
        var f = j ? 1 : 0.55 + R() * 0.1, p = qpt(T[0], T[1], T[2], T[3], T[4], T[5], f);
        var base = Math.atan2(p[2], -p[3]); // direction angle of stem (clockwise from up)
        var la = j ? base : base + (R() < 0.5 ? -0.9 : 0.9);
        var px = p[0], py = p[1], sz = (j ? 0.12 : 0.1) * (0.85 + 0.3 * R());
        if (!j) { // short petiole
          var qx = px + sin(la) * 0.06, qy = py - cos(la) * 0.06;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy);
          stroke(ctx, '#6a8a3e', 0.01, h, 0.5); px = qx; py = qy;
        }
        for (k = 0; k < 3; k++) {
          var ka = la + (k - 1) * 0.95;
          ctx.beginPath();
          shape(ctx, SERRATE_H, px, py, ka, sz * 0.95, sz * (k === 1 ? 1.15 : 0.95));
          ctx.fillStyle = k === 1 ? col2 : col; ctx.fill();
        }
      }
    }
    ctx.restore();
  };

  // 蕗の薹 — butterbur buds peeking from snow (or earth)
  M.fuki = function (ctx, h, o) {
    var R = rng(opt(o, 'seed', 1)), ground = opt(o, 'ground', 'snow');
    var n = 1 + floor(R() * 2.4), i, k;
    ctx.save();
    ctx.scale(h, h);
    var buds = [[0, 1]];
    if (n > 1) buds.push([-0.42 - R() * 0.1, 0.6 + R() * 0.1]);
    if (n > 2) buds.push([0.4 + R() * 0.1, 0.5 + R() * 0.1]);
    buds.sort(function (a, b) { return a[1] - b[1]; });
    for (i = 0; i < buds.length; i++) {
      var bx = buds[i][0], sc = buds[i][1] * 0.95, by = -0.06;
      // bracts: back ones darker, front lighter, cupping a cream floret cluster
      var bw = 0.34 * sc, bh = 0.78 * sc;
      ctx.beginPath(); shape(ctx, MOMO_H, bx, by, -0.42, bw * 1.3, bh * 0.85); shape(ctx, MOMO_H, bx, by, 0.42, bw * 1.3, bh * 0.85);
      ctx.fillStyle = '#7f9a48'; ctx.fill();
      ctx.beginPath();
      for (k = 0; k < 9; k++) circ(ctx, bx + (k % 3 - 1) * 0.07 * sc, by - bh * 0.72 - floor(k / 3) * 0.05 * sc + abs(k % 3 - 1) * 0.03 * sc, 0.055 * sc);
      ctx.fillStyle = '#eee7b4'; ctx.fill();
      ctx.beginPath(); shape(ctx, MOMO_H, bx, by, -0.2, bw * 1.5, bh * 0.75); shape(ctx, MOMO_H, bx, by, 0.22, bw * 1.5, bh * 0.72);
      ctx.fillStyle = '#a7c262'; ctx.fill();
      ctx.beginPath(); shape(ctx, UME_H, bx, by, 0.02, bw * 1.9, bh * 0.52);
      ctx.fillStyle = gcache(ctx, 'fkf', function () { return linGrad(ctx, 0, 0, 0, -0.5, [0, '#9fbd58', 1, '#cfe08c']); });
      ctx.fill();
      ctx.beginPath(); shape(ctx, MOMO_H, bx - bw * 0.5, by + 0.01, -0.75, bw * 1.0, bh * 0.45); shape(ctx, MOMO_H, bx + bw * 0.5, by + 0.01, 0.8, bw * 1.0, bh * 0.42);
      ctx.fillStyle = '#b9cf72'; ctx.fill();
    }
    // ground mound
    ctx.beginPath();
    ctx.moveTo(-0.75, 0.0);
    ctx.bezierCurveTo(-0.5, -0.12, -0.25, -0.1, 0, -0.08);
    ctx.bezierCurveTo(0.25, -0.1, 0.55, -0.13, 0.75, 0.0);
    ctx.closePath();
    ctx.fillStyle = ground === 'snow'
      ? gcache(ctx, 'fks', function () { return linGrad(ctx, 0, -0.13, 0, 0, [0, '#ffffff', 0.6, '#eef2f6', 1, '#c6d3e2']); })
      : gcache(ctx, 'fke', function () { return linGrad(ctx, 0, -0.13, 0, 0, [0, '#7a5e40', 1, '#4e3a28']); });
    ctx.fill();
    ctx.restore();
  };

  // 燕子花 — Kōrin-style iris: sword leaves in two greens and ultramarine flowers
  function irisFlower(ctx, x, y, f, tilt, c1, c2, c3) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.scale(f, f);
    // spathe
    ctx.beginPath(); shape(ctx, LANCE_H, 0, 0.32, 0.22, 0.22, 0.5);
    ctx.fillStyle = '#3f7d3e'; ctx.fill();
    // back standards
    ctx.beginPath(); shape(ctx, MOMO_H, -0.02, 0, -0.42, 0.34, 0.78); shape(ctx, MOMO_H, 0.02, 0, 0.42, 0.34, 0.78);
    ctx.fillStyle = c3; ctx.fill();
    // side falls
    ctx.beginPath(); shape(ctx, UME_H, -0.04, -0.02, -1.95, 0.62, 0.82); shape(ctx, UME_H, 0.04, -0.02, 1.95, 0.62, 0.82);
    ctx.fillStyle = c2; ctx.fill();
    // centre standard
    ctx.beginPath(); shape(ctx, MOMO_H, 0, 0, 0, 0.32, 0.72);
    ctx.fillStyle = c2; ctx.fill();
    // front fall
    ctx.beginPath(); shape(ctx, UME_H, 0, -0.05, PI - 0.08, 0.78, 0.92);
    ctx.fillStyle = c1; ctx.fill();
    // white signal streaks
    ctx.beginPath();
    shape(ctx, LANCE_H, 0.0, 0.08, PI - 0.08, 0.14, 0.5);
    shape(ctx, LANCE_H, -0.08, 0.0, -1.95, 0.1, 0.38);
    shape(ctx, LANCE_H, 0.08, 0.0, 1.95, 0.1, 0.38);
    ctx.fillStyle = 'rgba(244,240,226,0.92)'; ctx.fill();
    ctx.restore();
  }
  M.iris = function (ctx, h, o) {
    var ph = opt(o, 'phase', 0), R = rng(opt(o, 'seed', 1));
    var c1 = opt(o, 'color', '#25298a'), c2 = mix(c1, '#4a58c0', 0.45), c3 = mix(c1, '#8a92de', 0.45);
    var g1 = opt(o, 'leaf', '#3f8a45'), g2 = dark(g1, 0.28), g3 = light(g1, 0.15);
    var n = 7 + floor(R() * 3), i;
    ctx.save();
    ctx.scale(h, h);
    var leaves = [];
    for (i = 0; i < n; i++) {
      var x0 = (R() - 0.5) * 0.18, a = (i / (n - 1) - 0.5) * 0.7 + (R() - 0.5) * 0.12, ht = 0.6 + 0.4 * R();
      var bend = (R() - 0.5) * 0.25 + a * 0.4, sw = sin(ph * TAU + i * 0.8) * 0.025 * ht;
      leaves.push([x0, a, ht, bend, sw, floor(R() * 3)]);
    }
    var tones = [g1, g2, g3];
    for (i = 0; i < n; i++) {
      var L = leaves[i], tipx = L[0] + sin(L[1]) * L[2] + L[3] * L[2] * 0.4 + L[4], tipy = -cos(L[1]) * L[2];
      ctx.beginPath();
      blade(ctx, L[0], 0.0, L[0] + sin(L[1]) * L[2] * 0.5, -L[2] * 0.55, tipx, tipy, 0.06, 0, 1.0);
      ctx.fillStyle = tones[L[5]]; ctx.fill();
    }
    var nf = 2 + floor(R() * 2);
    for (i = 0; i < nf; i++) {
      var fx = (i - (nf - 1) / 2) * 0.16 + (R() - 0.5) * 0.06, fy = -(0.55 + R() * 0.3);
      var sw2 = sin(ph * TAU + i * 1.7) * 0.02;
      ctx.beginPath(); ctx.moveTo(fx * 0.4, 0); ctx.quadraticCurveTo(fx * 0.8, fy * 0.5, fx + sw2, fy + 0.04);
      stroke(ctx, '#3a7a3c', 0.014, h, 0.7);
      irisFlower(ctx, fx + sw2, fy, 0.17 * (0.85 + 0.3 * R()), (R() - 0.5) * 0.3, c1, c2, c3);
    }
    ctx.restore();
  };

  // 蓮 — lotus flower standing above its pad
  M.lotus = function (ctx, h, o) {
    var open = clamp(opt(o, 'open', 1), 0, 1), R = rng(opt(o, 'seed', 1));
    var col = opt(o, 'color', '#e06f93'), ph = opt(o, 'phase', 0);
    var side = R() < 0.5 ? -1 : 1, i;
    ctx.save();
    ctx.scale(h, h);
    ctx.lineCap = 'round';
    // pad on its own stalk
    var padX = side * (0.24 + R() * 0.06), padY = -0.3 - R() * 0.08;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(padX * 0.6, -0.1, padX + 0.02, padY + 0.01);
    stroke(ctx, '#5f7a3a', 0.016, h, 0.7);
    ctx.save(); ctx.translate(padX, padY); M.lotusPad(ctx, 0.3, { seed: R() * 1000 }); ctx.restore();
    // flower stalk
    var sw = sin(ph * TAU) * 0.02, fx = -side * 0.03 + sw, fy = -0.7;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-side * 0.06, -0.4, fx, fy);
    stroke(ctx, '#5f7a3a', 0.018, h, 0.8);
    var fs = 0.3, e = smooth(open);
    var g = gcache(ctx, 'lo' + col, function () {
      return radGrad(ctx, 0, 0, 0, 1, [0, '#fbf3ec', 0.45, mix('#fbf3ec', col, 0.25), 0.8, mix('#fbf3ec', col, 0.7), 1, col]);
    });
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(fs, fs);
    var back = [-1.15, -0.6, 0, 0.6, 1.15], front = [-1.35, -0.75, 0.75, 1.35];
    var edge = fade('#ffffff', 0.5);
    for (i = 0; i < back.length; i++) {
      ctx.beginPath(); shape(ctx, LOTUS_H, 0, 0, back[i] * e * 0.9, 0.78 * lerp(1.15, 1, e), 1.0 - abs(back[i]) * 0.08);
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = 0.02; ctx.stroke();
    }
    if (e > 0.45) {
      var pe = (e - 0.45) / 0.55;
      ctx.beginPath();
      for (i = 0; i < 14; i++) { var sa = -PI + i * PI / 13; ctx.moveTo(cos(sa) * 0.14, -0.3); ctx.lineTo(cos(sa) * 0.26 * pe, -0.3 - (0.12 + 0.08 * abs(sin(sa))) * pe); }
      ctx.strokeStyle = '#f2c94a'; ctx.lineWidth = 0.03; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.08, -0.12); ctx.lineTo(-0.2 * pe - 0.04, -0.34); ctx.quadraticCurveTo(0, -0.4, 0.2 * pe + 0.04, -0.34); ctx.lineTo(0.08, -0.12); ctx.closePath();
      ctx.fillStyle = '#c9c35a'; ctx.fill();
      ctx.beginPath(); ell(ctx, 0, -0.35, 0.2 * pe + 0.04, 0.05, 0);
      ctx.fillStyle = '#e0d878'; ctx.fill();
    }
    for (i = 0; i < front.length; i++) {
      ctx.beginPath(); shape(ctx, LOTUS_H, 0, 0.02, front[i] * e, 0.8 * lerp(1.1, 1, e), 0.82 * lerp(1, 0.85, e));
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = 0.02; ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  };

  // 筍 — bamboo shoot of overlapping spotted sheaths
  M.bambooShoot = function (ctx, h, o) {
    var R = rng(opt(o, 'seed', 1)), lean = (R() - 0.5) * 0.12, i;
    ctx.save();
    ctx.scale(h, h);
    var W = 0.22, N = 7;
    function edgeX(t, sgn) { return lean * t * t + sgn * W * (1 - t) * (0.9 + 0.1 * (1 - t)); }
    ctx.beginPath();
    ctx.moveTo(edgeX(0, -1), 0);
    for (i = 1; i <= 10; i++) ctx.lineTo(edgeX(i / 10, -1), -i / 10);
    for (i = 10; i >= 0; i--) ctx.lineTo(edgeX(i / 10, 1), -i / 10);
    ctx.closePath();
    ctx.fillStyle = '#5a3d26'; ctx.fill();
    var g = gcache(ctx, 'bs', function () { return linGrad(ctx, -0.25, 0, 0.25, 0, [0, '#6e4c2e', 0.4, '#9b7445', 0.7, '#a98250', 1, '#6a482c']); });
    for (i = N - 1; i >= 0; i--) {
      var t0 = i / N * 0.85, t1 = mmin(1, t0 + 0.32), sd = i % 2 ? 1 : -1;
      var yb = -t0, yt = -t1, xl = edgeX(t0, -1) - 0.01, xr = edgeX(t0, 1) + 0.01, xt = lean * t1 * t1 + sd * 0.03;
      ctx.beginPath();
      ctx.moveTo(xl, yb);
      ctx.quadraticCurveTo(xl + (xt - xl) * 0.2, yb + (yt - yb) * 0.6, xt, yt);
      ctx.quadraticCurveTo(xr + (xt - xr) * 0.2, yb + (yt - yb) * 0.6, xr, yb);
      ctx.quadraticCurveTo((xl + xr) / 2, yb + 0.03, xl, yb);
      ctx.closePath();
      ctx.fillStyle = i >= N - 2 ? mix('#a98250', '#b5b25e', (i - N + 3) / 2) : g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,210,170,0.45)'; lw(ctx, 0.008, h, 0.5); ctx.stroke();
      if (h >= 40 && i < N - 2) {
        ctx.beginPath();
        for (var k = 0; k < 5; k++) {
          var sx = lerp(xl, xr, 0.2 + 0.6 * R()), sy = yb - 0.02 - R() * (t1 - t0) * 0.45;
          ell(ctx, sx, sy, 0.012, 0.006, 0.3);
        }
        ctx.fillStyle = 'rgba(50,32,20,0.55)'; ctx.fill();
      }
    }
    // green tip leaflets
    var tx0 = lean, ty0 = -1;
    ctx.beginPath(); shape(ctx, LANCE_H, tx0, ty0 + 0.04, -0.25, 0.05, 0.1); shape(ctx, LANCE_H, tx0, ty0 + 0.04, 0.3, 0.05, 0.08);
    ctx.fillStyle = '#7f9a45'; ctx.fill();
    // earth
    ctx.beginPath(); ctx.moveTo(-0.42, 0.01); ctx.quadraticCurveTo(0, -0.12, 0.42, 0.01); ctx.closePath();
    ctx.fillStyle = '#5a4430'; ctx.fill();
    ctx.restore();
  };

  // 麦 — ripe wheat with awns
  M.wheat = function (ctx, h, o) {
    var ph = opt(o, 'phase', 0), R = rng(opt(o, 'seed', 1));
    var col = opt(o, 'color', '#d4a548'), n = 5 + floor(R() * 3), i, k;
    ctx.save();
    ctx.scale(h, h);
    ctx.lineCap = 'round';
    // dry leaves
    ctx.beginPath();
    for (i = 0; i < 4; i++) {
      var la = (R() - 0.5) * 1.4, ll = 0.3 + R() * 0.2, lx = (R() - 0.5) * 0.08, ly = -0.1 - R() * 0.25;
      blade(ctx, lx, ly, lx + sin(la) * ll * 0.5, ly - ll * 0.5, lx + sin(la) * ll * 1.1, ly - ll * 0.35, 0.025, 0, 0.7);
    }
    ctx.fillStyle = mix(col, '#9a8a4a', 0.4); ctx.fill();
    var stalks = [];
    for (i = 0; i < n; i++) {
      var x0 = (R() - 0.5) * 0.08, ht = 0.72 + 0.22 * R(), lean = (i / (n - 1) - 0.5) * 0.4 + (R() - 0.5) * 0.08;
      var sw = sin(ph * TAU + i * 0.7) * 0.035 * ht;
      stalks.push([x0, 0, x0 + lean * ht * 0.35, -ht * 0.5, x0 + lean * ht + sw, -ht + abs(lean) * 0.08]);
    }
    ctx.beginPath();
    for (i = 0; i < n; i++) { var S = stalks[i]; ctx.moveTo(S[0], S[1]); ctx.quadraticCurveTo(S[2], S[3], S[4], S[5]); }
    stroke(ctx, mix(col, '#a08a50', 0.35), 0.008, h, 0.7);
    var gr = dark(col, 0.12), gl = light(col, 0.18);
    for (i = 0; i < n; i++) {
      var T = stalks[i], dx = T[4] - T[2], dy = T[5] - T[3], dl = sqrt(dx * dx + dy * dy);
      var ux = dx / dl, uy = dy / dl;
      var nod = 0.12 * (ux >= 0 ? 1 : -1); var c = cos(nod), s2 = sin(nod);
      var vx = ux * c - uy * s2, vy = ux * s2 + uy * c, nx = -vy, ny = vx;
      var el = 0.17, gs = 0.022;
      ctx.beginPath();
      var aw = [];
      for (k = 0; k < 9; k++) {
        var t = k / 9, px = T[4] + vx * el * t, py = T[5] + vy * el * t, sc = 1 - t * 0.35;
        for (var sd = -1; sd <= 1; sd += 2) {
          var gx = px + nx * gs * 0.75 * sd * sc, gy = py + ny * gs * 0.75 * sd * sc;
          ell(ctx, gx, gy, gs * 1.15 * sc, gs * 0.62 * sc, Math.atan2(vy, vx) - sd * 0.5);
          aw.push(gx + vx * gs * sc, gy + vy * gs * sc, gx + (vx * 0.95 + nx * sd * 0.25) * 0.15, gy + (vy * 0.95 + ny * sd * 0.25) * 0.15);
        }
      }
      ctx.fillStyle = (i % 2) ? gr : col; ctx.fill();
      ctx.beginPath();
      for (k = 0; k < aw.length; k += 4) { ctx.moveTo(aw[k], aw[k + 1]); ctx.lineTo(aw[k + 2], aw[k + 3]); }
      stroke(ctx, fade(gl, 0.85), 0.0035, h, 0.35);
    }
    ctx.restore();
  };

  // 稲 — drooping golden rice ears
  M.rice = function (ctx, h, o) {
    var ph = opt(o, 'phase', 0), R = rng(opt(o, 'seed', 1));
    var col = opt(o, 'color', '#d8ae4a'), n = 4 + floor(R() * 3), i, k;
    ctx.save();
    ctx.scale(h, h);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (i = 0; i < 7; i++) {
      var la = (R() - 0.5) * 1.2, ll = 0.45 + R() * 0.35, lx = (R() - 0.5) * 0.06;
      blade(ctx, lx, 0, lx + sin(la) * ll * 0.4, -ll * 0.7, lx + sin(la) * ll * 0.95 + (la > 0 ? 0.1 : -0.1), -ll * 0.62, 0.024, 0, 0.8);
    }
    ctx.fillStyle = gcache(ctx, 'rcl' + col, function () { return linGrad(ctx, 0, 0, 0, -0.9, [0, '#7f8a3a', 0.5, mix('#9a9a48', col, 0.4), 1, col]); });
    ctx.fill();
    for (i = 0; i < n; i++) {
      var x0 = (R() - 0.5) * 0.06, ht = 0.72 + 0.25 * R(), dir = (i % 2 ? 1 : -1) * (R() < 0.8 ? 1 : -1);
      var sw = sin(ph * TAU + i * 0.9) * 0.03;
      var ax = x0 + dir * (0.08 + R() * 0.08) + sw, ay = -ht;
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.quadraticCurveTo(x0 + dir * 0.02, -ht * 0.6, ax, ay);
      stroke(ctx, mix(col, '#8a8a40', 0.4), 0.008, h, 0.7);
      // panicle: arc bowing over and down
      var c1x = ax + dir * 0.14, c1y = ay - 0.06, ex = ax + dir * (0.22 + R() * 0.05) + sw, ey = ay + 0.24 + R() * 0.06;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(c1x, c1y, ex, ey);
      stroke(ctx, dark(col, 0.2), 0.005, h, 0.5);
      ctx.beginPath();
      for (k = 1; k <= 11; k++) {
        var p = qpt(ax, ay, c1x, c1y, ex, ey, k / 11.5), tl = sqrt(p[2] * p[2] + p[3] * p[3]);
        var ux = p[2] / tl, uy = p[3] / tl, sd = k % 2 ? 1 : -1;
        var gx = p[0] - uy * sd * 0.016, gy = p[1] + ux * sd * 0.016 + 0.006;
        ell(ctx, gx, gy, 0.019, 0.011, Math.atan2(uy, ux) + sd * 0.35);
      }
      ctx.fillStyle = (i % 2) ? col : dark(col, 0.1); ctx.fill();
    }
    ctx.restore();
  };

  // 紅花 — safflower thistle-like heads
  M.safflower = function (ctx, h, o) {
    var ph = opt(o, 'phase', 0), R = rng(opt(o, 'seed', 1));
    var col = opt(o, 'color', '#f2a22a'), col2 = opt(o, 'color2', '#d9442a');
    var n = 2 + floor(R() * 2), i, k;
    ctx.save();
    ctx.scale(h, h);
    ctx.lineCap = 'round';
    var heads = [];
    for (i = 0; i < n; i++) {
      var x0 = (i - (n - 1) / 2) * 0.08, ht = 0.65 + 0.35 * R(), lean = (i - (n - 1) / 2) * 0.22 + (R() - 0.5) * 0.08;
      var sw = sin(ph * TAU + i * 1.2) * 0.03 * ht, ex = x0 + lean * ht + sw, ey = -ht;
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.quadraticCurveTo(x0 + lean * ht * 0.3, -ht * 0.5, ex, ey);
      stroke(ctx, '#6a8a42', 0.014, h, 0.7);
      for (k = 0; k < 3; k++) {
        var p = qpt(x0, 0, x0 + lean * ht * 0.3, -ht * 0.5, ex, ey, 0.25 + k * 0.22), sd = k % 2 ? 1 : -1;
        ctx.beginPath(); shape(ctx, LANCE_H, p[0], p[1], sd * (0.9 + R() * 0.3), 0.08, 0.17 - k * 0.025);
        ctx.fillStyle = k % 2 ? '#6f9244' : '#58793a'; ctx.fill();
      }
      heads.push([ex, ey, 0.75 + R() * 0.35, R()]);
    }
    for (i = 0; i < heads.length; i++) {
      var H = heads[i], hx = H[0], hy = H[1], sc = 0.1 * H[2];
      // florets fan
      ctx.beginPath();
      for (k = 0; k < 15; k++) {
        var a = (k / 14 - 0.5) * 2.1, fl = sc * (1.0 + 0.25 * ((k * 5) % 3) / 2);
        shape(ctx, LANCE_H, hx, hy - sc * 0.45, a, sc * 0.22, fl);
      }
      ctx.fillStyle = H[3] < 0.5 ? col : mix(col, col2, 0.55); ctx.fill();
      // bract cup
      ctx.beginPath(); ell(ctx, hx, hy - sc * 0.15, sc * 0.5, sc * 0.45, 0);
      for (k = 0; k < 7; k++) { var ba = (k / 6 - 0.5) * 2.4; shape(ctx, LANCE_H, hx + sin(ba) * sc * 0.3, hy - sc * 0.05, ba * 0.9, sc * 0.22, sc * 0.55); }
      ctx.fillStyle = '#6e9244'; ctx.fill();
      ctx.beginPath(); ell(ctx, hx, hy - sc * 0.1, sc * 0.32, sc * 0.3, 0);
      ctx.fillStyle = '#86a852'; ctx.fill();
    }
    ctx.restore();
  };

  // 薄 — pampas grass with silvery plumes
  M.susuki = function (ctx, h, o) {
    var ph = opt(o, 'phase', 0), R = rng(opt(o, 'seed', 1));
    var col = opt(o, 'color', '#7d8a58'), pc = opt(o, 'color2', '#ebe3d2');
    var i, k;
    ctx.save();
    ctx.scale(h, h);
    ctx.lineCap = 'round';
    ctx.beginPath();
    var nl = 8 + floor(R() * 4);
    for (i = 0; i < nl; i++) {
      var a = (R() - 0.5) * 1.6, ll = 0.5 + R() * 0.4, lx = (R() - 0.5) * 0.08, sw = sin(ph * TAU + i) * 0.03 * ll;
      var sd = a >= 0 ? 1 : -1;
      blade(ctx, lx, 0, lx + sin(a) * ll * 0.45, -ll * 0.82, lx + sin(a) * ll * 0.95 + sd * ll * 0.28 + sw, -ll * 0.48 + abs(a) * 0.12, 0.022, 0, 0.8);
    }
    ctx.fillStyle = gcache(ctx, 'ssl' + col, function () { return linGrad(ctx, 0, 0, 0, -0.9, [0, dark(col, 0.25), 1, light(col, 0.15)]); });
    ctx.fill();
    var ns = 3 + floor(R() * 2), dirAll = R() < 0.5 ? -1 : 1;
    for (i = 0; i < ns; i++) {
      var x0 = (R() - 0.5) * 0.06, ht = 0.78 + 0.22 * R(), lean = (i - (ns - 1) / 2) * 0.12 + dirAll * 0.06;
      var sw2 = (sin(ph * TAU + i * 0.6) * 0.05 + dirAll * 0.03) * ht;
      var tx2 = x0 + lean * ht + sw2, ty2 = -ht;
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.quadraticCurveTo(x0 + lean * ht * 0.4, -ht * 0.55, tx2, ty2 + 0.16);
      stroke(ctx, mix(col, '#a09a70', 0.4), 0.008, h, 0.7);
      var nb = 7 + floor(R() * 3);
      for (k = 0; k < nb; k++) {
        var bx = tx2 - (tx2 - x0) * 0.0, by = ty2 + 0.16 - k * 0.018;
        var spread = (k / (nb - 1) - 0.5) * 1.0, bl = 0.2 + R() * 0.07;
        var bdir = dirAll * 0.25 + spread + sin(ph * TAU + k) * 0.05;
        var ex = bx + sin(bdir) * bl * 0.8 + dirAll * bl * 0.25, ey = by - cos(bdir) * bl * 0.85 + bl * 0.25;
        ctx.beginPath();
        blade(ctx, bx, by, bx + sin(bdir) * bl * 0.5, by - bl * 0.75, ex, ey, 0.024, 0, 1.1);
        ctx.fillStyle = gcache(ctx, 'ssp' + pc, function () { return linGrad(ctx, 0, -1, 0, -0.6, [0, fade(light(pc, 0.3), 0.9), 0.5, fade(pc, 0.85), 1, fade(mix(pc, '#c9a89a', 0.5), 0.8)]); });
        ctx.fill();
      }
    }
    ctx.restore();
  };

  // 日本水仙 — white six-petal flowers with yellow cups on a scape among strap leaves
  M.narcissus = function (ctx, h, o) {
    var ph = opt(o, 'phase', 0), R = rng(opt(o, 'seed', 1)), i, k;
    var col = opt(o, 'color', '#fbf8ee'), cup = opt(o, 'color2', '#f0b928');
    ctx.save();
    ctx.scale(h, h);
    ctx.lineCap = 'round';
    var nl = 4 + floor(R() * 2), lg = gcache(ctx, 'nl', function () { return linGrad(ctx, 0, 0, 0, -0.9, [0, '#4a7462', 1, '#7aa48a']); });
    ctx.beginPath();
    for (i = 0; i < nl; i++) {
      var a = (i / (nl - 1) - 0.5) * 0.7 + (R() - 0.5) * 0.1, ll = 0.55 + R() * 0.35, lx = (R() - 0.5) * 0.06;
      var sw = sin(ph * TAU + i) * 0.02, sd = a >= 0 ? 1 : -1;
      blade(ctx, lx, 0, lx + sin(a) * ll * 0.5, -ll * 0.6, lx + sin(a) * ll + sd * 0.06 + sw, -ll * 0.95, 0.045, 0.012, 1.0);
    }
    ctx.fillStyle = lg; ctx.fill();
    var sx = sin(ph * TAU + 2) * 0.02 + (R() - 0.5) * 0.06, sy = -0.78;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(0.01, -0.4, sx, sy);
    stroke(ctx, '#5f8f6e', 0.016, h, 0.8);
    // papery spathe
    ctx.beginPath(); shape(ctx, LANCE_H, sx, sy + 0.01, 0.35, 0.05, 0.12);
    ctx.fillStyle = '#c8b98c'; ctx.fill();
    var nf = 3 + floor(R() * 2), fl = [];
    for (i = 0; i < nf; i++) {
      var fa = (i / (nf - 1) - 0.5) * 2.6 + (R() - 0.5) * 0.2, pl = 0.06 + R() * 0.04;
      fl.push([sx + sin(fa) * pl, sy - cos(fa) * pl * 0.6 + 0.02, fa, 0.075 + R() * 0.015]);
    }
    fl.sort(function (A, B) { return A[1] - B[1]; });
    ctx.beginPath();
    for (i = 0; i < nf; i++) { ctx.moveTo(sx, sy); ctx.lineTo(fl[i][0], fl[i][1]); }
    stroke(ctx, '#6f9a74', 0.007, h, 0.5);
    var pg = gcache(ctx, 'np' + col, function () { return radGrad(ctx, 0, 0, 0, 1, [0, mix(col, '#e9dca0', 0.5), 0.45, col, 1, col]); });
    for (i = 0; i < nf; i++) {
      var F = fl[i];
      ctx.save();
      ctx.translate(F[0], F[1]);
      ctx.rotate(F[2] * 0.35);
      ctx.scale(F[3] * (0.75 + 0.25 * abs(cos(F[2]))), F[3]);
      ctx.beginPath();
      for (k = 0; k < 6; k++) shape(ctx, MOMO_H, 0, 0, k * PI / 3 + (k % 2) * 0.0 + 0.2, 0.72, 0.98);
      ctx.fillStyle = pg; ctx.fill();
      ctx.strokeStyle = 'rgba(200,190,160,0.45)'; ctx.lineWidth = 0.03; ctx.stroke();
      ctx.beginPath(); circ(ctx, 0.04, 0, 0.34);
      ctx.fillStyle = cup; ctx.fill();
      ctx.beginPath(); circ(ctx, 0.07, 0, 0.18);
      ctx.fillStyle = dark(cup, 0.18); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };

  // 綿 — cotton stem with open bolls
  var COTTON_LOBES = [[-0.95, 0.75, 0.38], [0, 1, 0.4], [0.95, 0.75, 0.38]];
  M.cotton = function (ctx, h, o) {
    var R = rng(opt(o, 'seed', 1)), i, k;
    var leafCol = opt(o, 'color', '#5e7440');
    ctx.save();
    ctx.scale(h, h);
    ctx.lineCap = 'round';
    var tipx = (R() - 0.5) * 0.08;
    var br = [[0, 0, 0.02, -0.5, tipx, -0.86]];
    for (i = 0; i < 2; i++) {
      var f = 0.35 + i * 0.22, p = qpt(0, 0, 0.02, -0.5, tipx, -0.86, f), sd = i ? 1 : -1;
      br.push([p[0], p[1], p[0] + sd * 0.12, p[1] - 0.1, p[0] + sd * (0.24 + R() * 0.06), p[1] - 0.16 - R() * 0.06]);
    }
    ctx.beginPath();
    for (i = 0; i < br.length; i++) { ctx.moveTo(br[i][0], br[i][1]); ctx.quadraticCurveTo(br[i][2], br[i][3], br[i][4], br[i][5]); }
    stroke(ctx, '#6e5a40', 0.016, h, 0.8);
    // leaves
    for (i = 0; i < 2; i++) {
      var q = qpt(0, 0, 0.02, -0.5, tipx, -0.86, 0.2 + i * 0.3), s2 = i ? -1 : 1, lx = q[0] + s2 * 0.12, ly = q[1] - 0.04;
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(lx, ly); stroke(ctx, '#6e5a40', 0.007, h, 0.5);
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(s2 * 1.0); ctx.scale(0.13, 0.13);
      ctx.beginPath(); palmate(ctx, 0, -0.4, COTTON_LOBES, 0.48, 0.12);
      ctx.fillStyle = leafCol; ctx.fill();
      ctx.beginPath(); palmVeins(ctx, 0, -0.4, COTTON_LOBES, 0.8);
      ctx.strokeStyle = 'rgba(230,230,200,0.3)'; ctx.lineWidth = 0.04; ctx.stroke();
      ctx.restore();
    }
    // bolls
    var bg = gcache(ctx, 'cb', function () { return radGrad(ctx, -0.15, -0.2, 0, 0.75, [0, '#ffffff', 0.55, '#fbf9f3', 1, '#d9d3c6']); });
    for (i = 0; i < br.length; i++) {
      var bx = br[i][4], by = br[i][5], r = (i ? 0.085 : 0.1) * (0.9 + 0.2 * R());
      ctx.save(); ctx.translate(bx, by - r * 0.6); ctx.scale(r, r);
      ctx.beginPath();
      for (k = 0; k < 5; k++) shape(ctx, MOMO_H, 0, 0.1, PI + (k - 2) * 0.62, 0.55, 1.05);
      ctx.fillStyle = '#6a4a2e'; ctx.fill();
      var lobes = [[-0.48, 0.05, 0.55], [0.48, 0.05, 0.55], [-0.2, -0.42, 0.52], [0.25, -0.4, 0.5], [0, 0.22, 0.5]];
      for (k = 0; k < lobes.length; k++) {
        ctx.beginPath(); circ(ctx, lobes[k][0], lobes[k][1], lobes[k][2]);
        ctx.fillStyle = bg; ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  };

  // 夏枯草 (靫草) — short stems with purple spikes; opts.withered for the brown 乃東枯 state
  M.utsubogusa = function (ctx, h, o) {
    var ph = opt(o, 'phase', 0), R = rng(opt(o, 'seed', 1)), wd = !!opt(o, 'withered', false), i, k;
    var spike = wd ? '#7e5c3e' : opt(o, 'color', '#5a3f82'), lip = wd ? '#a07c56' : opt(o, 'color2', '#a585d6');
    var stemC = wd ? '#7a6444' : '#5d7a3c', leafC = wd ? '#8a7048' : '#557a3a';
    var n = 2 + floor(R() * 3);
    ctx.save();
    ctx.scale(h, h);
    ctx.lineCap = 'round';
    for (i = 0; i < n; i++) {
      var x0 = (i - (n - 1) / 2) * 0.16 + (R() - 0.5) * 0.05, ht = 0.6 + 0.4 * R(), lean = (x0) * 0.6 + (R() - 0.5) * 0.1;
      var sw = sin(ph * TAU + i * 1.3) * 0.025 * ht, ex = x0 + lean * ht + sw, ey = -ht + 0.24;
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.quadraticCurveTo(x0 + lean * 0.3, -ht * 0.4, ex, ey);
      stroke(ctx, stemC, 0.018, h, 0.7);
      var p = qpt(x0, 0, x0 + lean * 0.3, -ht * 0.4, ex, ey, 0.5);
      ctx.beginPath(); shape(ctx, LEAF_H, p[0], p[1], -1.15, 0.12, 0.2); shape(ctx, LEAF_H, p[0], p[1], 1.15, 0.12, 0.2);
      ctx.fillStyle = leafC; ctx.fill();
      // spike
      var sh = 0.26, sw2 = 0.085;
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(lean * 0.4);
      ctx.beginPath();
      ctx.moveTo(-sw2 * 0.5, 0.02); ctx.lineTo(-sw2 * 0.55, -sh * 0.8);
      ctx.quadraticCurveTo(-sw2 * 0.5, -sh * 1.02, 0, -sh * 1.04); ctx.quadraticCurveTo(sw2 * 0.5, -sh * 1.02, sw2 * 0.55, -sh * 0.8);
      ctx.lineTo(sw2 * 0.5, 0.02); ctx.closePath();
      ctx.fillStyle = spike; ctx.fill();
      ctx.beginPath();
      for (k = 0; k < 6; k++) {
        var yy = -0.02 - k * sh / 6.2;
        ctx.moveTo(-sw2 * 0.55, yy); ctx.quadraticCurveTo(0, yy - 0.04, sw2 * 0.55, yy);
      }
      ctx.strokeStyle = wd ? 'rgba(60,40,24,0.55)' : 'rgba(40,24,60,0.5)'; lw(ctx, 0.006, h, 0.4); ctx.stroke();
      if (!wd) {
        ctx.beginPath();
        for (k = 0; k < 7; k++) {
          var ky = -0.05 - (k >> 1) * sh / 4.6 - (k % 2) * 0.02, sd = k % 2 ? 1 : -1;
          shape(ctx, UME_H, sd * sw2 * 0.45, ky, sd * 1.25, 0.06, 0.07);
        }
        ctx.fillStyle = lip; ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  };

  // 牡丹 on a low leafy plant
  var PEONY_LOBES = [[-0.55, 0.72, 0.3], [0, 1, 0.3], [0.55, 0.72, 0.3]];
  M.peonyPlant = function (ctx, h, o) {
    var R = rng(opt(o, 'seed', 1)), col = opt(o, 'color', '#d9587f'), i;
    ctx.save();
    ctx.scale(h, h);
    ctx.lineCap = 'round';
    var bx = (R() - 0.5) * 0.1, by = -0.68;
    var budx = -0.28 - R() * 0.06, budy = -0.48 - R() * 0.08;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.quadraticCurveTo(bx * 0.5, -0.4, bx, by);
    ctx.moveTo(-0.02, 0); ctx.quadraticCurveTo(budx * 0.4, -0.3, budx, budy);
    stroke(ctx, '#7a5440', 0.016, h, 0.7);
    var leaves = 7, lc = opt(o, 'leaf', '#4b7a3e');
    for (i = 0; i < leaves; i++) {
      var a = (i / (leaves - 1) - 0.5) * 2.6 + (R() - 0.5) * 0.2, d = 0.22 + R() * 0.14;
      var lx = sin(a) * d, ly = -0.06 - cos(a) * d * 0.8 - 0.1;
      ctx.beginPath(); ctx.moveTo(0, -0.02); ctx.quadraticCurveTo(lx * 0.5, ly * 0.4 - 0.05, lx, ly);
      stroke(ctx, '#8a5a44', 0.008, h, 0.5);
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(a * 0.8); ctx.scale(0.17, 0.17);
      ctx.beginPath(); palmate(ctx, 0, -0.35, PEONY_LOBES, 0.42, 0.1);
      ctx.fillStyle = i % 2 ? lc : dark(lc, 0.15); ctx.fill();
      ctx.restore();
    }
    // bud
    ctx.beginPath(); circ(ctx, budx, budy - 0.04, 0.055);
    ctx.fillStyle = radGrad(ctx, budx, budy - 0.04, 0, 0.055, [0, light(col, 0.2), 1, col], budx - 0.02, budy - 0.06);
    ctx.fill();
    ctx.beginPath(); shape(ctx, MOMO_H, budx, budy + 0.01, -0.6, 0.06, 0.09); shape(ctx, MOMO_H, budx, budy + 0.01, 0.6, 0.06, 0.09);
    ctx.fillStyle = '#5a7a3c'; ctx.fill();
    ctx.save(); ctx.translate(bx, by); M.peony(ctx, 0.27, { color: col, seed: R() * 1000 }); ctx.restore();
    ctx.restore();
  };

  /* ============================================================== REGISTRY */
  // box = approximate drawn extent in units of s: [x0, y0, x1, y1]
  M.list = [
    { name: 'petal', kind: 'particle', origin: 'center', defaults: { kind: 'sakura', color: PETAL.sakura.col, phase: 0 }, box: [-0.85, -1, 0.85, 1] },
    { name: 'mapleLeaf', kind: 'particle', origin: 'center', defaults: { color: '#c8372a', color2: '#e9902e', phase: 0 }, box: [-1, -1, 1, 1] },
    { name: 'ginkgoLeaf', kind: 'particle', origin: 'center', defaults: { color: '#e8b526', phase: 0 }, box: [-1, -1, 1, 1] },
    { name: 'leaf', kind: 'particle', origin: 'center', defaults: { color: '#b36d38', color2: '#74431f', phase: 0 }, box: [-0.6, -1, 0.6, 1] },
    { name: 'snowflake', kind: 'particle', origin: 'center', defaults: { kind: 'soft', color: '#ffffff' }, box: [-1, -1, 1, 1] },
    { name: 'fluff', kind: 'particle', origin: 'center', defaults: { phase: 0, color: '#fbf9f1' }, box: [-1.1, -1.2, 1.1, 1] },
    { name: 'butterfly', kind: 'particle', origin: 'center', heading: 0, defaults: { color: '#f7f5ec', color2: '#4f4d49', phase: 0 }, box: [-0.75, -0.9, 0.8, 0.9] },
    { name: 'dragonfly', kind: 'particle', origin: 'center', heading: 0, defaults: { color: '#cf3f28', phase: 0 }, box: [-1, -1.05, 0.8, 1.05] },
    { name: 'swallow', kind: 'particle', origin: 'center', heading: 0, defaults: { color: '#1d2744', color2: '#b8382b', phase: 0 }, box: [-1.05, -1.05, 0.75, 1.0] },
    { name: 'goose', kind: 'particle', origin: 'center', heading: 0, defaults: { color: '#3b3631', phase: 0 }, box: [-0.7, -1.05, 1.05, 0.8] },
    { name: 'smallBird', kind: 'particle', origin: 'center', heading: 0, defaults: { kind: 'sparrow', phase: 0, anchor: 'center' }, box: [-1.1, -0.9, 0.9, 1] },
    { name: 'fish', kind: 'particle', origin: 'center', heading: 0, defaults: { phase: 0.5, color: '#5a6470', color2: '#ebe6dc', blush: '#c8574c' }, box: [-1.3, -1.3, 1.3, 1.3] },
    { name: 'firefly', kind: 'particle', origin: 'center', defaults: { glow: 1, color: '#d8ff72' }, box: [-1, -1, 1, 1] },
    { name: 'blossom', kind: 'ornament', origin: 'center', defaults: { kind: 'ume', open: 1, seed: 1, view: 'front' }, box: [-1, -1, 1, 1] },
    { name: 'kiri', kind: 'ornament', origin: 'center', defaults: { open: 1, seed: 1, color: '#a68ac8', color2: '#e6daf0' }, box: [-0.75, -1, 0.75, 1] },
    { name: 'fruit', kind: 'ornament', origin: 'center', defaults: { kind: 'ume', seed: 1 }, box: [-1, -1, 1, 1] },
    { name: 'leafCluster', kind: 'ornament', origin: 'attach', defaults: { tone: 'green', seed: 1, phase: 0 }, box: [-1.05, -1.05, 1.05, 0.2] },
    { name: 'snowCap', kind: 'ornament', origin: 'bottom', defaults: { seed: 1 }, box: [-1.05, -0.75, 1.05, 0.15] },
    { name: 'lotusPad', kind: 'ornament', origin: 'center', defaults: { seed: 1, color: '#4f7c3a', color2: '#94b55a', notch: true, tilt: 0.42 }, box: [-1.05, -0.5, 1.05, 0.5] },
    { name: 'peony', kind: 'ornament', origin: 'center', defaults: { color: '#d9587f', seed: 1, tilt: 0.86 }, box: [-1.1, -1.1, 1.1, 1.0] },
    { name: 'chrysanthemum', kind: 'ornament', origin: 'center', defaults: { color: '#f0c232', seed: 1 }, box: [-1.05, -1.05, 1.05, 1.05] },
    { name: 'reeds', kind: 'plant', origin: 'base', defaults: { color: '#6f8a46', plume: 0.6, phase: 0, seed: 1 }, box: [-0.75, -1.1, 0.75, 0.02] },
    { name: 'grass', kind: 'plant', origin: 'base', defaults: { tone: 'green', phase: 0, seed: 1 }, box: [-1, -1.05, 1, 0.02] },
    { name: 'seri', kind: 'plant', origin: 'base', defaults: { phase: 0, seed: 1 }, box: [-0.75, -1.25, 0.75, 0.02] },
    { name: 'fuki', kind: 'plant', origin: 'base', defaults: { seed: 1, ground: 'snow' }, box: [-0.8, -0.95, 0.8, 0.05] },
    { name: 'iris', kind: 'plant', origin: 'base', defaults: { phase: 0, seed: 1, color: '#25298a', leaf: '#3f8a45' }, box: [-0.75, -1.1, 0.75, 0.05] },
    { name: 'lotus', kind: 'plant', origin: 'base', defaults: { open: 1, seed: 1, phase: 0, color: '#e06f93' }, box: [-0.65, -1.05, 0.65, 0.05] },
    { name: 'bambooShoot', kind: 'plant', origin: 'base', defaults: { seed: 1 }, box: [-0.45, -1.05, 0.45, 0.05] },
    { name: 'wheat', kind: 'plant', origin: 'base', defaults: { phase: 0, seed: 1, color: '#d4a548' }, box: [-0.75, -1.15, 0.75, 0.02] },
    { name: 'rice', kind: 'plant', origin: 'base', defaults: { phase: 0, seed: 1, color: '#d8ae4a' }, box: [-0.75, -1.05, 0.75, 0.02] },
    { name: 'safflower', kind: 'plant', origin: 'base', defaults: { phase: 0, seed: 1, color: '#f2a22a', color2: '#d9442a' }, box: [-0.75, -1.2, 0.75, 0.02] },
    { name: 'susuki', kind: 'plant', origin: 'base', defaults: { phase: 0, seed: 1, color: '#7d8a58', color2: '#ebe3d2' }, box: [-1, -1.25, 1, 0.02] },
    { name: 'narcissus', kind: 'plant', origin: 'base', defaults: { phase: 0, seed: 1, color: '#fbf8ee', color2: '#f0b928' }, box: [-0.75, -1.05, 0.75, 0.02] },
    { name: 'cotton', kind: 'plant', origin: 'base', defaults: { seed: 1, color: '#5e7440' }, box: [-0.6, -1.1, 0.6, 0.02] },
    { name: 'utsubogusa', kind: 'plant', origin: 'base', defaults: { phase: 0, seed: 1, withered: false }, box: [-0.75, -1.1, 0.75, 0.02] },
    { name: 'peonyPlant', kind: 'plant', origin: 'base', defaults: { seed: 1, color: '#d9587f', leaf: '#4b7a3e' }, box: [-0.75, -1.05, 0.75, 0.02] }
  ];
  M.version = '1.0';
})();
