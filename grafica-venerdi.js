// grafica-venerdi.js — grafica Instagram del post del venerdì, identica a quella del lunedì
// (disegnaGraficaIG in CiliegioSocialMedia.html): foto 1080×1350, sfumatura scura sul fondo, badge tondo
// col logo in alto a destra e titolo in Titan One da bordo a bordo, nel colore della settimana.
// Uso: node grafica-venerdi.js <foto> <titolo> <colore> <uscita.jpg>
const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'TitanOne-Regular.ttf'), 'Titan One');

const W = 1080, H = 1350, LOGO_ICON_CUT = 0.64;
const LOGO = path.join(__dirname, '..', 'Ciliegio Menu', 'ciliegio_trasparente.png');

async function disegna(foto, titolo, colore) {
  const img = await loadImage(fs.readFileSync(foto));
  const cv = createCanvas(W, H), ctx = cv.getContext('2d');
  const scale = Math.max(W / img.width, H / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

  const grad = ctx.createLinearGradient(0, H * 0.45, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);

  const logo = await loadImage(fs.readFileSync(LOGO));
  const r = 90, cx = W - 64 - r, cy = 64 + r;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = colore; ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 16; ctx.fill(); ctx.restore();
  const sw = logo.width, sh = logo.height * LOGO_ICON_CUT, size = r * 1.88;
  const ls = Math.max(size / sw, size / sh), lw = sw * ls, lh = sh * ls;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(logo, 0, 0, sw, sh, cx - lw / 2, cy - lh / 2, lw, lh); ctx.restore();

  const pad = 64, maxW = W - pad * 2, testo = titolo.toUpperCase();
  ctx.textBaseline = 'alphabetic';
  ctx.font = '100px "Titan One"';
  const fontSize = Math.round(100 * (maxW / ctx.measureText(testo).width));
  ctx.font = `${fontSize}px "Titan One"`;
  const y = H - pad - fontSize * 0.34;
  ctx.lineJoin = 'round'; ctx.lineWidth = fontSize * 0.13; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(testo, pad, y);
  ctx.fillStyle = colore; ctx.fillText(testo, pad, y);
  return cv.encode('jpeg', 92);
}

if (require.main === module) {
  const [foto, titolo, colore, out] = process.argv.slice(2);
  disegna(foto, titolo, colore).then(buf => { fs.writeFileSync(out, buf); console.log('ok', out); })
    .catch(e => { console.error(e); process.exit(1); });
}
module.exports = { disegna };
