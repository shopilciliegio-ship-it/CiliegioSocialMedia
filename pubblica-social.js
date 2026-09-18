// pubblica-social.js
//
// Pubblica su Facebook + Instagram il reminder del lunedì, leggendo piano.json da Dropbox.
// Eseguito dalla GitHub Action .github/workflows/pubblica-lunedi.yml (cron ogni lunedì 9:00
// Europe/Rome, oppure a mano con "Run workflow").
//
// Flusso:
//  1. Legge piano.json da Dropbox (stesso file che CiliegioSocialMedia.html salva/carica).
//  2. Trova l'override del reminder del lunedì corrente (id "r_YYYY-MM-DD_reminder").
//  3. Se non è "approvato" (Luca non ha ancora cliccato "Approva questa settimana"), non fa nulla.
//  4. Facebook: pubblica la foto pulita (photoFile) + fbText.
//  5. Instagram: pubblica la grafica con overlay (graphicFile, generata e salvata su Dropbox
//     al momento dell'approvazione — vedi approvaSettimana() in CiliegioSocialMedia.html) + igText.
//     Se manca graphicFile (approvazione fatta prima di questa versione, o generazione fallita),
//     usa la foto pulita anche per IG.
//  6. Segna il post come "published" su piano.json, per evitare di ripubblicare per errore.
//
// Nessuna dipendenza npm: usa fetch/FormData/Blob globali di Node 20+.

const DROPBOX_API        = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT    = 'https://content.dropboxapi.com/2';
const DROPBOX_TOKEN_URL  = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_FILE_PATH  = '/IlCiliegio/SocialMedia/piano.json';
const GRAPH_API           = 'https://graph.facebook.com/v21.0';

// DRY_RUN di default true: bisogna passare esplicitamente 'false' per pubblicare davvero.
// Nel workflow: i run schedulati (cron) lo passano 'false', i run manuali (workflow_dispatch)
// rispettano l'input "dry_run" scelto da chi lancia il test.
const DRY_RUN   = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const FORCE_RUN = String(process.env.FORCE_RUN || 'false').toLowerCase() === 'true';

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`❌ Manca la variabile d'ambiente ${name} (GitHub Secret non configurato?)`); process.exit(1); }
  return v;
}

async function dropboxAccessToken() {
  const appKey = need('DROPBOX_APP_KEY');
  const refreshToken = need('DROPBOX_REFRESH_TOKEN');
  const res = await fetch(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: appKey })
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

async function dropboxDownloadBytes(token, path) {
  const res = await fetch(`${DROPBOX_CONTENT}/files/download`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path }) }
  });
  if (!res.ok) throw new Error(`Download ${path} fallito: HTTP ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

// Link diretto temporaneo (valido poche ore, nessuna auth per scaricarlo): serve perché
// l'endpoint /media di Instagram vuole un image_url pubblico, non un upload di byte.
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

// Lunedì della settimana corrente in Europe/Rome, come 'YYYY-MM-DD' (stesso formato
// usato da CiliegioSocialMedia.html per generare gli id "r_YYYY-MM-DD_reminder").
function currentMondayRome() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(new Date());
  const map = {}; parts.forEach(p => map[p.type] = p.value);
  const dowMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  const dow = dowMap[map.weekday];
  const today = new Date(`${map.year}-${map.month}-${map.day}T00:00:00Z`);
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today.getTime() + diffToMonday * 86400000);
  return monday.toISOString().slice(0, 10);
}

function romeWeekday() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', weekday: 'short' }).format(new Date());
}

function romeHour() {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()), 10);
}

async function fbPublishPhoto(pageId, pageToken, imageBuffer, caption) {
  const form = new FormData();
  form.append('caption', caption);
  form.append('access_token', pageToken);
  form.append('source', new Blob([imageBuffer], { type: 'image/jpeg' }), 'post.jpg');
  const res = await fetch(`${GRAPH_API}/${pageId}/photos`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Facebook publish fallito: ${JSON.stringify(data.error || data)}`);
  return data;
}

async function igPublishFeed(igUserId, igToken, imageUrl, caption) {
  const createRes = await fetch(`${GRAPH_API}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: igToken })
  });
  const created = await createRes.json();
  if (!createRes.ok || created.error) throw new Error(`Instagram media create fallito: ${JSON.stringify(created.error || created)}`);

  const pubRes = await fetch(`${GRAPH_API}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: created.id, access_token: igToken })
  });
  const published = await pubRes.json();
  if (!pubRes.ok || published.error) throw new Error(`Instagram media_publish fallito: ${JSON.stringify(published.error || published)}`);
  return published;
}

async function main() {
  if (!FORCE_RUN) {
    const weekday = romeWeekday();
    if (weekday !== 'Mon') {
      console.log(`ℹ️ Oggi non è lunedì a Europe/Rome (${weekday}) — nessuna azione.`);
      return;
    }
    const hour = romeHour();
    if (hour !== 9) {
      console.log(`ℹ️ Non sono le 9:00 a Europe/Rome (ora attuale: ${hour}) — nessuna azione, aspetto l'orario giusto.`);
      return;
    }
  } else {
    console.log('⚠️ FORCE_RUN attivo: salto il controllo giorno/ora (solo per test manuali).');
  }

  const monday = currentMondayRome();
  const postId = `r_${monday}_reminder`;
  console.log(`📅 Lunedì corrente (Europe/Rome): ${monday} — cerco il post "${postId}"`);

  const dbxToken = await dropboxAccessToken();
  const piano = await dropboxDownloadJson(dbxToken, DROPBOX_FILE_PATH);
  const overrides = piano.recurringOverrides || {};
  const post = overrides[postId];

  if (!post) {
    console.log(`⚠️ Nessun override trovato per "${postId}" — il reminder non è ancora stato aperto/salvato in CSM per questa settimana. Nessuna azione.`);
    return;
  }
  if (post.status === 'published') {
    console.log(`ℹ️ "${postId}" risulta già pubblicato — nessuna azione (evito il doppio post).`);
    return;
  }
  if (post.status !== 'approvato') {
    console.log(`⚠️ "${postId}" non è "approvato" (stato attuale: "${post.status}") — Luca non ha ancora confermato la settimana in CSM. Nessuna azione.`);
    return;
  }
  if (!post.photoFile || !post.fbText || !post.igText) {
    console.error(`❌ "${postId}" è "approvato" ma mancano dati (foto/testo) — serve un controllo manuale in CSM.`);
    process.exitCode = 1;
    return;
  }

  const usaFotoSemplicePerIG = !post.graphicFile;
  console.log(`✅ Post approvato trovato.`);
  console.log(`   Foto FB: ${post.photoFile}`);
  console.log(`   ${usaFotoSemplicePerIG ? `⚠️ Nessuna grafica IG salvata — uso la foto semplice anche per Instagram (${post.photoFile})` : `Grafica IG: ${post.graphicFile}`}`);

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN attivo — nessuna pubblicazione reale su Facebook/Instagram.');
    console.log('--- Testo Facebook ---');
    console.log(post.fbText);
    console.log('--- Testo Instagram ---');
    console.log(post.igText);
    return;
  }

  const fbPageId = need('FB_PAGE_ID');
  const fbToken  = need('FB_PAGE_ACCESS_TOKEN');
  const igUserId = need('IG_USER_ID');
  const igToken  = need('IG_ACCESS_TOKEN');

  console.log('\n📤 Pubblico su Facebook...');
  const fbPhotoBuffer = await dropboxDownloadBytes(dbxToken, post.photoFile);
  const fbResult = await fbPublishPhoto(fbPageId, fbToken, fbPhotoBuffer, post.fbText);
  console.log(`✅ Facebook pubblicato: id ${fbResult.post_id || fbResult.id}`);

  console.log('\n📤 Pubblico su Instagram...');
  const igImagePath = post.graphicFile || post.photoFile;
  const igImageUrl = await dropboxTempLink(dbxToken, igImagePath);
  const igResult = await igPublishFeed(igUserId, igToken, igImageUrl, post.igText);
  console.log(`✅ Instagram pubblicato: media id ${igResult.id}`);

  piano.recurringOverrides = piano.recurringOverrides || {};
  piano.recurringOverrides[postId] = { ...post, status: 'published' };
  piano.lastSaved = new Date().toISOString();
  await dropboxUploadJson(dbxToken, DROPBOX_FILE_PATH, piano);
  console.log('\n💾 piano.json aggiornato su Dropbox (status: published).');
}

main().catch(err => {
  console.error('❌ Errore:', err.message);
  process.exitCode = 1;
});
