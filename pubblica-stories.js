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
// Vengono postate SEMPRE entrambe le immagini (pranzo + cena), tutti i giorni: se il servizio
// è chiuso/al completo, in immagini-sito/ c'è comunque il file generico "AL COMPLETO" (vedi
// Completa-Immagini-Mancanti.ps1 nel repo Ciliegio Menu) — non c'è mai un giorno senza file.
//
// Nessuna dipendenza npm: usa fetch globale di Node 20+.

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const IMG_BASE  = 'https://raw.githubusercontent.com/shopilciliegio-ship-it/Ciliegio-Menu/main/immagini-sito/';

const DRY_RUN   = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const FORCE_RUN = String(process.env.FORCE_RUN || 'false').toLowerCase() === 'true';

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`❌ Manca la variabile d'ambiente ${name} (GitHub Secret non configurato?)`); process.exit(1); }
  return v;
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

function romeWeekday() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', weekday: 'short' }).format(new Date());
}

function romeHour() {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()), 10);
}

function imageUrlFor(num, dayName, servizio) {
  return IMG_BASE + encodeURIComponent(`${num}-${dayName}-${servizio}.jpg`);
}

async function igPublishStory(igUserId, igToken, imageUrl) {
  const createRes = await fetch(`${GRAPH_API}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, media_type: 'STORIES', access_token: igToken })
  });
  const created = await createRes.json();
  if (!createRes.ok || created.error) throw new Error(`IG media create fallito: ${JSON.stringify(created.error || created)}`);

  const pubRes = await fetch(`${GRAPH_API}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: created.id, access_token: igToken })
  });
  const published = await pubRes.json();
  if (!pubRes.ok || published.error) throw new Error(`IG media_publish fallito: ${JSON.stringify(published.error || published)}`);
  return published;
}

async function main() {
  if (!FORCE_RUN) {
    const hour = romeHour();
    if (hour !== 9) {
      console.log(`ℹ️ Non sono le 9:30 a Europe/Rome (ora attuale: ${hour}) — nessuna azione, aspetto l'orario giusto.`);
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

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN attivo — nessuna story pubblicata davvero.');
    return;
  }

  const igUserId = need('IG_USER_ID');
  const igToken  = need('IG_ACCESS_TOKEN');

  let hadError = false;
  for (const [label, url] of [['pranzo', pranzoUrl], ['cena', cenaUrl]]) {
    try {
      console.log(`\n📤 Pubblico story ${label}...`);
      const result = await igPublishStory(igUserId, igToken, url);
      console.log(`✅ Story ${label} pubblicata: media id ${result.id}`);
    } catch (err) {
      hadError = true;
      console.error(`❌ Story ${label} fallita: ${err.message}`);
    }
  }
  if (hadError) process.exitCode = 1;
}

main().catch(err => {
  console.error('❌ Errore:', err.message);
  process.exitCode = 1;
});
