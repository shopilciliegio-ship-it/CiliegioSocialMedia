// aggiorna-recensioni.js
//
// Scarica le ultime recensioni POSITIVE (4-5 stelle) da Google e TripAdvisor e le scrive in
// recensioni/recensioni.json, che la home del sito nuovo legge (assets/js/reviews.js) e mostra a scorrimento.
// Gira nella GitHub Action .github/workflows/aggiorna-recensioni.yml (ogni giorno + a mano).
//
// Segreti/variabili richiesti (una piattaforma senza chiave viene saltata, senza errori):
//   GOOGLE_PLACES_API_KEY (+ GOOGLE_PLACE_ID facoltativo: se manca lo ricava dal CID) -> Google (Places API "New": max 5 recensioni)
//   TRIPADVISOR_API_KEY   + TRIPADVISOR_LOCATION_ID -> TripAdvisor (Content API: max 5 recensioni)
// TheFork non ha un'API pubblica per le recensioni: si possono aggiungere a mano in recensioni/manuali.json
//   [{ "fonte": "TheFork", "autore": "Nome", "stelle": 5, "testo": "...", "data": "2026-11-20", "link": "https://..." }]
//
// Regole: solo 4 e 5 stelle, ordine dal più recente, massimo MAX_ITEMS. Se una piattaforma non risponde si
// tengono le sue recensioni già salvate (il sito non si svuota mai). Nessuna dipendenza npm (Node 20+).
//
// Uso: node aggiorna-recensioni.js           (scrive il file)
//      node aggiorna-recensioni.js --prova   (stampa soltanto, non scrive)

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'recensioni');
const OUT = path.join(DIR, 'recensioni.json');
const MANUALI = path.join(DIR, 'manuali.json');
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

// ---- TripAdvisor (Content API) ----
function normalizzaTripadvisor(reviewsJson, detailsJson) {
  const items = ((reviewsJson && reviewsJson.data) || []).map(r => ({
    fonte: 'TripAdvisor',
    autore: (r.user && (r.user.username || r.user.name)) || 'Ospite',
    stelle: r.rating,
    testo: taglia(r.text || r.title || ''),
    data: r.published_date || null,
    link: r.url || null,
  }));
  return {
    punteggio: detailsJson && detailsJson.rating ? Number(detailsJson.rating) : null,
    totale: detailsJson && detailsJson.num_reviews ? Number(detailsJson.num_reviews) : null,
    items,
  };
}

async function scaricaTripadvisor() {
  const key = env('TRIPADVISOR_API_KEY'), id = env('TRIPADVISOR_LOCATION_ID');
  if (!key || !id) return null;
  const base = `https://api.content.tripadvisor.com/api/v1/location/${encodeURIComponent(id)}`;
  const opts = { headers: { accept: 'application/json' } };
  const [r1, r2] = await Promise.all([
    fetch(`${base}/reviews?key=${encodeURIComponent(key)}&language=it`, opts),
    fetch(`${base}/details?key=${encodeURIComponent(key)}&language=it`, opts),
  ]);
  const reviews = await r1.json();
  if (!r1.ok) throw new Error(`TripAdvisor: ${r1.status} ${JSON.stringify(reviews).slice(0, 300)}`);
  const details = r2.ok ? await r2.json() : null;
  return normalizzaTripadvisor(reviews, details);
}

// ---- unione, filtro, ordine ----
function unisci(fonti, vecchie, manuali) {
  let items = [];
  for (const nome of ['Google', 'TripAdvisor']) {
    const f = fonti[nome];
    if (f) items = items.concat(f.items);
    else items = items.concat((vecchie.items || []).filter(i => i.fonte === nome)); // piattaforma ferma: tengo le vecchie
  }
  items = items.concat(manuali);
  items = items
    .filter(i => i && i.testo && Number(i.stelle) >= MIN_STELLE)
    .map(i => ({ ...i, _t: i.data ? Date.parse(i.data) || 0 : 0 }))
    .sort((a, b) => b._t - a._t)
    .slice(0, MAX_ITEMS)
    .map(({ _t, ...i }) => i);
  return items;
}

function leggiJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; }
}

async function main() {
  const vecchie = leggiJson(OUT, {});
  const manuali = leggiJson(MANUALI, []);
  const fonti = { Google: null, TripAdvisor: null };
  let errori = 0;
  for (const [nome, fn] of [['Google', scaricaGoogle], ['TripAdvisor', scaricaTripadvisor]]) {
    try {
      fonti[nome] = await fn();
      console.log(fonti[nome] ? `✅ ${nome}: ${fonti[nome].items.length} recensioni scaricate (punteggio ${fonti[nome].punteggio})` : `ℹ️ ${nome}: chiavi non configurate, salto.`);
    } catch (e) { errori++; console.error(`❌ ${e.message}`); }
  }
  const items = unisci(fonti, vecchie, manuali);
  const punteggi = {};
  for (const nome of ['Google', 'TripAdvisor']) {
    const f = fonti[nome] || (vecchie.punteggi && vecchie.punteggi[nome]);
    if (f && f.punteggio) punteggi[nome] = { punteggio: f.punteggio, totale: f.totale };
  }
  const out = { aggiornato: new Date().toISOString(), punteggi, items };
  console.log(`📝 Recensioni positive da pubblicare: ${items.length}`);
  if (PROVA) { console.log(JSON.stringify(out, null, 2)); return; }
  // Mai svuotare il sito: se non c'è niente di nuovo né di vecchio, non scrivo.
  if (!items.length) { console.log('ℹ️ Nessuna recensione disponibile: lascio il file com\'è.'); return; }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  if (errori) process.exitCode = 0; // un errore di una piattaforma non deve rompere il run
}

if (require.main === module) main();
module.exports = { normalizzaGoogle, normalizzaTripadvisor, unisci };
