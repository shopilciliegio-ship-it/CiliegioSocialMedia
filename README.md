# 🍒 Il Ciliegio — Social Media Agent

Agente editoriale autonomo per la gestione dei social media (Facebook e Instagram) dell'Azienda Agricola Il Ciliegio di Monteriggioni, Siena.

## Versione attuale: v1.1.0

---

## 🚀 Deploy su GitHub Pages

1. Carica `CiliegioSocialMedia.html` e `README.md` nella root del repo
2. Vai su **Settings → Pages → Branch: main → / (root)** → Save
3. L'app sarà disponibile su: `https://tuousername.github.io/CiliegioSocialMedia/CiliegioSocialMedia.html`

---

## 🔑 Configurazione API Keys

**Non inserire mai le API key direttamente nel codice HTML.**

### GitHub Secrets (consigliato)

Vai su **Settings → Secrets and variables → Actions → New repository secret**

| Nome Secret | Descrizione |
|---|---|
| `ANTHROPIC_API_KEY` | API key Anthropic (`sk-ant-...`) |
| `GOOGLE_SHEETS_API_KEY` | API key Google Sheets (`AIza...`) |

### Metodo alternativo: impostazioni in-app

Inserisci le API key dalla sezione **Impostazioni** dell'app — vengono salvate nel `localStorage` del browser, su ogni dispositivo la prima volta.

---

## 📊 Google Sheets — Setup

Il piano editoriale viene sincronizzato su Google Sheets (foglio `CiliegioSocialMedia`).

### 1. Prepara il foglio

Apri il foglio Google: https://docs.google.com/spreadsheets/d/1LNLG-bft89Bf3LnZstj_-7YCXIEE_TfdJa9oRFbn8ck

Crea **due schede** nel foglio:
- `Piano` — conterrà il piano editoriale
- `Impostazioni` — conterrà le impostazioni dell'app

### 2. Abilita Sheets API su Google Cloud

1. Vai su [console.cloud.google.com](https://console.cloud.google.com)
2. Crea progetto `CiliegioPR`
3. **APIs & Services → Library** → cerca **Google Sheets API** → Abilita
4. **APIs & Services → Credentials → + Create Credentials → API Key**
5. Copia la chiave (`AIza...`)
6. (Opzionale ma consigliato) Clicca sulla chiave → **API restrictions** → limita a "Google Sheets API"

### 3. Configura nell'app

1. Vai su **Impostazioni → Google Sheets**
2. Incolla la `AIza...` key
3. L'ID foglio è già preimpostato: `1LNLG-bft89Bf3LnZstj_-7YCXIEE_TfdJa9oRFbn8ck`
4. Clicca **Salva** poi **Inizializza foglio** (solo la prima volta)

Da quel momento:
- Ogni modifica ai post viene salvata automaticamente su Sheets
- Puoi caricare il piano da qualsiasi PC con **☁️ Carica da Sheets**
- Puoi modificare il piano direttamente nel foglio Google e ricaricare nell'app

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

Ogni release viene registrata nell'array `VERSIONS` in cima al file JS. Le versioni archiviate non vengono mai eliminate — visibili cliccando il badge versione nella sidebar.

### Come rilasciare una nuova versione

1. Apporta le modifiche al file
2. Aggiungi in cima all'array `VERSIONS`:
```javascript
{
  version: '1.2.0',
  date: '2025-XX-XX',
  current: true,
  description: 'Descrizione delle modifiche...'
},
```
3. Cambia `current: false` sulla versione precedente
4. Aggiorna il commento `<!-- VERSION MANIFEST -->` in cima al file
5. Copia la versione vecchia in `archive/CiliegioSocialMedia_v1.1.0.html`
6. Commit e push

---

## 🏗️ Struttura del progetto

```
CiliegioSocialMedia/
├── CiliegioSocialMedia.html   ← App principale
├── README.md                  ← Questo file
└── archive/                   ← Versioni precedenti
    └── CiliegioSocialMedia_v1.0.0.html
```

---

## 📞 Contatti azienda

- **Sito:** www.ilciliegio.com
- **Ristorante/Agriturismo:** agriturismo@ilciliegio.com | +39 329 1767348
- **Shop online:** shop@ilciliegio.com | +39 331 1347899
- **Vendita diretta:** info@ilciliegio.com | +39 335 7655171

---

*Sviluppato con Claude — Anthropic | v1.1.0*
