# Passaggio di consegne — Gestionale della Sala San Tommaso Moro

Questa guida serve a chi dovrà mandare avanti il gestionale se chi l'ha costruito non c'è.
Non contiene password né chiavi: quelle stanno solo negli account indicati sotto.
Il manuale completo delle funzioni è il [README](README.md).

## 1. Com'è fatto, in breve

| Pezzo | Dove sta | A cosa serve |
|---|---|---|
| **L'app** (pagine web) | repository GitHub `sala-san-tommaso-moro`, pubblicato con GitHub Pages | quello che si apre dal telefono o dal computer |
| **Il database** | progetto Supabase (indirizzo in `config.js`) | tutti i dati: prenotazioni, turni, cassa, prima nota, rubrica… |
| **Lo script Google** | Google Apps Script, nell'account Google di chi gestisce la sala (e, per la rubrica, nell'account della sala) | ogni 15 minuti legge calendario, email, Cinebot, C1, prima nota e porta tutto nel database |
| **I link senza account** | cartella `modulo/` | turni dei volontari, pulizie, contapersone, scheda di richiesta, info per i social |

Non c'è un server da tenere acceso: GitHub, Supabase e Google funzionano da soli e sono gratuiti con l'uso attuale.

### I file del codice
- `index.html`, `style.css`, `app.js`: l'app (in `app.js` ogni pagina ha un blocco che inizia con `/* ---------- nome ---------- */`).
- `badge.js`, `sas-email.js`, `sito.js`: pezzi separati (badge dei volontari, lettura delle email del SAS, controllo del sito).
- `modulo/`: le pagine dei link (`turni`, `pulizie`, `conta`, `compila`, `social`) e la scheda stampabile.
- `supabase/`: gli script del database, numerati. Si eseguono **in ordine** nel SQL Editor di Supabase; si possono rieseguire.
- `google-apps-script/`: lo script Google (`Sincronizzazione.gs`) e i suoi permessi (`appsscript.json`).

## 2. Gli account che servono (da passare di mano)

Per ognuno, la persona che subentra deve essere aggiunta **prima** che serva:

1. **GitHub** — proprietario del repository. *Settings → Collaborators* per aggiungere una persona, oppure *Settings → Transfer ownership*.
2. **Supabase** — organizzazione del progetto. *Organization → Team → Invite* con ruolo *Owner*.
3. **Google**
   - l'account della sala (calendario, posta, Drive con la prima nota e i C1);
   - l'account personale dove gira lo script Google: se la persona cambia, lo script va ricopiato nel nuovo account (vedi punto 4).
4. **L'app** — almeno **due amministratori** in *Persone*, così uno può sempre sbloccare l'altro.
5. **Cinebot**, **SIAE**, **ACEC/SAS**, banca: fuori dall'app, ma gli indirizzi email collegati devono essere della sala, non personali.

## 3. Le cose da fare con regolarità

| Quando | Cosa | Dove |
|---|---|---|
| ogni mese | **scaricare il backup** (l'app lo ricorda in *Oggi*) e salvarlo nel Drive della sala, cartella «Backup gestionale» | *Economia → Spese e tariffe → Esporta tutto* |
| ogni mese | aprire **Stato**: tutte le letture dello script devono essere recenti e gli script SQL eseguiti | *Stato* |
| ogni settimana | il progetto Supabase gratuito si mette in pausa dopo 7 giorni senza uso: c'è un'azione di GitHub che lo tiene sveglio; se si ferma, in Supabase basta «Restore» | GitHub → *Actions* |
| se un link gira troppo | **rinnovare** il link (pulizie, social) o il link personale del volontario | pagina del riquadro relativo |
| a inizio anno | controllare tariffe, convenzione del Comune e la cartella della prima nota del nuovo anno | *Economia*, *Comune* |

## 4. Rimettere in piedi le cose

**Lo script Google si è fermato o va spostato in un altro account**
1. Su script.google.com crea un progetto, incolla `Sincronizzazione.gs` e `appsscript.json` (in *Impostazioni progetto* spunta «Mostra il file manifest»).
2. *Impostazioni progetto → Proprietà script*: `SUPABASE_URL`, `SUPABASE_KEY` (la chiave pubblica), `SYNC_TOKEN` (il codice di sincronizzazione, in Supabase nella tabella `sync_tokens`), `MODALITA` (es. `lettura+email+cinema+c1+primanota+sas+foglietto`).
3. Esegui `installa` e concedi i permessi. Le funzioni `prova…` scrivono nel log cosa leggono.

**L'app non si apre o mostra dati vecchi**
- *Stato* dice cosa manca (script SQL non eseguiti, letture ferme).
- Se GitHub Pages è giù, l'app si può pubblicare anche su Cloudflare Pages (istruzioni nel README).

**Si è perso il database**
1. Crea un progetto Supabase nuovo ed esegui `supabase/schema.sql` e poi tutti gli script numerati, in ordine.
2. Metti indirizzo e chiave pubblica del nuovo progetto in `config.js`.
3. I dati si ricaricano dall'ultimo backup (`sala-stm-backup-AAAA-MM-GG.json`: una sezione per tabella). Calendario, Cinebot, C1, prima nota ed email del SAS si ricaricano da soli con lo script Google.

## 5. Sicurezza e dati personali

- La chiave in `config.js` è **pubblica per natura**: protegge tutto il **Row Level Security** di Supabase. Ogni tabella ha le sue regole (chi può leggere e scrivere secondo il ruolo); i link senza account passano da funzioni che controllano un codice segreto. Dopo ogni modifica al database conviene aprire **Supabase → Advisors → Security Advisor**.
- Password, chiave segreta di Supabase, `SYNC_TOKEN` e chiavi di servizi esterni **non vanno mai** nel codice né mandate in chat o per email: stanno nelle impostazioni di Supabase e nelle proprietà dello script.
- **Tessera sanitaria**: il codice fiscale **non viene salvato**; si tiene solo un'impronta cifrata con un segreto che resta nel database, che serve a riconoscere il volontario alla cassa e non permette di risalire al codice.
- **Dati dei volontari** (telefono, data di nascita, attestato antincendio) e **contatti di terzi** (rubrica, email di richiesta): si usano solo per le attività della sala; i volontari che non collaborano più si disattivano e, se lo chiedono, si eliminano.
- Il backup **non contiene** i link personali dei volontari, i codici dei badge né le impronte della tessera.

## 6. Modificare il codice

- Si modifica il file, si cambia `VERSIONE` in `app.js` e i `?v=…` in `index.html` e nelle pagine di `modulo/` (così i telefoni scaricano la versione nuova), si salva su GitHub: in un paio di minuti è online.
- Le modifiche al database si fanno **solo** con un nuovo script numerato in `supabase/`, da eseguire nel SQL Editor; mai a mano senza lasciarne traccia.
- Per le prove c'è il database di prova di Supabase o una copia del progetto: non provare sul database vero.
