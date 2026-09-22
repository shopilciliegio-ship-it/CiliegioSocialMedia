// verifica-pubblicazione.js
//
// Controllo giornaliero di sicurezza: verifica che la story di oggi (pranzo + cena) e, di lunedì,
// il post Facebook + Instagram del reminder settimanale siano DAVVERO usciti, leggendo gli stessi
// registri che scrivono pubblica-stories.js e pubblica-social.js su Dropbox (stories-log.json,
// post-log.json) — nessuna nuova fonte di verità, solo lettura.
//
// Manda SEMPRE un'email di controllo a Luca (via Brevo, stesso schema del digest ricerca AI
// importatori in crm-importatori/scripts/research_ai.py: mittente luca@sienawine.it, destinatario
// luca@ilciliegio.com), sia che vada tutto bene sia che manchi qualcosa — così si sa che il
// controllo stesso sta girando, non solo che i post sono usciti.
//
// Gira ogni giorno alle 10:30 Europe/Rome (.github/workflows/verifica-pubblicazione.yml, lanciato
// dal timer esterno timer-cloudflare/worker.js): un'ora dopo la story (9:30) e un'ora e mezza dopo
// il post del lunedì (9:00), abbondante margine perché eventuali retry nella finestra 9:00–11:00
// di pubblica-stories.js/pubblica-social.js siano già avvenuti.
//
// Se la settimana non è approvata in CSM ("Approva questa settimana" non cliccato), niente story/post
// è previsto: non è un errore, viene segnalato in email come informazione, non come problema.
//
// Nessuna dipendenza npm: usa fetch globale di Node 20+.

const DROPBOX_API        = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT    = 'https://content.dropboxapi.com/2';
const DROPBOX_TOKEN_URL  = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_PIANO_PATH    = '/IlCiliegio/SocialMedia/piano.json';
const DROPBOX_POSTLOG_PATH  = '/IlCiliegio/SocialMedia/post-log.json';
const DROPBOX_STORYLOG_PATH = '/IlCiliegio/SocialMedia/stories-log.json';

const RECIPIENT    = 'luca@ilciliegio.com';
const SENDER_NAME  = 'Il Ciliegio — Azienda Agricola';
const SENDER_EMAIL = 'luca@sienawine.it';
const LOGO_URL = 'https://raw.githubusercontent.com/shopilciliegio-ship-it/Ciliegio-Menu/main/ciliegio_trasparente.png';
const ACCENT = '#B8941A';
const BG     = '#2c2c2c';

// FORCE_RUN salta il controllo orario (solo per test manuali). SEND_EMAIL=false logga l'esito senza
// spedire, utile per provare il controllo senza riempire la casella durante un test.
const FORCE_RUN  = String(process.env.FORCE_RUN || 'false').toLowerCase() === 'true';
const SEND_EMAIL = String(process.env.SEND_EMAIL || 'true').toLowerCase() !== 'false';

function need(name) {
  const raw = process.env[name];
  const v = raw && raw.trim();
  if (!v) { console.error(`❌ Manca la variabile d'ambiente ${name} (GitHub Secret non configurato?)`); process.exit(1); }
  return v;
}

async function dropboxAccessToken() {
  const res = await fetch(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: need('DROPBOX_REFRESH_TOKEN'), client_id: need('DROPBOX_APP_KEY') })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Refresh token Dropbox fallito: ${data.error_description || data.error}`);
  return data.access_token;
}

// "File non esiste ancora" (409) restituisce null invece di errore: un registro non ancora scritto
// oggi non è un errore del controllo, è normale (es. prima ancora che le Action girino).
async function dropboxDownloadJsonOrNull(token, path) {
  const res = await fetch(`${DROPBOX_CONTENT}/files/download`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path }) }
  });
  if (res.status === 409) return null;
  if (!res.ok) throw new Error(`Download ${path} fallito: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

function romeWeekday() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', weekday: 'short' }).format(new Date());
}

function romeHour() {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()), 10);
}

function romeDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function romeTimeStr(isoStr) {
  if (!isoStr) return '';
  try {
    return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(isoStr));
  } catch { return ''; }
}

// Stessa logica di pubblica-social.js/pubblica-stories.js: lunedì corrente e id del reminder
// (con lo stesso "doppio candidato" per il disallineamento UTC/locale di CSM).
function currentMondayRome() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(new Date());
  const map = {}; parts.forEach(p => map[p.type] = p.value);
  const dowMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  const dow = dowMap[map.weekday];
  const today = new Date(`${map.year}-${map.month}-${map.day}T00:00:00Z`);
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  return new Date(today.getTime() + diffToMonday * 86400000).toISOString().slice(0, 10);
}

function pickReminderId(overrides, monday) {
  const prev = new Date(new Date(monday + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  const candidates = [`r_${monday}_reminder`, `r_${prev}_reminder`];
  const ok = candidates.find(id => overrides[id] && ['approvato', 'published'].includes(overrides[id].status));
  return ok || candidates.find(id => overrides[id]) || candidates[0];
}

async function main() {
  if (!FORCE_RUN) {
    // Finestra 10:00–12:00: un'ora dopo la story, mezz'ora dopo la chiusura della finestra di
    // pubblicazione (9:00–11:00) di pubblica-stories.js/pubblica-social.js.
    const hour = romeHour();
    if (hour < 10 || hour >= 12) {
      console.log(`ℹ️ Fuori dalla finestra di controllo 10:00–12:00 Europe/Rome (ora attuale: ${hour}) — nessuna azione.`);
      return;
    }
  } else {
    console.log('⚠️ FORCE_RUN attivo: salto il controllo orario (solo per test manuali).');
  }

  const dbxToken = await dropboxAccessToken();
  const piano = (await dropboxDownloadJsonOrNull(dbxToken, DROPBOX_PIANO_PATH)) || {};
  const overrides = piano.recurringOverrides || {};
  const monday = currentMondayRome();
  const postId = pickReminderId(overrides, monday);
  const post = overrides[postId] || {};
  const settimanaApprovata = post.status === 'approvato' || post.status === 'published';

  const postLog = (await dropboxDownloadJsonOrNull(dbxToken, DROPBOX_POSTLOG_PATH)) || {};
  const postEsito = (postLog.posts || {})[postId] || {};

  const storyLog = (await dropboxDownloadJsonOrNull(dbxToken, DROPBOX_STORYLOG_PATH)) || {};
  const oggi = romeDateStr();
  const storieOggi = (storyLog.stories || {})[oggi] || {};

  const isLunedi = romeWeekday() === 'Mon';

  const righe = []; // { ok: true|false|null, label, dettaglio }
  let problema = false;

  function checkVoce(label, esito) {
    if (!settimanaApprovata) {
      righe.push({ ok: null, label, dettaglio: 'settimana non approvata in CSM — nessuna pubblicazione prevista' });
    } else if (esito && esito.ok) {
      righe.push({ ok: true, label, dettaglio: `pubblicata alle ${romeTimeStr(esito.at) || esito.at}` });
    } else if (esito && !esito.ok) {
      righe.push({ ok: false, label, dettaglio: `ERRORE: ${esito.error || 'sconosciuto'}` });
      problema = true;
    } else {
      righe.push({ ok: false, label, dettaglio: 'NON risulta pubblicata' });
      problema = true;
    }
  }

  checkVoce('Story pranzo', storieOggi.pranzo);
  checkVoce('Story cena', storieOggi.cena);
  if (isLunedi) {
    checkVoce('Post Facebook (lunedì)', postEsito.fb);
    checkVoce('Post Instagram (lunedì)', postEsito.ig);
  }

  console.log(righe.map(r => `${r.ok === true ? '✅' : r.ok === false ? '❌' : 'ℹ️'} ${r.label}: ${r.dettaglio}`).join('\n'));

  if (SEND_EMAIL) {
    await inviaEmail({ righe, problema, oggi, isLunedi });
  } else {
    console.log('🧪 SEND_EMAIL=false — email non inviata (solo log qui sopra).');
  }

  if (problema) process.exitCode = 1;
}

async function inviaEmail({ righe, problema, oggi, isLunedi }) {
  const oraStr = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const titolo = problema ? '⚠️ Controllo pubblicazione — problema rilevato' : '✅ Controllo pubblicazione — tutto ok';
  const oggetto = `${problema ? '⚠️' : '✅'} Social ${oggi}${isLunedi ? ' (+ post lunedì)' : ''} — controllo delle ${oraStr}`;

  const righeHtml = righe.map(r => {
    const icona = r.ok === true ? '✅' : r.ok === false ? '❌' : 'ℹ️';
    const colore = r.ok === true ? '#2e7d32' : r.ok === false ? '#c62828' : '#888';
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;color:#333;font-size:14px">${icona} ${r.label}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;color:${colore};font-size:14px;text-align:right">${r.dettaglio}</td>
    </tr>`;
  }).join('');

  const htmlContent = `<!DOCTYPE html><html lang="it">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:Georgia,'Times New Roman',serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:${BG};border-radius:12px 12px 0 0;padding:20px 32px;text-align:center">
    <img src="${LOGO_URL}" width="60" alt="Il Ciliegio" style="display:block;margin:0 auto">
  </td></tr>
  <tr><td style="background:${ACCENT};height:4px;font-size:0">&nbsp;</td></tr>
  <tr><td style="background:#ffffff;padding:32px 40px">
    <p style="margin:0 0 4px;color:#999;font-size:12px">${oggi} · ${oraStr}</p>
    <h2 style="margin:0 0 20px;color:#222;font-size:20px;font-weight:bold">${titolo}</h2>
    <table width="100%" cellpadding="0" cellspacing="0">${righeHtml}</table>
  </td></tr>
  <tr><td style="background:${ACCENT};height:3px;font-size:0">&nbsp;</td></tr>
  <tr><td style="background:${BG};border-radius:0 0 12px 12px;padding:16px 32px;text-align:center">
    <p style="margin:0;color:#999;font-size:11px">Il Ciliegio Social — controllo automatico giornaliero</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;

  const textLines = [titolo, ''].concat(righe.map(r => `${r.ok === true ? 'OK' : r.ok === false ? 'PROBLEMA' : 'INFO'} — ${r.label}: ${r.dettaglio}`));

  const payload = {
    sender:      { name: SENDER_NAME, email: SENDER_EMAIL },
    to:          [{ email: RECIPIENT, name: 'Luca' }],
    subject:     oggetto,
    htmlContent,
    textContent: textLines.join('\n'),
    tags:        ['social-ciliegio', 'controllo-pubblicazione'],
    trackClicks: false,
    trackOpens:  false,
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': need('BREVO_API_KEY'), 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (res.ok) {
    console.log(`✉️ Email di controllo inviata a ${RECIPIENT}`);
  } else {
    console.error(`⚠️ Invio email fallito: ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('❌ Errore:', err.message);
  process.exitCode = 1;
});
