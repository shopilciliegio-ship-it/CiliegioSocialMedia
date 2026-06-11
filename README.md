# 🍒 Il Ciliegio — Social Media Agent

Agente editoriale autonomo per la gestione dei social media (Facebook e Instagram) dell'Azienda Agricola Il Ciliegio di Monteriggioni, Siena.

## Versione attuale: v1.2.0

---

## 🚀 Deploy su GitHub Pages

1. Carica `CiliegioSocialMedia.html` e `README.md` nella root del repo
2. Vai su **Settings → Pages → Branch: main → / (root)** → Save
3. L'app sarà disponibile su: `https://tuousername.github.io/CiliegioSocialMedia/CiliegioSocialMedia.html`

---

## 🔑 Configurazione API Keys

**Non inserire mai le API key direttamente nel codice HTML.**

### GitHub Secrets

Vai su **Settings → Secrets and variables → Actions → New repository secret**

| Nome Secret | Descrizione |
|---|---|
| `ANTHROPIC_API_KEY` | API key Anthropic (`sk-ant-...`) |
| `DROPBOX_ACCESS_TOKEN` | Token Dropbox (generato su dropbox.com/developers) |

### Metodo alternativo: impostazioni in-app

Inserisci le chiavi dalla sezione **Impostazioni** dell'app — vengono salvate nel `localStorage` del browser. Su ogni nuovo dispositivo le inserisci una volta sola.

---

## 📦 Dropbox — Sincronizzazione piano editoriale

Il piano editoriale viene salvato come file JSON su Dropbox:
```
/IlCiliegio/SocialMedia/piano.json
```
La cartella viene creata automaticamente al primo salvataggio.

### Setup Dropbox (5 minuti)

1. Vai su [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)
2. **Create app** → Scoped access → Full Dropbox
3. Nome: `CiliegioPR`
4. Tab **Settings → OAuth 2 → Generated access token** → clicca **Generate**
5. Copia il token e salvalo come GitHub Secret `DROPBOX_ACCESS_TOKEN`
6. Nell'app: **Impostazioni → Dropbox** → incolla il token → **Salva**
7. Clicca **☁️ Salva su Dropbox** per il primo salvataggio

Da quel momento ogni modifica viene salvata automaticamente su Dropbox e puoi caricare il piano da qualsiasi dispositivo con **⬇️ Carica da Dropbox**.

---

## 📤 Integrazione Meta API (Facebook & Instagram)

Per pubblicare e schedulare direttamente su FB e IG:

1. Vai su [developers.facebook.com](https://developers.facebook.com)
2. Crea una app di tipo **Business**
3. Aggiungi **Facebook Login** e **Instagram Graph API**
4. Genera un **Page Access Token** con i permessi:
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `instagram_content_publish`
   - `instagram_basic`
5. Inserisci il token in **Impostazioni → Meta**

---

## 📋 Sistema di versioning

Ogni release viene registrata nell'array `VERSIONS` nel file JS. Visibili cliccando il badge versione nella sidebar.

### Come rilasciare una nuova versione

1. Apporta le modifiche
2. Aggiungi in cima all'array `VERSIONS`:
```javascript
{
  version: '1.3.0',
  date: '2025-XX-XX',
  current: true,
  description: 'Descrizione modifiche...'
},
```
3. Cambia `current: false` sulla versione precedente
4. Aggiorna il commento `<!-- VERSION MANIFEST -->` in cima al file
5. Copia la versione vecchia in `archive/CiliegioSocialMedia_v1.2.0.html`
6. Commit e push

---

## 🏗️ Struttura del progetto

```
CiliegioSocialMedia/
├── CiliegioSocialMedia.html   ← App principale
├── README.md                  ← Questo file
└── archive/                   ← Versioni precedenti
    ├── CiliegioSocialMedia_v1.0.0.html
    └── CiliegioSocialMedia_v1.1.0.html
```

---

## 📞 Contatti azienda

- **Sito:** www.ilciliegio.com
- **Ristorante/Agriturismo:** agriturismo@ilciliegio.com | +39 329 1767348
- **Shop online:** shop@ilciliegio.com | +39 331 1347899
- **Vendita diretta:** info@ilciliegio.com | +39 335 7655171

---

*Sviluppato con Claude — Anthropic | v1.2.0*
