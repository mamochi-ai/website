/*
 * うつろい暦 — procedural ambient soundscape engine.
 *
 * Everything is synthesized at runtime with the Web Audio API: no audio files,
 * no samples, no network, no libraries. Off by default; call start() from a
 * user gesture.
 *
 *   var snd = UTSUROI.createSoundscape();
 *   button.onclick = function () { snd.start(); };
 *   snd.setScene({ sfx: { wind: 0.6, uguisu: 1 }, daylight: 1, dusk: 0, intensity: 0 });
 *   snd.tick(kouIndex);   // koto pluck at a micro-season boundary
 *
 * Signal flow:
 *   layer voices -> layer gain -> mix bus -> HP 32 Hz -> high-shelf -> limiter -> master
 *                         \-> layer send -> convolution reverb (generated IR) --^
 *   UI one-shots (tick/chime/thunder/stamp/whoosh) -> fx bus -> mix bus (+ reverb send)
 *
 * Continuous layers are built lazily (one per scheduler tick) and torn down
 * after ~10 s of silence. Event layers are scheduled by a 250 ms look-ahead
 * scheduler only while their effective level is > 0.05.
 */
(function () {
  'use strict';

  var W = (typeof window !== 'undefined') ? window : this;
  var U = W.UTSUROI = W.UTSUROI || {};
  var TAU = Math.PI * 2;

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function sstep(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 都節 (miyako-bushi / in) scale degrees on E: E F A B C
  var MIYAKO = [0, 1, 5, 7, 8];

  // Harmonic recipes for PeriodicWaves (amplitude of harmonic 1, 2, 3, ...)
  var HARM = {
    whistle: [1, 0.05, 0.015],
    bird: [1, 0.14, 0.04],
    chirp: [1, 0.32, 0.12, 0.04],
    hoot: [1, 0.2, 0.06, 0.02],
    deer: [1, 0.3, 0.12, 0.05],
    higu: [0.45, 1, 0.1],
    nasal: [1, 0.75, 0.6, 0.45, 0.32, 0.22, 0.14, 0.09, 0.05]
  };

  function dayWeight(kind, D, K) {
    var N = 1 - D;
    switch (kind) {
      case 'bird': return 0.05 + 0.95 * sstep(0.15, 0.65, D) + 0.3 * K;
      case 'lark': return sstep(0.25, 0.7, D);
      case 'geese': return 0.35 + 0.45 * D + 0.4 * K;
      case 'cicada': return 0.03 + 0.97 * sstep(0.3, 0.8, D) * (1 - 0.4 * K);
      case 'bees': return sstep(0.4, 0.85, D);
      case 'higu': return 0.08 + 0.15 * D + 0.95 * K;
      case 'insect': return 0.25 + 0.75 * N + 0.25 * K;
      case 'frog': return 0.3 + 0.7 * N + 0.35 * K;
      case 'owl': return sstep(0.35, 0.85, N);
      case 'deer': return 0.45 + 0.55 * N + 0.3 * K;
      case 'bell': return 0.75 + 0.25 * K;
      case 'wind': return 0.85 + 0.15 * D;
      default: return 1;
    }
  }

  U.createSoundscape = function (opts) {
    opts = opts || {};

    // ------------------------------------------------------------ randomness
    var R = (typeof opts.seed === 'number') ? mulberry32(opts.seed) : Math.random;
    function rnd(a, b) { return a + (b - a) * R(); }
    function rint(a, b) { return Math.floor(a + (b - a + 1) * R()); }
    function chance(p) { return R() < p; }
    function expo(rate) { return -Math.log(1 - R() * 0.999) / rate; }

    // ------------------------------------------------------------ state
    var AC = W.AudioContext || W.webkitAudioContext || null;
    var ctx = opts.context || null;
    var offline = !!(ctx && typeof ctx.startRendering === 'function');
    var G = null;
    var enabled = false, timer = null, stopTimer = null, vclock = 0;
    var layers = {};
    var scene = { sfx: {}, day: 1, dusk: 0, inten: 0 };
    var dirty = false, lastApply = -1;
    var nVoices = 0;
    var NB = {}, TX = {}, WAVES = {};
    var gust = { v: 0.5, tgt: 0.5, t0: 0, tc: 1, next: 0 };
    var koto = { last: -10, voices: [], cache: {}, bus: null };
    var lastThunder = -10;
    var volume = clamp(num(opts.volume, 1), 0, 2);

    var LOOK = 1.2;        // scheduler look-ahead (s)
    var TICK_MS = 250;     // scheduler period
    var TC = 0.4;          // level ramp time-constant (≈1.2 s to settle)
    var MASTER = 0.8;
    var TEARDOWN = 10;     // s of silence before a continuous layer is torn down
    var MAXV = 48;         // max concurrent event voices

    function alive() { return !!ctx && ctx.state !== 'closed'; }
    function now() { return ctx ? Math.max(ctx.currentTime, vclock) : vclock; }
    function wall() {
      return (offline || typeof performance === 'undefined' || !performance.now) ? now() : performance.now() / 1000;
    }
    function ready() { return enabled && !!G && alive(); }

    // ------------------------------------------------------------ node helpers
    function gn(v) { var g = ctx.createGain(); g.gain.value = (v == null) ? 1 : v; return g; }
    function biq(type, f, q, gain) {
      var b = ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f;
      if (q != null) b.Q.value = q;
      if (gain != null) b.gain.value = gain;
      return b;
    }
    function pan(p) {
      if (ctx.createStereoPanner) {
        try { var n = ctx.createStereoPanner(); n.pan.value = clamp(p || 0, -1, 1); return n; } catch (e) { /* fall through */ }
      }
      return gn(1);
    }
    function target(p, v, t, tc) { try { p.setTargetAtTime(v, t, Math.max(0.002, tc)); } catch (e) { /* ignore */ } }
    function retarget(p, v, tc) {
      var t = now();
      try { p.cancelScheduledValues(t); p.setTargetAtTime(v, t, tc); } catch (e) { /* ignore */ }
    }
    function done(src, nodes) {
      nVoices++;
      src.onended = function () {
        nVoices--;
        src.onended = null;
        for (var i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) { /* ignore */ } }
      };
    }
    function wave(name) {
      if (name in WAVES) return WAVES[name];
      var h = HARM[name], re = new Float32Array(h.length + 1), im = new Float32Array(h.length + 1);
      for (var i = 0; i < h.length; i++) im[i + 1] = h[i];
      var w = null;
      try { w = ctx.createPeriodicWave(re, im); } catch (e) { w = null; }
      WAVES[name] = w;
      return w;
    }
    function osc(type, f) {
      var o = ctx.createOscillator();
      if (type && HARM[type]) { var w = wave(type); if (w) o.setPeriodicWave(w); } else o.type = type || 'sine';
      o.frequency.value = f;
      return o;
    }

    // ------------------------------------------------------------ noise & textures
    function noiseBuf(kind) {
      if (NB[kind]) return NB[kind];
      var sr = ctx.sampleRate, len = Math.floor(sr * 4), xf = Math.floor(sr * 0.05);
      var b = ctx.createBuffer(2, len, sr), tmp = new Float32Array(len + xf);
      for (var c = 0; c < 2; c++) {
        var d = b.getChannelData(c), i;
        if (kind === 'pink') {
          var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
          for (i = 0; i < tmp.length; i++) {
            var w = R() * 2 - 1;
            b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
            b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
            tmp[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
            b6 = w * 0.115926;
          }
        } else {
          for (i = 0; i < tmp.length; i++) tmp[i] = (R() * 2 - 1) * 0.5;
        }
        for (i = 0; i < len; i++) d[i] = tmp[i];
        for (i = 0; i < xf; i++) { var x = i / xf; d[i] = tmp[i] * Math.sqrt(x) + tmp[len + i] * Math.sqrt(1 - x); }
      }
      NB[kind] = b;
      return b;
    }
    function nsrc(kind, rate) {
      var s = ctx.createBufferSource();
      s.buffer = noiseBuf(kind); s.loop = true;
      if (rate) s.playbackRate.value = rate;
      return s;
    }
    function startLoop(s, t) { s.start(t, R() * (s.buffer.duration - 0.1)); }

    function grains(d, len, sr, rate, fn) {
      var p = 0;
      for (;;) {
        p += Math.max(1, Math.floor(sr * expo(rate)));
        if (p >= len) break;
        fn(p);
      }
    }
    function fillRustle(d, sr, len) {
      var pos = 0;
      while (pos < len) {
        var seg = Math.floor(sr * rnd(0.2, 1.0)), lvl = Math.pow(R(), 1.5), rate = 30 + 420 * lvl;
        var end = Math.min(len, pos + seg), p = pos;
        for (;;) {
          p += Math.max(1, Math.floor(sr * expo(rate)));
          if (p >= end) break;
          var gl = Math.floor(sr * rnd(0.0015, 0.018)), amp = (0.25 + 0.75 * lvl) * Math.pow(R(), 2), dec = gl * 0.3 + 1, prev = 0;
          for (var k = 0; k < gl; k++) {
            var w = R() * 2 - 1, y = w - 0.7 * prev; prev = w;
            d[(p + k) % len] += y * amp * Math.min(1, k / 6) * Math.exp(-k / dec);
          }
        }
        pos = end;
      }
    }
    function fillRain(d, sr, len, tickRate, plinkRate, plinkAmp) {
      grains(d, len, sr, tickRate, function (p) {
        var gl = Math.floor(sr * rnd(0.0008, 0.004)), amp = Math.pow(R(), 2.5), dec = gl * 0.35 + 1, prev = 0;
        for (var k = 0; k < gl; k++) {
          var w = R() * 2 - 1, y = w - 0.45 * prev; prev = w;
          d[(p + k) % len] += y * amp * Math.exp(-k / dec);
        }
      });
      grains(d, len, sr, plinkRate, function (p) {
        var f0 = Math.exp(rnd(Math.log(1300), Math.log(4000))), tau = rnd(0.003, 0.011) * sr, n = Math.floor(tau * 5);
        var rise = rnd(0.2, 0.9), ph = 0, a = plinkAmp * Math.pow(R(), 1.8);
        for (var k = 0; k < n; k++) {
          ph += TAU * f0 * (1 + rise * k / n) / sr;
          d[(p + k) % len] += Math.sin(ph) * a * Math.exp(-k / tau) * Math.min(1, k / 8);
        }
      });
    }
    function fillBubbles(d, sr, len) {
      var pos = 0;
      while (pos < len) {
        var seg = Math.floor(sr * rnd(0.15, 0.8)), rate = rnd(12, 70), end = Math.min(len, pos + seg), p = pos;
        for (;;) {
          p += Math.max(1, Math.floor(sr * expo(rate)));
          if (p >= end) break;
          var f0 = Math.exp(rnd(Math.log(320), Math.log(1700))), tau = (0.005 + 0.018 * Math.min(1.5, 650 / f0)) * sr;
          var n = Math.floor(tau * 4.5), rise = rnd(0.15, 0.7), ph = 0, a = Math.pow(R(), 1.5) * (f0 < 700 ? 1 : 0.75);
          for (var k = 0; k < n; k++) {
            ph += TAU * f0 * (1 + rise * k / n) / sr;
            d[(p + k) % len] += Math.sin(ph) * a * Math.exp(-k / tau) * Math.min(1, k / 12);
          }
        }
        pos = end;
      }
    }
    function fillCicada(d, sr, len) {
      // tymbal click trains of a few distant insects, slowly swelling
      for (var ins = 0; ins < 4; ins++) {
        var per = sr / rnd(85, 130), swP = len / rint(1, 3), ph0 = R() * TAU, base = rnd(0.4, 1), p = R() * per;
        var n = Math.floor(sr * 0.004), tau = sr * 0.0012;
        while (p < len) {
          var ip = Math.floor(p), a = base * (0.55 + 0.45 * Math.sin(TAU * ip / swP + ph0)) * rnd(0.7, 1);
          for (var k = 0; k < n; k++) d[(ip + k) % len] += (R() * 2 - 1) * a * Math.exp(-k / tau);
          p += per * (1 + 0.1 * (R() - 0.5));
        }
      }
    }
    var TEX = {
      rustle: { sec: 7, fill: fillRustle },
      rain: { sec: 6, fill: function (d, sr, len) { fillRain(d, sr, len, 280, 26, 0.5); } },
      drizzle: { sec: 7, fill: function (d, sr, len) { fillRain(d, sr, len, 30, 5, 0.35); } },
      bubbles: { sec: 6, fill: fillBubbles },
      cicada: { sec: 5, fill: fillCicada }
    };
    function texture(name) {
      if (TX[name]) return TX[name];
      var spec = TEX[name], sr = ctx.sampleRate, len = Math.floor(sr * spec.sec);
      var b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0), i, s = 0, pk = 0;
      spec.fill(d, sr, len);
      for (i = 0; i < len; i++) { s += d[i] * d[i]; if (Math.abs(d[i]) > pk) pk = Math.abs(d[i]); }
      var rms = Math.sqrt(s / len) || 1, k = Math.min(0.12 / rms, 0.95 / (pk || 1));
      for (i = 0; i < len; i++) d[i] *= k;
      TX[name] = b;
      return b;
    }
    function tsrc(name, rate) {
      var s = ctx.createBufferSource();
      s.buffer = texture(name); s.loop = true; s.playbackRate.value = rate || 1;
      return s;
    }

    function makeIR() {
      var sr = ctx.sampleRate, len = Math.floor(sr * 1.5), b = ctx.createBuffer(2, len, sr), pre = 0.011;
      for (var c = 0; c < 2; c++) {
        var d = b.getChannelData(c), lp = 0;
        for (var i = 0; i < len; i++) {
          var t = i / sr, k = 0.2 + 0.72 * Math.min(1, t / 1.1);
          lp += ((R() * 2 - 1) - lp) * (1 - k);
          d[i] = t < pre ? 0 : lp * Math.exp(-(t - pre) / 0.2) * (1 - Math.exp(-(t - pre) / 0.006));
        }
        for (var r = 0; r < 7; r++) {
          var idx = Math.floor((0.013 + R() * 0.075) * sr);
          if (idx < len - 1) { var a = (0.35 - r * 0.04) * (R() < 0.5 ? -1 : 1); d[idx] += a; d[idx + 1] += a * 0.5; }
        }
      }
      return b;
    }

    // ------------------------------------------------------------ master graph
    function ensureGraph() {
      if (G) return alive();
      if (!ctx) {
        if (!AC) return false;
        try { ctx = new AC({ latencyHint: 'balanced' }); } catch (e) {
          try { ctx = new AC(); } catch (e2) { ctx = null; return false; }
        }
      }
      if (!alive()) return false;
      try {
        var g = {};
        g.master = gn(0);
        g.comp = ctx.createDynamicsCompressor();
        try {
          g.comp.threshold.value = -10; g.comp.knee.value = 6; g.comp.ratio.value = 12;
          g.comp.attack.value = 0.003; g.comp.release.value = 0.25;
        } catch (e) { /* ignore */ }
        g.shelf = biq('highshelf', 6500, null, -3);
        g.hp = biq('highpass', 32, 0.7);
        g.mix = gn(1);
        g.fx = gn(1);
        g.revIn = gn(1);
        g.fxSend = gn(0.28);
        g.mix.connect(g.hp); g.hp.connect(g.shelf); g.shelf.connect(g.comp);
        g.comp.connect(g.master); g.master.connect(ctx.destination);
        g.fx.connect(g.mix); g.fx.connect(g.fxSend); g.fxSend.connect(g.revIn);
        try {
          g.conv = ctx.createConvolver();
          g.conv.buffer = makeIR();
          g.revOut = gn(0.55);
          g.revIn.connect(g.conv); g.conv.connect(g.revOut); g.revOut.connect(g.shelf);
        } catch (e) { g.conv = null; }
        G = g;
        return true;
      } catch (e) {
        G = null;
        return false;
      }
    }

    // ------------------------------------------------------------ score voices
    // A Score collects notes as control curves (pitch + amplitude), rendered as
    // one oscillator with setValueCurveAtTime: cheap and click-free.
    function Score(rate) { this.rate = rate || 800; this.notes = []; this.endI = 0; }
    Score.prototype.note = function (t, d, fp, ap, att, rel) {
      var r = this.rate, i0 = Math.max(1, Math.round(t * r)), m = Math.max(2, Math.round(d * r));
      var ff = new Float32Array(m + 1), aa = new Float32Array(m + 1);
      att = (att == null) ? 0.006 : att; rel = (rel == null) ? 0.012 : rel;
      for (var j = 0; j <= m; j++) {
        var u = j / m, tt = j / r, e = Math.min(1, tt / att, ((m - j) / r) / rel);
        ff[j] = (typeof fp === 'function') ? fp(u, tt) : fp;
        aa[j] = ((typeof ap === 'function') ? ap(u, tt) : ap) * e;
      }
      this.notes.push([i0, ff, aa]);
      if (i0 + m > this.endI) this.endI = i0 + m;
      return this;
    };
    Score.prototype.render = function () {
      if (!this.notes.length) return null;
      var n = this.endI + 3, f = new Float32Array(n), a = new Float32Array(n), set = new Uint8Array(n), i, j;
      for (var k = 0; k < this.notes.length; k++) {
        var nt = this.notes[k], i0 = nt[0], ff = nt[1], aa = nt[2];
        for (j = 0; j < ff.length; j++) {
          i = i0 + j;
          if (i >= n - 1) break;
          if (!set[i] || aa[j] >= a[i]) { f[i] = ff[j]; set[i] = 1; }
          if (aa[j] > a[i]) a[i] = aa[j];
        }
      }
      var first = 0;
      for (i = 0; i < n; i++) if (set[i]) { first = f[i]; break; }
      var last = first;
      for (i = 0; i < n; i++) { if (set[i]) last = f[i]; else f[i] = last; }
      a[0] = 0; a[n - 1] = 0;
      return { f: f, a: a, dur: (n - 1) / this.rate };
    };
    function playScore(S, t, dest, o) {
      var r = S.render();
      if (!r || r.dur <= 0) return 0;
      var amp = (o.amp == null) ? 1 : o.amp, i;
      if (amp !== 1) for (i = 0; i < r.a.length; i++) r.a[i] *= amp;
      // NB: no .value assignment on params that receive a value curve. In Chromium a prior
      // automation event (assigning .value inserts one) occasionally leaves a later
      // setValueCurveAtTime stuck at its first value. Nothing plays before t anyway.
      var oc = ctx.createOscillator(), wv = HARM[o.wave] ? wave(o.wave) : null;
      if (wv) oc.setPeriodicWave(wv); else oc.type = o.wave || 'sine';
      var g = ctx.createGain(), nodes = [oc, g], last = g;
      oc.connect(g);
      try {
        oc.frequency.setValueCurveAtTime(r.f, t, r.dur);
        g.gain.setValueCurveAtTime(r.a, t, r.dur);
      } catch (e) { try { oc.disconnect(); } catch (e2) { /* ignore */ } return 0; }
      if (o.lp) { var f = biq('lowpass', o.lp, 0.6); last.connect(f); last = f; nodes.push(f); }
      var p = pan(o.pan || 0);
      last.connect(p); nodes.push(p);
      if (o.panTo != null && p.pan) {
        p.pan.setValueAtTime(clamp(o.pan || 0, -1, 1), t);
        p.pan.linearRampToValueAtTime(clamp(o.panTo, -1, 1), t + r.dur);
      }
      p.connect(dest);
      if (o.extra) nodes = nodes.concat(o.extra);
      oc.start(t); oc.stop(t + r.dur + 0.05);
      done(oc, nodes);
      return r.dur;
    }

    // ------------------------------------------------------------ gust process
    function gustAt(t) { return gust.tgt + (gust.v - gust.tgt) * Math.exp(-Math.max(0, t - gust.t0) / gust.tc); }
    function updateGust(t, tEnd) {
      var guard = 0;
      if (gust.next < t - 2) gust.next = t;
      while (gust.next < tEnd && guard++ < 4) {
        var tn = Math.max(gust.next, t), v = gustAt(tn), r = R(), tgt;
        tgt = r < 0.12 ? rnd(0.85, 1) : (r < 0.5 ? rnd(0.45, 0.8) : rnd(0.12, 0.45));
        gust.v = v; gust.t0 = tn; gust.tgt = tgt;
        gust.tc = tgt > v ? rnd(0.6, 1.5) : rnd(1.2, 3);
        gust.next = tn + rnd(1.8, 5.5);
        for (var name in layers) {
          var L = layers[name];
          if (L.parts && L.parts.gust) { try { L.parts.gust(tn, tgt, gust.tc); } catch (e) { /* ignore */ } }
        }
        gustEvents(tn, tgt, tgt - v);
      }
    }
    function gustEvents(tn, tgt, delta) {
      var F = layers.furin;
      if (F && F.eff > 0.05 && delta > 0.15 && chance(0.35 + delta) && nVoices < MAXV) {
        var te = tn + rnd(0.25, 1.0);
        if (te - (F.lastJ || -10) > 1.6) { F.lastJ = te; furinJingle(te, F, 0.5 + 0.5 * tgt); }
      }
      var B = layers.bamboo;
      if (B && B.eff > 0.05 && B.parts && delta > 0.2 && chance(0.5) && nVoices < MAXV) bambooCreak(tn + rnd(0.2, 1.2), B.out);
    }

    // ------------------------------------------------------------ continuous layers
    var building = null;   // parts of the layer currently being built (cleaned up if a build throws)
    function P() { building = { nodes: [], srcs: [] }; return building; }
    function keep(parts) { for (var i = 1; i < arguments.length; i++) parts.nodes.push(arguments[i]); }
    function run1(parts, s, t) {
      parts.nodes.push(s); parts.srcs.push(s);
      if (s.buffer) startLoop(s, t); else s.start(t);
    }

    function buildWind(L, t) {
      var p = P(), s = nsrc('pink'), lp = biq('lowpass', 500, 0.5), g = gn(0.5);
      var hs = biq('bandpass', 1700, 0.6), hg = gn(0.06), pn = pan(0);
      s.connect(lp); lp.connect(g); s.connect(hs); hs.connect(hg); hg.connect(g); g.connect(pn); pn.connect(L.out);
      keep(p, lp, g, hs, hg, pn); run1(p, s, t);
      p.gust = function (tn, v, tc) {
        target(lp.frequency, 260 + 900 * v, tn, tc);
        target(g.gain, 0.22 + 0.78 * v, tn, tc);
        target(hg.gain, 0.02 + 0.1 * v * v, tn, tc);
        if (pn.pan) target(pn.pan, rnd(-0.35, 0.35), tn, tc * 2);
      };
      p.gust(t, gustAt(t), 0.3);
      return p;
    }

    function buildGale(L, t) {
      var p = P(), s = nsrc('pink'), w = nsrc('white');
      var roar = biq('lowpass', 350, 0.6), rg = gn(0.5);
      var h1 = biq('bandpass', 420, 9), h1g = gn(0), p1 = pan(-0.55);
      var h2 = biq('bandpass', 640, 11), h2g = gn(0), p2 = pan(0.55);
      var hh = biq('highpass', 2200, 0.5), hl = biq('lowpass', 5500, 0.5), hg = gn(0.04);
      s.connect(roar); roar.connect(rg); rg.connect(L.out);
      s.connect(h1); h1.connect(h1g); h1g.connect(p1); p1.connect(L.out);
      s.connect(h2); h2.connect(h2g); h2g.connect(p2); p2.connect(L.out);
      w.connect(hh); hh.connect(hl); hl.connect(hg); hg.connect(L.out);
      keep(p, roar, rg, h1, h1g, p1, h2, h2g, p2, hh, hl, hg);
      run1(p, s, t); run1(p, w, t);
      p.h1 = h1; p.h2 = h2; p.v = 0.5;
      p.gust = function (tn, v, tc) {
        p.v = v;
        target(roar.frequency, 200 + 520 * v, tn, tc);
        target(rg.gain, 0.3 + 0.7 * v, tn, tc);
        target(h1g.gain, 3.2 * v * v, tn, tc * 1.2);
        target(h2g.gain, 2.4 * v * v * v, tn, tc * 0.9);
        target(hg.gain, 0.015 + 0.07 * v, tn, tc);
      };
      p.gust(t, gustAt(t), 0.3);
      return p;
    }
    function runGale(L, t, tEnd) {
      var p = L.parts;
      if (!p.nx || p.nx < t - 2) p.nx = t;
      while (p.nx < tEnd) {
        var v = p.v, tn = Math.max(p.nx, t);
        target(p.h1.frequency, 290 + 380 * v + rnd(-50, 50), tn, rnd(0.3, 0.9));
        target(p.h2.frequency, 470 + 560 * v + rnd(-70, 70), tn, rnd(0.25, 0.8));
        p.nx = tn + rnd(0.5, 1.4);
      }
    }

    function buildBreeze(L, t) {
      var p = P(), s = nsrc('pink'), lp = biq('lowpass', 700, 0.5), g = gn(0.4);
      var r1 = ctxTex('rustle', 1.0), r2 = ctxTex('rustle', 0.83), p1 = pan(-0.6), p2 = pan(0.6);
      var bp = biq('bandpass', 2900, 0.75), rg = gn(0.2);
      s.connect(lp); lp.connect(g); g.connect(L.out);
      r1.connect(p1); r2.connect(p2); p1.connect(bp); p2.connect(bp); bp.connect(rg); rg.connect(L.out);
      keep(p, lp, g, p1, p2, bp, rg); run1(p, s, t); run1(p, r1, t); run1(p, r2, t);
      p.gust = function (tn, v, tc) {
        target(lp.frequency, 380 + 700 * v, tn, tc);
        target(g.gain, 0.25 + 0.55 * v, tn, tc);
        target(rg.gain, 0.04 + 0.7 * v * v, tn, tc * 0.7);
      };
      p.gust(t, gustAt(t), 0.3);
      return p;
    }
    function ctxTex(name, rate) { return tsrc(name, rate); }

    function buildBamboo(L, t) {
      var p = P(), r1 = tsrc('rustle', 1.12), r2 = tsrc('rustle', 0.94), p1 = pan(-0.7), p2 = pan(0.65);
      var bp = biq('bandpass', 3500, 0.9), hp = biq('highpass', 900, 0.6), rg = gn(0.2);
      var s = nsrc('pink'), lp = biq('lowpass', 450, 0.5), ag = gn(0.12);
      r1.connect(p1); r2.connect(p2); p1.connect(bp); p2.connect(bp); bp.connect(hp); hp.connect(rg); rg.connect(L.out);
      s.connect(lp); lp.connect(ag); ag.connect(L.out);
      keep(p, p1, p2, bp, hp, rg, lp, ag); run1(p, r1, t); run1(p, r2, t); run1(p, s, t);
      p.gust = function (tn, v, tc) {
        target(rg.gain, 0.06 + 0.9 * v * v, tn, tc * 0.7);
        target(ag.gain, 0.05 + 0.2 * v, tn, tc);
      };
      p.gust(t, gustAt(t), 0.3);
      return p;
    }
    function runBamboo(L, t, tEnd) {
      every(L, t, tEnd, [2, 7], function (te) {
        if (chance(0.55)) bambooCreak(te, L.out); else bambooKnocks(te, L.out);
        return rnd(4, 11) * (1.3 - 0.6 * gustAt(te));
      });
    }
    function bambooCreak(t, dest) {
      var S = new Score(300), d = rnd(0.5, 1.3), f = rnd(45, 85), w = rnd(0.08, 0.25), wr = rnd(0.6, 2.2), ph = R() * TAU;
      S.note(0, d, function (u, tt) { return f * (1 + w * Math.sin(TAU * wr * tt + ph) + 0.04 * Math.sin(TAU * 7.3 * tt)); },
        function (u, tt) { return Math.sin(Math.PI * u) * (0.7 + 0.3 * Math.sin(TAU * 3.1 * tt + ph)); }, 0.08, 0.15);
      var bp = biq('bandpass', rnd(800, 1500), 5);
      playScore(S, t, bp, { wave: 'sawtooth', amp: rnd(0.08, 0.18), pan: 0 });
      var pn = pan(rnd(-0.7, 0.7)), lp = biq('lowpass', 2200, 0.6);
      bp.connect(lp); lp.connect(pn); pn.connect(dest);
      // filter chain is released together with a tiny silent timer source
      releaseLater([bp, lp, pn], t + d + 0.3);
    }
    function bambooKnocks(t, dest) {
      var n = rint(2, 4), x = 0, pn = rnd(-0.7, 0.7);
      for (var i = 0; i < n; i++) {
        hollowKnock(t + x, dest, rnd(420, 780), rnd(0.08, 0.2), pn, 0.05);
        x += rnd(0.08, 0.3);
      }
    }
    // Disconnect a set of nodes at time t using a silent 1-sample source as a timer.
    function releaseLater(nodes, t) {
      try {
        var s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(nodes[nodes.length - 1]);
        s.start(Math.max(t, now()));
        nodes.push(s);
        done(s, nodes);
      } catch (e) { /* ignore */ }
    }

    function buildRain(L, t) {
      var p = P(), n = nsrc('pink'), hp = biq('highpass', 500, 0.5), lp = biq('lowpass', 5200, 0.5), ng = gn(0.5);
      var lo = biq('lowpass', 260, 0.5), lg = gn(0.35);
      var d1 = tsrc('rain', 1), d2 = tsrc('rain', 0.91), p1 = pan(-0.55), p2 = pan(0.55), dl = biq('lowpass', 4800, 0.6), dg = gn(0.6);
      n.connect(hp); hp.connect(lp); lp.connect(ng); ng.connect(L.out);
      n.connect(lo); lo.connect(lg); lg.connect(L.out);
      d1.connect(p1); d2.connect(p2); p1.connect(dl); p2.connect(dl); dl.connect(dg); dg.connect(L.out);
      keep(p, hp, lp, ng, lo, lg, p1, p2, dl, dg); run1(p, n, t); run1(p, d1, t); run1(p, d2, t);
      p.drift = [ng, dg];
      return p;
    }
    function buildRainHeavy(L, t) {
      var p = P(), n = nsrc('pink'), hp = biq('highpass', 300, 0.5), lp = biq('lowpass', 6000, 0.5), ng = gn(0.75);
      var lo = biq('lowpass', 170, 0.6), lg = gn(0.9);
      var d1 = tsrc('rain', 1.17), d2 = tsrc('rain', 1.31), p1 = pan(-0.6), p2 = pan(0.6), dl = biq('lowpass', 5000, 0.6), dg = gn(0.75);
      n.connect(hp); hp.connect(lp); lp.connect(ng); ng.connect(L.out);
      n.connect(lo); lo.connect(lg); lg.connect(L.out);
      d1.connect(p1); d2.connect(p2); p1.connect(dl); p2.connect(dl); dl.connect(dg); dg.connect(L.out);
      keep(p, hp, lp, ng, lo, lg, p1, p2, dl, dg); run1(p, n, t); run1(p, d1, t); run1(p, d2, t);
      p.drift = [ng, lg];
      return p;
    }
    function runRainDrift(L, t, tEnd) {
      var p = L.parts;
      if (!p.nx || p.nx < t - 2) p.nx = t;
      while (p.nx < tEnd) {
        var tn = Math.max(p.nx, t), k = rnd(0.75, 1.2);
        for (var i = 0; i < p.drift.length; i++) {
          var g = p.drift[i];
          if (g._base == null) g._base = g.gain.value;
          target(g.gain, g._base * k, tn, rnd(1.5, 4));
        }
        p.nx = tn + rnd(4, 10);
      }
    }
    function buildDrizzle(L, t) {
      var p = P(), n = nsrc('pink'), hp = biq('highpass', 1800, 0.5), lp = biq('lowpass', 5000, 0.5), ng = gn(0.12);
      var d1 = tsrc('drizzle', 1), d2 = tsrc('drizzle', 0.87), p1 = pan(-0.6), p2 = pan(0.6), hp2 = biq('highpass', 1200, 0.5), lp2 = biq('lowpass', 4500, 0.6), dg = gn(0.6);
      n.connect(hp); hp.connect(lp); lp.connect(ng); ng.connect(L.out);
      d1.connect(p1); d2.connect(p2); p1.connect(hp2); p2.connect(hp2); hp2.connect(lp2); lp2.connect(dg); dg.connect(L.out);
      keep(p, hp, lp, ng, p1, p2, hp2, lp2, dg); run1(p, n, t); run1(p, d1, t); run1(p, d2, t);
      return p;
    }

    function buildStream(L, t) {
      var p = P(), n = nsrc('pink'), hp = biq('highpass', 220, 0.5), lp = biq('lowpass', 2600, 0.5), ng = gn(0.45);
      var b1 = tsrc('bubbles', 1), b2 = tsrc('bubbles', 1.13), p1 = pan(-0.45), p2 = pan(0.45), bl = biq('lowpass', 3500, 0.5), bg = gn(0.7);
      n.connect(hp); hp.connect(lp); lp.connect(ng); ng.connect(L.out);
      b1.connect(p1); b2.connect(p2); p1.connect(bl); p2.connect(bl); bl.connect(bg); bg.connect(L.out);
      keep(p, hp, lp, ng, p1, p2, bl, bg); run1(p, n, t); run1(p, b1, t); run1(p, b2, t);
      p.drift = [ng, bg];
      return p;
    }
    function runStream(L, t, tEnd) { runRainDrift(L, t, tEnd); }

    function buildSnow(L, t) {
      var p = P(), n = nsrc('pink'), l1 = biq('lowpass', 230, 0.5), l2 = biq('lowpass', 420, 0.5), g = gn(0.35);
      n.connect(l1); l1.connect(l2); l2.connect(g); g.connect(L.out);
      keep(p, l1, l2, g); run1(p, n, t);
      p.drift = [g];
      return p;
    }
    function runSnow(L, t, tEnd) {
      runRainDrift(L, t, tEnd);
      every(L, t, tEnd, [2, 9], function (te) { snowFlump(te, L.out); return rnd(9, 24); });
    }
    function snowFlump(t, dest) {
      var pn = pan(rnd(-0.6, 0.6)), nodes = [pn];
      pn.connect(dest);
      // faint sift of snow sliding off a branch
      var s1 = nsrc('white'), b1 = biq('bandpass', 1400, 0.6), g1 = gn(0);
      s1.connect(b1); b1.connect(g1); g1.connect(pn);
      g1.gain.setValueAtTime(0, t); g1.gain.linearRampToValueAtTime(0.025, t + 0.18); g1.gain.linearRampToValueAtTime(0, t + 0.4);
      startLoop(s1, t); s1.stop(t + 0.45); nodes.push(s1, b1, g1);
      // soft flump
      var tf = t + rnd(0.25, 0.4), s2 = nsrc('pink'), l2 = biq('lowpass', 380, 0.7), g2 = gn(0);
      s2.connect(l2); l2.connect(g2); g2.connect(pn);
      g2.gain.setValueAtTime(0, tf); g2.gain.linearRampToValueAtTime(rnd(0.5, 0.9), tf + 0.03); g2.gain.setTargetAtTime(0, tf + 0.035, rnd(0.08, 0.14));
      startLoop(s2, tf); s2.stop(tf + 1.2); nodes.push(s2, l2, g2);
      done(s2, nodes);
    }

    function buildShishi(L, t) {
      var p = P(), b = tsrc('bubbles', 1.55), bp = biq('bandpass', 2100, 0.8), g = gn(0.4), pn = pan(0.3);
      var n = nsrc('pink'), fb = biq('bandpass', 450, 7), fg = gn(0.5);
      b.connect(bp); bp.connect(g); g.connect(pn); pn.connect(L.out);
      n.connect(fb); fb.connect(fg); fg.connect(pn);
      keep(p, bp, g, pn, fb, fg); run1(p, b, t); run1(p, n, t);
      p.fill = fb;
      return p;
    }
    function runShishi(L, t, tEnd) {
      L.st = L.st || { f: rnd(520, 640) };
      every(L, t, tEnd, [1.5, 7], function (te) {
        var gap = rnd(15, 25), tk = te + rnd(0.35, 0.55);
        splash(te, L.out, 0.3);
        hollowKnock(tk, L.out, L.st.f, 1, 0.3, 0.6);
        if (chance(0.6)) hollowKnock(tk + rnd(0.1, 0.14), L.out, L.st.f, 0.22, 0.3, 0.6);
        if (L.parts && L.parts.fill) {
          var fq = L.parts.fill.frequency;
          fq.setValueAtTime(380, tk + 0.05);
          fq.linearRampToValueAtTime(1000, tk + gap * 0.9);
        }
        return gap;
      });
    }
    function splash(t, dest, amp) {
      var s = nsrc('pink'), bp = biq('bandpass', 1300, 0.7), g = gn(0), pn = pan(0.3);
      s.connect(bp); bp.connect(g); g.connect(pn); pn.connect(dest);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.04); g.gain.setTargetAtTime(0, t + 0.07, 0.13);
      startLoop(s, t); s.stop(t + 1.2);
      done(s, [s, bp, g, pn]);
    }
    // Hollow bamboo "kōn": modal partials + click + optional stone thud.
    function hollowKnock(t, dest, f, amp, pn, thud) {
      var out = gn(amp), p = pan(pn), nodes = [out, p], first = null;
      out.connect(p); p.connect(dest);
      var M = [[1, 1, 0.11], [2.62, 0.35, 0.05], [4.1, 0.14, 0.022]];
      for (var i = 0; i < M.length; i++) {
        var o = osc('sine', f * M[i][0] * 1.03), g = gn(0), tau = M[i][2] * rnd(0.85, 1.15);
        o.frequency.setValueAtTime(f * M[i][0] * 1.03, t);
        o.frequency.exponentialRampToValueAtTime(f * M[i][0], t + 0.02);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(M[i][1] * 0.5, t + 0.0015);
        g.gain.setTargetAtTime(0, t + 0.002, tau);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + tau * 9 + 0.02);
        nodes.push(o, g);
        if (!first) first = o;
      }
      var c = nsrc('white'), cb = biq('bandpass', 2600, 1.2), cg = gn(0);
      c.connect(cb); cb.connect(cg); cg.connect(out);
      cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(0.5, t + 0.0008); cg.gain.setTargetAtTime(0, t + 0.001, 0.004);
      startLoop(c, t); c.stop(t + 0.06); nodes.push(c, cb, cg);
      if (thud) {
        var s = nsrc('pink'), sl = biq('lowpass', 320, 0.8), sg = gn(0);
        s.connect(sl); sl.connect(sg); sg.connect(out);
        sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(thud, t + 0.002); sg.gain.setTargetAtTime(0, t + 0.003, 0.025);
        startLoop(s, t); s.stop(t + 0.25); nodes.push(s, sl, sg);
      }
      done(first, nodes);
    }

    function runLap(L, t, tEnd) {
      every(L, t, tEnd, [0.3, 2], function (te) { waterLap(te, L.out); return rnd(2.4, 5.5); });
    }
    function waterLap(t, dest) {
      var a = rnd(0.35, 0.8), d = rnd(0.9, 1.6), s = nsrc('pink'), f = biq('lowpass', 220, 1.1), g = gn(0), pn = pan(rnd(-0.55, 0.55));
      s.connect(f); f.connect(g); g.connect(pn); pn.connect(dest);
      f.frequency.setValueAtTime(220, t); f.frequency.linearRampToValueAtTime(rnd(650, 1100), t + a);
      f.frequency.exponentialRampToValueAtTime(240, t + a + d);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rnd(0.35, 0.7), t + a); g.gain.setTargetAtTime(0, t + a, d / 3);
      startLoop(s, t); s.stop(t + a + d * 2 + 0.3);
      done(s, [s, f, g, pn]);
      var n = rint(0, 3);
      for (var i = 0; i < n; i++) glug(t + a * rnd(0.6, 1.3), pn, rnd(170, 480), rnd(0.05, 0.14));
    }
    function glug(t, dest, f, amp) {
      var o = osc('sine', f), g = gn(0);
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rnd(1.3, 1.8), t + 0.07);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.005); g.gain.setTargetAtTime(0, t + 0.006, 0.022);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.2);
      done(o, [o, g]);
    }

    // Frogs: persistent voices (pulse train -> formant) gated per croak; neighbours alternate (anti-phase).
    function buildFrogs(L, t) {
      var p = P(), vs = [];
      for (var i = 0; i < 6; i++) {
        var near = i < 3, o = osc('sawtooth', 180), hp = biq('highpass', 650, 0.7), bp = biq('bandpass', near ? rnd(1700, 2500) : rnd(1300, 1900), 3);
        var g = gn(0), pn = pan(near ? rnd(-0.8, 0.8) : rnd(-0.5, 0.5)), last = bp;
        o.connect(hp); hp.connect(bp); keep(p, hp);
        if (!near) { var lp = biq('lowpass', 1500, 0.7); bp.connect(lp); last = lp; keep(p, lp); }
        last.connect(g); g.connect(pn); pn.connect(L.out);
        keep(p, bp, g, pn); run1(p, o, t);
        vs.push({ o: o, g: g, f: rnd(160, 230), amp: near ? rnd(2, 3.2) : rnd(0.7, 1.2), phase: (i % 2) ? 0.5 : 0, next: 0 });
      }
      p.vs = vs; p.T = rnd(0.25, 0.32); p.t0 = t;
      return p;
    }
    function runFrogs(L, t, tEnd) {
      var p = L.parts, T = p.T;
      for (var i = 0; i < p.vs.length; i++) {
        var v = p.vs[i];
        if (!v.next || v.next < t - 1) v.next = t + rnd(0, 3);
        while (v.next < tEnd) {
          var n = rint(5, 18), k0 = Math.ceil((v.next - p.t0) / T - v.phase), nd = rnd(0.06, 0.1), rattle = chance(0.25);
          for (var j = 0; j < n; j++) {
            var tn = p.t0 + (k0 + j + v.phase) * T + rnd(-0.012, 0.012);
            if (tn < t + 0.01) continue;
            croak(v, tn, nd * rnd(0.9, 1.1), v.amp * (j < 2 ? 0.6 + 0.2 * j : 1) * rnd(0.85, 1), rattle);
          }
          v.next = p.t0 + (k0 + n + v.phase) * T + rnd(1.5, 7);
        }
      }
    }
    function croak(v, tn, d, a, rattle) {
      var g = v.g.gain, f = v.o.frequency;
      g.setValueAtTime(0, tn);
      g.linearRampToValueAtTime(a, tn + 0.008);
      if (rattle) {
        g.linearRampToValueAtTime(a * 0.15, tn + d * 0.45);
        g.linearRampToValueAtTime(a * 0.85, tn + d * 0.55);
      } else {
        g.linearRampToValueAtTime(a * 0.75, tn + d * 0.7);
      }
      g.linearRampToValueAtTime(0, tn + d);
      f.setValueAtTime(v.f * 0.94, tn);
      f.linearRampToValueAtTime(v.f * 1.06, tn + d);
    }

    // Cicadas: distant chorus texture + two min-min voices (AM'd carrier ~4.3 kHz).
    function buildCicadas(L, t) {
      var p = P(), t1 = tsrc('cicada', 1), t2 = tsrc('cicada', 0.93), p1 = pan(-0.6), p2 = pan(0.6);
      var bp = biq('bandpass', 4600, 1.6), bl = biq('lowpass', 6000, 0.6), bl2 = biq('lowpass', 7000, 0.6), bg = gn(1.8);
      t1.connect(p1); t2.connect(p2); p1.connect(bp); p2.connect(bp); bp.connect(bl); bl.connect(bl2); bl2.connect(bg); bg.connect(L.out);
      keep(p, p1, p2, bp, bl, bl2, bg); run1(p, t1, t); run1(p, t2, t);
      var ns = nsrc('white'), nb = biq('bandpass', 4300, 5), ng = gn(0.5);
      ns.connect(nb); nb.connect(ng); keep(p, nb, ng); run1(p, ns, t);
      p.vs = [];
      for (var i = 0; i < 2; i++) {
        var car = osc('sine', 4300), mod = osc('sine', rnd(95, 125)), md = gn(0.45), am = gn(0.55), gate = gn(0);
        var pn = pan(i ? rnd(0.3, 0.8) : rnd(-0.8, -0.3));
        mod.connect(md); md.connect(am.gain); car.connect(am); ng.connect(am); am.connect(gate); gate.connect(pn); pn.connect(L.out);
        keep(p, md, am, gate, pn); run1(p, car, t); run1(p, mod, t);
        p.vs.push({ car: car, g: gate, f: rnd(4100, 4500), next: 0 });
      }
      p.drift = [bg];
      return p;
    }
    function runCicadas(L, t, tEnd) {
      runRainDrift(L, t, tEnd);
      var vs = L.parts.vs;
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (!v.next || v.next < t - 1) v.next = t + rnd(0.3, 4);
        while (v.next < tEnd) v.next += minminPhrase(v, Math.max(v.next, t + 0.02)) + rnd(3, 12);
      }
    }
    function minminPhrase(v, ts) {
      var x = ts, f = v.f * rnd(0.97, 1.03), d = rnd(0.7, 1.1), n = rint(5, 12), per = rnd(0.27, 0.34), a = rnd(0.18, 0.3);
      mmNote(v, x, d, f, a, 0); x += d + 0.06;
      for (var j = 0; j < n; j++) { mmNote(v, x, per * 0.78, f, a * 0.95, 1); x += per; }
      d = rnd(0.8, 1.4); mmNote(v, x, d, f * 0.97, a * 0.7, 2); x += d;
      return x - ts;
    }
    function mmNote(v, tn, d, f, a, kind) {
      var g = v.g.gain, fr = v.car.frequency;
      g.setValueAtTime(0, tn);
      fr.setValueAtTime(f * 0.9, tn);
      if (kind === 0) {
        g.linearRampToValueAtTime(a * 0.5, tn + 0.05); g.linearRampToValueAtTime(a, tn + d * 0.7);
        fr.linearRampToValueAtTime(f * 1.03, tn + d * 0.75); fr.linearRampToValueAtTime(f * 0.95, tn + d);
      } else if (kind === 1) {
        g.linearRampToValueAtTime(a, tn + 0.04); g.linearRampToValueAtTime(a * 0.85, tn + d * 0.7);
        fr.linearRampToValueAtTime(f * 1.04, tn + d * 0.7); fr.linearRampToValueAtTime(f * 0.97, tn + d);
      } else {
        g.linearRampToValueAtTime(a, tn + 0.1);
        fr.linearRampToValueAtTime(f, tn + 0.1); fr.linearRampToValueAtTime(f * 0.85, tn + d);
      }
      g.linearRampToValueAtTime(0, tn + d);
    }

    // Suzumushi "リーン": persistent ~4.4 kHz voices with a fluttered onset.
    function buildSuzumushi(L, t) {
      var p = P(); p.vs = [];
      for (var i = 0; i < 3; i++) {
        var o = osc('sine', rnd(4200, 4650)), g = gn(0), pn = pan(i === 2 ? rnd(-0.3, 0.3) : (i ? rnd(0.2, 0.8) : rnd(-0.8, -0.2)));
        o.connect(g); g.connect(pn); pn.connect(L.out);
        keep(p, g, pn); run1(p, o, t);
        p.vs.push({ o: o, g: g, f: o.frequency.value, amp: i === 2 ? 0.35 : rnd(0.7, 1), per: rnd(0.75, 1.2), d: rnd(0.28, 0.42), next: 0 });
      }
      return p;
    }
    function runSuzumushi(L, t, tEnd) {
      var vs = L.parts.vs;
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (!v.next || v.next < t - 1) v.next = t + rnd(0.2, 3);
        while (v.next < tEnd) {
          var n = rint(6, 20), x = Math.max(v.next, t + 0.02);
          for (var j = 0; j < n; j++) { riin(v, x + rnd(-0.01, 0.01), v.d * rnd(0.92, 1.08), v.amp * rnd(0.85, 1)); x += v.per * rnd(0.97, 1.03); }
          v.next = x + rnd(1.5, 6);
        }
      }
    }
    function riin(v, tn, d, a) {
      var g = v.g.gain, f = v.o.frequency, np = rint(2, 4), k;
      g.setValueAtTime(0, tn);
      for (k = 0; k < np; k++) {
        var tk = tn + k * 0.032;
        g.linearRampToValueAtTime(a, tk + 0.008);
        g.linearRampToValueAtTime(a * 0.35, tk + 0.028);
      }
      var ts = tn + np * 0.032;
      g.linearRampToValueAtTime(a * 0.95, ts + 0.02);
      g.linearRampToValueAtTime(a * 0.6, tn + d * 0.8);
      g.linearRampToValueAtTime(0, tn + d);
      f.setValueAtTime(v.f, tn); f.linearRampToValueAtTime(v.f, tn + d * 0.6); f.linearRampToValueAtTime(v.f * 0.985, tn + d);
    }

    // Crickets: emma-korogi "コロコロリー" voices + a tsuzure-sase trill wash.
    function buildCrickets(L, t) {
      var p = P(); p.vs = [];
      for (var i = 0; i < 2; i++) {
        var o = osc('sine', rnd(3400, 3800)), g = gn(0), pn = pan(i ? rnd(0.2, 0.8) : rnd(-0.8, -0.2));
        o.connect(g); g.connect(pn); pn.connect(L.out);
        keep(p, g, pn); run1(p, o, t);
        p.vs.push({ o: o, g: g, f: o.frequency.value, amp: rnd(0.6, 1), next: 0 });
      }
      var car = osc('sine', rnd(4000, 4400)), lfo = osc('sine', rnd(17, 24)), lg = gn(0.5), am = gn(0.5), wg = gn(0), wp = pan(rnd(-0.4, 0.4));
      lfo.connect(lg); lg.connect(am.gain); car.connect(am); am.connect(wg); wg.connect(wp); wp.connect(L.out);
      keep(p, lg, am, wg, wp); run1(p, car, t); run1(p, lfo, t);
      p.wash = { g: wg, next: 0 };
      return p;
    }
    function runCrickets(L, t, tEnd) {
      var p = L.parts, i;
      for (i = 0; i < p.vs.length; i++) {
        var v = p.vs[i];
        if (!v.next || v.next < t - 1) v.next = t + rnd(0.2, 3);
        while (v.next < tEnd) {
          var n = rint(4, 10), x = Math.max(v.next, t + 0.02);
          for (var j = 0; j < n; j++) x += korokoro(v, x, v.amp * rnd(0.8, 1)) + rnd(0.6, 1.6);
          v.next = x + rnd(2, 8);
        }
      }
      var w = p.wash;
      if (!w.next || w.next < t - 1) w.next = t + rnd(0, 4);
      while (w.next < tEnd) {
        var ts = Math.max(w.next, t + 0.02), d = rnd(4, 15), a = rnd(0.15, 0.3), gg = w.g.gain;
        gg.setValueAtTime(0, ts); gg.linearRampToValueAtTime(a, ts + 0.4); gg.linearRampToValueAtTime(a * rnd(0.6, 1), ts + d - 0.6); gg.linearRampToValueAtTime(0, ts + d);
        w.next = ts + d + rnd(2, 10);
      }
    }
    function korokoro(v, ts, a) {
      var g = v.g.gain, f = v.o.frequency, x = ts, groups = rint(2, 3), k;
      f.setValueAtTime(v.f, ts);
      g.setValueAtTime(0, ts);
      for (var gi = 0; gi < groups; gi++) {
        var np = rint(3, 4);
        for (k = 0; k < np; k++) {
          g.setValueAtTime(0, x); g.linearRampToValueAtTime(a * (0.8 + 0.2 * k / np), x + 0.004); g.linearRampToValueAtTime(0, x + 0.022);
          x += 0.033;
        }
        x += 0.06;
      }
      var n2 = rint(8, 14);
      f.setValueAtTime(v.f, x); f.linearRampToValueAtTime(v.f * 1.012, x + n2 * 0.026);
      for (k = 0; k < n2; k++) {
        var aa = a * 0.9 * (1 - 0.35 * k / n2);
        g.setValueAtTime(0.02 * a, x); g.linearRampToValueAtTime(aa, x + 0.004); g.linearRampToValueAtTime(0.02 * a, x + 0.022);
        x += 0.026;
      }
      g.linearRampToValueAtTime(0, x + 0.01);
      return x - ts + 0.02;
    }

    // Bees: a few wandering buzzing voices.
    function buildBees(L, t) {
      var p = P(), lp = biq('lowpass', 1500, 0.7);
      lp.connect(L.out); keep(p, lp);
      p.vs = [];
      for (var i = 0; i < 3; i++) {
        var f = i === 2 ? rnd(140, 165) : rnd(215, 255), o = osc('sawtooth', f), g = gn(0), pn = pan(rnd(-0.6, 0.6));
        o.connect(g); g.connect(pn); pn.connect(lp);
        keep(p, g, pn); run1(p, o, t);
        p.vs.push({ o: o, g: g, p: pn, f: f, next: 0, k: i === 2 ? 0.8 : 0.5 });
      }
      return p;
    }
    function runBees(L, t, tEnd) {
      var vs = L.parts.vs;
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (!v.next || v.next < t - 1) v.next = t;
        while (v.next < tEnd) {
          var tn = Math.max(v.next, t), r = R(), a = r < 0.25 ? 0 : Math.pow(r, 1.5);
          target(v.g.gain, a * v.k, tn, rnd(0.4, 1));
          target(v.o.frequency, v.f * (1 + 0.06 * (R() - 0.5)) * (1 + 0.04 * a), tn, rnd(0.2, 0.6));
          if (v.p.pan) target(v.p.pan, rnd(-0.8, 0.8), tn, rnd(0.6, 1.5));
          v.next = tn + rnd(0.7, 2.2);
        }
      }
    }

    // ------------------------------------------------------------ event layers
    function every(L, t, tEnd, first, fn) {
      if (!L.next || L.next < t - 2) L.next = t + rnd(first[0], first[1]);
      var guard = 0;
      while (L.next < tEnd && guard++ < 8) {
        var te = Math.max(L.next, t + 0.02), gap;
        if (nVoices < MAXV) gap = fn(te); else gap = rnd(1, 3);
        L.next = te + Math.max(0.05, num(gap, 1)) * (1.6 - 0.6 * L.eff);
      }
    }

    function runThunder(L, t, tEnd) {
      every(L, t, tEnd, [3, 10], function (te) { thunderVoice(te, rnd(0.15, 0.6), L.out); return rnd(20, 60); });
    }
    function thunderVoice(t, s, dest) {
      var src = nsrc('pink'), lp = biq('lowpass', 140 + 600 * s, 0.7), lp2 = biq('lowpass', 900, 0.5), g = gn(0), pn = pan(rnd(-0.6, 0.6));
      var nodes = [src, lp, lp2, g, pn], dur = 5 + 5 * s + rnd(0, 3);
      src.connect(lp); lp.connect(lp2); lp2.connect(g); g.connect(pn); pn.connect(dest);
      lp.frequency.setValueAtTime(140 + 600 * s, t);
      lp.frequency.exponentialRampToValueAtTime(70 + 90 * s, t + dur);
      g.gain.setValueAtTime(0, t);
      var tb = t + (s > 0.6 ? 0.02 : rnd(0.1, 0.4)), nb = 3 + Math.floor(R() * 4 + s * 3), lvl = 0.35 + 0.65 * s;
      for (var i = 0; i < nb; i++) {
        var peak = (i === 0 ? 1 : rnd(0.35, 0.9) * Math.pow(0.82, i)) * lvl;
        g.gain.setTargetAtTime(peak, tb, i === 0 ? 0.03 + 0.25 * (1 - s) : rnd(0.08, 0.3));
        var hold = rnd(0.15, 0.6);
        g.gain.setTargetAtTime(peak * rnd(0.2, 0.5), tb + hold, rnd(0.3, 0.8));
        tb += hold + rnd(0.3, 1.2);
        if (tb > t + dur - 1.2) break;
      }
      g.gain.setTargetAtTime(0, tb, rnd(0.8, 1.4));
      startLoop(src, t); src.stop(tb + 8);
      if (s > 0.55) {
        var tc = t + rnd(0, 0.05), c = nsrc('white'), cb = biq('bandpass', 1600, 0.5), cl = biq('lowpass', 4200, 0.5), cg = gn(0);
        c.connect(cb); cb.connect(cl); cl.connect(cg); cg.connect(pn);
        cg.gain.setValueAtTime(0, tc); cg.gain.linearRampToValueAtTime(0.35 * s, tc + 0.006); cg.gain.setTargetAtTime(0, tc + 0.008, 0.07);
        for (var k = 0; k < 4; k++) { var tk = tc + rnd(0.05, 0.4); cg.gain.setTargetAtTime(rnd(0.05, 0.15) * s, tk, 0.01); cg.gain.setTargetAtTime(0, tk + 0.02, 0.05); }
        startLoop(c, tc); c.stop(tc + 1.5); nodes.push(c, cb, cl, cg);
      }
      done(src, nodes);
    }

    // ウグイス
    function runUguisu(L, t, tEnd) {
      every(L, t, tEnd, [0.8, 5], function (te) {
        var st = L.st || (L.st = { left: 0 });
        if (st.left <= 0) {
          if (!st.bird || chance(0.45)) {
            st.bird = { f0: rnd(950, 1300), pan: rnd(-0.75, 0.75), amp: rnd(0.45, 1), lp: rnd(4800, 6500), k: rnd(0.93, 1.07), hoo: rnd(0.9, 1.5) };
          }
          st.left = rint(2, 6);
        }
        st.left--;
        var d = chance(0.16) ? uguisuValley(te, st.bird, L.out) : uguisuSong(te, st.bird, L.out);
        return st.left > 0 ? d + rnd(5, 12) : d + rnd(10, 28);
      });
    }
    function uguisuSong(t, b, dest) {
      var S = new Score(800), f0 = b.f0 * rnd(0.96, 1.04), dh = b.hoo * rnd(0.88, 1.12), k = b.k;
      // ホー: long, slightly rising whistle with crescendo
      S.note(0.02, dh, function (u, tt) { return f0 * (0.93 + 0.07 * sstep(0, 0.25, u) + 0.025 * u) * (1 + 0.0025 * Math.sin(TAU * 5.5 * tt)); },
        function (u) { return 0.3 + 0.7 * sstep(0, 0.6, u); }, 0.09, 0.035);
      var x = 0.02 + dh + rnd(0.1, 0.17);
      // ホ
      S.note(x, 0.075, function (u) { return k * (1850 - 300 * u); }, 0.7, 0.006, 0.015); x += 0.11;
      // ケ: fast upsweep
      S.note(x, 0.06, function (u) { return k * (2400 + 1500 * sstep(0, 1, u)); }, 0.85, 0.005, 0.01); x += 0.088;
      // キョ: sharp arch then a long fall
      var dk = rnd(0.2, 0.27);
      S.note(x, dk, function (u) { return k * (3400 + 800 * sstep(0, 0.2, u) - 2000 * sstep(0.2, 1, u)); },
        function (u) { return 1 - 0.5 * u; }, 0.004, 0.03);
      x += dk;
      playScore(S, t, dest, { wave: 'bird', amp: b.amp, pan: b.pan, lp: b.lp });
      return x + 0.1;
    }
    function uguisuValley(t, b, dest) {  // 谷渡り: ケキョケキョケキョ…
      var S = new Score(800), n = rint(7, 15), per = rnd(0.15, 0.19), x = 0.05, k = b.k * rnd(0.97, 1.03);
      for (var i = 0; i < n; i++) {
        var a = 1 - 0.55 * i / n;
        S.note(x, 0.04, function (u) { return k * (2500 + 900 * u); }, 0.75 * a, 0.004, 0.008);
        S.note(x + 0.055, 0.085, function (u) { return k * (3700 + 300 * sstep(0, 0.25, u) - 1500 * sstep(0.25, 1, u)); }, a, 0.004, 0.02);
        x += per * (1 + 0.25 * sstep(0.6, 1, i / n));
      }
      playScore(S, t, dest, { wave: 'bird', amp: b.amp, pan: b.pan, lp: b.lp });
      return x + 0.2;
    }

    // スズメ
    function runSparrows(L, t, tEnd) {
      every(L, t, tEnd, [0.5, 3], function (te) {
        var nb = rint(1, 3), longest = 0;
        for (var b = 0; b < nb; b++) {
          var kf = rnd(0.88, 1.12), n = rint(2, 6), x = rnd(0, 0.9), S = new Score(2000), am = rnd(90, 160);
          for (var i = 0; i < n; i++) {
            var d = rnd(0.05, 0.09), fb = 3300 * kf * rnd(0.95, 1.05), reps = chance(0.3) ? 2 : 1;
            for (var r = 0; r < reps; r++) {
              S.note(x, d, function (u) { return u < 0.15 ? fb * (1 + 0.22 * u / 0.15) : fb * 1.22 * (1 - 0.36 * sstep(0.15, 1, u)); },
                function (u, tt) { return (1 - 0.5 * u) * (0.75 + 0.25 * Math.sin(TAU * am * tt)); }, 0.004, 0.015);
              x += d + 0.035;
            }
            x += rnd(0.1, 0.35);
          }
          playScore(S, te, L.out, { wave: 'chirp', amp: rnd(0.45, 1), pan: rnd(-0.8, 0.8), lp: 6000 });
          longest = Math.max(longest, x);
        }
        return longest + rnd(1.5, 6);
      });
    }

    // ツバメ
    function runSwallows(L, t, tEnd) {
      every(L, t, tEnd, [0.5, 4], function (te) {
        var S = new Score(1000), x = 0.02, dur = rnd(1.0, 2.6), k = rnd(0.92, 1.08);
        while (x < dur) {
          var d = rnd(0.025, 0.06), f1 = rnd(2400, 4300) * k, f2 = rnd(2400, 4500) * k;
          if (chance(0.75)) S.note(x, d, function (u) { return f1 + (f2 - f1) * u; }, rnd(0.5, 1), 0.004, 0.01);
          else { d *= 1.5; S.note(x, d, function (u, tt) { return f1 * (1 + 0.08 * Math.sin(TAU * 45 * tt)); }, rnd(0.4, 0.8), 0.005, 0.012); }
          x += d + rnd(0.015, 0.05);
        }
        if (chance(0.7)) {  // ジュルル buzz
          var bd = rnd(0.25, 0.45), fc = rnd(3000, 3600) * k, fm = rnd(30, 48);
          S.note(x + 0.04, bd, function (u, tt) { return fc * (1 + 0.12 * Math.sin(TAU * fm * tt)); },
            function (u, tt) { return 0.6 * (0.6 + 0.4 * Math.sin(TAU * fm * tt)); }, 0.01, 0.05);
          x += bd + 0.04;
        }
        var p0 = (chance(0.5) ? 1 : -1) * rnd(0.3, 0.9);
        playScore(S, te, L.out, { wave: 'bird', amp: rnd(0.5, 1), pan: p0, panTo: -p0 * rnd(0.5, 1), lp: 6000 });
        return x + rnd(2, 9);
      });
    }

    // ヒバリ: long, rapid, high and far.
    function runSkylark(L, t, tEnd) {
      var st = L.st || (L.st = { k: rnd(0.95, 1.05), pan: rnd(-0.5, 0.5) });
      every(L, t, tEnd, [0.3, 3], function (te) {
        var S = new Score(1000), dur = rnd(7, 14), x = 0.05, lo = 2600 * st.k, hi = 4700 * st.k, i, j;
        while (x < dur) {
          var r = R();
          if (r < 0.4) {
            var d = rnd(0.03, 0.08), fa = rnd(lo, hi), fb = rnd(lo, hi);
            S.note(x, d, function (u) { return fa + (fb - fa) * u; }, rnd(0.4, 1), 0.004, 0.008);
            x += d + rnd(0.01, 0.04);
          } else if (r < 0.65) {
            var n = rint(4, 12), fr = rnd(16, 26), f1 = rnd(lo, hi), f2 = f1 * rnd(0.8, 1.2), am = rnd(0.5, 1);
            for (i = 0; i < n; i++) { S.note(x, 0.6 / fr, (i % 2) ? f2 : f1, am, 0.003, 0.006); x += 1 / fr; }
            x += rnd(0.02, 0.06);
          } else if (r < 0.85) {
            var d2 = rnd(0.12, 0.35), c = rnd(lo, hi * 0.9), w = rnd(150, 500), wr = rnd(9, 16);
            S.note(x, d2, function (u, tt) { return c + w * Math.sin(TAU * wr * tt); }, rnd(0.4, 0.9), 0.008, 0.02);
            x += d2 + rnd(0.02, 0.05);
          } else {
            var n2 = rint(3, 7), f3 = rnd(lo, hi), rr = rnd(9, 14);
            for (j = 0; j < n2; j++) { S.note(x, 0.035, function (u) { return f3 * (1.05 - 0.1 * u); }, 0.8, 0.003, 0.01); x += 1 / rr; }
          }
        }
        var p0 = st.pan; st.pan = clamp(p0 + rnd(-0.35, 0.35), -0.75, 0.75);
        playScore(S, te, L.out, { wave: 'whistle', amp: rnd(0.6, 1), pan: p0, panTo: st.pan, lp: 5500 });
        return x + rnd(0.4, 3);
      });
    }

    // セキレイ: チチン flight calls.
    function runWagtail(L, t, tEnd) {
      every(L, t, tEnd, [0.5, 5], function (te) {
        var S = new Score(1000), n = rint(2, 5), x = 0.02, k = rnd(0.92, 1.06);
        for (var i = 0; i < n; i++) {
          S.note(x, 0.035, function (u) { return k * (4200 - 700 * u); }, 0.7, 0.003, 0.008);
          S.note(x + 0.06, 0.075, function (u) { return k * (4000 + 400 * Math.sin(Math.PI * u) - 500 * u); }, 1, 0.004, 0.02);
          x += rnd(0.32, 0.7);
        }
        var p0 = rnd(-0.8, 0.8);
        playScore(S, te, L.out, { wave: 'bird', amp: rnd(0.4, 0.9), pan: p0, panTo: clamp(p0 + rnd(-0.8, 0.8), -0.9, 0.9), lp: 5500 });
        return x + rnd(5, 16);
      });
    }

    // キジ: ケーンケーン + wing drumming (母衣打ち).
    function runPheasant(L, t, tEnd) {
      every(L, t, tEnd, [1, 8], function (te) { return pheasant(te, L.out) + rnd(35, 90); });
    }
    function pheasant(t, dest) {
      var S = new Score(1000), f0 = rnd(950, 1150), x = 0.02, pn = rnd(-0.7, 0.7), amp = rnd(0.5, 1);
      for (var i = 0; i < 2; i++) {
        var d = rnd(0.28, 0.38);
        S.note(x, d, function (u) { return f0 * (u < 0.12 ? 0.82 + 0.2 * u / 0.12 : 1.02 - 0.1 * sstep(0.12, 1, u)); },
          function (u, tt) { return (u < 0.1 ? 1 : 0.85 - 0.25 * u) * (0.8 + 0.2 * Math.sin(TAU * 70 * tt)); }, 0.01, 0.06);
        x += d + rnd(0.12, 0.2);
      }
      playScore(S, t, dest, { wave: 'nasal', amp: amp, pan: pn, lp: 3200 });
      var td = t + x + rnd(0.05, 0.2), nb = rint(10, 16), per = 1 / rnd(13, 17);
      var src = nsrc('pink'), lp = biq('lowpass', 260, 0.8), g = gn(0), p = pan(pn), tk = td;
      src.connect(lp); lp.connect(g); g.connect(p); p.connect(dest);
      g.gain.setValueAtTime(0, td);
      for (var j = 0; j < nb; j++) {
        var a = amp * 1.6 * Math.pow(1 - j / nb, 0.8), pj = per * (1 + 0.15 * j / nb);
        g.gain.setValueAtTime(0, tk); g.gain.linearRampToValueAtTime(a, tk + 0.008); g.gain.linearRampToValueAtTime(0, tk + pj * 0.8);
        tk += pj;
      }
      startLoop(src, td); src.stop(tk + 0.2);
      done(src, [src, lp, g, p]);
      return tk - t;
    }

    // フクロウ: ホッホー … ゴロスケ ホッホー
    function runOwl(L, t, tEnd) {
      every(L, t, tEnd, [1, 6], function (te) {
        var st = L.st || (L.st = { left: 0 });
        if (st.left <= 0) {
          if (!st.b || chance(0.4)) st.b = { f0: rnd(360, 450), pan: rnd(-0.7, 0.7), amp: rnd(0.55, 1) };
          st.left = rint(2, 4);
        }
        st.left--;
        var d = owlSong(te, L.out, st.b);
        return st.left > 0 ? d + rnd(5, 10) : d + rnd(15, 40);
      });
    }
    function owlSong(t, dest, b) {
      var S = new Score(800), f0 = b.f0 * rnd(0.98, 1.02), x = 0.02;
      function hoot(d, lvl, fk, roll) {
        S.note(x, d, function (u) { return f0 * fk * (0.9 + 0.1 * sstep(0, 0.2, u) - 0.04 * sstep(0.5, 1, u)); },
          function (u, tt) { var a = lvl * sstep(0, 0.18, u) * (1 - 0.6 * sstep(0.55, 1, u)); return roll ? a * (0.55 + 0.45 * Math.cos(TAU * roll * tt)) : a; }, 0.03, 0.06);
      }
      hoot(0.16, 0.8, 1); x += 0.28;
      hoot(0.45, 1, 1); x += 0.45 + rnd(0.6, 0.9);
      if (chance(0.85)) {
        hoot(0.32, 0.75, 0.93, rnd(14, 19)); x += 0.38;
        hoot(0.12, 0.7, 1.02); x += 0.17;
        hoot(0.14, 0.8, 1.05); x += 0.3;
        hoot(0.2, 0.85, 1); x += 0.3;
        hoot(0.55, 1, 0.98); x += 0.55;
      }
      playScore(S, t, dest, { wave: 'hoot', amp: b.amp, pan: b.pan, lp: 1700 });
      return x;
    }

    // ガン: a distant skein passing overhead.
    function runGeese(L, t, tEnd) {
      every(L, t, tEnd, [1, 6], function (te) { return geese(te, L.out) + rnd(30, 90); });
    }
    function geese(t, dest) {
      var dur = rnd(9, 15), dir = chance(0.5) ? 1 : -1, i;
      var bus = ctx.createGain(), bp = biq('bandpass', 1300, 0.8), lp = biq('lowpass', 900, 0.7), p = pan(-0.8 * dir);
      bus.connect(bp); bp.connect(lp); lp.connect(p); p.connect(dest);
      var env = new Float32Array(64);
      for (i = 0; i < 64; i++) env[i] = Math.pow(Math.sin(Math.PI * i / 63), 1.4);
      env[0] = 0; env[63] = 0;
      bus.gain.setValueCurveAtTime(env, t, dur);   // fresh param: no prior events (see playScore)
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.linearRampToValueAtTime(2600, t + dur / 2);
      lp.frequency.linearRampToValueAtTime(900, t + dur);
      if (p.pan) { p.pan.setValueAtTime(-0.8 * dir, t); p.pan.linearRampToValueAtTime(0.8 * dir, t + dur); }
      var nb = rint(4, 7);
      for (var b = 0; b < nb; b++) {
        var S = new Score(600), f0 = rnd(560, 820), x = rnd(0, 1.5);
        while (x < dur - 0.5) {
          var d2 = rnd(0.14, 0.22);
          S.note(x, 0.06, function (u) { return f0 * (1.1 + 0.12 * u); }, 0.8, 0.008, 0.01);
          S.note(x + 0.09, d2, function (u) { return f0 * (1.25 + 0.06 * Math.sin(Math.PI * u) - 0.22 * u); }, function (u) { return 1 - 0.3 * u; }, 0.012, 0.04);
          x += rnd(0.5, 2.2);
        }
        S.note(dur, 0.01, f0, 0);   // pad every bird's score to the same length
        playScore(S, t, bus, { wave: 'nasal', amp: rnd(0.5, 1), pan: 0, extra: b === nb - 1 ? [bus, bp, lp, p] : null });
      }
      return dur;
    }

    // シカ: distant stag "ピィー(ヨー)" calls.
    function runDeer(L, t, tEnd) {
      var st = L.st || (L.st = { pan: rnd(-0.6, 0.6) });
      every(L, t, tEnd, [1, 6], function (te) {
        var n = rint(1, 3), x = 0.02, S = new Score(600), k = rnd(0.9, 1.1);
        for (var i = 0; i < n; i++) {
          var d = rnd(0.9, 1.5), pk = rnd(1900, 2300) * k, s0 = rnd(800, 1000) * k;
          S.note(x, d, function (u, tt) {
            return u < 0.3 ? s0 + (pk - s0) * sstep(0, 0.3, u)
              : (u < 0.72 ? pk * (1 - 0.06 * sstep(0.3, 0.72, u)) * (1 + 0.008 * Math.sin(TAU * 6 * tt)) : pk * 0.94 * (1 - 0.42 * sstep(0.72, 1, u)));
          }, function (u) { return sstep(0, 0.25, u) * (1 - 0.3 * sstep(0.7, 1, u)); }, 0.05, 0.12);
          x += d + rnd(2, 4);
        }
        if (chance(0.3)) st.pan = rnd(-0.6, 0.6);
        playScore(S, te, L.out, { wave: 'deer', amp: rnd(0.5, 1), pan: st.pan, lp: 3200 });
        return x + rnd(20, 50);
      });
    }

    // ヒグラシ: カナカナカナ… descending, slowing, fading.
    function runHigurashi(L, t, tEnd) {
      var st = L.st || (L.st = { ind: [] });
      if (!st.ind.length) for (var i = 0; i < 3; i++) st.ind.push({ f: rnd(2150, 2400), pan: rnd(-0.85, 0.85), amp: rnd(0.45, 1) });
      every(L, t, tEnd, [0.5, 4], function (te) {
        var b = st.ind[Math.floor(R() * st.ind.length)];
        var d = higurashi(te, L.out, b);
        return chance(0.3) ? d * rnd(0.3, 0.7) : d + rnd(1.5, 8);
      });
    }
    function higurashi(t, dest, b) {
      var S = new Score(1000), dur = rnd(4.5, 8), x = 0.02, f = b.f * rnd(0.98, 1.02), i = 0, am = rnd(55, 85);
      while (x < dur) {
        var u = x / dur, per = 1 / (8.5 - 3.5 * u);
        var lvl = u < 0.08 ? 0.6 + 5 * u : 1 - 0.65 * sstep(0.3, 1, u), fk = f * (1 - 0.12 * u) * ((i % 2) ? 0.965 : 1);
        S.note(x, per * 0.72, function (v) { return fk * (1.035 - 0.05 * v); },
          function (v, tt) { return lvl * (1 - 0.6 * v) * (0.8 + 0.2 * Math.sin(TAU * am * tt)); }, 0.004, 0.03);
        x += per; i++;
      }
      playScore(S, t, dest, { wave: 'higu', amp: b.amp, pan: b.pan, lp: 6500 });
      return x;
    }

    // 風鈴: glass bell with beating partials; struck by the clapper 1–4 times.
    function glass(t, base, strikes, amp, dest, pn) {
      var Pp = [[1, 1, 1.9], [0, 0.7, 1.7], [2.43, 0.2, 0.55], [2.48, 0.12, 0.45]];
      var out = gn(amp), p = pan(pn), nodes = [out, p], end = t, oscs = [], i;
      out.connect(p); p.connect(dest);
      for (i = 0; i < Pp.length; i++) {
        var fr = i === 1 ? base + rnd(2.5, 5) : base * Pp[i][0] * rnd(0.998, 1.002);
        var o = osc('sine', fr), g = gn(0);
        o.connect(g); g.connect(out); nodes.push(o, g); oscs.push(o);
        for (var s = 0; s < strikes.length; s++) {
          var ts = t + strikes[s][0], v = strikes[s][1] * Pp[i][1], tau = Pp[i][2] / 6.9 * rnd(0.85, 1.15);
          g.gain.setTargetAtTime(v, ts, 0.0015);
          g.gain.setTargetAtTime(0, ts + 0.008, tau);
          end = Math.max(end, ts + tau * 7);
        }
      }
      for (i = 0; i < oscs.length; i++) { oscs[i].start(t); oscs[i].stop(end + 0.1); }
      done(oscs[0], nodes);
    }
    function furinJingle(t, L, force) {
      var st = L.st || (L.st = { base: rnd(2150, 2650), pan: rnd(-0.5, 0.5), base2: rnd(1800, 2900) });
      var n = Math.max(1, Math.min(4, Math.round(rnd(0.6, 2.6) * (0.6 + 0.6 * (force || 0.7))))), x = 0, v = rnd(0.7, 1), strikes = [];
      for (var i = 0; i < n; i++) { strikes.push([x, v]); x += rnd(0.07, 0.32); v *= rnd(0.35, 0.8); }
      var far = chance(0.18);
      glass(t, far ? st.base2 : st.base, strikes, far ? 0.35 : 0.8, L.out, far ? -st.pan : st.pan);
      return x;
    }
    function runFurin(L, t, tEnd) {
      every(L, t, tEnd, [0.5, 4], function (te) {
        if (te - (L.lastJ || -10) > 1.6) { L.lastJ = te; furinJingle(te, L, gustAt(te)); }
        return rnd(5, 14);
      });
    }

    // 梵鐘: distant temple bell, inharmonic partials with beating (うなり).
    function runBell(L, t, tEnd) {
      L.st = L.st || { f0: rnd(112, 138), pan: rnd(-0.35, 0.35) };
      every(L, t, tEnd, [2, 10], function (te) { templeBell(te, L.out, L.st.f0, L.st.pan); return rnd(40, 90); });
    }
    function templeBell(t, dest, f0, pn) {
      var Pp = [[1, 0.55, 26, 0.55], [2.04, 0.85, 21, 0.9], [2.72, 0.5, 15, 1.3], [3.56, 0.42, 11, 0],
        [4.62, 0.3, 8, 0], [5.94, 0.22, 5.5, 0], [7.38, 0.13, 3.8, 0], [8.97, 0.07, 2.6, 0]];
      var out = gn(0.5), lp = biq('lowpass', 1500, 0.5), p = pan(pn), nodes = [out, lp, p], longest = null, maxEnd = 0;
      out.connect(lp); lp.connect(p); p.connect(dest);
      for (var i = 0; i < Pp.length; i++) {
        var T = Pp[i][2] * rnd(0.85, 1.1), g = gn(0), stopAt = t + T * 1.1;
        g.connect(out); nodes.push(g);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(Pp[i][1], t + 0.006); g.gain.setTargetAtTime(0, t + 0.008, T / 6.9);
        var o = osc('sine', f0 * Pp[i][0]); o.connect(g); o.start(t); o.stop(stopAt); nodes.push(o);
        if (Pp[i][3]) {
          var o2 = osc('sine', f0 * Pp[i][0] + Pp[i][3]), g2 = gn(0.85);
          o2.connect(g2); g2.connect(g); o2.start(t); o2.stop(stopAt); nodes.push(o2, g2);
        }
        if (stopAt > maxEnd) { maxEnd = stopAt; longest = o; }
      }
      var ns = nsrc('pink'), nl = biq('lowpass', 420, 0.7), ng = gn(0);
      ns.connect(nl); nl.connect(ng); ng.connect(out);
      ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.9, t + 0.003); ng.gain.setTargetAtTime(0, t + 0.004, 0.035);
      startLoop(ns, t); ns.stop(t + 0.4); nodes.push(ns, nl, ng);
      done(longest, nodes);
    }

    // ------------------------------------------------------------ layer table
    var DEF = {
      wind: { gain: 0.55, send: 0.04, dw: 'wind', build: buildWind },
      gale: { gain: 0.6, send: 0.07, dw: 'wind', build: buildGale, run: runGale },
      breeze: { gain: 0.5, send: 0.05, build: buildBreeze },
      rain: { gain: 0.5, send: 0.06, build: buildRain, run: runRainDrift },
      'rain-heavy': { gain: 0.5, send: 0.08, build: buildRainHeavy, run: runRainDrift },
      drizzle: { gain: 0.6, send: 0.1, build: buildDrizzle },
      thunder: { gain: 2.0, send: 0.45, run: runThunder },
      stream: { gain: 0.38, send: 0.07, build: buildStream, run: runStream },
      'water-lap': { gain: 0.9, send: 0.15, run: runLap },
      'snow-hush': { gain: 0.4, send: 0.2, build: buildSnow, run: runSnow },
      uguisu: { gain: 0.3, send: 0.28, dw: 'bird', run: runUguisu },
      sparrows: { gain: 0.26, send: 0.18, dw: 'bird', run: runSparrows },
      swallows: { gain: 0.22, send: 0.18, dw: 'bird', run: runSwallows },
      skylark: { gain: 0.12, send: 0.4, dw: 'lark', run: runSkylark },
      frogs: { gain: 0.3, send: 0.25, dw: 'frog', build: buildFrogs, run: runFrogs },
      cicadas: { gain: 0.25, send: 0.2, dw: 'cicada', build: buildCicadas, run: runCicadas },
      higurashi: { gain: 0.25, send: 0.42, dw: 'higu', run: runHigurashi },
      suzumushi: { gain: 0.09, send: 0.3, dw: 'insect', build: buildSuzumushi, run: runSuzumushi },
      crickets: { gain: 0.15, send: 0.3, dw: 'insect', build: buildCrickets, run: runCrickets },
      geese: { gain: 0.22, send: 0.4, dw: 'geese', run: runGeese },
      wagtail: { gain: 0.28, send: 0.22, dw: 'bird', run: runWagtail },
      pheasant: { gain: 0.35, send: 0.4, dw: 'bird', run: runPheasant },
      owl: { gain: 0.26, send: 0.42, dw: 'owl', run: runOwl },
      furin: { gain: 0.3, send: 0.3, run: runFurin },
      bell: { gain: 0.3, send: 0.65, dw: 'bell', run: runBell },
      shishiodoshi: { gain: 0.3, send: 0.45, build: buildShishi, run: runShishi },
      bamboo: { gain: 0.8, send: 0.15, build: buildBamboo, run: runBamboo },
      bees: { gain: 0.1, send: 0.08, dw: 'bees', build: buildBees, run: runBees },
      deer: { gain: 0.35, send: 0.55, dw: 'deer', run: runDeer }
    };
    var NAMES = Object.keys(DEF);

    function mkLayer(name) {
      var d = DEF[name], L = { name: name, def: d, eff: 0, out: gn(0), parts: null, next: 0, silentAt: -1, wantAt: -1, failAt: -100, st: null };
      L.out.connect(G.mix);
      if (d.send && G.conv) { L.snd = gn(d.send); L.out.connect(L.snd); L.snd.connect(G.revIn); }
      layers[name] = L;
      return L;
    }
    function teardown(L) {
      var p = L.parts, t = now(), i;
      L.parts = null; L.silentAt = -1; L.next = 0;
      if (!p) return;
      for (i = 0; i < p.srcs.length; i++) { try { p.srcs[i].stop(t + 0.05); } catch (e) { /* ignore */ } }
      for (i = 0; i < p.nodes.length; i++) { try { p.nodes[i].disconnect(); } catch (e) { /* ignore */ } }
    }

    function applyLevels(force) {
      if (!G || !alive()) return;
      var t = now();
      if (!force && !offline && t - lastApply < 0.04) { dirty = true; return; }
      lastApply = t; dirty = false;
      for (var i = 0; i < NAMES.length; i++) {
        var name = NAMES[i], d = DEF[name], req = scene.sfx[name] || 0;
        var eff = req > 0 ? clamp(req * clamp(dayWeight(d.dw, scene.day, scene.dusk), 0, 1), 0, 1) : 0;
        var L = layers[name];
        if (!L) { if (eff <= 0.001) continue; L = mkLayer(name); }
        if (Math.abs(eff - L.eff) < 0.003 && !(eff === 0 && L.eff !== 0)) continue;
        if (L.eff <= 0.02 && eff > 0.02) L.wantAt = t;
        L.eff = eff;
        retarget(L.out.gain, d.gain * Math.pow(eff, 1.15), TC);
      }
      retarget(G.mix.gain, 1 - 0.12 * scene.inten, 0.3);
    }

    // ------------------------------------------------------------ scheduler
    function schedTick() {
      if (!G || !alive()) return;
      var t = now(), tEnd = t + LOOK, built = false;
      if (dirty) applyLevels(true);
      updateGust(t, tEnd);
      for (var i = 0; i < NAMES.length; i++) {
        var L = layers[NAMES[i]];
        if (!L) continue;
        var d = L.def;
        if (d.build) {
          if (!L.parts && L.eff > 0.02 && (offline || (!built && t - L.wantAt >= 0.15)) && !(t - L.failAt < 30)) {
            building = null;
            try { L.parts = d.build(L, t); } catch (e) {
              if (building) { L.parts = building; teardown(L); }
              L.parts = null; L.failAt = t;
            }
            building = null;
            built = true;
          }
          if (L.parts) {
            if (L.eff <= 0.002) {
              if (L.silentAt < 0) L.silentAt = t;
              else if (t - L.silentAt > TEARDOWN) teardown(L);
            } else L.silentAt = -1;
          }
        }
        if (d.run) {
          if (L.eff > 0.05 && (!d.build || L.parts)) { try { d.run(L, t, tEnd); } catch (e) { /* keep going */ } }
          else L.next = 0;
        }
      }
    }
    function startTimer() {
      if (timer || offline) return;
      timer = setInterval(function () { try { schedTick(); } catch (e) { /* ignore */ } }, TICK_MS);
    }
    function stopTimerFn() { if (timer) { clearInterval(timer); timer = null; } }

    // ------------------------------------------------------------ koto (tick)
    function kotoMidi(i) {
      var sekki = Math.floor(i / 3), k = i % 3, season = Math.floor(sekki / 6), p = sekki % 6;
      var deg = [5, 7, 4, 2][season] + p + [0, 2, 1][k];   // each sekki: a rising "turn" motif, sekki step up
      return 52 + 12 * Math.floor(deg / 5) + MIYAKO[deg % 5]; // 52 = E3
    }
    function kotoBuf(m) {
      if (koto.cache[m]) return koto.cache[m];
      var sr = ctx.sampleRate, f = 440 * Math.pow(2, (m - 69) / 12), len = Math.floor(sr * 1.6);
      var b = ctx.createBuffer(1, len, sr), out = b.getChannelData(0);
      var N = sr / f, br = clamp(0.32 + (f - 200) / 4000, 0.32, 0.48), T60 = clamp(1.6 - (f - 200) / 900, 0.7, 1.6);
      var g = Math.pow(10, -3 / (T60 * f)), Lt = N - br, L = Math.floor(Lt), fr = Lt - L, i;
      if (fr < 0.3) { L -= 1; fr += 1; }
      var C = (1 - fr) / (1 + fr), ring = new Float32Array(L), lp = 0, mean = 0;
      for (i = 0; i < L; i++) { lp += ((R() * 2 - 1) - lp) * 0.75; ring[i] = lp; }
      var P0 = Math.max(1, Math.round(0.13 * L)), tmp = new Float32Array(L);   // pluck position comb
      for (i = 0; i < L; i++) { tmp[i] = ring[i] - (i >= P0 ? ring[i - P0] : 0); mean += tmp[i]; }
      mean /= L;
      for (i = 0; i < L; i++) ring[i] = tmp[i] - mean;
      var idx = 0, x1 = 0, apx = 0, apy = 0, pk = 0;
      for (var n = 0; n < len; n++) {
        var x = ring[idx];
        out[n] = x;
        var y = (1 - br) * x + br * x1; x1 = x;
        var ap = C * y + apx - C * apy; apx = y; apy = ap;
        ring[idx] = ap * g;
        if (++idx >= L) idx = 0;
      }
      // tsume (plectrum) click
      var cl = Math.floor(sr * 0.003);
      for (i = 0; i < cl; i++) out[i] += (R() * 2 - 1) * 0.25 * (1 - i / cl);
      var fade = Math.floor(sr * 0.1);
      for (i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
      for (i = 0; i < len; i++) if (Math.abs(out[i]) > pk) pk = Math.abs(out[i]);
      var k = 0.9 / (pk || 1);
      for (i = 0; i < len; i++) out[i] *= k;
      koto.cache[m] = b;
      return b;
    }
    function kotoBus() {
      if (koto.bus) return koto.bus;
      var a = biq('peaking', 240, 1.2, 3), b = biq('peaking', 1150, 1.5, 2), c = biq('lowpass', 5200, 0.6), g = gn(0.9);
      a.connect(b); b.connect(c); c.connect(g); g.connect(G.fx);
      koto.bus = a;
      return a;
    }
    function pluck(m, vel, t) {
      var bus = kotoBus(), buf = kotoBuf(m);
      while (koto.voices.length >= 6) {
        var old = koto.voices.shift();
        try { old.g.gain.cancelScheduledValues(t); old.g.gain.setTargetAtTime(0, t, 0.012); old.s.stop(t + 0.1); } catch (e) { /* ignore */ }
      }
      var s = ctx.createBufferSource(), g = gn(vel * 0.42), p = pan(clamp((m - 66) / 40, -0.35, 0.35));
      s.buffer = buf;
      s.playbackRate.setValueAtTime(1.004, t); s.playbackRate.setTargetAtTime(1, t, 0.03);
      s.connect(g); g.connect(p); p.connect(bus);
      var v = { s: s, g: g };
      koto.voices.push(v);
      s.onended = function () {
        var j = koto.voices.indexOf(v);
        if (j >= 0) koto.voices.splice(j, 1);
        s.onended = null;
        try { s.disconnect(); g.disconnect(); p.disconnect(); } catch (e) { /* ignore */ }
      };
      s.start(t);
    }

    // ------------------------------------------------------------ UI one-shots
    function stampSound(t) {
      var out = gn(1), p = pan(rnd(-0.1, 0.1)), nodes = [out, p];
      out.connect(p); p.connect(G.fx);
      var o = osc('sine', 260), og = gn(0);
      o.frequency.setValueAtTime(rnd(240, 280), t); o.frequency.exponentialRampToValueAtTime(rnd(140, 160), t + 0.05);
      og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.5, t + 0.002); og.gain.setTargetAtTime(0, t + 0.003, 0.03);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.35); nodes.push(o, og);
      var c = nsrc('white'), cb = biq('bandpass', 1800, 1.2), cg = gn(0);
      c.connect(cb); cb.connect(cg); cg.connect(out);
      cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(0.35, t + 0.001); cg.gain.setTargetAtTime(0, t + 0.002, 0.008);
      startLoop(c, t); c.stop(t + 0.1); nodes.push(c, cb, cg);
      var m = nsrc('pink'), ml = biq('lowpass', 600, 0.7), mg = gn(0);
      m.connect(ml); ml.connect(mg); mg.connect(out);
      mg.gain.setValueAtTime(0, t); mg.gain.linearRampToValueAtTime(0.45, t + 0.003); mg.gain.setTargetAtTime(0, t + 0.004, 0.025);
      startLoop(m, t); m.stop(t + 0.3); nodes.push(m, ml, mg);
      var r = nsrc('white'), rb = biq('bandpass', 3500, 0.7), rg = gn(0);
      r.connect(rb); rb.connect(rg); rg.connect(out);
      rg.gain.setValueAtTime(0, t + 0.01); rg.gain.linearRampToValueAtTime(0.025, t + 0.06); rg.gain.linearRampToValueAtTime(0, t + 0.2);
      startLoop(r, t); r.stop(t + 0.25); nodes.push(r, rb, rg);
      done(o, nodes);
    }
    function whooshSound(t) {
      var d = 0.9, s = nsrc('pink'), bp = biq('bandpass', 350, 0.9), g = gn(0), p = pan(-0.5), nodes = [s, bp, g, p];
      s.connect(bp); bp.connect(g); g.connect(p); p.connect(G.fx);
      bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(1600, t + 0.45); bp.frequency.exponentialRampToValueAtTime(500, t + d);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55, t + 0.38); g.gain.setTargetAtTime(0, t + 0.42, 0.16);
      if (p.pan) { p.pan.setValueAtTime(-0.5, t); p.pan.linearRampToValueAtTime(0.5, t + d); }
      var w = nsrc('white'), wb = biq('bandpass', 3000, 0.6), wg = gn(0);
      w.connect(wb); wb.connect(wg); wg.connect(p);
      wg.gain.setValueAtTime(0, t); wg.gain.linearRampToValueAtTime(0.06, t + 0.4); wg.gain.setTargetAtTime(0, t + 0.45, 0.12);
      startLoop(s, t); startLoop(w, t); s.stop(t + d + 0.8); w.stop(t + d + 0.8); nodes.push(w, wb, wg);
      done(s, nodes);
    }

    // ------------------------------------------------------------ public API
    function guard(fn) {
      return function () {
        try { return fn.apply(null, arguments); } catch (e) { return undefined; }
      };
    }

    var api = {};

    api.start = function () {
      try {
        try { if (W.navigator && W.navigator.audioSession) W.navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
        if (!ensureGraph()) return Promise.resolve(false);
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
        var resumed = null;
        if (!offline && ctx.state !== 'running' && ctx.resume) {
          try { resumed = ctx.resume(); } catch (e) { resumed = null; }
        }
        if (!offline) {
          try {  // iOS unlock: play one silent sample inside the gesture
            var sb = ctx.createBufferSource();
            sb.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
            sb.connect(ctx.destination); sb.start(0);
            sb.onended = function () { try { sb.disconnect(); } catch (e) { /* ignore */ } };
          } catch (e) { /* ignore */ }
        }
        var wasEnabled = enabled;
        enabled = true;
        retarget(G.master.gain, MASTER * volume, 0.45);
        if (!wasEnabled) applyLevels(true);
        schedTick();
        startTimer();
        if (resumed && typeof resumed.then === 'function') {
          return resumed.then(function () { return true; }, function () { return false; });
        }
        return Promise.resolve(true);
      } catch (e) {
        return Promise.resolve(false);
      }
    };

    api.stop = guard(function () {
      var was = enabled;
      enabled = false;
      stopTimerFn();
      if (!G || !alive()) return;
      retarget(G.master.gain, 0, 0.16);
      if (!was || offline || stopTimer) return;
      stopTimer = setTimeout(function () {
        stopTimer = null;
        try { if (!enabled && ctx.state === 'running' && ctx.suspend) ctx.suspend(); } catch (e) { /* ignore */ }
      }, 1000);
    });

    Object.defineProperty(api, 'enabled', { enumerable: true, get: function () { return enabled; } });

    api.setScene = guard(function (sc) {
      if (!sc || typeof sc !== 'object') return;
      var sfx = (sc.sfx && typeof sc.sfx === 'object') ? sc.sfx : {};
      var day = clamp(num(sc.daylight, 1), 0, 1), dusk = clamp(num(sc.dusk, 0), 0, 1), inten = clamp(num(sc.intensity, 0), 0, 1);
      var changed = Math.abs(day - scene.day) > 0.01 || Math.abs(dusk - scene.dusk) > 0.01 || Math.abs(inten - scene.inten) > 0.05, k;
      var next = {};
      for (k in sfx) {
        if (!DEF.hasOwnProperty(k)) continue;
        var v = clamp(num(sfx[k], 0), 0, 1);
        if (v > 0) next[k] = v;
        if (!changed && Math.abs(v - (scene.sfx[k] || 0)) > 0.005) changed = true;
      }
      if (!changed) for (k in scene.sfx) if (!(k in next)) { changed = true; break; }
      if (changed) {
        scene.sfx = next; scene.day = day; scene.dusk = dusk; scene.inten = inten;
        if (enabled) applyLevels(false);
      } else if (dirty && enabled) applyLevels(false);
    });

    api.tick = guard(function (index) {
      if (!ready()) return;
      var i = ((Math.round(num(index, 0)) % 72) + 72) % 72, w = wall(), dt = w - koto.last;
      if (dt < 1 / 12) return;
      koto.last = w;
      var vel = dt < 0.15 ? 0.55 : (dt < 0.4 ? 0.75 : 1);
      pluck(kotoMidi(i), vel * (1 - 0.15 * scene.inten), now() + 0.005);
    });

    api.chime = guard(function () {
      if (!ready()) return;
      var t = now() + 0.01, base = [2349, 2489, 2637][Math.floor(R() * 3)];
      glass(t, base, [[0, 1], [rnd(0.12, 0.2), rnd(0.25, 0.4)]], 0.22, G.fx, rnd(-0.15, 0.15));
    });

    api.thunder = guard(function (strength) {
      if (!ready()) return;
      var s = clamp(num(strength, 0.6), 0, 1), w = wall();
      if (w - lastThunder < 1.2) return;
      lastThunder = w;
      thunderVoice(now() + 0.25 + (1 - s) * 1.6 + rnd(0, 0.4), s, G.fx);
    });

    api.stamp = guard(function () { if (ready()) stampSound(now() + 0.005); });
    api.whoosh = guard(function () { if (ready()) whooshSound(now() + 0.01); });

    // Test hooks: run the scheduler deterministically against a virtual clock
    // (needed for OfflineAudioContext, which renders everything at once).
    api._advance = guard(function (seconds) {
      if (!G) return;
      var end = vclock + Math.max(0, num(seconds, 0));
      while (vclock < end - 1e-9) { vclock = Math.min(end, vclock + TICK_MS / 1000); schedTick(); }
    });
    api._stats = guard(function () {
      var built = [], on = [];
      for (var k in layers) { if (layers[k].parts) built.push(k); if (layers[k].eff > 0.001) on.push(k); }
      return { voices: nVoices, built: built, active: on, kotoVoices: koto.voices.length, time: now(), state: ctx ? ctx.state : 'none' };
    });
    Object.defineProperty(api, 'context', { enumerable: false, get: function () { return ctx; } });

    return api;
  };
})();
