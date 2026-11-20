// 起動アイコンを描く（漆の地に朱の日輪と金箔の霞）。node tools/icons.cjs
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [name, S] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
    const data = await p.evaluate((S) => {
      const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d'); const k = S / 512;
      const g = x.createRadialGradient(S * .5, S * .42, 0, S * .5, S * .5, S * .75); g.addColorStop(0, '#2a2019'); g.addColorStop(1, '#0d0a08');
      x.fillStyle = g; x.fillRect(0, 0, S, S);
      x.fillStyle = '#c8402c'; x.beginPath(); x.arc(S * .5, S * .44, 108 * k, 0, Math.PI * 2); x.fill();
      function band(y, x0, x1, h) {
        const r = h / 2; x.beginPath(); x.moveTo(x0 + r, y - r); x.lineTo(x1 - r, y - r); x.arc(x1 - r, y, r, -Math.PI / 2, Math.PI / 2); x.lineTo(x0 + r, y + r); x.arc(x0 + r, y, r, Math.PI / 2, Math.PI * 1.5); x.closePath();
        const gg = x.createLinearGradient(x0, y - r, x1, y + r); gg.addColorStop(0, '#a87a2a'); gg.addColorStop(.45, '#f3d785'); gg.addColorStop(1, '#b88a34'); x.fillStyle = gg; x.fill();
        x.save(); x.clip(); x.strokeStyle = 'rgba(120,80,20,.35)'; x.lineWidth = 1.2 * k; for (let i = x0; i < x1; i += 26 * k) { x.beginPath(); x.moveTo(i, y - r); x.lineTo(i, y + r); x.stroke(); } x.restore();
      }
      band(318 * k, 60 * k, 400 * k, 44 * k); band(356 * k, 190 * k, 470 * k, 36 * k);
      x.fillStyle = '#2b3a52'; x.beginPath(); x.moveTo(0, 420 * k); x.lineTo(170 * k, 392 * k); x.lineTo(260 * k, 300 * k); x.lineTo(350 * k, 392 * k); x.lineTo(512 * k, 410 * k); x.lineTo(512 * k, 512 * k); x.lineTo(0, 512 * k); x.fill();
      x.fillStyle = '#eef1f6'; x.beginPath(); x.moveTo(233 * k, 328 * k); x.lineTo(260 * k, 300 * k); x.lineTo(287 * k, 328 * k); x.lineTo(270 * k, 322 * k); x.lineTo(260 * k, 332 * k); x.lineTo(248 * k, 322 * k); x.fill();
      return c.toDataURL('image/png');
    }, S);
    require('fs').writeFileSync(path.join(__dirname, '..', name), Buffer.from(data.split(',')[1], 'base64'));
  }
  await b.close(); console.log('icons written');
})();
