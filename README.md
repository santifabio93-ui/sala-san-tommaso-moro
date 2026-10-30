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

## Stato dell'app
La pagina **Stato** (solo amministratore, con il numero dei problemi accanto alla voce del menu) mostra:
- quali aggiornamenti SQL del database sono stati eseguiti e quali mancano; «Copia tutti quelli mancanti» prepara
  un unico testo, in ordine, da incollare una volta sola nel SQL Editor di Supabase;
- l'ultima lettura dello script Google per ogni parte (calendario, email, Cinebot, C1, prima nota, email del SAS),
  con l'avviso se una lettura è ferma;
- le impostazioni ancora da completare (volontari, referenti del SAS, contatto del sito, convenzione, preventivo,
  catalogo). Se mancano aggiornamenti, lo dice anche la pagina «Oggi».

## Oggi
La prima pagina dell'app. Per amministratori e coordinatori raccoglie in un solo elenco, dal più urgente:
pagamenti anticipati, DVD e link dei film confermati, supporti e prove dei film, risposte del SAS da confermare,
film da chiedere, turni scoperti ed eventi senza turni, richieste di sala, schede da verificare o mancanti, permessi
SIAE da ricevere, affitti da incassare, sopralluoghi, correzioni al sito e settori oltre il preventivo. Ogni voce
porta alla pagina giusta; le cose dei film si segnano «Fatto» da lì. I volontari vedono i propri turni e i posti
scoperti. A destra, cosa c'è in sala oggi e nei due giorni successivi.

## La serata
La pagina **La serata** mostra su un'unica schermata, anche dal telefono, la serata di oggi o la prossima con qualcosa
in sala (con ‹ › per le altre): eventi e orari, capienza, chi è di turno e chi manca, i film con supporto, dove si
trova e stato della prova, il collegamento alla cassa e i promemoria di sicurezza per l'apertura e la chiusura.
Amministratori e coordinatori vedono anche organizzatore e responsabile in sala con il telefono, il tecnico, cosa
c'è da sapere dalla scheda (carrozzine, effetti, attrezzature, SIAE), il parere di sicurezza e quanto resta da incassare.

## Secondo calendario gestito dall'app
Il calendario principale della sala resta in sola lettura. In un secondo calendario dello stesso account (es.
«Sala – App») lo script tiene allineati: le prenotazioni nate nell'app o dalle email (con stato, referente e turni
con i nomi nella descrizione), le proiezioni del cinema e i sopralluoghi, da 30 giorni fa a un anno avanti.
1. In Google Calendar dell'account della sala: Altri calendari → + → Crea nuovo calendario («Sala – App»); nelle sue
   impostazioni copia l'«ID calendario».
2. Esegui `supabase/018_calendario_app.sql`.
3. Nello script: proprietà `CALENDARIO_APP` = l'ID copiato, aggiungi `+app` alla MODALITA, e in `appsscript.json`
   sostituisci `calendar.readonly` con `calendar`; poi esegui `provaCalendarioApp` e accetta il nuovo permesso.
Lo script rifiuta di partire se il secondo calendario coincide con il principale e cambia solo gli eventi creati da lui.

## Cassa
Esegui una volta `supabase/003_cassa.sql` nel SQL Editor. Nella sezione **Cassa** chi fa cassa registra per ogni serata
biglietti online, botteghino in contanti e con POS, omaggi; conta i contanti (anche per taglio), vede se la cassa quadra,
indica quanto preleva e ottiene il nuovo saldo, che diventa il fondo della cassa successiva. Gli incassi dei biglietti
entrano in **Economia**. Fanno cassa amministratori, coordinatori e i volontari abilitati in **Persone** («Fa cassa»).
Una cassa chiusa la può correggere solo un amministratore. Il prezzo proposto del biglietto si imposta in Economia → Tariffe.

**Conta il fondo iniziale**: all'apertura lo stesso cruscotto serve per contare il fondo nel cassetto; se il totale è diverso dal saldo con cui si era chiusa l'ultima cassa, l'app lo segnala.

**Conta i contanti**: a fine serata c'è un cruscotto con tutti i tagli (banconote da 200 a 5 €, monete da 2 € a 1 cent).
Per ogni taglio si mette solo il numero di pezzi, scrivendolo o con i bottoni − e +: l'app calcola i subtotali, il
totale di banconote e monete e lo mette da sola nei «Contanti contati», con la quadratura. Senza conteggio si può
ancora scrivere il totale a mano.

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

In cima alla pagina Cinema, **Cose da fare per i film** elenca per i film dei prossimi 45 giorni cosa manca e
entro quando: chiedere il supporto al distributore (21 giorni prima), controllare che arrivi, la prova (7 giorni
prima), il film sul sito (10 giorni prima, dal controllo della pagina Sito web) e, per l'amministratore, i noleggi
già proiettati che non risultano ancora in prima nota. I film appena arrivati da Cinebot sono segnati «Nuovo».

Nella pagina **Turni** le regole della sala dicono quante persone servono: senza pubblico 1, pubblico solo in
galleria 2, pubblico in platea a ingresso libero 3, spettacolo a pagamento 4 (l'admin le cambia nella stessa pagina;
si salvano con `013_tariffe.sql`). «Eventi senza turni» elenca gli eventi confermati dei prossimi 30 giorni senza
turni, deduce il tipo di pubblico da proiezioni, scheda e tariffa e crea il turno con un tocco (mezz'ora prima e dopo
l'evento; oltre le 5 ore in due fasce). «Testo per il sondaggio» prepara domanda e opzioni da copiare in un sondaggio
WhatsApp con le fasce ancora scoperte dei prossimi 14 giorni.

**Link personali dei volontari** (esegui `supabase/014_turni_link.sql`): in Turni → «Volontari con link personale»
aggiungi nome e cellulare di ogni volontario e gli mandi su WhatsApp il suo link (`modulo/turni.html?t=…`). Senza
account vede le fasce confermate dei prossimi 30 giorni, chi c'è già e quanti posti mancano, e tocca «Ci sono» o
«Non ci sono più»: i nomi arrivano subito nei turni dell'app. Una fascia piena non accetta altri nomi; un link
disattivato smette di funzionare. «Avviso per il gruppo» prepara il messaggio con le fasce ancora scoperte.

Sempre in **Turni**, per oggi e i due giorni successivi, «Promemoria per chi è di turno» prepara il messaggio
per il gruppo con eventi, fasce orarie, nomi e posti ancora scoperti.

## Richieste di film al SAS
In **Cinema → Richieste al SAS** (esegui `supabase/016_sas.sql`): si cerca il titolo nel catalogo del SAS (gli elenchi
che manda il SAS, da incollare nella stessa pagina: i link a MyMovies danno anche l'anno), tra i film di Cinebot o
tra quelli già proiettati, oppure lo si scrive; «Cerca su MyMovies» apre la ricerca della scheda e incollando il link
di una scheda MyMovies titolo e anno si ricavano dall'indirizzo (senza scaricare nulla dal sito); si indicano date, pomeriggio o sera, per quale rassegna, biglietto o
ingresso libero e note. «Prepara l'email» raccoglie tutti i film da chiedere in un'unica email (come chiede il SAS),
da aprire in Gmail o copiare; la richiesta passa «in attesa di risposta». Con «Segna la risposta» si salvano
esito, supporto, minimo garantito, percentuale, agenzia e distributore: «Conviene?» usa queste condizioni.
I referenti del SAS (nome ed email) si aggiungono nella stessa pagina e per ogni email si sceglie a chi scrivere;
restano nel database, non nel codice.

## Email del SAS lette da sole
Esegui `supabase/017_sas_email.sql` e, nell'account Google che riceve le email del SAS, aggiungi `+sas` alla
MODALITA dello script (la prima volta guarda un anno indietro). Lo script copia nell'app le email di
acectriveneta.it; l'app (`sas-email.js`) ne ricava:
- la **programmazione confermata** dalle email automatiche «Conferme/Proposta programmazione» (data, film, agenzia,
  distributore, supporto, minimo, percentuale, note), mese per mese con spettatori e incasso dai C1;
- le **risposte** di Christian e Arianna alle richieste in attesa («OK mg 150 al 40% - DVD», «in embargo»…):
  in Richieste al SAS compaiono già compilate, da confermare con un tocco;
- le **cose da fare** per ogni film confermato: bonifico anticipato del minimo (10 giorni prima), DVD da
  ricevere o ritirare, link da controllare (7 giorni prima), DVD da restituire, file da cancellare dopo la proiezione.

## Incassi C1
Esegui `supabase/006_c1.sql` nel SQL Editor (si può rieseguire). Con `+c1` nella proprietà `MODALITA` dello script Google
(es. `lettura+email+cinema+c1`) lo script legge i riepiloghi C1 in PDF dalla cartella Drive dei C1 e dagli allegati
delle email degli ultimi 60 giorni, dal 2026 in poi; ogni PDF viene letto una volta sola. Il testo viene estratto dal PDF
direttamente dallo script, in sola lettura. Nell'app, in **Cinema → Incassi C1**, ci sono spettatori,
incasso lordo, netto IVA e IVA per proiezione, per film e per mese, con il confronto con la Cassa della stessa serata;
il confronto compare anche nella sezione Cassa. Per controllare la lettura esegui a mano la funzione `provaC1`.

Sotto le statistiche, **Consigli per la programmazione**: soglia di pareggio (spettatori che servono per coprire il
noleggio medio), giorni e orari da ripensare o da sfruttare, film italiani o stranieri, omaggi; e **le rassegne a
confronto** (proiezioni, spettatori medi, riempimento e margine dalla prima nota).

## Conviene prendere questo film?
In Cinema (e in fondo alle Statistiche) «Conviene?» calcola, per un film nuovo (giorno, orario, numero di proiezioni)
o per uno già in programma, gli spettatori attesi dai C1 degli ultimi 12 mesi nello stesso giorno e orario (con la
forbice tra una serata scarsa e una buona), l'incasso netto, il noleggio secondo le condizioni del distributore
(percentuale con minimo garantito, solo percentuale o forfait) e il margine. Dice quanti spettatori servono per
andare in pari e se conviene, con un po' di rischio o no.

## Statistiche
In **Cinema → Statistiche** (amministratori e coordinatori), calcolate dai C1: spettatori, riempimento medio della sala
(capienza letta dai C1), prezzo medio pagato e quota di omaggi; frasi di sintesi (momento migliore, pomeriggio o sera,
record, film che ha reso di più, confronto con il periodo precedente); spettatori mese per mese con l'anno prima;
classifica dei film; mappa giorno × fascia oraria; tipi di biglietto. Nella Programmazione ogni film mostra una stima
degli spettatori della prossima proiezione, ricavata dai C1 della stessa fascia e del film stesso.

## Preventivo
In Economia → Bilancio, sotto il bilancio, il **preventivo dell'anno**: entrate e uscite previste per ogni settore
della prima nota, confrontate con quelle registrate. Avvisa quando un settore ha già superato le uscite previste
o, a questo ritmo, le supererà, e quando le entrate restano indietro. «Proponi le cifre» parte dal consuntivo
dell'anno prima (o dalla proiezione dell'anno in corso). Esegui `supabase/015_preventivo.sql`.

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

## Sito web
La pagina **Sito web** (admin e coordinatori) legge le pagine pubbliche di www.salasantommasomoro.it
(WordPress, dal browser: il sito lo permette) e le confronta con il programma dei prossimi 45 giorni. Il confronto è
in `sito.js` e segnala:
- film in vendita su Cinebot che mancano sul sito, o con un orario diverso;
- date scritte con il giorno della settimana sbagliato;
- eventi annullati ancora online, appuntamenti già passati ancora in Home;
- appuntamenti del sito che nel calendario della sala non risultano (da verificare).

Gli eventi del calendario (anche gli affitti privati) si segnalano solo se sul sito compaiono con un'altra data o
sono annullati. «Avvisa…» prepara il messaggio per chi aggiorna il sito, da mandare su WhatsApp o copiare.
Esegui `supabase/012_sito.sql` per salvare il nome e il cellulare di chi aggiorna il sito (li inserisce l'admin
nella pagina, restano nel database e non nel codice), le segnalazioni già mandate e quelle da non mostrare più.

## Tariffe
Le tariffe sono a giornata, in base allo spazio: galleria 400 €, platea 500 €, platea e galleria 800 € (+ IVA 22%),
più i supplementi biglietteria 100 €, tappeto danza 200 € e attività commerciale 100 €. Nella prenotazione si
scelgono spazio e supplementi e l'app calcola il prezzo; se c'è la scheda dell'organizzatore, lo spazio è proposto in
base al pubblico previsto. Esegui `supabase/013_tariffe.sql` per poter cambiare le cifre da Economia → Spese e
tariffe e per ricordare in ogni prenotazione come è stato calcolato il prezzo.

Il pannello **Le tariffe coprono i costi?** (Economia → Spese e tariffe) stima dalla prima nota il costo di una giornata
di sala (costi annui della struttura ÷ giornate di apertura) e lo confronta con le tariffe: dice se e di quanto
aumentarle, quanto margine resta prima di andare sotto costo e, se i costi della struttura non sono coperti da affitti
e attività (le donazioni non si contano perché non sono certe), quanti affitti in più servirebbero o di quanto alzare le tariffe. Costi annui e giornate si
possono correggere a mano quando una bolletta non è ancora registrata.

## Contapersone alla porta

Il giorno di un evento, nel link personale dei turni compare «🚪 Contapersone di stasera» (`modulo/conta.html`).
Il volontario alla porta tocca «+1 Entra», «+5 Entrano» o «−1 Esce»: il numero delle persone in sala è lo stesso su
tutti i telefoni (si rilegge ogni 3 secondi) ed è confrontato con la capienza (galleria 134, platea 338, platea e
galleria 472, presa dalla prenotazione e cambiabile con un tocco). Dall'85% diventa arancione, alla capienza rosso:
«Sala piena: non far entrare nessuno». Tiene entrati in tutto, usciti e picco; lo schermo resta acceso e i tocchi
fatti senza rete partono appena torna. Nell'app, la pagina «La serata» mostra i numeri. Serve lo script
`026_contapersone.sql`.

## Segreteria e accesso senza Google

Il ruolo **Segreteria** (script `025_segreteria.sql`) è per chi aiuta a tenere l'agenda: vede e modifica calendario,
prenotazioni, richieste, schede di richiesta, sopralluoghi e serate del Comune, e segna le scorte. Non vede cassa,
incassi dei film, prima nota, donazioni, dati dei volontari, SAS, sito e impostazioni (lo blocca il database, non
solo l'app). Si assegna in Persone.

Chi non ha un account Google entra con **email e password**: l'amministratore crea l'utente in Supabase
(Authentication → Users → Add user → Create new user, con «Auto Confirm User») e gli dà la password; dopo il primo
accesso la cambia con «Cambia password» in alto. Se l'email è già in Persone con un ruolo, l'accesso è immediato.

## Gruppo pulizie

Un link solo per il gruppo pulizie (`modulo/pulizie.html`, senza account), da mandare ai referenti delle pulizie: nel
riquadro «Gruppo pulizie» (pagina Turni e Turni → Volontari) si salvano i referenti con il cellulare e «Manda a …»
apre WhatsApp sulla loro chat con il messaggio già scritto. Mostra cosa è successo in sala nei sette giorni prima delle pulizie (di solito il martedì; il giorno si
cambia dallo stesso riquadro): quando e per quanto, in quali spazi (platea, galleria, palco, tappeto danza), per cosa
e con quante persone (dalla cassa, dai C1 o dal pubblico previsto nella scheda), con in evidenza tappeto danza, molti
bambini o tanta gente. A fine lavoro segnano «Pulizie fatte» con una nota (cosa manca, cosa non va): la nota compare
nel riquadro e in Oggi. «Rinnova il link» lo cambia se gira troppo. In alto il link dice anche quando la sala serve di nuovo dopo le pulizie
(in evidenza se è lo stesso giorno o il giorno dopo).

**Scorte che mancano**: carta igienica, sapone, sacchi… le segnano con un tocco i volontari di turno (pagina «La serata»)
e gli addetti alle pulizie (dal loro link); chi le compra tocca «Preso ✓». Le scorte da comprare compaiono in Oggi. Serve lo script `024_pulizie.sql`. I nomi dei
referenti, i telefoni e gli incassi non compaiono.

## Film e altri spettacoli

Su Cinebot si vendono anche teatro, danza, concerti e incontri: non tutto è un film. Lo script Google porta da Cinebot
qualche indizio (sottotitolo, prezzo, visto di censura, che hanno solo i film) e l'app capisce da sola che cos'è:
per esempio un sottotitolo «Teatro…» è teatro, un ingresso a 0 € è un incontro, un biglietto da 12 € in su senza visto
è un altro spettacolo. Nella scheda il campo «Che cos'è» mostra la scelta automatica e si può correggere a mano.
Per gli spettacoli che non sono film l'app non chiede supporto, distributore, prova di proiezione e fattura del
noleggio; in Cinema c'è il filtro «Altri spettacoli» e il resoconto del mese li elenca a parte.
Serve lo script `023_tipo_spettacolo.sql` e lo script Google aggiornato.

## Eventi organizzati dalla Sala

Nella prenotazione la spunta **«Organizzato dalla Sala San Tommaso Moro»** distingue gli eventi della Sala dagli
affitti (serve lo script `022_eventi_della_sala.sql`). Per questi eventi non si chiede la scheda di richiesta; in
Affitti → Schede il bottone «È della Sala» li segna con un tocco. In Prenotazioni i filtri «Affitti» e «Della Sala»
li tengono separati, e il resoconto del mese li conta a parte.

## Modificare gli eventi del calendario

Tutti i dettagli di una prenotazione si possono cambiare dall'app, anche per gli eventi che arrivano dal Google
Calendar della sala: titolo, data, orario, «tutto il giorno» e stato (serve lo script `020_modifiche_calendario.sql`).
Quando cambi uno di questi campi vale la versione dell'app e la sincronizzazione non la sovrascrive più. Il calendario
Google invece non viene toccato: la prenotazione mostra cosa c'è ancora scritto lì, e Oggi ricorda di aggiornarlo.
Con «Usa quello del calendario» si torna alla versione del calendario, che da quel momento torna a valere.
Se un evento viene cancellato dal calendario, sparisce anche dall'app.

## Volontari

Turni → Volontari (admin e coordinatori) è l'elenco dei volontari: nome, cellulare, data di nascita, attestato
antincendio (livello, data del corso, scadenza e il file PDF o la foto dell'attestato) e note. Serve lo script
`019_volontari_dati.sql`. Gli attestati stanno in uno spazio file privato che vedono solo admin e coordinatori.

- **Compleanni**: in Oggi compare chi compie gli anni oggi o domani, con il bottone «Auguri» che prepara il messaggio
  e apre WhatsApp sul suo numero; nella pagina Volontari ci sono quelli dei prossimi 30 giorni.
- **Antincendio**: la scadenza si propone da sola 5 anni dopo il corso (si può cambiare). Gli attestati scaduti o in
  scadenza entro 60 giorni compaiono in Oggi. Nei turni chi ha l'attestato valido ha 🧯 accanto al nome, e le serate con
  pubblico (spettacoli a pagamento e galleria) senza nessun addetto antincendio sono segnalate.
- **Esporta elenco**: un file CSV da aprire con Excel, ad esempio per l'assicurazione o i controlli.

- **Link perso**: c'è anche un link uguale per tutti (`modulo/turni.html`, in Turni → «Link per la descrizione del
  gruppo»), da mettere nella descrizione del gruppo WhatsApp. Il telefono che ha già aperto il link personale viene
  riconosciuto da solo; altrimenti il volontario scrive cellulare e data di nascita e ritrova il suo link (serve lo
  script `021_turni_recupero.sql`; dopo 20 tentativi sbagliati in un'ora la pagina si ferma per un po'). La pagina
  suggerisce anche di aggiungere il link alla schermata Home del telefono.

I volontari dal loro link dei turni vedono solo i nomi degli altri: telefono, data di nascita e attestati no.

## Resoconto mensile

Economia → Resoconto (admin e coordinatori) prepara su una pagina il riassunto di un mese per il parroco e il
direttivo: giornate di apertura, eventi e affitti, spettatori e biglietti dai C1 (con il confronto con lo stesso mese
dell'anno prima), film più visti, turni coperti dai volontari, il mese dopo (film ed eventi in calendario) e le cose
ancora da sistemare. Gli admin vedono anche entrate, uscite e risultato da inizio anno dalla prima nota.
Si sceglie il mese, si aggiungono le note per il direttivo, poi «Copia il testo» (da incollare in WhatsApp o in
un'email) oppure «Stampa o salva PDF». L'app non invia nulla da sola.

## Backup
In **Economia → Esporta tutto** scarichi un file JSON con tutti i dati e un CSV delle prenotazioni
(apribile con Excel). Conviene farlo una volta al mese: il piano gratuito non ha backup scaricabili.

## Privacy
L'app conserva nomi, telefoni ed email di clienti e volontari. Prepara una breve informativa privacy
e, se la sala fa capo a una parrocchia o associazione, falla verificare da chi segue questi aspetti.

## Diritti
© 2026 Fabio Santi, realizzata per la Sala San Tommaso Moro (Parrocchia di San Biagio). Tutti i diritti riservati:
il codice è visibile ma non può essere copiato, modificato o riusato senza autorizzazione scritta. Vedi il file `LICENSE`.
