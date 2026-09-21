// rinnova-token-ig.js
//
// Rinnova il token Instagram Login (60 giorni) e lo salva su Dropbox. Eseguito ogni settimana dalla
// GitHub Action .github/workflows/rinnova-token-ig.yml, oppure a mano con "Run workflow".
// Dettagli e logica di scelta del token in ig-token.js.
//
// Se fallisce esce con codice 1 (run rosso → mail da GitHub): il token attuale resta valido fino alla
// sua scadenza, quindi c'è tempo per intervenire.

const { refreshIgToken } = require('./ig-token');

const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

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

async function main() {
  const envToken = need('IG_ACCESS_TOKEN');
  const dbxToken = await dropboxAccessToken();
  const r = await refreshIgToken(dbxToken, envToken);
  if (r.skipped) {
    console.log(`ℹ️ ${r.reason}`);
    return;
  }
  console.log(`✅ Token Instagram rinnovato e salvato su Dropbox.`);
  console.log(`   Scade il ${r.expiresAt} (tra ${r.days} giorni).`);
}

main().catch(err => {
  console.error('❌ Errore:', err.message);
  console.error('   Se dice che il token è troppo recente: Meta rinnova solo token emessi da almeno 24 ore, riprovare domani.');
  console.error('   Se dice che è scaduto o non valido: generare un token nuovo in Meta e aggiornare il secret IG_ACCESS_TOKEN.');
  process.exitCode = 1;
});
