# SPID Metadata App

App React + Express per gestione e visualizzazione dei file XML di enti SPID, storico delle Pull Request automatizzato, e integrazione GitHub.

## Struttura
- frontend/src/App.js → Interfaccia React, storico PR
- backend/server.mjs → API Express, upload file, creazione PR GitHub

## Avvio
1. Clona la repo: git clone https://github.com/tuo-utente/tuo-repo.git
2. Installa le dipendenze in /frontend e /backend
3. Copia repo-config.example.json in /backend/repo-config.json e inserisci il tuo token GitHub
4. Avvia:
   - Backend: node server.mjs
   - Frontend: npm start in /frontend

## Sicurezza
- Non inserire le tue credenziali GitHub reali nella repo pubblica!
