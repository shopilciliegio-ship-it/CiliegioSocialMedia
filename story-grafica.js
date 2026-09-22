// story-grafica.js
//
// Compone l'immagine di una IG Story (1080×1920, formato 9:16): sfondo nel colore della
// settimana, scritta fissa "ICCHESSIMANGIAOGGI?" in Titan One (stesso font di "OVVIA MIMMI!"),
// il menù del giorno come "cartolina" e il badge tondo con lo stemma del Ciliegio.
//
// Stesso stile della grafica del post del lunedì (disegnaGraficaIG in CiliegioSocialMedia.html):
// stessa palette settimanale, stesso badge (cerchio colorato + solo lo stemma dorato del logo).
// Posizione e dimensione di scritta, menù e badge sono identiche su ogni story: cambia solo il colore.
//
// Usa @napi-rs/canvas (Node, nessun browser). Il font è nel repo (fonts/TitanOne-Regular.ttf, licenza OFL).

const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'TitanOne-Regular.ttf'), 'Titan One');

const W = 1080, H = 1920;
const TITOLO = 'ICCHESSIMANGIAOGGI?';
const LOGO_ICON_CUT = 0.64; // frazione superiore del file logo occupata dal solo stemma dorato
const SAFE_TOP = 250;       // IG copre in alto nome profilo/chiudi
const SAFE_BOTTOM = 300;    // ... e in basso la barra "invia messaggio"
// Pillola "Prenota un tavolo: link in bio" sotto la cartolina (le story da API non possono avere lo sticker link:
// l'unico modo di rimandare alle prenotazioni è scriverlo sull'immagine; il link vero sta nella bio del profilo).
// Bozza "B" scelta da Luca il 21/9/2026. Solo Titan One e forme disegnate: niente emoji (sul runner Linux non ci sono font emoji).
const PRENOTA_TESTO = 'PRENOTA UN TAVOLO · LINK IN BIO';
const PRENOTA_SPAZIO = 120; // altezza tolta alla cartolina per far posto alla pillola

// Stessa palette e stessa rotazione della grafica IG del lunedì (IG_GRAPHIC_COLORS in CSM).
const COLORS = ['#E8552F', '#1D9E75', '#BA7517', '#993C1D', '#185FA5', '#C9302C', '#534AB7', '#0F6E56', '#D68910', '#993556'];
function colorForIndex(idx) { return COLORS[((idx % COLORS.length) + COLORS.length) % COLORS.length]; }

// Il numero della foto della settimana è l'inizio del nome file ("01 degustazione-vini....jpg").
function weekIndexFromPhoto(photoFile) {
  const m = String(photoFile || '').split('/').pop().match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Badge tondo: cerchio del colore della settimana + solo lo stemma dorato (come sul post del lunedì),
// con un anello crema perché il fondo della story ha lo stesso colore del badge.
function drawBadge(ctx, logo, cx, cy, r, color) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.restore();
  const sw = logo.width, sh = logo.height * LOGO_ICON_CUT;
  const size = r * 1.88;
  const sc = Math.max(size / sw, size / sh);
  const lw = sw * sc, lh = sh * sc;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(logo, 0, 0, sw, sh, cx - lw / 2, cy - lh / 2, lw, lh);
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
  ctx.lineWidth = 6; ctx.strokeStyle = '#FFF3DC'; ctx.stroke();
}

// Scritta a una riga, ridimensionata per occupare esattamente maxW (dimensione dipende solo dal testo fisso).
function fitTitle(ctx, maxW) {
  ctx.font = '100px "Titan One"';
  const fontSize = Math.round(100 * (maxW / ctx.measureText(TITOLO).width));
  ctx.font = `${fontSize}px "Titan One"`;
  return fontSize;
}
function drawTitle(ctx, x, baselineY, fontSize) {
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.lineWidth = fontSize * 0.13; ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.strokeText(TITOLO, x, baselineY);
  ctx.fillStyle = '#FFF3DC';
  ctx.fillText(TITOLO, x, baselineY);
}

function drawCard(ctx, menu, top, bottom) {
  const h = bottom - top, w = h * menu.width / menu.height;
  const x = (W - w) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  roundRect(ctx, x, top, w, h, 30); ctx.fillStyle = '#FFF3DC'; ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x + 10, top + 10, w - 20, h - 20, 22); ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(menu, x + 10, top + 10, w - 20, h - 20);
  ctx.restore();
  return { x, y: top, w, h };
}

// Pillola crema con il testo nel colore della settimana, centrata sotto la cartolina (dentro la zona sicura in basso).
function drawPrenota(ctx, cardBottom, color) {
  const h = 74, y = cardBottom + 34, fontPx = 38;
  ctx.font = `${fontPx}px "Titan One"`;
  const w = ctx.measureText(PRENOTA_TESTO).width + h * 0.9;
  const x = (W - w) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  roundRect(ctx, x, y, w, h, h / 2); ctx.fillStyle = '#FFF3DC'; ctx.fill();
  ctx.restore();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = color;
  ctx.fillText(PRENOTA_TESTO, x + h * 0.45, y + h / 2 + fontPx * 0.04);
}

// Layout unico (variante "A" scelta da Luca): scritta a tutta larghezza sotto la zona coperta da IG,
// cartolina del menù al centro, badge come sigillo sull'angolo in alto a destra della cartolina,
// pillola "Prenota un tavolo · link in bio" sotto la cartolina — SOLO se prenota=true (vedi sotto).
// ATTENZIONE: la stessa geometria è replicata in CiliegioSocialMedia.html (disegnaStoryCanvas, usata per
// l'anteprima nel calendario): se cambi qualcosa qui, cambia anche là.
//
// prenota=false: niente pillola e la cartolina usa tutto lo spazio verticale altrimenti tolto per farle
// posto (PRENOTA_SPAZIO). Va passato false quando il giorno/servizio NON ha un menù reale confermato in
// menu-data.json (quindi l'immagine è la cartolina generica "AL COMPLETO/FULLY BOOKED" copiata da
// Completa-Immagini-Mancanti.ps1): invitare a prenotare un servizio già al completo non ha senso — è il
// caso aperto di [[github_actions_cron_unreliable_external_timer]], chiuso il 22/9/2026.
async function composeStory({ menuBuf, logoBuf, color, prenota = true }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const [menu, logo] = await Promise.all([loadImage(menuBuf), loadImage(logoBuf)]);

  ctx.fillStyle = color; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const pad = 64;
  const fs = fitTitle(ctx, W - pad * 2);
  drawTitle(ctx, pad, SAFE_TOP + 50 + fs * 0.72, fs);
  const cardBottom = H - SAFE_BOTTOM - (prenota ? PRENOTA_SPAZIO : 0);
  const card = drawCard(ctx, menu, 480, cardBottom);
  drawBadge(ctx, logo, card.x + card.w - 26, card.y + 24, 66, color);
  if (prenota) drawPrenota(ctx, card.y + card.h, color);
  return canvas.toBuffer('image/jpeg', 92);
}

module.exports = { composeStory, colorForIndex, weekIndexFromPhoto, COLORS, TITOLO };
