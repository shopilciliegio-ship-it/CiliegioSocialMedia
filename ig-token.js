// ig-token.js
//
// Gestione del token Instagram Login ("IGA...", long-lived): dura 60 giorni e va rinnovato prima che scada.
//
// Come funziona:
//  - Il secret GitHub IG_ACCESS_TOKEN è solo il punto di partenza.
//  - Il rinnovo (rinnova-token-ig.js, workflow settimanale) chiede a Instagram un token nuovo e lo salva
//    su Dropbox (/IlCiliegio/SocialMedia/ig-token.json) insieme alla data di scadenza.
//  - pubblica-social.js e pubblica-stories.js usano getIgToken(): il token su Dropbox se c'è ed è
//    "figlio" del secret attuale, altrimenti il secret. Se Luca rigenera a mano il token e aggiorna il
//    secret, l'impronta (sourceFp) non combacia più e il secret nuovo vince: niente token vecchi che
//    tornano a galla.
//
// Compromesso: il token rinnovato sta su Dropbox (lo stesso account dove sta già piano.json) invece che
// nei secret GitHub, perché scrivere un secret GitHub da uno script richiederebbe un token GitHub con
// permessi molto più ampi.
//
// I token "EAA..." (Facebook Login / Page) non si rinnovano così: qui vengono lasciati stare.

const crypto = require('crypto');

const DROPBOX_CONTENT = 'https://content.dropboxapi.com/2';
const TOKEN_PATH      = '/IlCiliegio/SocialMedia/ig-token.json';
const REFRESH_URL     = 'https://graph.instagram.com/refresh_access_token';
const WARN_DAYS       = 10; // avviso nei log se mancano meno di N giorni alla scadenza

const fingerprint = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
const daysLeft    = iso => Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);

async function readStore(dbxToken) {
  const res = await fetch(`${DROPBOX_CONTENT}/files/download`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${dbxToken}`, 'Dropbox-API-Arg': JSON.stringify({ path: TOKEN_PATH }) }
  });
  if (res.status === 409) return null; // non esiste ancora
  if (!res.ok) throw new Error(`Download ${TOKEN_PATH} fallito: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function writeStore(dbxToken, obj) {
  const res = await fetch(`${DROPBOX_CONTENT}/files/upload`, {
    method: 'POST',
    headers: {
      'Authorization':   `Bearer ${dbxToken}`,
      'Content-Type':    'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: TOKEN_PATH, mode: 'overwrite', autorename: false, mute: true })
    },
    body: JSON.stringify(obj, null, 2)
  });
  if (!res.ok) throw new Error(`Upload ${TOKEN_PATH} fallito: HTTP ${res.status} ${await res.text()}`);
}

// Token da usare per pubblicare. Non lancia mai: se Dropbox non risponde si ripiega sul secret.
async function getIgToken(dbxToken, envToken) {
  try {
    const store = await readStore(dbxToken);
    if (store && store.token && store.sourceFp === fingerprint(envToken)) {
      if (store.expiresAt) {
        const d = daysLeft(store.expiresAt);
        if (d < 0)               console.warn(`⚠️ Il token IG rinnovato risulta SCADUTO da ${-d} giorni (${store.expiresAt}): il rinnovo automatico non sta girando? Serve un token nuovo.`);
        else if (d < WARN_DAYS)  console.warn(`⚠️ Il token IG scade tra ${d} giorni (${store.expiresAt}): controllare il workflow "Rinnova token Instagram".`);
      }
      return store.token;
    }
    if (store) console.log('ℹ️ Il secret IG_ACCESS_TOKEN è stato sostituito dopo l\'ultimo rinnovo: uso il secret.');
  } catch (err) {
    console.warn(`⚠️ Impossibile leggere il token IG rinnovato da Dropbox (${err.message}) — uso il secret.`);
  }
  return envToken;
}

// Chiede a Instagram un token nuovo (60 giorni da adesso) e lo salva su Dropbox.
// Requisiti Meta: token long-lived, emesso da almeno 24 ore, non ancora scaduto.
async function refreshIgToken(dbxToken, envToken) {
  const current = await getIgToken(dbxToken, envToken);
  if (!current.startsWith('IG')) {
    return { skipped: true, reason: `token non di tipo Instagram Login (inizia con "${current.slice(0, 3)}"): niente da rinnovare` };
  }
  const url = `${REFRESH_URL}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(current)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(`Rinnovo token Instagram fallito: ${JSON.stringify(data.error || data)}`);
  }
  const now = Date.now();
  const store = {
    token:       data.access_token,
    sourceFp:    fingerprint(envToken),
    refreshedAt: new Date(now).toISOString(),
    expiresAt:   new Date(now + (data.expires_in || 5184000) * 1000).toISOString()
  };
  await writeStore(dbxToken, store);
  return { skipped: false, refreshedAt: store.refreshedAt, expiresAt: store.expiresAt, days: daysLeft(store.expiresAt) };
}

module.exports = { getIgToken, refreshIgToken };
