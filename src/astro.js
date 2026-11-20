/* うつろい暦 — astro.js
 * 端末内だけで太陽黄経・月相・太陽/月の高度を計算する（通信なし）。
 * 精度: 太陽黄経 ~0.01°（節気・候の日時は数十分以内）、月の位置 ~0.3°。
 */
(function () {
  var U = window.UTSUROI = window.UTSUROI || {};
  var RAD = Math.PI / 180;
  var SYNODIC = 29.530588853;

  function norm360(x) { x %= 360; return x < 0 ? x + 360 : x; }
  function wrap180(x) { x = norm360(x); return x > 180 ? x - 360 : x; }
  function toJD(ms) { return ms / 86400000 + 2440587.5; }
  function fromJD(jd) { return (jd - 2440587.5) * 86400000; }

  // 太陽の視黄経（Meeus 低精度式）
  function sun(jd) {
    var T = (jd - 2451545.0) / 36525;
    var L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    var M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    var Mr = M * RAD;
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr) +
      (0.019993 - 0.000101 * T) * Math.sin(2 * Mr) + 0.000289 * Math.sin(3 * Mr);
    var omega = 125.04 - 1934.136 * T;
    var lambda = norm360(L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD));
    var eps = 23.439291 - 0.0130042 * T + 0.00256 * Math.cos(omega * RAD);
    var l = lambda * RAD, e = eps * RAD;
    var ra = norm360(Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / RAD);
    var dec = Math.asin(Math.sin(e) * Math.sin(l)) / RAD;
    return { lambda: lambda, ra: ra, dec: dec, eps: eps };
  }

  // 月の黄経・黄緯（主要項のみ）
  function moon(jd) {
    var T = (jd - 2451545.0) / 36525;
    var Lp = 218.3164477 + 481267.88123421 * T;
    var D = 297.8501921 + 445267.1114034 * T;
    var M = 357.5291092 + 35999.0502909 * T;
    var Mp = 134.9633964 + 477198.8675055 * T;
    var F = 93.2720950 + 483202.0175233 * T;
    var r = RAD;
    var lon = Lp + 6.289 * Math.sin(Mp * r) + 1.274 * Math.sin((2 * D - Mp) * r) +
      0.658 * Math.sin(2 * D * r) + 0.214 * Math.sin(2 * Mp * r) -
      0.186 * Math.sin(M * r) - 0.114 * Math.sin(2 * F * r) +
      0.059 * Math.sin((2 * D - 2 * Mp) * r) + 0.057 * Math.sin((2 * D - M - Mp) * r) +
      0.053 * Math.sin((2 * D + Mp) * r) + 0.046 * Math.sin((2 * D - M) * r);
    var lat = 5.128 * Math.sin(F * r) + 0.281 * Math.sin((Mp + F) * r) +
      0.278 * Math.sin((Mp - F) * r) + 0.173 * Math.sin((2 * D - F) * r);
    lon = norm360(lon);
    var s = sun(jd);
    var e = s.eps * r, l = lon * r, b = lat * r;
    var ra = norm360(Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)) / r);
    var dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)) / r;
    var elong = norm360(lon - s.lambda);           // 0=新月, 180=満月
    var illum = (1 - Math.cos(elong * r)) / 2;
    return { lambda: lon, lat: lat, ra: ra, dec: dec, elong: elong, illum: illum, age: elong / 360 * SYNODIC };
  }

  function gmst(jd) { return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0)); }

  // 高度・時角（度）
  function horizontal(ra, dec, jd, lat, lon) {
    var H = wrap180(gmst(jd) + lon - ra);
    var r = RAD;
    var alt = Math.asin(Math.sin(lat * r) * Math.sin(dec * r) + Math.cos(lat * r) * Math.cos(dec * r) * Math.cos(H * r)) / r;
    return { alt: alt, H: H };
  }

  // 観測地：日本時間なら東京、そうでなければタイムゾーンから経度を推定
  var LOC = (function () {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { }
    if (/Tokyo|Japan/.test(tz)) return { lat: 35.68, lon: 139.77, name: '東京' };
    var off = -new Date().getTimezoneOffset() / 60;
    return { lat: 35, lon: off * 15, name: '' };
  })();

  // 太陽黄経が target になる時刻（JD）を求める
  function solveLongitude(target, jdGuess) {
    var jd = jdGuess;
    for (var i = 0; i < 8; i++) {
      var d = wrap180(target - sun(jd).lambda);
      jd += d / 0.98564736;
      if (Math.abs(d) < 1e-6) break;
    }
    return jd;
  }

  // s: 0..72（0 = 立春の初め＝東風解凍の始まり、黄経315°）
  function sFromLambda(lambda) { return norm360(lambda - 315) / 5; }

  // 日付を含む「立春から次の立春まで」の候の境界 73 点
  function cycleFor(ms) {
    var jd = toJD(ms);
    var lam = sun(jd).lambda;
    var since = norm360(lam - 315);
    var start = solveLongitude(315, jd - since / 0.9856);
    if (start > jd) start = solveLongitude(315, start - 365.2422);
    var b = [start];
    for (var k = 1; k <= 72; k++) b.push(solveLongitude(norm360(315 + 5 * k), start + k * 5.0727));
    var startDate = new Date(fromJD(start));
    return { jd: b, ms: b.map(fromJD), year: startDate.getFullYear() };
  }

  function sOfDate(ms, cycle) {
    var jd = toJD(ms), b = cycle.jd;
    if (jd < b[0]) return 0;
    for (var k = 0; k < 72; k++) if (jd < b[k + 1]) return k + (jd - b[k]) / (b[k + 1] - b[k]);
    return 71.9999;
  }
  function dateOfS(s, cycle) {
    s = ((s % 72) + 72) % 72;
    var k = Math.floor(s), f = s - k, b = cycle.ms;
    return b[k] + (b[k + 1] - b[k]) * f;
  }

  function localMidnight(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  // 候の期間（ローカル日付）: 開始日〜次の候の開始日の前日
  function koRange(k, cycle) {
    var a = localMidnight(cycle.ms[k]);
    var b = localMidnight(cycle.ms[k + 1]) - 86400000;
    if (b < a) b = a;
    return { start: a, end: b };
  }

  // 月相の名前（月齢から）
  function moonName(age) {
    var d = Math.round(age) + 1; // 旧暦の日付に近い数え方
    var e = age / SYNODIC * 360;
    if (e < 7 || e > 353) return { name: '新月', yomi: 'しんげつ' };
    if (Math.abs(e - 180) < 7) return { name: '満月', yomi: 'まんげつ' };
    if (Math.abs(e - 90) < 5) return { name: '上弦の月', yomi: 'じょうげんのつき' };
    if (Math.abs(e - 270) < 5) return { name: '下弦の月', yomi: 'かげんのつき' };
    var table = [
      [2, '二日月', 'ふつかづき'], [3, '三日月', 'みかづき'], [4, '四日月', 'よっかづき'], [5, '五日月', 'いつかづき'],
      [6, '六日月', 'むいかづき'], [7, '七日月', 'なのかづき'], [8, '上弦の月', 'じょうげんのつき'], [9, '九日月', 'ここのかづき'],
      [10, '十日夜の月', 'とおかんやのつき'], [11, '十一日月', 'じゅういちにちづき'], [12, '十二日月', 'じゅうににちづき'],
      [13, '十三夜', 'じゅうさんや'], [14, '小望月', 'こもちづき'], [15, '望月', 'もちづき'], [16, '十六夜', 'いざよい'],
      [17, '立待月', 'たちまちづき'], [18, '居待月', 'いまちづき'], [19, '寝待月', 'ねまちづき'], [20, '更待月', 'ふけまちづき'],
      [21, '二十日余りの月', 'はつかあまりのつき'], [22, '二十二日月', 'にじゅうににちづき'], [23, '下弦の月', 'かげんのつき'],
      [24, '二十四日月', 'にじゅうよっかづき'], [25, '二十五日月', 'にじゅうごにちづき'], [26, '有明月', 'ありあけづき'],
      [27, '有明月', 'ありあけづき'], [28, '有明月', 'ありあけづき'], [29, '晦日月', 'みそかづき'], [30, '晦日月', 'みそかづき']
    ];
    for (var i = 0; i < table.length; i++) if (table[i][0] === d) return { name: table[i][1], yomi: table[i][2] };
    return { name: '晦日月', yomi: 'みそかづき' };
  }

  // 期間中の主な月相（新月・上弦・満月・下弦）
  function moonEvents(fromMs, toMs) {
    var out = [], names = ['新月', '上弦', '満月', '下弦'];
    var step = 6 * 3600000;
    var prev = moon(toJD(fromMs)).elong;
    for (var t = fromMs + step; t <= toMs + 86400000; t += step) {
      var e = moon(toJD(t)).elong;
      for (var q = 0; q < 4; q++) {
        var target = q * 90;
        var a = wrap180(prev - target), c = wrap180(e - target);
        if (a < 0 && c >= 0 && Math.abs(a - c) < 90) {
          // 二分法で精密化
          var lo = t - step, hi = t;
          for (var i = 0; i < 20; i++) {
            var mid = (lo + hi) / 2;
            if (wrap180(moon(toJD(mid)).elong - target) < 0) lo = mid; else hi = mid;
          }
          if (hi >= fromMs && hi < toMs + 86400000) out.push({ ms: hi, name: names[q], q: q });
        }
      }
      prev = e;
    }
    return out;
  }

  // 年中行事（固定日＋太陽黄経から計算するもの）
  function eventsInCycle(cycle) {
    var y0 = cycle.year, ev = [];
    var startMs = cycle.ms[0], endMs = cycle.ms[72];
    function addFixed(m, d, name, note) {
      for (var y = y0; y <= y0 + 1; y++) {
        var t = new Date(y, m - 1, d, 12).getTime();
        if (t >= startMs - 86400000 && t < endMs) ev.push({ ms: t, name: name, note: note });
      }
    }
    function lamDate(l) { return fromJD(solveLongitude(l, toJD(startMs) + norm360(l - 315) / 0.9856)); }
    var risshun = cycle.ms[0];
    ev.push({ ms: risshun - 86400000, name: '節分', note: '立春の前日。豆をまき、季節の変わり目の邪気を払う' });
    addFixed(1, 1, '元日', '年のはじめ。初日の出を拝む');
    addFixed(1, 7, '七草', '春の七草を粥にして一年の無病を願う');
    addFixed(1, 11, '鏡開き', '供えた鏡餅を下ろし、汁粉や雑煮にしていただく');
    addFixed(3, 3, '桃の節句', '雛人形を飾り、女の子の健やかな成長を願う');
    addFixed(5, 5, '端午の節句', '菖蒲湯に入り、鯉のぼりを揚げる');
    addFixed(7, 7, '七夕', '笹に短冊を結び、星に願いをかける');
    addFixed(8, 13, '盆の入り', '迎え火を焚き、祖先の霊を迎える');
    addFixed(9, 9, '重陽の節句', '菊の節句。菊を浮かべた酒で長寿を願う');
    addFixed(11, 15, '七五三', '子どもの成長を祝い、千歳飴を持って詣でる');
    addFixed(12, 13, '正月事始め', '煤払いをして正月の準備を始める日');
    addFixed(12, 31, '大晦日', '年越し蕎麦を食べ、除夜の鐘を聞く');
    ev.push({ ms: lamDate(0), name: '春分', note: '昼と夜の長さがほぼ等しくなる。彼岸の中日' });
    ev.push({ ms: lamDate(0) - 3 * 86400000, name: '春の彼岸入り', note: '春分を中日とする七日間が始まる' });
    ev.push({ ms: lamDate(80), name: '入梅', note: '暦の上での梅雨入り' });
    ev.push({ ms: lamDate(90), name: '夏至', note: '一年で最も昼が長い日' });
    ev.push({ ms: lamDate(117), name: '夏の土用入り', note: '立秋前の約十八日間。鰻を食べる習わしがある' });
    ev.push({ ms: lamDate(180), name: '秋分', note: '昼と夜の長さがほぼ等しくなる。彼岸の中日' });
    ev.push({ ms: lamDate(180) - 3 * 86400000, name: '秋の彼岸入り', note: '秋分を中日とする七日間が始まる' });
    ev.push({ ms: lamDate(270), name: '冬至', note: '一年で最も昼が短い日。柚子湯に入り、南瓜を食べる' });
    ev.push({ ms: risshun + 87 * 86400000, name: '八十八夜', note: '立春から数えて八十八日目。茶摘みの頃' });
    ev.push({ ms: risshun + 209 * 86400000, name: '二百十日', note: '立春から二百十日目。台風の厄日とされる' });
    ev.sort(function (a, b) { return a.ms - b.ms; });
    return ev;
  }

  // 現在時刻の天体情報
  function sky(ms) {
    var jd = toJD(ms);
    var s = sun(jd), m = moon(jd);
    var sh = horizontal(s.ra, s.dec, jd, LOC.lat, LOC.lon);
    var mh = horizontal(m.ra, m.dec, jd, LOC.lat, LOC.lon);
    // 太陽南中高度（その日の）: 90 - lat + dec
    return {
      sunAlt: sh.alt, sunH: sh.H, sunDec: s.dec, noonAlt: 90 - LOC.lat + s.dec,
      moonAlt: mh.alt, moonH: mh.H, moonIllum: m.illum, moonElong: m.elong, moonAge: m.age,
      lambda: s.lambda
    };
  }

  U.Astro = {
    toJD: toJD, fromJD: fromJD, sun: sun, moon: moon, sky: sky, LOC: LOC,
    cycleFor: cycleFor, sOfDate: sOfDate, dateOfS: dateOfS, koRange: koRange,
    sFromLambda: sFromLambda, moonName: moonName, moonEvents: moonEvents,
    eventsInCycle: eventsInCycle, SYNODIC: SYNODIC
  };
})();
