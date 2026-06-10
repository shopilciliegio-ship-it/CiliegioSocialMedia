# 🍒 Il Ciliegio — Social PR Agent

Agente editoriale autonomo per la gestione dei social media (Facebook e Instagram) dell'Azienda Agricola Il Ciliegio di Monteriggioni, Siena.

## Versione attuale: v1.0.0

---

## 🚀 Deploy su GitHub Pages

1. Crea un repository su GitHub (es. `ciliegio-social-agent`)
2. Carica `CiliegioPR.html` nella root del repo
3. Vai su **Settings → Pages → Branch: main → / (root)** → Save
4. L'app sarà disponibile su: `https://tuousername.github.io/ciliegio-social-agent/CiliegioPR.html`

---

## 🔑 Configurazione API Key Anthropic

**Non inserire mai la API key direttamente nel codice HTML.**

### Metodo consigliato: GitHub Secrets + GitHub Actions

Se vuoi che la chiave venga iniettata al build:

1. Vai su **Settings → Secrets and variables → Actions → New repository secret**
2. Nome: `ANTHROPIC_API_KEY`
3. Valore: la tua chiave `sk-ant-...`

### Metodo semplice: impostazioni in-app

Per uso personale, inserisci la API key direttamente dalla sezione **Impostazioni** dell'app. Viene salvata nel `localStorage` del browser — non nel codice.

> ⚠️ Il localStorage è specifico per ogni browser/dispositivo. Per usare la stessa chiave su più PC, inseriscila nelle impostazioni su ogni browser la prima volta.

---

## 🗄️ Google Drive (sincronizzazione piano editoriale)

Per sincronizzare il piano editoriale su tutti i dispositivi tramite Google Drive:

1. Vai su [Google Cloud Console](https://console.cloud.google.com)
2. Crea un nuovo progetto (es. `ciliegio-social`)
3. Abilita **Google Drive API**
4. Crea credenziali **OAuth 2.0** (tipo: Web application)
5. Aggiungi l'URL di GitHub Pages agli **Authorized redirect URIs**
6. Inserisci il **Client ID** e la **Folder ID** nella sezione Impostazioni dell'app

> Guida dettagliata in arrivo con v1.1.0

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
5. Inserisci il token nella sezione **Impostazioni → Meta** dell'app

---

## 📋 Sistema di versioning

Ogni release viene registrata nel blocco `VERSIONS` in cima al file `CiliegioPR.html`. Le versioni archiviate non vengono mai eliminate — sono visibili cliccando il badge versione nella sidebar.

### Come rilasciare una nuova versione

1. Apporta le modifiche al file
2. Aggiungi in cima all'array `VERSIONS` nel JS:
```javascript
{
  version: '1.1.0',
  date: '2025-XX-XX',
  current: true,
  description: 'Descrizione delle modifiche...'
},
```
3. Cambia il campo `current: false` sulla versione precedente
4. Aggiorna il commento `<!-- VERSION MANIFEST -->` in cima al file
5. Commit e push su GitHub

---

## 🏗️ Struttura del progetto

```
ciliegio-social-agent/
├── CiliegioPR.html      ← App principale (tutto in un file)
├── README.md            ← Questo file
└── archive/             ← Versioni precedenti (opzionale)
    └── CiliegioPR_v1.0.0.html
```

---

## 📞 Contatti azienda

- **Sito:** www.ilciliegio.com
- **Ristorante/Agriturismo:** agriturismo@ilciliegio.com | +39 329 1767348
- **Shop online:** shop@ilciliegio.com | +39 331 1347899
- **Vendita diretta:** info@ilciliegio.com | +39 335 7655171

---

*Sviluppato con Claude — Anthropic*
