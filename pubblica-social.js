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
//  6. Registra l'esito di OGNI piattaforma in post-log.json (Dropbox): se FB esce e IG fallisce, il run
//     successivo (cron di riserva o manuale) rifà solo IG, senza ripubblicare FB. Quando entrambe sono
//     uscite segna il post come "published" su piano.json.
//
// Nessuna dipendenza npm: usa fetch/FormData/Blob globali di Node 20+.

const DROPBOX_API        = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT    = 'https://content.dropboxapi.com/2';
const DROPBOX_TOKEN_URL  = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_FILE_PATH  = '/IlCiliegio/SocialMedia/piano.json';
// Esito per piattaforma dei post del lunedì, scritto SOLO da questa Action. File separato da piano.json
// apposta: CSM salva piano.json per intero con un elenco fisso di campi e scarterebbe i campi sconosciuti.
const DROPBOX_LOG_PATH   = '/IlCiliegio/SocialMedia/post-log.json';
const GRAPH_API           = 'https://graph.facebook.com/v21.0';

// DRY_RUN di default true: bisogna passare esplicitamente 'false' per pubblicare davvero.
// Nel workflow: i run schedulati (cron) lo passano 'false', i run manuali (workflow_dispatch)
// rispettano l'input "dry_run" scelto da chi lancia il test.
const DRY_RUN   = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const FORCE_RUN = String(process.env.FORCE_RUN || 'false').toLowerCase() === 'true';
// Solo per recuperi manuali: "Facebook è già uscito (a mano o in un run finito male), non rifarlo".
const FB_GIA_PUBBLICATO = String(process.env.FB_GIA_PUBBLICATO || 'false').toLowerCase() === 'true';

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
// Diagnostica non sensibile: lunghezza e prime 3 lettere (EAA / IGA), per capire di che token si tratta.
function describeToken(token) {
  return `lunghezza ${token.length}, inizia con "${token.slice(0, 3)}"`;
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

// Diagnostica: a quale account Dropbox appartiene questo token (utile per capire se il
// secret è collegato all'account giusto quando un path risulta "not_found" a sorpresa).
async function dropboxAccountEmail(token) {
  try {
    const res = await fetch(`${DROPBOX_API}/users/get_current_account`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return res.ok ? data.email : `(errore: ${JSON.stringify(data)})`;
  } catch (err) {
    return `(errore: ${err.message})`;
  }
}

// Diagnostica: elenca il contenuto di una cartella (path vuota = radice) vista da questo
// token, per capire se il nome esatto di una sottocartella/file combacia con quello atteso.
async function dropboxListFolder(token, path) {
  try {
    const res = await fetch(`${DROPBOX_API}/files/list_folder`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!res.ok) return `(errore: ${JSON.stringify(data)})`;
    return data.entries.map(e => `${e['.tag']}:${e.path_display}`).join(', ') || '(vuota)';
  } catch (err) {
    return `(errore: ${err.message})`;
  }
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

async function igPublishFeed(igUserId, igToken, imageUrl, caption) {
  const api = igGraphApi(igToken);
  const createRes = await fetch(`${api}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: igToken })
  });
  const created = await createRes.json();
  if (!createRes.ok || created.error) throw new Error(`Instagram media create fallito: ${JSON.stringify(created.error || created)}`);

  return igPublishContainer(api, igUserId, igToken, created.id);
}

async function main() {
  if (!FORCE_RUN) {
    const weekday = romeWeekday();
    if (weekday !== 'Mon') {
      console.log(`ℹ️ Oggi non è lunedì a Europe/Rome (${weekday}) — nessuna azione.`);
      return;
    }
    // Finestra 9:00–10:59 (non "esattamente le 9"): il trigger è un timer esterno preciso, ma se parte
    // con qualche minuto di scarto, o interviene il cron GitHub di riserva, deve comunque pubblicare la
    // mattina. Dopo le 11 no: un post del lunedì che esce nel pomeriggio non serve. Niente doppio post:
    // sotto c'è il controllo status === 'published'.
    const hour = romeHour();
    if (hour < 9 || hour >= 11) {
      console.log(`ℹ️ Fuori dalla finestra 9:00–11:00 a Europe/Rome (ora attuale: ${hour}) — nessuna azione.`);
      return;
    }
  } else {
    console.log('⚠️ FORCE_RUN attivo: salto il controllo giorno/ora (solo per test manuali).');
  }

  const monday = currentMondayRome();
  console.log(`📅 Lunedì corrente (Europe/Rome): ${monday} — cerco il reminder della settimana`);

  const dbxToken = await dropboxAccessToken();
  console.log(`🔑 Account Dropbox autenticato: ${await dropboxAccountEmail(dbxToken)}`);
  console.log(`📂 Radice Dropbox: ${await dropboxListFolder(dbxToken, '')}`);
  console.log(`📂 Dentro /IlCiliegio: ${await dropboxListFolder(dbxToken, '/IlCiliegio')}`);
  console.log(`📂 Dentro /IlCiliegio/SocialMedia: ${await dropboxListFolder(dbxToken, '/IlCiliegio/SocialMedia')}`);

  const piano = await dropboxDownloadJson(dbxToken, DROPBOX_FILE_PATH);
  const overrides = piano.recurringOverrides || {};
  const postId = pickReminderId(overrides, monday);
  console.log(`🔎 Reminder trovato con id "${postId}"`);
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

  // Cosa è già uscito? (post-log.json). Una piattaforma con esito ok non si rifà mai; una con errore si ritenta.
  const logIniziale = (await dropboxDownloadJsonOrNull(dbxToken, DROPBOX_LOG_PATH)) || {};
  const gia = (logIniziale.posts || {})[postId] || {};
  let fbFatto = !!(gia.fb && gia.fb.ok);
  const igFatto = !!(gia.ig && gia.ig.ok);
  console.log(`📋 Stato registrato: Facebook ${fbFatto ? `già pubblicato (${gia.fb.at})` : 'da pubblicare'} · Instagram ${igFatto ? `già pubblicato (${gia.ig.at})` : 'da pubblicare'}`);

  if (FB_GIA_PUBBLICATO && !fbFatto) {
    if (DRY_RUN) {
      console.log('🧪 DRY RUN: con "fb_gia_pubblicato" segnerei Facebook come già pubblicato.');
    } else {
      await segnaEsito(dbxToken, postId, 'fb', { ok: true, id: 'manuale', at: new Date().toISOString() });
      console.log('📝 Facebook segnato come già pubblicato (input manuale): non lo rifaccio.');
    }
    fbFatto = true;
  }

  if (fbFatto && igFatto) {
    console.log('ℹ️ Entrambe le piattaforme risultano già pubblicate: allineo solo piano.json.');
    if (!DRY_RUN) await segnaPubblicatoSuPiano(dbxToken, postId, post);
    return;
  }

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN attivo — nessuna pubblicazione reale su Facebook/Instagram.');
    if (!fbFatto) { console.log('--- Testo Facebook (da pubblicare) ---'); console.log(post.fbText); }
    if (!igFatto) { console.log('--- Testo Instagram (da pubblicare) ---'); console.log(post.igText); }
    return;
  }

  const fbPageId = fbFatto ? null : need('FB_PAGE_ID');
  const fbToken  = fbFatto ? null : need('FB_PAGE_ACCESS_TOKEN');
  const igUserId = igFatto ? null : need('IG_USER_ID');
  const igToken  = igFatto ? null : need('IG_ACCESS_TOKEN');

  // Le due piattaforme sono indipendenti: se una fallisce l'altra si prova comunque.
  let errori = 0;

  if (!fbFatto) {
    try {
      console.log('\n📤 Pubblico su Facebook...');
      const fbPhotoBuffer = await dropboxDownloadBytes(dbxToken, post.photoFile);
      const fbResult = await fbPublishPhoto(fbPageId, fbToken, fbPhotoBuffer, post.fbText);
      const fbId = fbResult.post_id || fbResult.id;
      console.log(`✅ Facebook pubblicato: id ${fbId}`);
      await registraEsito(dbxToken, postId, 'fb', { ok: true, id: fbId, at: new Date().toISOString() }, 'Facebook');
    } catch (err) {
      errori++;
      console.error(`❌ Facebook fallito: ${err.message}`);
      await registraEsito(dbxToken, postId, 'fb', { ok: false, error: String(err.message).slice(0, 300), at: new Date().toISOString() }, 'Facebook');
    }
  }

  if (!igFatto) {
    try {
      console.log('\n📤 Pubblico su Instagram...');
      console.log(`   Token IG: ${describeToken(igToken)} — dominio ${igGraphApi(igToken)}`);
      const igImagePath = post.graphicFile || post.photoFile;
      const igImageUrl = await dropboxTempLink(dbxToken, igImagePath);
      const igResult = await igPublishFeed(igUserId, igToken, igImageUrl, post.igText);
      console.log(`✅ Instagram pubblicato: media id ${igResult.id}`);
      await registraEsito(dbxToken, postId, 'ig', { ok: true, id: igResult.id, at: new Date().toISOString() }, 'Instagram');
    } catch (err) {
      errori++;
      console.error(`❌ Instagram fallito: ${err.message}`);
      await registraEsito(dbxToken, postId, 'ig', { ok: false, error: String(err.message).slice(0, 300), at: new Date().toISOString() }, 'Instagram');
    }
  }

  if (errori) {
    console.error(`\n⚠️ Pubblicazione incompleta (${errori} piattaforma/e con errore). Il post resta "approvato" e il prossimo run rifà SOLO quella mancante.`);
    process.exitCode = 1;
    return;
  }
  await segnaPubblicatoSuPiano(dbxToken, postId, post);
}

// Scrive l'esito di una piattaforma in post-log.json. Rilegge il file ogni volta (nessuno stato in memoria).
async function segnaEsito(dbxToken, postId, piattaforma, esito) {
  const log = (await dropboxDownloadJsonOrNull(dbxToken, DROPBOX_LOG_PATH)) || {};
  log.posts = log.posts || {};
  log.posts[postId] = { ...(log.posts[postId] || {}), [piattaforma]: esito };
  log.lastUpdated = new Date().toISOString();
  await dropboxUploadJson(dbxToken, DROPBOX_LOG_PATH, log);
}

// Come segnaEsito, ma non lancia: il post è già uscito, un errore di scrittura del registro non deve
// far fallire il run. Va però gridato, perché un run successivo ripubblicherebbe quella piattaforma.
async function registraEsito(dbxToken, postId, piattaforma, esito, nome) {
  try {
    await segnaEsito(dbxToken, postId, piattaforma, esito);
  } catch (err) {
    const avviso = esito.ok ? ` ${nome} è uscito ma un nuovo run lo ripubblicherebbe: se serve, lanciare a mano con "fb_gia_pubblicato".` : '';
    console.error(`⚠️⚠️ ATTENZIONE: esito ${nome} NON registrato su Dropbox (${err.message}).${avviso}`);
  }
}

// Quando FB e IG sono entrambi usciti: status "published" su piano.json (per CSM e per il controllo
// anti doppio post). Rilegge piano.json prima di scrivere, per non sovrascrivere modifiche fatte da CSM nel frattempo.
async function segnaPubblicatoSuPiano(dbxToken, postId, post) {
  const piano = await dropboxDownloadJson(dbxToken, DROPBOX_FILE_PATH);
  piano.recurringOverrides = piano.recurringOverrides || {};
  piano.recurringOverrides[postId] = { ...(piano.recurringOverrides[postId] || post), status: 'published' };
  piano.lastSaved = new Date().toISOString();
  await dropboxUploadJson(dbxToken, DROPBOX_FILE_PATH, piano);
  console.log('\n💾 piano.json aggiornato su Dropbox (status: published).');
}

main().catch(err => {
  console.error('❌ Errore:', err.message);
  process.exitCode = 1;
});
