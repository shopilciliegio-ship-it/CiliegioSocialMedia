// pubblica-stories.js
//
// Pubblica ogni giorno due IG Stories con il menù del giorno (pranzo + cena), leggendo
// direttamente le immagini già generate dall'app Ciliegio Menù e pubbliche su GitHub
// (repo Ciliegio-Menu, cartella immagini-sito/) — nessuna generazione, nessun testo:
// il JPG del menù è già l'immagine finita.
//
// Gira ogni giorno alle 9:30 Europe/Rome (.github/workflows/pubblica-stories.yml), mezz'ora
// dopo il post settimanale del lunedì per non sovrapporsi.
//
// GRAFICA: l'immagine pubblicata NON è il JPG del menù nudo, ma una story 1080×1920 composta da
// story-grafica.js (scritta ICCHESSIMANGIAOGGI?, colore della settimana, badge col logo). Si compone al
// momento della pubblicazione partendo dal JPG che c'è in quel momento su GitHub, così i cambi dell'ultimo
// minuto al menù passano da soli. Se la composizione fallisce, esce comunque il JPG semplice.
//
// GATE DI APPROVAZIONE: non viene pubblicato NULLA se Luca non ha cliccato "Approva questa
// settimana" in CSM per la settimana corrente (reminder r_<lunedì>_reminder con status
// 'approvato', oppure 'published' se il post del lunedì è già uscito). Se piano.json non è
// leggibile o lo stato non è chiaro, vale la regola sicura: non pubblicare.
//
// Vengono postate SEMPRE entrambe le immagini (pranzo + cena), tutti i giorni: se il servizio
// è chiuso/al completo, in immagini-sito/ c'è comunque il file generico "AL COMPLETO" (vedi
// Completa-Immagini-Mancanti.ps1 nel repo Ciliegio Menu) — non c'è mai un giorno senza file.
//
// Nessuna dipendenza npm: usa fetch globale di Node 20+.

const { getIgToken } = require('./ig-token');

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const IMG_BASE  = 'https://raw.githubusercontent.com/shopilciliegio-ship-it/Ciliegio-Menu/main/immagini-sito/';
// Stessa fonte di verità che usa Completa-Immagini-Mancanti.ps1 (repo Ciliegio Menu) per decidere se un
// giorno/servizio ha un menù reale o va riempito con la cartolina generica "AL COMPLETO": se non c'è la
// chiave "${data}_${servizio}_Menù del Sito" in menu-data.json, l'immagine di quel giorno è quella
// generica — e in quel caso la story non deve invitare a prenotare (vedi haMenuReale sotto).
const MENU_DATA_URL = 'https://raw.githubusercontent.com/shopilciliegio-ship-it/Ciliegio-Menu/main/menu-data.json';

const DROPBOX_API       = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT   = 'https://content.dropboxapi.com/2';
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_FILE_PATH = '/IlCiliegio/SocialMedia/piano.json';
// Registro delle story pubblicate, scritto SOLO da questa Action e letto da CSM (sola lettura) per
// mostrare "Pubblicata" sul giorno del calendario. File separato da piano.json apposta: il browser
// salva piano.json per intero e potrebbe sovrascrivere ciò che scrive l'Action.
const DROPBOX_LOG_PATH  = '/IlCiliegio/SocialMedia/stories-log.json';
// Immagini composte delle story (le legge Instagram tramite link temporaneo Dropbox).
const DROPBOX_STORY_FOLDER = '/IlCiliegio/SocialMedia/GraficaGenerata/stories';
const LOGO_URL = 'https://raw.githubusercontent.com/shopilciliegio-ship-it/Ciliegio-Menu/main/ciliegio_trasparente.png';

const DRY_RUN   = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const FORCE_RUN = String(process.env.FORCE_RUN || 'false').toLowerCase() === 'true';
// Lancio manuale "rifai": ripubblica solo quella story (pranzo/cena) ignorando il registro di oggi,
// per quando è stata cancellata a mano da Instagram (es. menù sbagliato, poi corretto su GitHub).
const RIFAI = ['pranzo', 'cena'].includes(String(process.env.RIFAI || '').toLowerCase()) ? String(process.env.RIFAI).toLowerCase() : null;

function need(name) {
  const raw = process.env[name];
  const v = raw && raw.trim();
  if (!v) { console.error(`❌ Manca la variabile d'ambiente ${name} (GitHub Secret non configurato?)`); process.exit(1); }
  // Uno spazio o un a-capo incollato insieme al secret fa rispondere Meta "Cannot parse access token".
  if (v !== raw) console.warn(`⚠️ ${name} conteneva spazi/a-capo ai bordi: li ignoro (conviene rifare il secret senza).`);
  return v;
}

// I token Instagram Login ("IG...") vanno sul dominio Instagram; i token Facebook Login / Page ("EAA...")
// su graph.facebook.com. Un token IG... su graph.facebook.com dà "Cannot parse access token".
function igGraphApi(token) {
  return token.startsWith('IG') ? 'https://graph.instagram.com/v21.0' : GRAPH_API;
}

// Numerazione canonica (stessa di CANONICAL in carica-menu-sito.js, repo Ciliegio Menu) e
// nome giorno esattamente come appare nei file reali (accento incluso, es. "lunedì").
const DAY_INFO = {
  Mon: { name: 'lunedì',    pranzo: '02', cena: '03' },
  Tue: { name: 'martedì',   pranzo: '04', cena: '05' },
  Wed: { name: 'mercoledì', pranzo: '06', cena: '07' },
  Thu: { name: 'giovedì',   pranzo: '08', cena: '09' },
  Fri: { name: 'venerdì',   pranzo: '10', cena: '11' },
  Sat: { name: 'sabato',    pranzo: '12', cena: '13' },
  Sun: { name: 'domenica',  pranzo: '14', cena: '15' },
};

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

async function dropboxDownloadJson(token, path) {
  const res = await fetch(`${DROPBOX_CONTENT}/files/download`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path }) }
  });
  if (!res.ok) throw new Error(`Download ${path} fallito: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// Come dropboxDownloadJson, ma "file non esiste ancora" (409) restituisce null invece di errore.
async function dropboxDownloadJsonOrNull(token, path) {
  const res = await fetch(`${DROPBOX_CONTENT}/files/download`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path }) }
  });
  if (res.status === 409) return null;
  if (!res.ok) throw new Error(`Download ${path} fallito: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function dropboxUploadJson(token, path, obj) {
  const res = await fetch(`${DROPBOX_CONTENT}/files/upload`, {
    method: 'POST',
    headers: {
      'Authorization':   `Bearer ${token}`,
      'Content-Type':    'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false, mute: true })
    },
    body: JSON.stringify(obj, null, 2)
  });
  if (!res.ok) throw new Error(`Upload ${path} fallito: HTTP ${res.status} ${await res.text()}`);
}

async function dropboxUploadBytes(token, path, buf) {
  const res = await fetch(`${DROPBOX_CONTENT}/files/upload`, {
    method: 'POST',
    headers: {
      'Authorization':   `Bearer ${token}`,
      'Content-Type':    'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false, mute: true })
    },
    body: buf
  });
  if (!res.ok) throw new Error(`Upload ${path} fallito: HTTP ${res.status} ${await res.text()}`);
}

// Link diretto temporaneo: l'endpoint /media di Instagram vuole un image_url pubblico (stesso metodo del post del lunedì).
async function dropboxTempLink(token, path) {
  const res = await fetch(`${DROPBOX_API}/files/get_temporary_link`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Temp link ${path} fallito: ${data.error_summary || res.status}`);
  return data.link;
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${url} fallito: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// null se non scaricabile/non parsabile: chi chiama tratta "non so" come "NON è un menù reale"
// (fail-closed — meglio una story senza pillola "Prenota" che una su un giorno al completo).
async function fetchMenuDataOrNull() {
  try {
    const res = await fetch(MENU_DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`⚠️ menu-data.json non scaricabile (${err.message}) — per sicurezza tratto tutti i servizi di oggi come "non confermati" (niente pillola "Prenota").`);
    return null;
  }
}

// Stessa chiave usata da mkKey() in Ciliegio-Menu.html e dallo script Completa-Immagini-Mancanti.ps1:
// "${data}_${servizio}_Menù del Sito". Se manca, quel servizio non ha un menù reale confermato ed è
// stato riempito con la cartolina generica "AL COMPLETO".
function haMenuReale(menuData, dateStr, servizio) {
  if (!menuData || !menuData.menu) return false;
  return Object.prototype.hasOwnProperty.call(menuData.menu, `${dateStr}_${servizio}_Menù del Sito`);
}

// Grafica delle story (scritta ICCHESSIMANGIAOGGI? + colore della settimana + badge, vedi story-grafica.js).
// Se il modulo o la sua dipendenza non sono disponibili (npm ci fallito), si ripiega sull'immagine semplice:
// meglio una story senza header che nessuna story.
function loadStoryGrafica() {
  try { return require('./story-grafica'); }
  catch (err) { console.warn(`⚠️ Grafica story non disponibile (${err.message}) — userò i JPG del menù semplici.`); return null; }
}

// Compone la story di un servizio e la rende raggiungibile da Instagram. Qualunque errore → immagine semplice.
async function prepareStoryImage({ label, num, plainUrl, grafica, logoBuf, color, prenota, dbxToken }) {
  if (!grafica || !logoBuf) return { url: plainUrl, composed: false };
  try {
    const menuBuf = await fetchBuffer(plainUrl);
    const jpg = await grafica.composeStory({ menuBuf, logoBuf, color, prenota });
    // Nome fisso per numero (02…15): i file si sovrascrivono ogni settimana, la cartella non cresce.
    const dbxPath = `${DROPBOX_STORY_FOLDER}/story-${num}.jpg`;
    await dropboxUploadBytes(dbxToken, dbxPath, jpg);
    const link = await dropboxTempLink(dbxToken, dbxPath);
    console.log(`🎨 Story ${label} composta (${Math.round(jpg.length / 1024)} KB) → Dropbox ${dbxPath}`);
    return { url: link, composed: true, dbxPath };
  } catch (err) {
    console.warn(`⚠️ Composizione story ${label} fallita (${err.message}) — userò il JPG del menù semplice.`);
    return { url: plainUrl, composed: false };
  }
}

function romeDateStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Lunedì della settimana corrente in Europe/Rome ('YYYY-MM-DD'), stesso formato degli id
// "r_YYYY-MM-DD_reminder" usati da CiliegioSocialMedia.html e da pubblica-social.js.
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

// CSM (CiliegioSocialMedia.html) ricava l'id del reminder con toISOString(), cioè in UTC: in un
// browser europeo la mezzanotte locale di lunedì cade ancora domenica in UTC, quindi il post
// del lunedì 21/9 viene salvato come "r_2026-09-20_reminder" invece di "r_2026-09-21_reminder".
// Per non dipendere dal fuso del browser si cercano entrambi gli id (esatto e giorno prima):
// vince quello già approvato/pubblicato, altrimenti il primo che esiste.
function pickReminderId(overrides, monday) {
  const prev = new Date(new Date(monday + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  const candidates = [`r_${monday}_reminder`, `r_${prev}_reminder`];
  const ok = candidates.find(id => overrides[id] && ['approvato', 'published'].includes(overrides[id].status));
  return ok || candidates.find(id => overrides[id]) || candidates[0];
}

function romeWeekday() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', weekday: 'short' }).format(new Date());
}

function romeHour() {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()), 10);
}

function imageUrlFor(num, dayName, servizio) {
  return IMG_BASE + encodeURIComponent(`${num}-${dayName}-${servizio}.jpg`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Instagram elabora il contenitore in modo asincrono: pubblicarlo subito dà "Media ID is not available"
// (code 9007, subcode 2207027). Si aspetta status_code FINISHED, poi si pubblica; se per qualche
// motivo risponde ancora "non pronto" si riprova qualche volta. Un contenitore rimasto non pubblicato
// scade da solo: un nuovo tentativo ne crea uno nuovo, non c'è rischio di doppio post.
async function igPublishContainer(api, igUserId, igToken, containerId) {
  const t0 = Date.now();
  let status = '';
  while (Date.now() - t0 < 120000) {
    const res = await fetch(`${api}/${containerId}?fields=status_code&access_token=${encodeURIComponent(igToken)}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      console.warn(`⚠️ Stato del contenitore IG non leggibile (${JSON.stringify(data.error || data)}) — provo a pubblicare comunque.`);
      break;
    }
    status = data.status_code;
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`Contenitore IG in stato ${status}: ${JSON.stringify(data)}`);
    await sleep(3000);
  }
  console.log(`   Contenitore IG ${containerId}: ${status || 'stato sconosciuto'} dopo ${Math.round((Date.now() - t0) / 1000)}s`);

  let published;
  for (let tentativo = 1; tentativo <= 4; tentativo++) {
    const pubRes = await fetch(`${api}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerId, access_token: igToken })
    });
    published = await pubRes.json();
    if (pubRes.ok && !published.error) return published;
    const nonPronto = published.error && published.error.error_subcode === 2207027;
    if (!nonPronto || tentativo === 4) break;
    console.log(`   Media non ancora pronto (tentativo ${tentativo}/4) — riprovo tra 5s...`);
    await sleep(5000);
  }
  throw new Error(`Instagram media_publish fallito: ${JSON.stringify(published.error || published)}`);
}

async function igPublishStory(igUserId, igToken, imageUrl) {
  const api = igGraphApi(igToken);
  const createRes = await fetch(`${api}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, media_type: 'STORIES', access_token: igToken })
  });
  const created = await createRes.json();
  if (!createRes.ok || created.error) throw new Error(`IG media create fallito: ${JSON.stringify(created.error || created)}`);

  return igPublishContainer(api, igUserId, igToken, created.id);
}

async function main() {
  if (!FORCE_RUN) {
    // Finestra 9:00–10:59 (non "esattamente le 9"): vedi pubblica-social.js. Il doppio invio è evitato
    // dal registro stories-log.json (sotto), non dall'orario.
    const hour = romeHour();
    if (hour < 9 || hour >= 11) {
      console.log(`ℹ️ Fuori dalla finestra 9:00–11:00 a Europe/Rome (ora attuale: ${hour}) — nessuna azione.`);
      return;
    }
  } else {
    console.log('⚠️ FORCE_RUN attivo: salto il controllo orario (solo per test manuali).');
  }

  const info = DAY_INFO[romeWeekday()];
  const pranzoUrl = imageUrlFor(info.pranzo, info.name, 'pranzo');
  const cenaUrl    = imageUrlFor(info.cena, info.name, 'cena');
  console.log(`📅 Oggi (Europe/Rome): ${info.name}`);
  console.log(`🍽️ Pranzo: ${pranzoUrl}`);
  console.log(`🌙 Cena: ${cenaUrl}`);

  // Gate di approvazione, fail-closed: qualunque errore (Dropbox, file mancante) o stato
  // diverso da approvato/published fa uscire senza pubblicare nulla.
  const dbxToken = await dropboxAccessToken();
  const piano = await dropboxDownloadJson(dbxToken, DROPBOX_FILE_PATH);
  const overrides = piano.recurringOverrides || {};
  const postId = pickReminderId(overrides, currentMondayRome());
  const status = (overrides[postId] || {}).status;
  if (status !== 'approvato' && status !== 'published') {
    console.log(`⛔ Settimana NON approvata (${postId}, stato: ${status || 'nessun dato'}) — non pubblico nessuna story.`);
    return;
  }
  console.log(`✅ Settimana approvata (${postId}, stato: ${status}).`);

  // Anti doppio invio: con più trigger (timer esterno + cron GitHub di riserva) la story già uscita oggi
  // non va ripubblicata. Una story con errore invece viene ritentata al giro successivo. Anche in dry run
  // si legge il registro, così il test mostra cosa farebbe davvero. Per rifare una story a mano:
  // togliere la sua voce da stories-log.json su Dropbox.
  const oggi = romeDateStr();
  const logIniziale = (await dropboxDownloadJsonOrNull(dbxToken, DROPBOX_LOG_PATH)) || {};
  const giaFatte = (logIniziale.stories || {})[oggi] || {};
  const daFare = RIFAI ? [RIFAI] : ['pranzo', 'cena'].filter(label => !(giaFatte[label] && giaFatte[label].ok));
  if (RIFAI) console.log(`🔁 RIFAI attivo: ripubblico solo la story ${RIFAI}, ignorando il registro di oggi.`);
  else for (const label of ['pranzo', 'cena']) {
    if (!daFare.includes(label)) console.log(`ℹ️ Story ${label} già pubblicata oggi (${giaFatte[label].at}) — la salto.`);
  }
  if (!daFare.length) {
    console.log('✅ Entrambe le story di oggi sono già uscite — nessuna azione.');
    return;
  }

  // Immagini: composizione con la grafica (colore della settimana = quello del post del lunedì, dal numero
  // della foto del reminder). Anche in dry run si compone e si salva su Dropbox (utile per vederla), ma non si pubblica.
  const grafica = loadStoryGrafica();
  let logoBuf = null, color = null;
  if (grafica) {
    try {
      logoBuf = await fetchBuffer(LOGO_URL);
      const idx = grafica.weekIndexFromPhoto((overrides[postId] || {}).photoFile);
      if (idx == null) console.warn('⚠️ Numero foto del reminder non riconoscibile — uso il primo colore della palette.');
      color = grafica.colorForIndex(idx == null ? 0 : idx);
      console.log(`🎨 Colore della settimana: ${color} (foto n. ${idx})`);
    } catch (err) {
      console.warn(`⚠️ Logo non scaricabile (${err.message}) — userò i JPG del menù semplici.`);
    }
  }
  // Un giorno/servizio senza menù reale confermato in menu-data.json è la cartolina generica "AL
  // COMPLETO/FULLY BOOKED" (stessa fonte di verità di Completa-Immagini-Mancanti.ps1): in quel caso
  // la story non deve invitare a prenotare un servizio già pieno.
  const menuData = await fetchMenuDataOrNull();
  const prepared = {};
  for (const [label, num, plainUrl] of [['pranzo', info.pranzo, pranzoUrl], ['cena', info.cena, cenaUrl]]) {
    if (!daFare.includes(label)) continue;
    const prenota = haMenuReale(menuData, oggi, label);
    console.log(`${prenota ? '✅' : 'ℹ️'} Story ${label}: ${prenota ? 'menù reale confermato' : 'nessun menù confermato (probabile "al completo") — niente pillola "Prenota"'}`);
    prepared[label] = await prepareStoryImage({ label, num, plainUrl, grafica, logoBuf, color, prenota, dbxToken });
  }

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN attivo — nessuna story pubblicata davvero.');
    for (const label of daFare) console.log(`   ${label}: ${prepared[label].composed ? 'grafica composta (vedi Dropbox)' : 'immagine semplice'}`);
    return;
  }

  const igUserId = need('IG_USER_ID');
  const igToken  = await getIgToken(dbxToken, need('IG_ACCESS_TOKEN')); // rinnovato su Dropbox se c'è, altrimenti il secret
  console.log(`🔑 Token IG: lunghezza ${igToken.length}, inizia con "${igToken.slice(0, 3)}" — dominio ${igGraphApi(igToken)}`);

  let hadError = false;
  const results = {};
  for (const label of daFare) {
    try {
      console.log(`\n📤 Pubblico story ${label}...`);
      const result = await igPublishStory(igUserId, igToken, prepared[label].url);
      console.log(`✅ Story ${label} pubblicata: media id ${result.id}`);
      results[label] = { ok: true, id: result.id, composed: prepared[label].composed, at: new Date().toISOString() };
    } catch (err) {
      hadError = true;
      console.error(`❌ Story ${label} fallita: ${err.message}`);
      results[label] = { ok: false, error: String(err.message).slice(0, 300), at: new Date().toISOString() };
    }
  }

  // Registro per CSM. Le story sono già uscite: se la scrittura del registro fallisce si avvisa
  // soltanto (niente exit code rosso, niente ripubblicazione), CSM mostrerà "non pubblicata".
  try {
    const log = (await dropboxDownloadJsonOrNull(dbxToken, DROPBOX_LOG_PATH)) || {};
    log.stories = log.stories || {};
    const day = romeDateStr();
    log.stories[day] = { ...(log.stories[day] || {}), ...results };
    log.lastUpdated = new Date().toISOString();
    await dropboxUploadJson(dbxToken, DROPBOX_LOG_PATH, log);
    console.log(`💾 Registro story aggiornato su Dropbox (${day}).`);
  } catch (err) {
    console.warn(`⚠️ Story pubblicate ma registro Dropbox non aggiornato: ${err.message}`);
  }
  if (hadError) process.exitCode = 1;
}

main().catch(err => {
  console.error('❌ Errore:', err.message);
  process.exitCode = 1;
});
