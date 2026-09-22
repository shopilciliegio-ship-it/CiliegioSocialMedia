// worker.js — timer esterno (Cloudflare Worker) per i workflow social.
//
// Perché esiste: il cron di GitHub Actions parte con ore di ritardo (19-21/9/2026: run alle 14-15 invece che
// alle 9:30). Un "Run workflow" (workflow_dispatch) invece parte subito. Questo Worker, che Cloudflare
// esegue puntuale, lancia il workflow giusto all'ora giusta (Europe/Rome).
//
// Un solo cron trigger: "0,30 7,8,9 * * *" (UTC — va impostato così nel pannello Cloudflare, Triggers).
// Copre ora legale e solare; il Worker guarda l'ora vera di Roma e lancia solo se è il momento giusto:
//   - lunedì  9:00 Roma → pubblica-lunedi.yml           (post FB + IG del reminder)
//   - ogni giorno 9:30 Roma → pubblica-stories.yml      (stories pranzo + cena)
//   - ogni giorno 10:30 Roma → verifica-pubblicazione.yml (email di controllo a Luca)
// Gli orari UTC dell'altra stagione (e i due slot 11:00/11:30 Roma che esistono solo d'estate) vengono ignorati.
//
// I workflow hanno comunque la finestra 9:00–11:00 e il controllo anti doppio invio: se questo timer e il cron
// di riserva di GitHub partono entrambi, non si pubblica due volte.
//
// Segreti (Worker → Settings → Variables and Secrets, tipo "Secret"):
//   GITHUB_TOKEN  token fine-grained GitHub, solo repo CiliegioSocialMedia, permesso Actions: Read and write
//   TEST_KEY      una stringa a caso, serve solo per la pagina di prova /test/<TEST_KEY>/<lunedi|stories>
// Pagina /status: dice se il Worker è attivo e se i due segreti gli sono arrivati (mai i valori).

// Un secret incollato nel pannello può portarsi dietro spazi o a-capo: qui vengono ignorati.
const segreto = v => (typeof v === 'string' ? v.trim() : '');

const OWNER = 'shopilciliegio-ship-it';
const REPO  = 'CiliegioSocialMedia';
const BRANCH = 'main';

// Quando parte ciascun job, in ora di Roma. slot = 0 (allo scoccare dell'ora) o 30 (e mezza).
// Ogni job dichiara i propri input di workflow_dispatch: GitHub rifiuta (422) input non definiti
// nel workflow, quindi non si può mandare "dry_run" a verifica-pubblicazione.yml, che non ce l'ha
// (ha "send_email" al suo posto — vedi verifica-pubblicazione.js).
const JOBS = {
  lunedi:   { workflow: 'pubblica-lunedi.yml',        quando: r => r.weekday === 'Mon' && r.hour === 9  && r.slot === 0,
              inputs: o => ({ dry_run: String(o.dry), force: String(o.force) }) },
  stories:  { workflow: 'pubblica-stories.yml',       quando: r => r.hour === 9  && r.slot === 30,
              inputs: o => ({ dry_run: String(o.dry), force: String(o.force) }) },
  verifica: { workflow: 'verifica-pubblicazione.yml', quando: r => r.hour === 10 && r.slot === 30,
              inputs: o => ({ send_email: String(!o.dry), force: String(o.force) }) },
};

function romeNow(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(date).map(p => [p.type, p.value])
  );
  const minute = parseInt(parts.minute, 10);
  return { weekday: parts.weekday, hour: parseInt(parts.hour, 10) % 24, minute, slot: minute < 15 ? 0 : (minute < 45 ? 30 : 60) };
}

// Lancia il workflow. Errori nostri (token, permessi, nome file) → subito eccezione; errori di GitHub (5xx, 429) → 3 tentativi.
async function dispatch(env, job, { dry = false, force = false } = {}) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${JOBS[job].workflow}/dispatches`;
  const body = JSON.stringify({ ref: BRANCH, inputs: JOBS[job].inputs({ dry, force }) });
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${segreto(env.GITHUB_TOKEN)}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ciliegio-timer',
        'Content-Type': 'application/json'
      },
      body
    });
    if (res.status === 204) return `OK: lanciato ${JOBS[job].workflow} (dry_run=${dry}, force=${force}), tentativo ${tentativo}`;
    const testo = (await res.text()).slice(0, 300);
    if (res.status < 500 && res.status !== 429) throw new Error(`GitHub ha risposto ${res.status} per ${JOBS[job].workflow}: ${testo}`);
    await new Promise(r => setTimeout(r, 2000 * tentativo));
  }
  throw new Error(`GitHub non raggiungibile per ${JOBS[job].workflow} dopo 3 tentativi`);
}

export default {
  // Chiamato da Cloudflare secondo il cron trigger.
  async scheduled(event, env) {
    const r = romeNow(new Date(event.scheduledTime));
    const lanciati = Object.keys(JOBS).filter(j => JOBS[j].quando(r));
    if (!lanciati.length) {
      console.log(`Niente da lanciare: a Roma sono ${r.weekday} ${r.hour}:${String(r.minute).padStart(2, '0')} (orario dell'altra stagione, ignorato).`);
      return;
    }
    for (const j of lanciati) console.log(await dispatch(env, j));   // se lancia eccezione l'esecuzione risulta fallita nei log di Cloudflare
  },

  // Pagina di prova: /test/<TEST_KEY>/<lunedi|stories>  → lancia il workflow in modalità TEST (dry_run + force:
  // logga cosa farebbe, non pubblica nulla). Con una chiave sbagliata risponde 404.
  async fetch(request, env) {
    const [, sezione, chiave, job] = new URL(request.url).pathname.split('/');
    if (sezione === 'status') {
      const r = romeNow(new Date());
      return new Response([
        'Worker attivo.',
        `GITHUB_TOKEN: ${segreto(env.GITHUB_TOKEN) ? 'impostato' : 'MANCANTE'}`,
        `TEST_KEY: ${segreto(env.TEST_KEY) ? 'impostata' : 'MANCANTE'}`,
        `Ora a Roma: ${r.weekday} ${r.hour}:${String(r.minute).padStart(2, '0')}`,
        `Job disponibili: ${Object.keys(JOBS).join(', ')}`
      ].join('\n') + '\n');
    }
    if (sezione !== 'test' || !segreto(env.TEST_KEY) || chiave !== segreto(env.TEST_KEY) || !JOBS[job]) return new Response('Not found', { status: 404 });
    try {
      return new Response(await dispatch(env, job, { dry: true, force: true }) + '\n');
    } catch (err) {
      return new Response(`ERRORE: ${err.message}\n`, { status: 502 });
    }
  }
};
