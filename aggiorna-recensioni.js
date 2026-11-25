// aggiorna-recensioni.js
//
// Scarica le ultime recensioni POSITIVE (4-5 stelle) da Google e TripAdvisor e le scrive in
// recensioni/recensioni.json, che la home del sito nuovo legge (assets/js/reviews.js) e mostra a scorrimento.
// Gira nella GitHub Action .github/workflows/aggiorna-recensioni.yml (ogni lunedì + a mano).
// NB: la Places API (New) di Google dà solo 5 recensioni "più pertinenti" (non le ultime) e cambiano di rado:
// per questo il giro è settimanale. Quando arriverà la Business Profile API (recensioni per data) rimettere il cron giornaliero.
//
// Segreti/variabili richiesti (una piattaforma senza chiave viene saltata, senza errori):
//   GOOGLE_PLACES_API_KEY (+ GOOGLE_PLACE_ID facoltativo: se manca lo ricava dal CID) -> Google (Places API "New": max 5 recensioni)
//   TRIPADVISOR_API_KEY   + TRIPADVISOR_LOCATION_ID -> TripAdvisor (API Terra, piano Discover: 3 ultime recensioni)
// TheFork non ha un'API pubblica per le recensioni: si possono aggiungere a mano in recensioni/manuali.json
//   [{ "fonte": "TheFork", "autore": "Nome", "stelle": 5, "testo": "...", "data": "2026-11-20", "link": "https://..." }]
//
// Regole: solo 4 e 5 stelle, ordine dal più recente, massimo MAX_ITEMS (10) mostrate sul sito.
// ARCHIVIO: ogni recensione nuova (Google, TripAdvisor, manuali) si AGGIUNGE a recensioni/archivio.json senza duplicati
// e non si cancella mai; recensioni.json contiene solo le MAX_ITEMS più recenti dell'archivio (le più vecchie escono
// dalla vista ma restano in archivio). Se una piattaforma non risponde l'archivio garantisce che il sito non si svuoti.
// Nessuna dipendenza npm (Node 20+).
//
// Uso: node aggiorna-recensioni.js           (scrive il file)
//      node aggiorna-recensioni.js --prova   (stampa soltanto, non scrive)

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'recensioni');
const OUT = path.join(DIR, 'recensioni.json');
const MANUALI = path.join(DIR, 'manuali.json');
const ARCHIVIO = path.join(DIR, 'archivio.json');
const MAX_ITEMS = 10;
const MIN_STELLE = 4;
const MAX_CHARS = 320;
const PROVA = process.argv.includes('--prova');

const env = n => (process.env[n] || '').trim();

function taglia(testo) {
  let t = String(testo || '').replace(/\s+/g, ' ').trim();
  if (t.length > MAX_CHARS) t = t.slice(0, MAX_CHARS).replace(/\s+\S*$/, '') + '…';
  return t;
}

// ---- Google (Places API New) ----
function normalizzaGoogle(json) {
  const items = (json.reviews || []).map(r => ({
    fonte: 'Google',
    autore: (r.authorAttribution && r.authorAttribution.displayName) || 'Ospite',
    stelle: r.rating,
    testo: taglia((r.text && r.text.text) || (r.originalText && r.originalText.text) || ''),
    data: r.publishTime || null,
    link: (r.authorAttribution && r.authorAttribution.uri) || null,
  }));
  return { punteggio: json.rating || null, totale: json.userRatingCount || null, items };
}

// Il link di Google "ludocid=..." è il CID della scheda, non il Place ID che serve all'API. Se GOOGLE_PLACE_ID
// non è impostato, il Place ID si ricava cercando il nome e scegliendo il risultato con quel CID.
const GOOGLE_CID = env('GOOGLE_CID') || '17508871207857454496';
async function trovaPlaceId(key) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.googleMapsUri,places.displayName' },
    body: JSON.stringify({ textQuery: 'Ristorante Agrituristico Il Ciliegio Monteriggioni', languageCode: 'it' }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google (ricerca scheda): ${res.status} ${JSON.stringify(json.error || json).slice(0, 300)}`);
  const trovato = (json.places || []).find(p => String(p.googleMapsUri || '').includes(`cid=${GOOGLE_CID}`));
  if (!trovato) throw new Error(`Google: nessun risultato con CID ${GOOGLE_CID} (trovati: ${(json.places || []).map(p => p.displayName && p.displayName.text).join(', ')})`);
  console.log(`🔎 Scheda Google trovata: ${trovato.displayName && trovato.displayName.text} (${trovato.id})`);
  return trovato.id;
}

async function scaricaGoogle() {
  const key = env('GOOGLE_PLACES_API_KEY');
  if (!key) return null;
  const id = env('GOOGLE_PLACE_ID') || await trovaPlaceId(key);
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=it`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'rating,userRatingCount,reviews' },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google: ${res.status} ${JSON.stringify(json.error || json).slice(0, 300)}`);
  return normalizzaGoogle(json);
}

// ---- TripAdvisor (API "Terra", dal 2026 al posto della vecchia Content API) ----
// Indirizzo https://terra.tripadvisor.com/api, chiave nell'header X-API-Key. La vecchia api.content.tripadvisor.com
// con una chiave Terra risponde 403 "explicit deny". Piano Discover: le 3 ultime recensioni per scheda.
// Il formato esatto di una recensione Terra non è documentato: i campi si leggono con più varianti e, se non si trova
// il testo, il log stampa i campi trovati così si corregge in un giro.
const primo = (...v) => v.find(x => x !== undefined && x !== null && x !== '');
// I testi Terra sono liste di versioni per lingua: [{language, value, primary}]. Preferisco l'italiano, poi la versione primaria/originale.
function testoLoc(x) {
  if (!Array.isArray(x)) return (x && typeof x === 'object') ? String(x.value || '') : String(x || '');
  const t = x.find(v => v && v.language === 'it') || x.find(v => v && v.primary) || x[0];
  return t ? String(t.value || '') : '';
}
function normalizzaTripadvisor(reviewsJson, detailsJson) {
  const lista = Array.isArray(reviewsJson) ? reviewsJson : ((reviewsJson && (reviewsJson.data || reviewsJson.reviews)) || []);
  const items = lista.map(r => {
    const u = r.user || r.author || {};
    const testo = testoLoc(primo(r.text, r.body, r.review_text, r.content, '')) || testoLoc(r.title);
    const ts = primo(r.published_date, r.publish_date, r.published_at, r.publish_ts, r.created_at, r.date, r.travel_date, null);
    const rating = primo(r.rating, r.rating_value, r.stars, (r.ratings && r.ratings.overall), null);
    return {
      fonte: 'TripAdvisor',
      autore: primo(u.username, u.display_name, u.name, r.username, r.author_name, 'Ospite'),
      stelle: Number(rating),
      testo: taglia(testo),
      data: ts ? (isNaN(Date.parse(ts)) && /^\d+$/.test(String(ts)) ? new Date(Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000).toISOString() : ts) : null,
      link: primo(r.url, r.link, r.review_url, null),
    };
  });
  if (lista.length && !items.some(i => i.testo && i.stelle >= MIN_STELLE)) console.log('ℹ️ TripAdvisor: esempio di recensione →', JSON.stringify(lista[0]).slice(0, 900));
  const ov = detailsJson && detailsJson.traveler_ratings && detailsJson.traveler_ratings.overall;
  return {
    punteggio: ov && ov.rating ? Number(ov.rating) : (detailsJson && detailsJson.rating ? Number(detailsJson.rating) : null),
    totale: ov && ov.count ? Number(ov.count) : (detailsJson && detailsJson.num_reviews ? Number(detailsJson.num_reviews) : null),
    items,
  };
}

async function scaricaTripadvisor() {
  const key = env('TRIPADVISOR_API_KEY'), id = env('TRIPADVISOR_LOCATION_ID');
  if (!key || !id) return null;
  const base = `https://terra.tripadvisor.com/api/locations/${encodeURIComponent(id)}`;
  const opts = { headers: { accept: 'application/json', 'X-API-Key': key } };
  const [r1, r2] = await Promise.all([fetch(`${base}/reviews?size=20`, opts), fetch(base, opts)]);
  const reviews = await r1.json().catch(() => ({}));
  if (!r1.ok) throw new Error(`TripAdvisor: ${r1.status} ${JSON.stringify(reviews).slice(0, 300)}`);
  const details = r2.ok ? await r2.json().catch(() => null) : null;
  return normalizzaTripadvisor(reviews, details);
}

// ---- unione, archivio, filtro, ordine ----
function chiave(i) {
  return [i.fonte, String(i.autore || '').toLowerCase(), String(i.testo || '').slice(0, 40).toLowerCase()].join('|');
}
// archivio = vecchio archivio + vecchie del sito (prima versione senza archivio) + nuove scaricate + manuali, senza duplicati.
// Per un duplicato vince la versione più recente (la nuova scaricata), così testo e link restano aggiornati.
function unisciArchivio(archivio, scaricate) {
  const mappa = new Map();
  for (const i of [...archivio, ...scaricate]) {
    if (i && i.testo && Number(i.stelle) >= MIN_STELLE) mappa.set(chiave(i), i);
  }
  return [...mappa.values()];
}
function ordinaETaglia(items, max = MAX_ITEMS) {
  return items
    .map(i => ({ ...i, _t: i.data ? Date.parse(i.data) || 0 : 0 }))
    .sort((a, b) => b._t - a._t)
    .slice(0, max)
    .map(({ _t, ...i }) => i);
}
function unisci(fonti, vecchie, manuali, archivio = []) {
  const scaricate = [];
  for (const nome of ['Google', 'TripAdvisor']) if (fonti[nome]) scaricate.push(...fonti[nome].items);
  scaricate.push(...manuali);
  const base = [...archivio, ...((vecchie && vecchie.items) || [])];
  const completo = unisciArchivio(base, scaricate);
  return { archivio: completo, items: ordinaETaglia(completo) };
}

function leggiJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; }
}

async function main() {
  const vecchie = leggiJson(OUT, {});
  const manuali = leggiJson(MANUALI, []);
  const archivioVecchio = leggiJson(ARCHIVIO, []);
  const fonti = { Google: null, TripAdvisor: null };
  let errori = 0;
  for (const [nome, fn] of [['Google', scaricaGoogle], ['TripAdvisor', scaricaTripadvisor]]) {
    try {
      fonti[nome] = await fn();
      console.log(fonti[nome] ? `✅ ${nome}: ${fonti[nome].items.length} recensioni scaricate (punteggio ${fonti[nome].punteggio})` : `ℹ️ ${nome}: chiavi non configurate, salto.`);
    } catch (e) { errori++; console.error(`❌ ${e.message}`); }
  }
  const { archivio, items } = unisci(fonti, vecchie, manuali, Array.isArray(archivioVecchio) ? archivioVecchio : []);
  const punteggi = {};
  for (const nome of ['Google', 'TripAdvisor']) {
    const f = fonti[nome] || (vecchie.punteggi && vecchie.punteggi[nome]);
    if (f && f.punteggio) punteggi[nome] = { punteggio: f.punteggio, totale: f.totale };
  }
  const out = { aggiornato: new Date().toISOString(), punteggi, items };
  console.log(`📝 Recensioni positive da pubblicare: ${items.length} (archivio: ${archivio.length})`);
  if (PROVA) { console.log(JSON.stringify(out, null, 2)); return; }
  // Mai svuotare il sito: se non c'è niente di nuovo né di vecchio, non scrivo.
  if (!items.length) { console.log('ℹ️ Nessuna recensione disponibile: lascio il file com\'è.'); return; }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  if (errori) process.exitCode = 0; // un errore di una piattaforma non deve rompere il run
}

if (require.main === module) main();
module.exports = { normalizzaGoogle, normalizzaTripadvisor, unisci, unisciArchivio, ordinaETaglia };
