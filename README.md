# 🔐 SPID Metadata Manager

Applicazione completa per la gestione automatizzata di metadata SPID con integrazione GitHub e sidebar collassabile.

## ✨ Caratteristiche

- 📤 **Upload multiplo** file XML con validazione automatica
- 🔍 **Validazione SPID** completa con errori e warning dettagliati
- 🌿 **Creazione automatica PR** su GitHub
- 📋 **Sidebar collassabile** per gestione file ottimizzata
- 🎨 **UI moderna** con React e CSS personalizzato
- 📊 **Statistiche e anteprima** PR con metadati
- 🔔 **Notifiche toast** eleganti
- 📜 **Storico PR** con filtri e ricerca
- 🚀 **Performance ottimizzate** con upload concorrente

---

## 🏗️ Architettura

spid-metadata-app/
├── backend/ # Server Node.js + Express
│ ├── config/
│ │ └── config.js # Gestione configurazione
│ ├── services/
│ │ ├── GitHubService.js # Interazione con GitHub API
│ │ ├── XMLValidatorService.js
│ │ └── PRTemplateService.js
│ ├── server.mjs # Entry point backend
│ ├── package.json
│ ├── .env.example
│ └── repo-config.json.example
│
├── frontend/ # React App
│ ├── src/
│ │ ├── components/ # Componenti riutilizzabili
│ │ │ ├── ValidationBadge.js
│ │ │ ├── ProgressTracker.js
│ │ │ └── PRPreviewModal.js
│ │ ├── services/
│ │ │ └── notificationService.js
│ │ ├── App.js # Componente principale
│ │ └── App.css # Stili completi
│ └── package.json
│
└── README.md


---

## 🚀 Installazione

### Prerequisiti

- Node.js ≥ 18.0.0
- npm o yarn
- Account GitHub con repository target
- GitHub Personal Access Token

### 1. Clona il repository

```bash
git clone https://github.com/your-username/spid-metadata-app.git
cd spid-metadata-app
cd backend
npm install

# Copia e configura .env
cp .env.example .env
# Oppure usa repo-config.json
cp repo-config.json.example repo-config.json

PORT=4000
NODE_ENV=development

GITHUB_TOKEN=ghp_your_token_here
GITHUB_REPO=owner/repository-name
BASE_BRANCH=main

VALIDATION_ENABLED=true
VALIDATION_STRICT_MODE=false

cd ../frontend
npm install

# Configura URL backend
cp .env.example .env

REACT_APP_API_URL=http://localhost:4000
