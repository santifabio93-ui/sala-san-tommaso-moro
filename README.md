# Sala San Tommaso Moro

App web per gestire la sala: calendario e prenotazioni, turni dei volontari, entrate e spese, tariffe.
Accesso con Google, permessi in base al ruolo.

| Ruolo | Cosa può fare |
|---|---|
| Amministratore | Tutto: prenotazioni, economia, tariffe, turni, persone e ruoli |
| Coordinatore | Prenotazioni e turni (con prezzi e contatti). Non vede spese e tariffe |
| Volontario | Calendario e turni, senza prezzi né contatti. Si segna e si toglie dai turni |
| In attesa | Ha fatto l'accesso ma non è ancora stato approvato |
| Bloccato | Non vede nulla |

I permessi sono controllati dal database (Row Level Security), non solo dalla pagina.

## Come è fatta

- `index.html`, `style.css`, `app.js`: l'app, senza passaggi di compilazione
- `config.js`: indirizzo e chiave pubblica del progetto Supabase
- `supabase/schema.sql`: tabelle e permessi, da eseguire una volta
- `.github/workflows/keepalive.yml`: evita che il progetto gratuito di Supabase vada in pausa

## Configurazione (una volta sola, circa 30 minuti)

### 1. Supabase (database e accesso)
1. Vai su https://supabase.com, accedi con GitHub e crea un nuovo progetto.
   Regione: **Central EU (Frankfurt)**. Salva la password del database in un posto sicuro.
2. Apri **SQL Editor**, crea una nuova query, incolla tutto il contenuto di `supabase/schema.sql` e premi **Run**.
3. In **Project Settings → API** copia **Project URL** e la chiave **anon public**.

### 2. Google (pulsante «Accedi con Google»)
1. Vai su https://console.cloud.google.com e crea un progetto (es. «Sala STM»).
2. Apri **Google Auth Platform** (o «Schermata consenso OAuth»): nome app «Sala San Tommaso Moro», la tua email di assistenza, tipo di pubblico **Esterno**.
3. In **Client** crea un client OAuth di tipo **Applicazione web**.
   In **URI di reindirizzamento autorizzati** inserisci:
   `https://<il-tuo-progetto>.supabase.co/auth/v1/callback`
4. Copia **ID client** e **Client secret**.
5. In **Pubblico** premi **Pubblica app**, così può accedere chiunque abbia un account Google
   (per nome, email e foto non serve la verifica di Google).
6. In Supabase: **Authentication → Sign In / Providers → Google**: attiva e incolla ID client e secret.

### 3. Pubblicazione (Cloudflare Pages, gratuito)
1. Su https://dash.cloudflare.com: **Workers & Pages → Crea → Pages → Collega a Git** e scegli questo repository.
2. Preimpostazione framework: **Nessuna**. Comando di build: vuoto. Directory di output: `/`.
3. Al termine ottieni un indirizzo tipo `https://sala-stm.pages.dev`.
4. In Supabase: **Authentication → URL Configuration**: imposta **Site URL** su quell'indirizzo
   e aggiungilo anche in **Redirect URLs**.

### 4. Collegare l'app al database
Inserisci in `config.js` il Project URL e la chiave anon public, poi salva (commit).
Cloudflare ripubblica da solo.

### 5. Primo accesso
Apri l'app e accedi con Google: **la prima persona che entra diventa amministratore**.
Fallo subito dopo la configurazione.
Ai volontari basta mandare il link: dopo il primo accesso compaiono in **Persone** come «In attesa»
e tu assegni il ruolo.

### 6. Tenere attivo il progetto gratuito
In GitHub: **Settings → Secrets and variables → Actions → New repository secret**, aggiungi
`SUPABASE_URL` e `SUPABASE_ANON_KEY` con gli stessi valori di `config.js`.
L'azione «Mantieni attivo Supabase» farà una piccola richiesta ogni 3 giorni.

## Automatismi: Google Calendar e Gmail

Lo script `google-apps-script/Sincronizzazione.gs` gira gratis dentro Google ogni 15 minuti:

- **Calendario** (account della sala): gli eventi del Google Calendar compaiono nell'app.
  Con `MODALITA` = `lettura+email` lo script **non modifica mai il calendario**. Con `calendario+email`
  anche le prenotazioni create nell'app finiscono nel calendario: lo script modifica o cancella **solo gli
  eventi creati da lui** (hanno un contrassegno invisibile), mai quelli esistenti o inseriti a mano. Nel titolo, «Ref. Nome 333-…»
  diventa referente e telefono; «EVENTO DA PERFEZIONARE» e «OPZIONE –» diventano stato *Opzione*.
  Gli eventi ricorrenti (es. cineforum) si modificano solo da Google Calendar.
- **Email**: le email che chiedono la sala compaiono in **Richieste**, con data e ora riconosciute quando
  scritte per esteso. Lo script non modifica le email; un'email a cui metti a mano l'etichetta Gmail «Sala-Richieste» entra sempre.

### Installazione (un solo account basta)
1. In Supabase esegui `supabase/002_sincronizzazione.sql` nel SQL Editor e copia il **codice di sincronizzazione**
   che compare in basso. Per rivederlo in seguito: `select token from public.sync_tokens;`
2. Entra in https://script.google.com con l'account che vede il calendario della sala (anche in sola lettura)
   → **Nuovo progetto**, cancella il contenuto e incolla `google-apps-script/Sincronizzazione.gs`. Salva.
   In **Impostazioni progetto** spunta «Mostra il file manifest "appsscript.json" nell'editor», poi nell'editor
   sostituisci il contenuto di `appsscript.json` con `google-apps-script/appsscript.json`: limita lo script
   alla **sola lettura** di calendario ed email.
3. **Impostazioni progetto** (ingranaggio) → **Proprietà script** → aggiungi:
   `SUPABASE_URL`, `SUPABASE_KEY` (la chiave publishable), `SYNC_TOKEN` (il codice del punto 1),
   `MODALITA` = `lettura+email`, `CALENDARIO` = `salatommasomoro@gmail.com`.
4. Torna all'editor, scegli la funzione **installa** e premi **Esegui**; accetta i permessi.

Per leggere anche le email della casella della sala: inoltro automatico da quella casella, oppure lo stesso
script installato in quell'account con `MODALITA` = `email`.
Prima di passare a `calendario+email` (scrittura sul calendario), fai un backup:
Google Calendar → Impostazioni → Importa ed esporta → Esporta.

## Cassa
Esegui una volta `supabase/003_cassa.sql` nel SQL Editor. Nella sezione **Cassa** chi fa cassa registra per ogni serata
biglietti online, botteghino in contanti e con POS, omaggi; conta i contanti (anche per taglio), vede se la cassa quadra,
indica quanto preleva e ottiene il nuovo saldo, che diventa il fondo della cassa successiva. Gli incassi dei biglietti
entrano in **Economia**. Fanno cassa amministratori, coordinatori e i volontari abilitati in **Persone** («Fa cassa»).
Una cassa chiusa la può correggere solo un amministratore. Il prezzo proposto del biglietto si imposta in Economia → Tariffe.

## Sopralluoghi
Esegui una volta `supabase/004_sopralluoghi.sql` nel SQL Editor. Nella voce di menu **Sopralluoghi** si fissano le visite
alla sala (giorno, ora, chi viene, evento e data desiderata, chi accompagna, cosa vuole vedere), con controllo che la sala
sia libera, messaggio di conferma da inviare e trasformazione in prenotazione. Si possono fissare anche dal calendario
e da una richiesta arrivata per email. Un volontario vede solo i sopralluoghi in cui accompagna e può segnarli come fatti.

## Cinema
Esegui una volta `supabase/005_cinema.sql` nel SQL Editor. La voce **Cinema** mostra i film in programma con locandina
e orari; per ognuno si segna il supporto (file, DVD, Blu-ray, link), se è già in sala e dove si trova, e la prova di
proiezione. Il cartellino sulla locandina dice se il film è pronto o cosa manca, con la scadenza: la prova va fatta
almeno 7 giorni prima della prima proiezione. Tutti gli approvati possono aggiornare supporto e prova; aggiungere o
togliere film e orari spetta allo staff.
Per leggere la programmazione da Cinebot (film, locandine, orari) aggiungi `+cinema` alla proprietà `MODALITA`
dello script Google (es. `lettura+email+cinema`): lo script legge https://ticket.cinebot.it/s.tommasomoro/ una volta
all'ora. Supporto, prova e note scritti nell'app non vengono mai sovrascritti.

## Incassi C1
Esegui `supabase/006_c1.sql` nel SQL Editor (si può rieseguire). Con `+c1` nella proprietà `MODALITA` dello script Google
(es. `lettura+email+cinema+c1`) lo script legge i riepiloghi C1 in PDF dalla cartella Drive dei C1 e dagli allegati
delle email degli ultimi 60 giorni, dal 2026 in poi; ogni PDF viene letto una volta sola. Il testo viene estratto dal PDF
direttamente dallo script, in sola lettura. Nell'app, in **Cinema → Incassi C1**, ci sono spettatori,
incasso lordo, netto IVA e IVA per proiezione, per film e per mese, con il confronto con la Cassa della stessa serata;
il confronto compare anche nella sezione Cassa. Per controllare la lettura esegui a mano la funzione `provaC1`.

## Statistiche
In **Cinema → Statistiche** (amministratori e coordinatori), calcolate dai C1: spettatori, riempimento medio della sala
(capienza letta dai C1), prezzo medio pagato e quota di omaggi; frasi di sintesi (momento migliore, pomeriggio o sera,
record, film che ha reso di più, confronto con il periodo precedente); spettatori mese per mese con l'anno prima;
classifica dei film; mappa giorno × fascia oraria; tipi di biglietto. Nella Programmazione ogni film mostra una stima
degli spettatori della prossima proiezione, ricavata dai C1 della stessa fascia e del film stesso.

## Bilancio dalla prima nota
Esegui `supabase/007_prima_nota.sql` nel SQL Editor (si può rieseguire). Con `+primanota` nella proprietà `MODALITA`
dello script Google lo script legge il file Excel (.xlsx) più recente nella cartella Drive «PRIMA NOTA» (foglio
«Prima nota», nomi di settori e categorie dal foglio «Piano dei conti») e lo rilegge solo quando cambia; per provarlo
subito esegui `provaPrimaNota`. In **Economia → Bilancio** (solo amministratori): entrate, uscite, risultato di gestione
(per competenza o tutti i movimenti), costi previsti da pagare, incasso per spettatore; frasi di sintesi (costo mensile
della struttura e quanto è coperto, settore migliore e in perdita, peso di noleggio film, SIAE e commissioni, punto di
pareggio in spettatori, mese di minima liquidità, eventi in perdita); entrate e uscite per mese, saldo cumulato,
risultato per settore, uscite ed entrate per categoria, conto economico per evento con spettatori dai C1, elenco dei
movimenti con filtro e ricerca.
Sotto le frasi di sintesi ci sono gli **indicatori di gestione** (margine di contribuzione, punto di pareggio, margine di
sicurezza, leva operativa, stima a fine anno; costi fissi, costo fisso per serata, autonomia finanziaria, dipendenza
dalle donazioni, concentrazione del margine; riempimento della sala, prezzo medio, ricavo per posto offerto, quota al
distributore, costo per spettatore; giorni di utilizzo e ricavo medio per affitto), ognuno con «come si calcola», e il
**conto economico riclassificato** a margine di contribuzione. Sono costi variabili le categorie U01, U02, U03, U05,
U06, U07, U15 (legate agli spettacoli); le altre uscite sono costi fissi di struttura (`CAT_VARIABILI` in `app.js`).

## Donazioni
Esegui `supabase/008_donatori.sql` nel SQL Editor (si può rieseguire). In **Economia → Donazioni** (solo amministratori)
le donazioni arrivano dalla prima nota (categoria E03, donatore = colonna «Controparte»): totale, numero di donatori,
dono medio, peso su entrate e costi fissi, concentrazione, nuovi e da ricontattare (quando ci sono anni precedenti),
donazioni per mese e per tipo di donatore, elenco con ricerca. Nella scheda di ogni donatore si salvano tipo, contatti,
note, ringraziamento e ricevuta per anno, e si prepara la lettera di ringraziamento. «Esporta elenco» scarica un CSV.

## Serate del Comune
Esegui `supabase/009_comune.sql` nel SQL Editor (si può rieseguire). Ogni prenotazione ha la spunta «Serata del Comune
(convenzione)». In **Affitti → Serate del Comune** il contatore annuale mostra serate usate, in calendario e rimaste su
25 (anno solare, con frecce per gli altri anni), l'elenco delle serate e gli eventi che forse sono del Comune (con
«Comune», «sindaco», «assessore», «patrocinio») da segnare con un clic. Il contatore compare anche sotto il calendario.
Lo script Google segna da solo gli eventi nuovi del calendario con «Comune» o «comunale» nel titolo. Facoltativo: una
data di inizio della convenzione, se l'anno non parte il 1° gennaio, con il riepilogo dei 20 anni.

## Scheda di richiesta (stampabile e online)
`modulo/scheda-manifestazioni.html` (e il PDF) è la scheda da stampare, 2 facciate. Esegui `supabase/010_schede.sql`
per la versione online: da **Affitti → Schede di richiesta** si manda all'organizzatore un link personale
(`modulo/compila.html?t=…`) che apre la scheda già compilata con evento e orari; lui la compila dal telefono, senza
account, e la invia. Il cruscotto mostra per ogni evento esterno in arrivo se la scheda è da inviare, inviata, aperta,
compilata (da verificare), approvata o da correggere, segnala le urgenti (evento entro 14 giorni) e permette di
mandare il link o un sollecito, leggere le risposte, dare il parere di sicurezza, approvare, chiedere correzioni,
copiare i dati nella prenotazione e stampare. Il link dà accesso solo a quella scheda (funzioni `scheda_apri` e
`scheda_invia`); dopo l'approvazione non si può più modificare.

**SIAE**: il permesso SIAE e i diritti d'autore sono a carico dell'organizzatore. La scheda chiede se l'evento usa
opere protette e, in caso affermativo, di allegare il permesso (PDF o foto, massimo 10 MB) oppure di dichiarare che
lo manderà per email prima dell'evento. Esegui `supabase/011_siae.sql`: crea lo spazio file privato `schede`, dove
l'organizzatore può solo caricare nella cartella della sua scheda (finché non è approvata) e solo admin e
coordinatori possono aprire i file. Il cruscotto mostra «SIAE allegata / da ricevere / non serve» e avvisa prima di
approvare una scheda senza permesso.

## Backup
In **Economia → Esporta tutto** scarichi un file JSON con tutti i dati e un CSV delle prenotazioni
(apribile con Excel). Conviene farlo una volta al mese: il piano gratuito non ha backup scaricabili.

## Privacy
L'app conserva nomi, telefoni ed email di clienti e volontari. Prepara una breve informativa privacy
e, se la sala fa capo a una parrocchia o associazione, falla verificare da chi segue questi aspetti.
