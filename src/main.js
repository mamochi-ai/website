/* うつろい暦 — main.js
 * 年輪（ダイヤル）・指の操作・縦書きの表示・巻物・絵葉書・手紙・屏風の開幕。
 */
(function () {
  'use strict';
  var U = window.UTSUROI, A = U.Astro, KO = U.KO;
  var $ = function (id) { return document.getElementById(id); };
  var TAU = Math.PI * 2, DAY = 86400000;
  var reduced = false;
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }
  var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var SEKKI_YOMI = { '立春': 'りっしゅん', '雨水': 'うすい', '啓蟄': 'けいちつ', '春分': 'しゅんぶん', '清明': 'せいめい', '穀雨': 'こくう', '立夏': 'りっか', '小満': 'しょうまん', '芒種': 'ぼうしゅ', '夏至': 'げし', '小暑': 'しょうしょ', '大暑': 'たいしょ', '立秋': 'りっしゅう', '処暑': 'しょしょ', '白露': 'はくろ', '秋分': 'しゅうぶん', '寒露': 'かんろ', '霜降': 'そうこう', '立冬': 'りっとう', '小雪': 'しょうせつ', '大雪': 'たいせつ', '冬至': 'とうじ', '小寒': 'しょうかん', '大寒': 'だいかん' };
  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function wrap72(s) { return ((s % 72) + 72) % 72; }
  function midnight(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function sinceMidnight(ms) { return ms - midnight(ms); }
  function kanjiNum(n) {
    var d = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (n < 10) return d[n]; if (n < 20) return '十' + (n % 10 ? d[n % 10] : '');
    return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '');
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tcy(n) { return '<span class="tcy">' + n + '</span>'; }
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem('utsuroi:' + k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('utsuroi:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  // ---------- 暦 ----------
  var baseCycle = A.cycleFor(Date.now());
  var cycles = { 0: baseCycle };
  function cycleAt(i) { if (!cycles[i]) cycles[i] = A.cycleFor(baseCycle.ms[36] + i * 365.2422 * DAY); return cycles[i]; }
  function sTodayAbs() {
    var now = Date.now();
    for (var i = -1; i <= 1; i++) { var c = cycleAt(i); if (now >= c.ms[0] && now < c.ms[72]) return i * 72 + A.sOfDate(now, c); }
    return A.sOfDate(now, baseCycle);
  }
  function split(sAbs) { var i = Math.floor(sAbs / 72); return { i: i, s: sAbs - i * 72, k: Math.floor(sAbs - i * 72), cyc: cycleAt(i) }; }
  function dateAt(sAbs) { var p = split(sAbs); return A.dateOfS(p.s, p.cyc); }

  // ---------- 状態 ----------
  var st = {
    s: sTodayAbs(), v: 0, live: true, timeOffset: 0, target: null, snapping: false,
    k: -1, lastTick: 0, dragging: false, lastInput: performance.now(), scrubDist: 0, arrow: false
  };
  (function hashStart() {
    var m = /^#ko(\d{1,2})$/.exec(location.hash || '');
    if (m) { var n = clamp(parseInt(m[1], 10), 1, 72); st.s = (n - 1) + 0.5; st.live = false; }
  })();

  // ---------- 情景 ----------
  var canvas = $('sky'), stage = $('stage');
  var scene = new U.Scene(canvas, { reduced: reduced });
  var DPR = 1;
  function dialH() { return $('dialWrap').getBoundingClientRect().height || 112; }
  function layout() {
    var w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    dpr = Math.min(dpr, Math.sqrt(2.4e6 / (w * h)));
    dpr = Math.max(1, dpr) * scene.dprScale;
    DPR = dpr;
    scene.resize(w, h, dpr, dialH());
    sizeDial();
    var panels = clamp(Math.round(w / 230), 2, 6);
    document.documentElement.style.setProperty('--panels', panels);
  }
  scene.dprScale = 1;

  // ---------- 和紙の地 ----------
  function makeGrain() {
    var c = document.createElement('canvas'), S = 256; c.width = c.height = S;
    var x = c.getContext('2d'), img = x.createImageData(S, S), d = img.data;
    for (var i = 0; i < d.length; i += 4) { var v = 236 + Math.random() * 19 - (Math.random() < 0.02 ? 18 : 0); d[i] = v; d[i + 1] = v - 2; d[i + 2] = v - 6; d[i + 3] = 255; }
    x.putImageData(img, 0, 0);
    x.lineCap = 'round';
    for (var f = 0; f < 70; f++) {
      var px = Math.random() * S, py = Math.random() * S, a = Math.random() * TAU, len = 8 + Math.random() * 40;
      x.strokeStyle = 'rgba(150,135,110,' + (0.08 + Math.random() * 0.16) + ')'; x.lineWidth = 0.4 + Math.random() * 0.6;
      x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a + 0.6) * len * 0.5, py + Math.sin(a + 0.6) * len * 0.5, px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke();
    }
    return c;
  }
  var grain = makeGrain();
  try { $('grain').style.backgroundImage = 'url(' + grain.toDataURL('image/png') + ')'; } catch (e) { }

  // ---------- 触覚 ----------
  var haptic = (function () {
    var lab = null, last = 0;
    if (isIOS && !navigator.vibrate) {
      try {
        var inp = document.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('switch', ''); inp.id = 'hpt'; inp.tabIndex = -1; inp.setAttribute('aria-hidden', 'true');
        inp.style.cssText = 'position:fixed;left:-200px;top:0;opacity:0;pointer-events:none;';
        lab = document.createElement('label'); lab.htmlFor = 'hpt'; lab.setAttribute('aria-hidden', 'true'); lab.style.cssText = 'position:fixed;left:-200px;top:0;opacity:0;pointer-events:none;';
        document.body.appendChild(inp); document.body.appendChild(lab);
      } catch (e) { lab = null; }
    }
    return function (strong) {
      var t = performance.now(); if (t - last < 55) return; last = t;
      try { if (navigator.vibrate) navigator.vibrate(strong ? 12 : 6); else if (lab) lab.click(); } catch (e) { }
    };
  })();

  // ---------- 音 ----------
  var sound = null;
  try { sound = U.createSoundscape ? U.createSoundscape() : null; } catch (e) { sound = null; }
  var soundOn = false;
  function setSound(on) {
    soundOn = !!on && !!sound;
    var b = $('btnSound'); b.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    b.querySelector('.lab').textContent = soundOn ? 'おと 入' : 'おと';
    if (!sound) return;
    try { if (soundOn) { sound.start(); } else sound.stop(); } catch (e) { }
    store.set('sound', soundOn);
  }
  scene.onThunder = function (k) { if (soundOn && sound) setTimeout(function () { try { sound.thunder(k); } catch (e) { } }, 500 + Math.random() * 1600); };

  // ---------- 候の表示 ----------
  var koEl = $('ko'), kanjiEl = $('kanji');
  function rangeText(r, vertical) {
    var a = new Date(r.start), b = new Date(r.end);
    var am = a.getMonth() + 1, ad = a.getDate(), bm = b.getMonth() + 1, bd = b.getDate();
    if (!vertical) return am + '月' + ad + '日 〜 ' + (bm !== am ? bm + '月' : '') + bd + '日';
    return tcy(am) + '月' + tcy(ad) + '日〜' + (bm !== am ? tcy(bm) + '月' : '') + tcy(bd) + '日';
  }
  function setKo(p, animate) {
    var ko = KO[p.k]; if (!ko) return;
    var r = A.koRange(p.k, p.cyc);
    $('sekki').textContent = ko.sekki; $('phase').textContent = ko.phase;
    kanjiEl.innerHTML = ko.kanji.split('').map(function (ch, i) { return '<span style="--i:' + i + '">' + ch + '</span>'; }).join('');
    $('seal').innerHTML = '<span>' + kanjiNum(ko.no) + '</span><span>候</span>';
    $('yomi').textContent = ko.yomi;
    $('mean').textContent = ko.meaning;
    $('dates').innerHTML = rangeText(r, true);
    koEl.setAttribute('aria-label', ko.sekki + ' ' + ko.phase + '、' + ko.kanji + '（' + ko.yomi + '）。' + ko.meaning + '。' + rangeText(r, false) + '。ひらいて詳しく読む');
    if (animate) { koEl.classList.remove('swap'); void koEl.offsetWidth; koEl.classList.add('swap'); }
    clearTimeout(setKo.lt);
    setKo.lt = setTimeout(function () { $('live').textContent = ko.sekki + ko.phase + '、' + ko.kanji + '、' + ko.yomi + '。' + rangeText(r, false); }, 600);
  }

  // 文字色（空の明るさに合わせて）
  var inkDark = null;
  function updateInk() {
    var info = scene.info; if (!info) return;
    var C = U.color, top = C.mix(info.skyTop, info.skyBot, 0.25), l = C.lum(top);
    var dark = inkDark === null ? l > 0.5 : (inkDark ? l > 0.44 : l > 0.56);
    if (dark !== inkDark) { inkDark = dark; document.documentElement.classList.toggle('ink-light', !dark); }
  }

  // ---------- ダイヤル（年輪） ----------
  var dial = $('dial'), dctx = dial.getContext('2d'), DW = 0, DH = 0, dDpr = 1, PXK = 44;
  function sizeDial() {
    var r = dial.getBoundingClientRect(); DW = r.width; DH = r.height; dDpr = Math.min(window.devicePixelRatio || 1, 2);
    dial.width = Math.round(DW * dDpr); dial.height = Math.round(DH * dDpr);
    var R = Math.max(DW * 1.3, 560); PXK = R * (5 * Math.PI / 180);
  }
  var SEASON = [{ k: 9, c: '春' }, { k: 27, c: '夏' }, { k: 45, c: '秋' }, { k: 63, c: '冬' }];
  var monthTicks = {};
  function monthsFor(ci) {
    if (monthTicks[ci]) return monthTicks[ci];
    var c = cycleAt(ci), out = [], d = new Date(c.ms[0]); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() + 1);
    while (d.getTime() < c.ms[72]) { out.push({ s: ci * 72 + A.sOfDate(d.getTime(), c), m: d.getMonth() + 1 }); d.setMonth(d.getMonth() + 1); }
    monthTicks[ci] = out; return out;
  }
  function drawDial(sAbs, todayAbs) {
    var c = dctx, w = DW, h = DH; if (!w) return;
    c.setTransform(dDpr, 0, 0, dDpr, 0, 0); c.clearRect(0, 0, w, h);
    var R = Math.max(w * 1.3, 560), cx = w / 2, rim = 46, cy = rim + R, deg = Math.PI / 180;
    function pos(sv, rr) { var a = (sv - sAbs) * 5 * deg; return { x: cx + Math.sin(a) * rr, y: cy - Math.cos(a) * rr, a: a }; }
    var span = Math.ceil((Math.asin(Math.min(1, (w / 2 + 40) / R)) / deg) / 5) + 1;
    // 縁
    c.lineWidth = 1; c.strokeStyle = 'rgba(201,162,75,0.55)';
    c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2 - (span * 5) * deg, -Math.PI / 2 + (span * 5) * deg); c.stroke();
    c.strokeStyle = 'rgba(201,162,75,0.18)'; c.beginPath(); c.arc(cx, cy, R - 34, -Math.PI / 2 - (span * 5) * deg, -Math.PI / 2 + (span * 5) * deg); c.stroke();
    // いまの候を朱で
    var kNow = Math.floor(sAbs);
    c.strokeStyle = 'rgba(205,72,52,0.95)'; c.lineWidth = 3; c.lineCap = 'butt';
    c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2 + (kNow - sAbs) * 5 * deg, -Math.PI / 2 + (kNow + 1 - sAbs) * 5 * deg); c.stroke();
    // 目盛
    c.lineCap = 'round';
    for (var k = Math.floor(sAbs) - span; k <= Math.floor(sAbs) + span + 1; k++) {
      var p = pos(k, R), kk = ((k % 72) + 72) % 72, big = kk % 3 === 0, season = kk % 18 === 0;
      var len = season ? 18 : big ? 12 : 6;
      var p2 = pos(k, R - len);
      c.strokeStyle = 'rgba(232,206,140,' + (big ? 0.85 : 0.5) + ')'; c.lineWidth = season ? 1.6 : 1;
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p2.x, p2.y); c.stroke();
      // 候の中心点
      var pc = pos(k + 0.5, R - 4);
      c.fillStyle = 'rgba(232,206,140,0.35)'; c.beginPath(); c.arc(pc.x, pc.y, 1, 0, TAU); c.fill();
      if (big) {
        var lk = KO[kk]; if (!lk) continue;
        var pl = pos(k + 1.5, R - 24);
        c.save(); c.translate(pl.x, pl.y); c.rotate(pl.a);
        var near = Math.abs(k + 1.5 - sAbs) < 1.5;
        c.fillStyle = near ? 'rgba(248,232,190,0.98)' : 'rgba(226,200,140,0.72)';
        c.font = (near ? '600 ' : '') + '12px ' + getComputedStyle(document.documentElement).getPropertyValue('--f-min');
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(lk.sekki, 0, 0);
        c.restore();
      }
    }
    // 季（春夏秋冬）
    var font = getComputedStyle(document.documentElement).getPropertyValue('--f-min');
    SEASON.forEach(function (S) {
      for (var j = -1; j <= 1; j++) {
        var sv = Math.round((sAbs - S.k) / 72) * 72 + S.k + j * 72;
        if (Math.abs(sv - sAbs) > span + 2) continue;
        var pp = pos(sv, R - 52);
        c.save(); c.translate(pp.x, pp.y); c.rotate(pp.a);
        c.fillStyle = 'rgba(201,162,75,0.34)'; c.font = '600 22px ' + font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(S.c, 0, 0);
        c.restore();
      }
    });
    // 月の区切り
    var ci = Math.floor(sAbs / 72);
    [ci - 1, ci, ci + 1].forEach(function (cc) {
      monthsFor(cc).forEach(function (m) {
        if (Math.abs(m.s - sAbs) > span + 1) return;
        var a1 = pos(m.s, R + 3), a2 = pos(m.s, R + 9);
        c.strokeStyle = 'rgba(232,206,140,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(a1.x, a1.y); c.lineTo(a2.x, a2.y); c.stroke();
        var lp = pos(m.s + 0.18, R + 15);
        c.save(); c.translate(lp.x, lp.y); c.rotate(lp.a);
        c.fillStyle = 'rgba(232,214,170,0.55)'; c.font = '10px ' + getComputedStyle(document.documentElement).getPropertyValue('--f-sans'); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(m.m + '月', 0, 0);
        c.restore();
      });
    });
    // 今日
    if (Math.abs(todayAbs - sAbs) < span + 1) {
      var tp = pos(todayAbs, R);
      c.fillStyle = '#e0553c'; c.beginPath(); c.arc(tp.x, tp.y, 4, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(255,230,200,0.8)'; c.lineWidth = 1; c.stroke();
    }
  }

  // ---------- 日付チップ ----------
  var lastChip = '';
  function updateChip(sAbs, todayAbs) {
    var ms = dateAt(sAbs), d = new Date(ms);
    var isToday = midnight(ms) === midnight(Date.now());
    var txt = (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WEEK[d.getDay()] + '）';
    var y = d.getFullYear(), ny = new Date().getFullYear();
    var key = txt + isToday + y + (st.timeOffset ? 1 : 0);
    if (key === lastChip) return; lastChip = key;
    $('chipDate').textContent = (y !== ny ? y + '年 ' : '') + txt;
    $('chipToday').hidden = !isToday;
    var away = Math.abs(sAbs - todayAbs) > 0.6 || Math.abs(st.timeOffset) > 60000;
    $('btnNow').hidden = !away;
  }

  // ---------- 時刻（太陽・月を動かしたとき） ----------
  function timeMsFor(sAbs) {
    var day = midnight(dateAt(sAbs));
    return day + sinceMidnight(Date.now()) + st.timeOffset;
  }

  // ---------- 操作 ----------
  var ptr = null, toastT = 0;
  function toast(html, ms) {
    var t = $('toast'); t.innerHTML = html; t.hidden = false; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.hidden = true; }, 400); }, ms || 2600);
  }
  function fmtTime(ms) { var d = new Date(ms); return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
  function riseSet(dayMs) {
    var out = { rise: null, set: null }, prev = A.sky(dayMs).sunAlt;
    for (var m = 4; m <= 1440; m += 4) {
      var t = dayMs + m * 60000, a = A.sky(t).sunAlt;
      if (prev < -0.833 && a >= -0.833 && !out.rise) out.rise = t; if (prev >= -0.833 && a < -0.833) out.set = t;
      prev = a;
    }
    return out;
  }

  function onDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('button, .tool, #ko, textarea, a')) return;
    var r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    var onDial = e.target.closest('#dialWrap') != null;
    var cel = onDial ? null : scene.hitCelestial(x, y);
    ptr = { id: e.pointerId, x0: x, y0: y, x: x, y: y, t0: performance.now(), t: performance.now(), mode: cel ? 'sun' : 'pending', cel: cel, vx: 0, vy: 0, hist: [], onDial: onDial, moved: 0 };
    try { stage.setPointerCapture(e.pointerId); } catch (err) { }
    st.lastInput = performance.now();
    if (cel) stage.classList.add('dragging');
    hideHint();
  }
  function onMove(e) {
    var r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (!ptr || ptr.id !== e.pointerId) {
      if (e.pointerType === 'mouse') { st.tiltTarget = { x: (x / r.width - 0.5) * 2, y: (y / r.height - 0.5) * 2 }; }
      return;
    }
    var now = performance.now(), dt = Math.max(1, now - ptr.t) / 1000, dx = x - ptr.x, dy = y - ptr.y;
    ptr.vx = dx / dt; ptr.vy = dy / dt; ptr.moved += Math.abs(dx) + Math.abs(dy);
    scene.stir(x, y, ptr.vx, ptr.vy);
    st.tiltTarget = { x: (x / r.width - 0.5) * 2, y: (y / r.height - 0.5) * 2 };
    if (ptr.mode === 'pending') {
      var tx = x - ptr.x0, ty = y - ptr.y0;
      if (Math.abs(tx) > 7 && Math.abs(tx) > Math.abs(ty) * 0.8) { ptr.mode = 'scrub'; st.live = false; st.target = null; st.snapping = false; st.dragging = true; st.scrubDist = 0; stage.classList.add('dragging'); }
      else if (!ptr.onDial && Math.abs(ty) > 12 && Math.abs(ty) > Math.abs(tx) * 1.3) ptr.mode = 'vswipe';
    }
    if (ptr.mode === 'scrub') {
      var ds = -dx / PXK;
      st.s += ds; st.scrubDist += Math.abs(ds);
      ptr.hist.push({ t: now, s: st.s });
      while (ptr.hist.length > 6 || (ptr.hist.length && now - ptr.hist[0].t > 120)) ptr.hist.shift();
      if (st.scrubDist >= 72 && !st.yearToast) { st.yearToast = true; toast('<b class="stamp">光陰矢の如し</b><span>一年を、指先でめぐりました</span>', 3200); }
    } else if (ptr.mode === 'sun') {
      st.timeOffset += dx / r.width * 12 * 3600000;
      st.timeOffset = clamp(st.timeOffset, -26 * 3600000, 26 * 3600000);
    }
    ptr.x = x; ptr.y = y; ptr.t = now;
    st.lastInput = now;
  }
  function onUp(e) {
    if (!ptr || ptr.id !== e.pointerId) return;
    var p = ptr; ptr = null; stage.classList.remove('dragging'); st.dragging = false;
    var dur = performance.now() - p.t0;
    if (p.mode === 'scrub') {
      var h = p.hist, v = 0;
      if (h.length >= 2) { var a = h[0], b = h[h.length - 1]; if (b.t - a.t > 8) v = (b.s - a.s) / ((b.t - a.t) / 1000); }
      if (performance.now() - (h.length ? h[h.length - 1].t : 0) > 90) v = 0;
      st.v = clamp(v, -60, 60);
      if (reduced) st.v = 0;
      st.snapping = true;
    } else if (p.mode === 'vswipe') {
      if (p.y - p.y0 < -50) openScroll();
    } else if (p.mode === 'sun') {
      if (p.moved < 8) celestialToast(p.cel);
    } else if (p.mode === 'pending' && dur < 500 && p.moved < 12) {
      var res = scene.tap(p.x, p.y);
      if (res === 'bird') haptic(true);
    }
  }
  function celestialToast(which) {
    var sAbs = st.s, tm = timeMsFor(sAbs);
    if (which === 'moon') {
      var m = A.moon(A.toJD(tm)), nm = A.moonName(m.age);
      toast('<b>' + nm.name + '</b><span>' + nm.yomi + '　月齢 ' + m.age.toFixed(1) + '</span>');
    } else {
      var rs = riseSet(midnight(tm));
      toast('<b>日の出 ' + (rs.rise ? fmtTime(rs.rise) : '—') + '　日の入 ' + (rs.set ? fmtTime(rs.set) : '—') + '</b><span>' + (A.LOC.name || '推定位置') + 'での目安。太陽を左右に動かすと時刻が変わる</span>', 3400);
    }
  }
  stage.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  // マウスホイール・トラックパッド
  var wheelT = 0;
  stage.addEventListener('wheel', function (e) {
    if (e.target.closest('#scroll')) return;
    e.preventDefault();
    var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (e.deltaMode === 1) d *= 16;
    st.live = false; st.target = null; st.v = 0; st.snapping = false;
    st.s += d / PXK * 0.6; st.lastInput = performance.now();
    clearTimeout(wheelT); wheelT = setTimeout(function () { st.snapping = true; }, 160);
    hideHint();
  }, { passive: false });

  function goTo(sAbs, live) { st.target = sAbs; st.v = 0; st.snapping = false; st.live = !!live; }
  function step(dir) { var base = Math.floor(st.target != null ? st.target : st.s); goTo(base + dir + 0.5, false); hideHint(); }
  $('btnNow').addEventListener('click', function () { st.timeOffset = 0; goTo(sTodayAbs(), true); });
  $('btnPrev').addEventListener('click', function () { step(-1); });
  $('btnNext').addEventListener('click', function () { step(1); });
  koEl.addEventListener('click', function () { openScroll(); });
  koEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openScroll(); } });
  $('btnSound').addEventListener('click', function () { setSound(!soundOn); if (soundOn) try { sound.chime(); } catch (e) { } });
  $('btnCard').addEventListener('click', function () { makePostcard(); });

  document.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('textarea, input')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (!$('scroll').hidden) { if (e.key === 'Escape') closeScroll(); return; }
    if (!$('card').hidden) { if (e.key === 'Escape') closeCard(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home' || e.key === 't') { st.timeOffset = 0; goTo(sTodayAbs(), true); }
    else if (e.key === 'Enter' && e.target === document.body) openScroll();
  });

  // ---------- 傾き（スマホ単体で開いたとき） ----------
  st.tilt = { x: 0, y: 0 }; st.tiltTarget = { x: 0, y: 0 };
  function onOrient(e) { if (e.gamma == null) return; st.tiltTarget = { x: clamp(e.gamma / 30, -1, 1), y: clamp((e.beta - 45) / 30, -1, 1) }; }
  var orientAsked = false;
  function askOrientation() {
    if (orientAsked || window.self !== window.top) return; orientAsked = true;
    // 許可ダイアログが要らない端末（Android など）だけ、傾きで金箔の照りと奥行きを動かす
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function') window.addEventListener('deviceorientation', onOrient);
    } catch (e) { }
  }

  // ---------- 巻物 ----------
  var scrollEl = $('scroll'), lastFocus = null;
  function moonIcon(elong, size) {
    var c = document.createElement('canvas'), d = Math.min(window.devicePixelRatio || 1, 2); c.width = c.height = size * d; c.style.width = c.style.height = size + 'px';
    var x = c.getContext('2d'); x.scale(d, d); x.translate(size / 2, size / 2);
    var r = size * 0.42, e = elong * Math.PI / 180, k = Math.cos(e);
    x.fillStyle = '#2b2a3a'; x.beginPath(); x.arc(0, 0, r, 0, TAU); x.fill();
    if (elong > 180) x.scale(-1, 1);
    x.fillStyle = '#f1e6c4'; x.beginPath(); x.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    x.ellipse(0, 0, Math.max(0.01, r * Math.abs(k)), r, 0, Math.PI / 2, -Math.PI / 2, k > 0); x.fill();
    return c;
  }
  function fmtMD(ms, vertical) { var d = new Date(ms); return vertical ? tcy(d.getMonth() + 1) + '月' + tcy(d.getDate()) + '日' : (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function lettersKey(no) { return 'letters'; }
  function readLetters() { return store.get('letters') || {}; }

  function fillScroll() {
    var p = split(st.s), ko = KO[p.k], cyc = p.cyc, r = A.koRange(p.k, cyc);
    var html = '';
    html += '<header class="sc-head"><p class="sc-no">第' + kanjiNum(ko.no) + '候　<span class="sc-sekki">' + ko.sekki + '（' + (SEKKI_YOMI[ko.sekki] || '') + '）' + ko.phase + '</span></p>';
    html += '<h2 id="scKanji" class="sc-kanji">' + esc(ko.kanji) + '</h2><p class="sc-yomi">' + esc(ko.yomi) + '</p>';
    html += '<p class="sc-date">' + rangeText(r, true) + '</p></header>';
    html += '<p class="sc-mean">' + esc(ko.meaning) + '。</p>';
    html += '<p class="sc-note">' + esc(ko.note) + '</p>';
    var col = ko.color || {};
    html += '<figure class="sc-color"><span class="chip" style="background:' + esc(col.hex || '#c9a24b') + '"></span><figcaption><span class="lbl">この候の色</span><b>' + esc(col.name || '') + '</b><span class="cy">' + esc(col.yomi || '') + '</span><span class="hex">' + esc((col.hex || '').toUpperCase()) + '</span></figcaption></figure>';
    // 月
    var nowMs = Date.now(), contains = nowMs >= r.start && nowMs < r.end + DAY;
    var refMs = contains ? nowMs : (r.start + r.end) / 2 + DAY / 2;
    var mm = A.moon(A.toJD(refMs)), mn = A.moonName(mm.age);
    var evs = A.moonEvents(r.start, r.end);
    html += '<section class="sc-moon"><h3>' + (contains ? '今夜の月' : 'この候の月') + '</h3><div class="moonrow"><span class="moonic" data-elong="' + mm.elong.toFixed(1) + '"></span><p><b>' + mn.name + '</b><span class="cy">' + mn.yomi + '</span><span>月齢' + tcy(Math.round(mm.age)) + '</span></p></div>';
    if (evs.length) html += '<ul>' + evs.map(function (e) { return '<li>' + fmtMD(e.ms, true) + '　' + e.name + '</li>'; }).join('') + '</ul>';
    html += '</section>';
    // 行事
    var evAll = A.eventsInCycle(cyc).filter(function (e) { var d = midnight(e.ms); return d >= r.start && d <= r.end; });
    if (evAll.length) html += '<section class="sc-events"><h3>この候の暦</h3><ul>' + evAll.map(function (e) { return '<li><b>' + fmtMD(e.ms, true) + '　' + esc(e.name) + '</b><span>' + esc(e.note) + '</span></li>'; }).join('') + '</ul></section>';
    html += '<section class="sc-hint"><h3>ひとつ、ためす</h3><p>' + esc(ko.hint) + '</p></section>';
    // 手紙
    var L = readLetters()[ko.no] || [], mine = null, past = [];
    L.forEach(function (it) { if (it.y === cyc.year) mine = it; else if (it.y < cyc.year) past.push(it); });
    html += '<section class="sc-letter"><h3>来年の、この候へ</h3>';
    if (past.length) html += past.sort(function (a, b) { return b.y - a.y; }).map(function (it) { return '<blockquote class="past"><p>' + esc(it.t) + '</p><cite>' + tcy(it.y) + '年のこの候に</cite></blockquote>'; }).join('');
    html += '<label for="letter" class="sr-only">この候に残す言葉</label><textarea id="letter" maxlength="200" placeholder="ここに書いた言葉は、一年後のこの候にひらきます">' + (mine ? esc(mine.t) : '') + '</textarea>';
    html += '<div class="letter-row"><button type="button" id="letterSave" class="btn-ink">' + (mine ? '書き直してしまう' : 'しまう') + '</button><span id="letterMsg" class="msg" role="status"></span></div>';
    html += '<p class="small">言葉はこの端末の中だけにしまわれます。</p></section>';
    html += '<section class="sc-act"><button type="button" id="scCard" class="btn-shu">この候を絵葉書に</button><button type="button" id="scNext" class="btn-ink">次の候へ</button></section>';
    html += '<footer class="sc-colophon"><p>うつろい暦</p><p>七十二候は明治七年の略本暦による。日付・月の満ち欠け・太陽の高さは、この端末の中で天文計算している。通信はしない。</p><p>文・色・絵は、この暦のためにつくったもの。</p></footer>';
    $('scrollBody').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('.moonic'), function (el) { el.appendChild(moonIcon(parseFloat(el.getAttribute('data-elong')), 44)); });
    document.documentElement.style.setProperty('--ko-color', col.hex || '#c9a24b');
    $('letterSave').addEventListener('click', function () {
      var tval = $('letter').value.trim(), all = readLetters(), list = (all[ko.no] || []).filter(function (it) { return it.y !== cyc.year; });
      if (tval) list.push({ y: cyc.year, t: tval, d: new Date().toISOString().slice(0, 10) });
      all[ko.no] = list;
      var ok = store.set('letters', all);
      $('letterMsg').textContent = ok ? (tval ? '封をしました。一年後にひらきます' : '言葉を取り下げました') : 'この端末では保存できませんでした';
      if (ok && tval) { haptic(true); if (soundOn) try { sound.stamp(); } catch (e) { } }
    });
    $('scCard').addEventListener('click', function () { makePostcard(); });
    $('scNext').addEventListener('click', function () { closeScroll(); setTimeout(function () { step(1); }, reduced ? 0 : 420); });
  }
  function openScroll() {
    if (!scrollEl.hidden) return;
    st.v = 0; st.snapping = true;
    fillScroll();
    lastFocus = document.activeElement;
    scrollEl.hidden = false; void scrollEl.offsetWidth; scrollEl.classList.add('open');
    var paper = $('scrollPaper');
    paper.scrollLeft = 0;
    requestAnimationFrame(function () { try { var max = paper.scrollWidth - paper.clientWidth; if (paper.scrollLeft < 0 || getComputedStyle(paper).direction) { } } catch (e) { } });
    setTimeout(function () { $('scrollClose').focus({ preventScroll: true }); }, 60);
    if (soundOn) try { sound.chime(); } catch (e) { }
    hideHint();
  }
  function closeScroll() {
    if (scrollEl.hidden) return;
    scrollEl.classList.remove('open'); scrollEl.classList.add('closing');
    setTimeout(function () { scrollEl.hidden = true; scrollEl.classList.remove('closing'); if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); }, reduced ? 0 : 520);
  }
  $('scrollClose').addEventListener('click', closeScroll);
  scrollEl.addEventListener('click', function (e) { if (e.target === scrollEl) closeScroll(); });
  // 縦書きの巻物は横に送る：ホイールの縦移動を横に
  $('scrollPaper').addEventListener('wheel', function (e) {
    if (e.target.closest('textarea')) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); this.scrollLeft -= e.deltaY; }
  }, { passive: false });
  // 巻物の下スワイプで閉じる
  (function () {
    var y0 = null, x0 = null;
    scrollEl.addEventListener('touchstart', function (e) { if (e.target.closest('textarea')) return; y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; }, { passive: true });
    scrollEl.addEventListener('touchend', function (e) { if (y0 == null) return; var t = e.changedTouches[0]; if (t.clientY - y0 > 90 && Math.abs(t.clientX - x0) < 50) closeScroll(); y0 = null; }, { passive: true });
  })();

  // ---------- 絵葉書 ----------
  var cardURL = null, cardBlob = null, cardName = '';
  function drawVertical(c, text, x, y, size, gap) {
    var small = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョ';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i], yy = y + i * (size + gap);
      if (small.indexOf(ch) >= 0) c.fillText(ch, x + size * 0.12, yy - size * 0.12);
      else c.fillText(ch, x, yy);
    }
  }
  function makePostcard() {
    var btn = $('btnCard'); btn.classList.add('busy');
    setTimeout(function () {
      try {
        var W = 600, H = 900, d = 2, cv = document.createElement('canvas');
        var sc = new U.Scene(cv, { reduced: false }); sc.dprScale = 1;
        sc.resize(W, H, d, 0);
        var sAbs = st.s, p = split(sAbs), tm = timeMsFor(sAbs);
        sc.setState({ s: p.s, timeMs: tm, tilt: { x: 0, y: 0 } });
        sc._static = true; sc.prewarm(2.5); sc.setState({ s: p.s, timeMs: tm, tilt: { x: 0, y: 0 } });
        sc.render();
        var c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0);
        // 和紙
        c.globalCompositeOperation = 'multiply'; c.globalAlpha = 0.28; c.fillStyle = c.createPattern(grain, 'repeat'); c.fillRect(0, 0, W, H);
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
        // 文字
        var ko = KO[p.k], r = A.koRange(p.k, p.cyc), C = U.color;
        var info = sc.info, l = C.lum(C.mix(info.skyTop, info.skyBot, 0.25)), ink = l > 0.5 ? '#1f1b19' : '#f6f0e2', halo = l > 0.5 ? 'rgba(255,250,240,0.7)' : 'rgba(10,12,24,0.6)';
        var fmin = getComputedStyle(document.documentElement).getPropertyValue('--f-min');
        c.textAlign = 'center'; c.textBaseline = 'top';
        c.shadowColor = halo; c.shadowBlur = 18;
        c.fillStyle = ink; c.font = '600 76px ' + fmin; drawVertical(c, ko.kanji, W - 74, 54, 76, 6);
        c.shadowBlur = 10;
        c.font = '17px ' + fmin; drawVertical(c, ko.yomi, W - 140, 60, 17, 4);
        c.font = '15px ' + fmin; drawVertical(c, ko.sekki + '　' + ko.phase, W - 24, 58, 15, 5);
        c.shadowBlur = 0;
        // 落款
        var sy = 54 + ko.kanji.length * 82 + 18, sx = W - 74 - 22;
        c.save(); c.translate(sx + 22, sy + 22); c.rotate(-0.03);
        c.fillStyle = '#c23a2b'; c.fillRect(-22, -22, 44, 44);
        c.fillStyle = '#fbefe6'; c.font = '600 12px ' + fmin; c.textBaseline = 'middle';
        var num = kanjiNum(ko.no); drawVertical(c, num, 6, -((num.length - 1) * 13) / 2, 12, 1); drawVertical(c, '候', -9, 0, 12, 0);
        c.globalCompositeOperation = 'destination-out'; c.globalAlpha = 0.25;
        for (var i = 0; i < 60; i++) { c.fillRect(-22 + Math.random() * 44, -22 + Math.random() * 44, 1 + Math.random() * 2, 1 + Math.random() * 2); }
        c.restore(); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
        // 額と銘
        c.strokeStyle = 'rgba(201,162,75,0.85)'; c.lineWidth = 1.2; c.strokeRect(14, 14, W - 28, H - 28);
        c.strokeStyle = 'rgba(201,162,75,0.4)'; c.lineWidth = 0.6; c.strokeRect(19, 19, W - 38, H - 38);
        var dd = new Date(midnight(dateAt(sAbs)));
        c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.font = '13px ' + fmin;
        var cap = 'うつろい暦　' + dd.getFullYear() + '年' + (dd.getMonth() + 1) + '月' + dd.getDate() + '日　' + ko.meaning;
        var cw = c.measureText(cap).width + 24;
        c.fillStyle = 'rgba(16,12,10,0.55)'; c.fillRect(28, H - 58, Math.min(cw, W - 56), 28);
        c.fillStyle = '#f2e2b4'; c.fillText(cap, 40, H - 39, W - 80);
        cardName = 'utsuroi-' + String(ko.no).padStart(2, '0') + '-' + dd.getFullYear() + ('0' + (dd.getMonth() + 1)).slice(-2) + ('0' + dd.getDate()).slice(-2) + '.png';
        cv.toBlob(function (blob) {
          btn.classList.remove('busy');
          if (!blob) { toast('<b>絵葉書をつくれませんでした</b>'); return; }
          cardBlob = blob; if (cardURL) URL.revokeObjectURL(cardURL); cardURL = URL.createObjectURL(blob);
          $('cardImg').src = cardURL; $('cardImg').alt = ko.kanji + '（' + ko.yomi + '）の絵葉書';
          openCard();
        }, 'image/png');
        haptic(true); if (soundOn) try { sound.stamp(); } catch (e) { }
      } catch (err) { btn.classList.remove('busy'); toast('<b>絵葉書をつくれませんでした</b>'); }
    }, 30);
  }
  var cardEl = $('card');
  function openCard() { lastFocus = document.activeElement; cardEl.hidden = false; void cardEl.offsetWidth; cardEl.classList.add('open'); $('cardMsg').textContent = ''; setTimeout(function () { $('cardSave').focus({ preventScroll: true }); }, 50); }
  function closeCard() { cardEl.classList.remove('open'); setTimeout(function () { cardEl.hidden = true; }, reduced ? 0 : 300); if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); }
  $('cardClose').addEventListener('click', closeCard);
  cardEl.addEventListener('click', function (e) { if (e.target === cardEl) closeCard(); });
  $('cardSave').addEventListener('click', function () {
    if (!cardBlob) return;
    var msg = $('cardMsg');
    msg.textContent = '';
    saveBlob(cardBlob, cardName).then(function (r) {
      msg.textContent = r === 'saved' ? '保存しました' : r === 'shared' ? '' : r === 'downloaded' ? '保存しました' : r === 'declined' ? '' : '画像を長押しして保存してください';
    });
  });
  function saveBlob(blob, name) {
    var tryClaude = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(function () { return null; }) : Promise.resolve(null);
    return tryClaude.then(function (dl) {
      if (dl) return dl.save({ filename: name, data: blob }).then(function () { return 'saved'; }, function (e) { return e && e.code === 'declined' ? 'declined' : 'fail'; });
      try {
        var file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: 'うつろい暦' }).then(function () { return 'shared'; }, function (e) { return e && e.name === 'AbortError' ? 'declined' : 'fail'; });
      } catch (e) { }
      if (window.self !== window.top) return 'fail';
      try { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); return 'downloaded'; } catch (e) { return 'fail'; }
    });
  }

  // ---------- 案内 ----------
  var hintShown = false, hintGone = false;
  function showHint() { if (hintGone || store.get('hinted')) return; hintShown = true; $('hint').hidden = false; requestAnimationFrame(function () { $('hint').classList.add('show'); }); }
  function hideHint() { if (hintGone) return; hintGone = true; var h = $('hint'); h.classList.remove('show'); setTimeout(function () { h.hidden = true; }, 500); if (hintShown) store.set('hinted', true); askOrientation(); }

  // ---------- 一コマ ----------
  var lastT = performance.now(), frames = 0, slowAcc = 0, fpsT = 0, inkT = 0, sndT = 0, skip = false, hashT = 0;
  function frame(now) {
    var dt = clamp((now - lastT) / 1000, 0, 0.05); lastT = now;
    var idle = now - st.lastInput > 25000 && !st.dragging && st.target == null && Math.abs(st.v) < 0.01;
    if (idle && !reduced) { skip = !skip; if (skip) { requestAnimationFrame(frame); return; } dt = Math.min(0.08, dt * 2); }
    // 動き
    var todayAbs = sTodayAbs();
    if (st.live && !st.dragging && st.target == null && !st.snapping) st.s = todayAbs;
    if (st.target != null) {
      var d = st.target - st.s, k = reduced ? 1 : 1 - Math.exp(-dt * 7.5);
      st.s += d * k;
      if (Math.abs(d) < 0.002) { st.s = st.target; st.target = null; if (st.live) st.s = todayAbs; }
    } else if (st.snapping && !st.dragging) {
      if (Math.abs(st.v) > 1.2) { st.s += st.v * dt; st.v *= Math.exp(-dt / 0.38); }
      else { st.v = 0; st.snapping = false; st.target = Math.floor(st.s) + 0.5; st.live = false; }
    }
    // 候が変わったら
    var p = split(st.s), kAbs = Math.floor(st.s);
    if (kAbs !== st.k) {
      var first = st.k === -1;
      st.k = kAbs; setKo(p, !first);
      if (!first) { haptic(p.k % 3 === 0); if (soundOn) try { sound.tick(p.k); } catch (e) { } }
      clearTimeout(hashT);
      hashT = setTimeout(function () { try { history.replaceState(null, '', '#ko' + (split(st.s).k + 1)); } catch (e) { } }, 800);
    }
    // 傾き
    var tt = st.tiltTarget; st.tilt.x += (tt.x - st.tilt.x) * Math.min(1, dt * 3); st.tilt.y += (tt.y - st.tilt.y) * Math.min(1, dt * 3);
    // 描く
    scene.setState({ s: p.s, timeMs: timeMsFor(st.s), tilt: st.tilt });
    scene.update(dt); scene.render();
    drawDial(st.s, todayAbs);
    updateChip(st.s, todayAbs);
    inkT += dt; if (inkT > 0.25) { inkT = 0; updateInk(); }
    sndT += dt;
    if (soundOn && sound && sndT > 0.12) {
      sndT = 0;
      try { sound.setScene({ sfx: scene.B.sfx, daylight: scene.L.day, dusk: scene.L.dusk, intensity: clamp(Math.abs(st.v) / 20 + (st.dragging ? 0.3 : 0), 0, 1) }); } catch (e) { }
    }
    // 重いときは軽くする
    frames++; fpsT += dt; if (dt > 0.026) slowAcc++;
    if (fpsT > 2.5) {
      if (slowAcc / frames > 0.45) {
        if (scene.quality > 0.55) scene.quality -= 0.15;
        else if (scene.dprScale > 0.7) { scene.dprScale -= 0.15; layout(); }
      }
      frames = 0; slowAcc = 0; fpsT = 0;
    }
    requestAnimationFrame(frame);
  }

  // ---------- 屏風が開く ----------
  function intro(done) {
    var el = $('intro');
    if (reduced) { el.remove(); done(); return; }
    var w = stage.clientWidth, h = stage.clientHeight, N = clamp(Math.round(w / 170), 4, 6), pw = w / N;
    var holder = $('introPanels'), parent = holder, panels = [];
    for (var i = 0; i < N; i++) {
      var pnl = document.createElement('div'); pnl.className = 'ip';
      pnl.style.width = pw + 'px'; pnl.style.height = h + 'px';
      if (i > 0) pnl.style.left = pw + 'px';
      var cv = document.createElement('canvas'); cv.width = Math.round(pw * DPR); cv.height = Math.round(h * DPR);
      try { cv.getContext('2d').drawImage(canvas, Math.round(i * pw * DPR), 0, Math.round(pw * DPR), Math.round(h * DPR), 0, 0, cv.width, cv.height); } catch (e) { }
      pnl.appendChild(cv);
      var sh = document.createElement('div'); sh.className = 'ish'; pnl.appendChild(sh);
      parent.appendChild(pnl); parent = pnl; panels.push({ el: pnl, sh: sh });
    }
    var t0 = null, D0 = 900, D1 = 1700, ended = false;
    function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
    function apply(a) {
      var rad = a * Math.PI / 180, total = w * Math.cos(rad);
      panels.forEach(function (p, i) {
        var ang = i === 0 ? a : (i % 2 ? -2 * a : 2 * a);
        p.el.style.transform = (i === 0 ? 'translateX(' + ((w - total) / 2) + 'px) ' : '') + 'rotateY(' + ang + 'deg)';
        p.sh.style.opacity = (i % 2 ? 0.55 : 0.18) * Math.sin(rad);
      });
    }
    apply(84);
    function tick(now) {
      if (ended) return;
      if (t0 == null) t0 = now;
      var e = now - t0;
      if (e < D0) { el.style.setProperty('--title', String(Math.min(1, e / 500))); holder.style.opacity = '0'; }
      else {
        var k = Math.min(1, (e - D0) / D1); el.style.setProperty('--title', String(Math.max(0, 1 - k * 3)));
        holder.style.opacity = String(Math.min(1, k * 6));
        apply(84 * (1 - ease(k)));
        if (k >= 1) { finish(); return; }
      }
      requestAnimationFrame(tick);
    }
    function finish() {
      if (ended) return; ended = true; apply(0);
      el.classList.add('done');
      setTimeout(function () { el.remove(); }, 700);
      done();
    }
    el.addEventListener('pointerdown', function () { finish(); }, { once: true });
    requestAnimationFrame(tick);
    setTimeout(function () { if (soundOn) try { sound.whoosh(); } catch (e) { } }, D0);
  }

  // ---------- はじまり ----------
  function start() {
    layout();
    window.addEventListener('resize', function () { clearTimeout(start.rt); start.rt = setTimeout(layout, 120); });
    var p = split(st.s);
    scene.setState({ s: p.s, timeMs: timeMsFor(st.s), tilt: { x: 0, y: 0 } });
    scene.prewarm(0.2);
    scene.render(); drawDial(st.s, sTodayAbs()); updateChip(st.s, sTodayAbs()); updateInk();
    st.k = Math.floor(st.s); setKo(p, false);
    document.addEventListener('visibilitychange', function () {
      if (!sound) return;
      try { if (document.hidden) sound.stop(); else if (soundOn) sound.start(); } catch (e) { }
    });
    var wantSound = store.get('sound');
    $('btnSound').querySelector('.lab').textContent = 'おと';
    intro(function () {
      document.documentElement.classList.add('ready');
      setTimeout(showHint, reduced ? 200 : 1500);
      if (wantSound) $('btnSound').classList.add('remember');
    });
    lastT = performance.now();
    requestAnimationFrame(frame);
  }

  // GitHub Pages などに置いたとき：一度ひらけば通信なしでも開ける
  try { if ('serviceWorker' in navigator && location.protocol === 'https:' && window.self === window.top && document.querySelector('link[rel=manifest]')) navigator.serviceWorker.register('sw.js').catch(function () { }); } catch (e) { }

  U.app = { state: st, scene: scene, openScroll: openScroll, makePostcard: makePostcard, goTo: goTo };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
