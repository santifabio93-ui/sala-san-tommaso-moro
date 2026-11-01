# Sala San Tommaso Moro

> Per chi subentra nella gestione: [Passaggio di consegne](PASSAGGIO_CONSEGNE.md) (account, cose da fare ogni mese, come ripartire).

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

## Scheda evento

Dal calendario o dall’elenco prenotazioni, tocca un evento per aprire la sua scheda:
prossime azioni, scheda di richiesta e SIAE, turni con persone e posti liberi,
pagamenti, contatti, materiali, richiesta originale e sopralluoghi collegati.
I pulsanti aprono direttamente la prenotazione, le risposte della scheda o i turni
di quell’evento. L’indirizzo `#evento/<id>` si può riaprire o condividere: l’accesso
resta soggetto al ruolo e ai permessi del database.

I volontari vedono soltanto le informazioni pubbliche e i turni. I dati mancanti o
non disponibili non vengono presentati come controlli superati. Aggiungere materiali
a un affitto privato non lo pubblica sul sito o nel programma dei social.
La scheda usa le tabelle esistenti, senza nuovi aggiornamenti SQL.

## Richieste per attività della Parrocchia

In **Affitti → Schede → + Richiesta Parrocchia**, un amministratore o coordinatore
predispone un link per il gruppo parrocchiale. Il percorso è assegnato dalla sala:
non si ottiene scegliendo “Parrocchia” nel modulo per utilizzatori esterni.

Il modulo raccoglie consiglio pastorale, catechismo, conferenza/incontro,
corso fidanzati o altra attività parrocchiale da valutare, gruppo, referente e
responsabile presente, partecipanti/minori, accessibilità e attrezzature.
I dati anagrafici sono quelli della Parrocchia di San Biagio; non si chiedono
codice fiscale o indirizzo del singolo gruppo. Feste private escluse; corsi e
laboratori esterni non attivi. La gratuità non esonera dalla verifica dei diritti
per eventuali opere protette.

Si possono richiedere fino a 52 incontri con preparazione e riordino. L’invio
porta la richiesta in **Da verificare**, senza creare prenotazioni. Dopo la
verifica delle risposte e del parere di sicurezza, un gestore preme **Approva e
prenota gratuitamente gli incontri**. Se una data si sovrappone a un evento
attivo del calendario dell’app, nessun incontro viene confermato: si devono
correggere date/orari e riprovare. I tempi di preparazione e riordino sono inclusi
nell’occupazione del calendario. Incontri distinti vengono creati per ogni riga.
Una seconda approvazione non crea duplicati.

Gli incontri approvati sono sempre gratuiti: il database blocca prezzi e incassi
diversi da zero, e l’app non propone preventivi o pagamenti. La richiesta resta collegata
a tutti gli incontri. Dopo l’approvazione, le modifiche si gestiscono dal calendario;
il link del richiedente mostra la conferma e non consente altri invii.

**Aggiornamento necessario:** eseguire
[`037_richieste_parrocchia.sql`](supabase/037_richieste_parrocchia.sql) nel SQL Editor
Supabase dopo i precedenti aggiornamenti, prima di usare il nuovo percorso.
Lo script è rieseguibile; le schede precedenti restano nel percorso esterno e
non vengono riclassificate automaticamente. Il gestore verifica che si tratti effettivamente di un’attività della Parrocchia
prima di approvarla.

### Descrizione, spazi e dotazioni della richiesta parrocchiale

Ogni richiesta deve spiegare concretamente cosa si farà e come saranno usate le
sale. Sono obbligatori descrizione, scelta tra galleria/platea/entrambe,
allestimento e indicazione dell’eventuale uso del palco. L’allestimento può essere
riunione seduta, tavolo, piccoli gruppi o altra disposizione da descrivere.
La galleria non comprende il palco né le dotazioni di scena della platea.

Le domande si adattano alle dotazioni selezionate: contenuti e collegamento del
proiettore, utilizzo dell’audio, quantità di microfoni a filo/radiomicrofoni/da
tavolo, posti al tavolo relatori, luci e sipario. Si indicano eventuale tecnico
proprio e contatto, attrezzature elettriche portate, potenza se nota, materiali e
loro collocazione. Sono disponibili campi per apertura/accoglienza/assistenza,
accessibilità, differenze tra gli incontri e ulteriori spazi o esigenze da valutare.
Le richieste non confermano automaticamente disponibilità di dotazioni o personale.

Tutti i dettagli compaiono nelle risposte che il gestore verifica prima di approvare
e nella sezione **Attività, sala ed esigenze** della scheda evento. Le quantità e
i campi condizionali vengono controllati anche dal database, non solo dal modulo.
Se una dotazione viene deselezionata, i suoi dettagli non vengono reinviati.

**Aggiornamento necessario:** eseguire
[`038_parrocchia_esigenze.sql`](supabase/038_parrocchia_esigenze.sql) dopo 037.
Le richieste ancora da approvare devono essere integrate riaprendo il loro link;
gli incontri e le richieste già approvati non vengono modificati.

### Link personali e richieste già approvate

I link copiati dall’app includono la versione (`&v=...`) per distinguere i nuovi
caricamenti da pagine precedenti nella cache, conservando lo stesso codice della
richiesta e la bozza locale. Il modulo mostra versione e percorso effettivo:
Parrocchia oppure utilizzatori esterni. Un vecchio link esterno non viene
riclassificato automaticamente come richiesta parrocchiale.

Le richieste parrocchiali approvate mostrano un riepilogo completo in sola lettura:
attività, persone, date attuali in calendario, spazi, allestimenti, attrezzature
ed esigenze. I dati mai compilati sono indicati come mancanti; per integrazioni
o modifiche si contatta il gestore. Non vengono riaperte richieste approvate.
Questo aggiornamento dell’interfaccia non richiede nuove migrazioni SQL.

## Preventivo per chi chiede la sala

Nella **Scheda evento → Prepara preventivo**, oppure in **Affitti → Richieste →
Prepara preventivo**, si prepara un documento con destinatario, evento, data e
orari. Lo spazio e i supplementi già scelti vengono riproposti; le tariffe sono
quelle attuali della sala, a giornata, con l’IVA applicata come nelle impostazioni.
Se l’importo della prenotazione è diverso, viene proposto l’importo concordato:
si può scegliere di usare invece il dettaglio delle tariffe attuali. Le differenze
vengono segnalate e non modificano il prezzo della prenotazione.

Le condizioni iniziali riprendono le regole e la scheda tecnica previste dalla
scheda di richiesta; si possono modificare. Validità e note per il cliente si
compilano prima di stampare.
**Stampa / Salva PDF** apre il documento per la stampa del browser: scegliere
«Salva come PDF» per scaricarlo. Le note interne e gli incassi non vengono copiati.
Il documento non viene inviato automaticamente e non conferma una prenotazione.
La bozza resta disponibile nella pagina aperta, ma non viene salvata nel database
e si perde ricaricando o chiudendo la pagina. Nessun nuovo SQL da eseguire.
Il preventivo al cliente è distinto dal preventivo annuale di Economia.

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

**Cassa con il solo badge, senza account sul computer** (script
[`043_cassa_badge_senza_account.sql`](supabase/043_cassa_badge_senza_account.sql)):

1. Da amministratore o coordinatore, in **Volontari → Scheda**, spuntare
   **Abilitato alla cassa con badge, senza account** per le persone autorizzate.
   Le abilitazioni nuove sono disattivate fino a questa scelta esplicita.
2. Sul computer aprire `modulo/cassa.html`, oppure **Cassa con badge · senza
   account** dalla schermata iniziale. Il link può essere salvato nei preferiti.
3. Passare il badge STM al lettore: il codice completo attiva l’accesso
   automaticamente. Sono disponibili anche Invio e il pulsante Entra.
4. Aprire o continuare la cassa, scegliere evento/proiezione o inserire un titolo,
   registrare biglietti e incassi e contare il fondo e i contanti. Il prelievo
   indicato è successivo al conteggio. In chiusura ripassare il badge della persona
   che chiude, anche se diversa da chi ha aperto. Si torna poi alla lettura badge.

La pagina non crea account Google, profili di accesso o utenti anonimi. Il badge
abilitato è la credenziale del cassiere e il suo codice va tenuto riservato,
come il link personale che lo mostra. La sessione rimane solo in memoria:
ricaricando la pagina si ripassa il badge. Scade dopo 20 minuti senza attività e
comunque dopo 8 ore. Esci, disattivazione del volontario, revoca dell’abilitazione
o generazione di un nuovo badge invalidano le sessioni. I badge già stampati
rimangono validi; la migrazione non li sostituisce.

Si gestisce solo la serata corrente, con il giorno precedente disponibile prima
delle 06:00 (fuso Europe/Rome). Sono mostrati solo gli eventi/proiezioni e i dati
necessari alla cassa, oltre al fondo proposto dall’ultima chiusura. Il registro
storico e le correzioni delle casse chiuse restano nel gestionale dei responsabili.
Apertura, ultimo salvataggio e chiusura registrano i volontari reali. Il riepilogo
di una cassa chiusa si legge e si stampa dopo aver ripassato un badge abilitato.

Le tabelle restano protette da RLS; le operazioni senza account passano da RPC
con sessioni revocabili, limite ai tentativi, importi e saldo calcolati sul server,
controllo delle revisioni e blocco delle aperture duplicate dello stesso evento.
Badge e sessioni non compaiono in URL o archivi del browser. La modalità senza
account usa il badge STM della Sala; la modalità precedente con tessera sanitaria
resta disponibile per chi usa ancora un account della postazione.

Applicare 043 dopo gli aggiornamenti precedenti, prima di pubblicare questa versione.

**Modalità precedente con account e tessera sanitaria** (script `028_cassa_tessera.sql`): il computer della biglietteria entra con un
account apposta (in Persone: ruolo Volontario, «Fa cassa» e «Postazione cassa») che vede solo la cassa. Il volontario
passa la tessera sanitaria con il lettore di codici a barre (o scrive il codice fiscale e preme Invio): l'app lo
riconosce, apre la cassa della serata a suo nome e, alla chiusura, chiede di ripassare la tessera di chi chiude. Nella
cassa restano «aperta da» e «chiusa da». Le tessere si registrano nella scheda del volontario (Turni → Volontari):
il codice fiscale non viene salvato, solo un'impronta cifrata con un sale segreto.

**Badge della Sala** (script `030_badge.sql`): ogni volontario ha un codice casuale (es. STM7K3QX9PA, senza dati
personali) che vale alla postazione come la tessera sanitaria. In Turni (riquadro «Volontari con link personale») e in Turni → Volontari «🪪 Stampa i badge» prepara le
tesserine (85 × 54 mm, 10 per foglio A4) con ritratto, nome, QR code e codice a barre Code 39 (lo stesso tipo della
tessera sanitaria, così lo legge qualsiasi lettore); il volontario lo trova anche nel suo link dei turni («Il mio badge
per la cassa») da mostrare dal telefono. Se lo perde, nella sua scheda «Nuovo badge» rende inutilizzabile il vecchio.

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
dello script Google lo script legge dalla cartella Drive «PRIMA NOTA» il **registro di chi tiene i conti** (fogli
«Prima nota 26», «Prima nota 2025»…: anno rif., codice, data, descrizione, nr fatt., entrate, uscite, data/evento, codice
evento) e lo rilegge solo quando cambia; per provarlo subito esegui `provaPrimaNota`. Se nella cartella c'è anche il file
«ordinato» (foglio «Prima nota» con codici di settore e categoria + «Piano dei conti»), per le righe che contiene usa
settore, categoria, evento e controparte sistemati lì; le righe nuove le classifica da solo: settore dal codice, categoria
dalla descrizione (C1 = biglietti, SIAE, Stripe/Cinebot = commissioni, noleggio film, Enel = energia, donazioni…), evento
dal C1 o dal codice evento, rimborsi tra le entrate come note di credito. Senza registro legge il file ordinato come prima. In **Economia → Bilancio** (solo amministratori): entrate, uscite, risultato di gestione
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

## Foglietto parrocchiale

Ogni giovedì mattina (dalle 7) lo script Google manda dall'account della sala un'email al parroco con gli appuntamenti
pubblici della sala dalla domenica alla domenica dopo, pronti da copiare nel foglietto: film e spettacoli (con il tipo
e il prezzo da Cinebot), eventi organizzati dalla Sala e serate del Comune. Gli affitti privati e gli eventi da
confermare non compaiono. In **Sito web → Foglietto parrocchiale** l'amministratore accende l'invio e imposta email
del parroco, saluto, firma e note da aggiungere; c'è l'anteprima della settimana e «Copia il testo».
Serve lo script `029_foglietto.sql`, lo script Google aggiornato con il nuovo `appsscript.json` (permesso
`script.send_mail`, solo per questa email) e «+foglietto» nella MODALITA. `provaFoglietto` manda una prova all'account
dello script, non al parroco.

## Parroco

Il ruolo **Parroco** (script `027_parroco.sql`) vede la sala in sola lettura: la pagina «In breve» (cosa c'è in sala
nelle prossime due settimane, i numeri del mese, cose da sapere come richieste da confermare, attestati antincendio,
serate del Comune usate e segnalazioni delle pulizie), il calendario, i film con gli spettatori, le serate del Comune
e il resoconto del mese. Dei conti vede **solo i totali** (entrate e uscite per mese dalla prima nota). Non legge
direttamente le tabelle: la funzione `parroco_dati` gli prepara i dati già ridotti, senza telefoni ed email di chi
affitta e senza dati dei volontari. Si assegna in Persone; può entrare con Google o con email e password.

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

## Info per i social

Un link solo per chi cura i social (`modulo/social.html`, senza account): per ogni film, spettacolo, evento della Sala
e serata del Comune dei prossimi due mesi mostra date e orari, ingresso (dal prezzo di Cinebot o scritto a mano),
regista (anche dalle richieste al SAS), collaborazioni, descrizione, note, distributore, locandina, link dei biglietti
e cartella dei materiali, con il bottone «Copia tutte le info». Gli affitti privati non compaiono. Il link si manda dal
riquadro «Info per i social» nella pagina Sito web, dove si completano anche le informazioni di ogni evento («Completa»
mostra cosa manca). «Rinnova il link» lo cambia se gira troppo. Serve lo script `033_info_social.sql`.
Gli eventi nuovi o cambiati dall'ultima visita (date, orari, informazioni) hanno un'etichetta per 3 giorni e un filtro
«Novità». Con «❓ Chiedi» (o toccando «da chiedere») fanno una domanda: arriva in Oggi e nel riquadro, si risponde da lì
e la risposta compare nel loro link.

## Rubrica della sala

Pagina **Rubrica** (amministratori, coordinatori, segreteria): i contatti di chi ha avuto a che fare con la sala,
raccolti da soli da prenotazioni, schede di richiesta (organizzatore, responsabile in sala, tecnico), email di
richiesta, sopralluoghi, volontari e contatti del SAS, uniti per telefono o email. Per ognuno: categoria, ultimo
contatto e lo storico con la sala; bottoni per chiamare, WhatsApp ed email; «Nuova prenotazione» già compilata.
Si aggiungono contatti a mano (fornitori, tecnici, enti…), si correggono nome, ente, categoria e note, si nascondono
quelli inutili. «Esporta (Excel)» scarica l'elenco filtrato. Serve lo script `034_rubrica.sql`. Con «+rubrica» nella MODALITA dello script Google
dell'account della sala entrano anche le persone con cui la sala ha scambiato email (solo le conversazioni in cui la sala
ha scritto o risposto: niente pubblicità né newsletter), con il telefono trovato nella firma e il link all'ultima email.
La prima volta lo script legge tutta la posta inviata a blocchi (40 conversazioni ogni 15 minuti), poi ogni 6 ore. Dalla firma
delle email ricava anche ente o associazione, ruolo e sito; la rubrica aggiunge da sola il telefono scritto nelle email di
richiesta, indirizzo e codice fiscale dalle schede, gli eventi fatti e in programma, quanto ha pagato in totale (solo
amministratore) e indovina la categoria dall'ente o dall'indirizzo email. Dopo un aggiornamento dello script, eseguire una
volta `rileggiRubrica` per rileggere tutta la posta con le informazioni nuove. Sono dati personali:
restano nel database e si usano solo per le attività della sala.

## Locandine lette da Claude

Nell'app si può caricare la foto di una locandina in due punti:
- **«📷 Da locandina»** in alto, accanto a «+ Nuova prenotazione»: prepara una prenotazione già compilata
  (titolo, tipo, data, orari, organizzatore; ingresso, chi presenta, collaborazioni, contatti e altre date nelle note).
  Si controlla e si salva come sempre; la locandina e le informazioni vanno anche nelle info per i social.
- **Sito web → Info per i social → «Completa» → «📷 Carica la locandina»**: compila solo i campi ancora vuoti e la
  locandina si vede e si scarica dal link dei social.

Le locandine si salvano nello spazio file pubblico `locandine` (script `033_info_social.sql`). La lettura la fa Claude
attraverso una piccola funzione di Supabase; la chiave di Anthropic resta in Supabase e non è mai nell'app. Per attivarla:
1. Su https://console.anthropic.com crea un account, aggiungi un po' di credito (bastano 5 €: ogni locandina costa
   circa 1–2 centesimi) e in **API Keys** crea una chiave. Non scriverla in chat né nel codice.
2. In Supabase: **Edge Functions → Secrets** → aggiungi `ANTHROPIC_API_KEY` con la chiave.
3. In Supabase: **Edge Functions → Deploy a new function → Via Editor**, nome `leggi-locandina`, incolla tutto il file
   `supabase/functions/leggi-locandina/index.ts` e premi **Deploy**.
La funzione la possono usare solo admin, coordinatori e segreteria.

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

- **Turni nel calendario del telefono**: accanto a ogni turno in cui si è segnati c'è «📅 Mettilo nel calendario»
  (su iPhone apre «Aggiungi al calendario» con l'avviso un'ora prima, su Android apre Google Calendar con l'evento già
  compilato) e in alto «Tutti i miei turni nel calendario»; nella pagina Turni dell'app c'è «📅 Nel calendario» accanto ai propri turni (file .ics per iPhone, Outlook, Samsung). Se ci si toglie da
  un turno, va cancellato anche dal calendario.

- **Com'è fatta la pagina**: in alto il benvenuto con il prossimo turno («tra 3 giorni») e i bottoni rapidi
  (contapersone, badge, calendario); poi «I tuoi turni» (schede da scorrere a destra e sinistra), il filtro «Dove servo / Tutti», la striscia dei giorni (pallino
  rosso dove mancano persone) e un riquadro per evento con le fasce: i posti mostrano il nome completo di chi c'è
  («libero» tratteggiato dove manca qualcuno), «Urgente» se mancano persone entro 3 giorni. «Ci sono» si aggiorna subito con «Annulla»
  nel messaggio; per togliersi si tocca «✓ Ci sei» e poi «Toglimi».
  Anche quando una fascia è al completo «Ci sono» resta: chi si aggiunge compare con il suo nome come gli altri
  (script `031_turni_oltre.sql`, al massimo 10 persone oltre i posti).
- **Scambio di turno** (script `032_turni_cambi.sql`): sotto un proprio turno «🔁 Chiedi il cambio»; il turno resta suo
  finché un altro volontario, nella sezione «Cercano un sostituto» del suo link, tocca «Lo prendo io»: allora il turno
  passa da solo. Chi chiede può mandare il messaggio al gruppo WhatsApp e ritirare la richiesta («Ci vado io»).
  Le richieste aperte compaiono in Oggi e nella pagina Turni.

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

## Eventi organizzati dalla Sala: referente interno e ospite

Aprire una prenotazione segnata **Della Sala**, quindi **Scheda evento →
Organizzazione della Sala → Prepara informazioni e invito**. Il referente interno
sceglie conferenza, teatro, concerto, danza o proiezione e raccoglie programma,
contatti, durata, pubblico, accessibilità e accordi riservati. Si può salvare una
bozza incompleta; la conferma richiede le informazioni essenziali.

Le sezioni tecniche dipendono dal tipo: una conferenza non presenta palco e luci
di scena. Ogni sezione può essere compilata internamente oppure affidata
all’ospite. **Prepara messaggio per l’ospite** apre un testo da copiare: non invia
messaggi automaticamente. Il link personale `modulo/ospite.html` consente solo
le sezioni assegnate, senza account; chi possiede il link può compilarle.
Il database non restituisce al link note interne, importi o informazioni social.

La risposta rimane **Da verificare dalla Sala** finché amministratore,
coordinatore o segreteria non selezionano **Verifica e conferma esigenze**.
Anche una modifica di titolo, date, orari o stato della prenotazione richiede
una nuova verifica; l’annullamento revoca definitivamente il link.
La conferma fotografa le esigenze operative e le rende disponibili anche in
**La serata** per questi ruoli. Una nuova risposta o modifica interna annulla
la verifica precedente. I volontari non accedono a questa raccolta riservata.
La conferma delle esigenze non cambia lo stato della prenotazione e non promette
la disponibilità delle attrezzature richieste.

Cambiando tipo o sezioni assegnate, il vecchio link viene revocato e le risposte
vanno raccolte di nuovo. Le revisioni impediscono che due compilazioni concorrenti
si sovrascrivano: in caso di conflitto occorre ricaricare. Date, prezzi e turni
restano gestiti dalla prenotazione. Le informazioni per il pubblico hanno campi
separati e un’autorizzazione esplicita: dopo la verifica **Prepara info per i
social** le trasferisce nel dialogo social, dove vanno ancora salvate.

Prima dell’attivazione applicare [`039_eventi_sala_inviti.sql`](supabase/039_eventi_sala_inviti.sql)
nel SQL Editor di Supabase, dopo le migrazioni precedenti. La tabella privata è
protetta da RLS; i salvataggi e la conferma passano da RPC che controllano ruolo,
revisione e tipo di evento. Le RPC pubbliche restituiscono solo i campi previsti
per l’ospite e rifiutano risposte fuori dalle sezioni assegnate.
Il backup JSON include i dati nella sezione `organizzazione_sala`.



## Persone, gruppi e attività

In **Rubrica → Nuovo contatto** si inseriscono le persone, con telefono ed email.
Un contatto in rubrica non crea un account di accesso all’app.
In **Rubrica → Gruppi e persone → Nuovo gruppo** si sceglie il nome del gruppo,
si cercano e spuntano le persone che ne fanno parte e si indica, se presente,
il referente abituale. La stessa persona può appartenere a più gruppi.
Si possono distinguere gruppi parrocchiali, associazioni, compagnie e altri gruppi.

Nella **prenotazione** e quando si prepara una **scheda di richiesta**, anche
parrocchiale, è possibile scegliere il gruppo e il referente dalla rubrica.
Il gruppo propone il referente abituale; si può scegliere un’altra persona per
la singola attività oppure compilare i campi a mano. Il gruppo resta facoltativo
per gli inviti individuali. La scelta compila nome e contatti della bozza corrente:
non modifica i contatti originali o gli altri appuntamenti.

La scheda evento mostra il gruppo e la rubrica riporta gruppi di appartenenza e
storico delle attività collegate. Cambiare il referente abituale del gruppo non
cambia quello degli eventi già salvati. Nascondere un contatto utilizzato mantiene
le associazioni; i gruppi si archiviano e restano nello storico, senza essere
proposti per nuove attività. I collegamenti sono inclusi nel backup JSON.

Nelle nuove richieste parrocchiali, gruppo e dati del referente vengono già
predisposti nel modulo personale. Il link pubblico non espone l’elenco dei gruppi,
le altre persone o le note interne. All’approvazione, gli incontri ereditano i
collegamenti se i nomi dichiarati corrispondono al gruppo e alla persona scelti;
se il compilatore indica un gruppo o una persona diversi, il collegamento relativo
rimane vuoto e va verificato dal gestore nella prenotazione.

Prima dell’attivazione applicare [`040_gruppi_persone.sql`](supabase/040_gruppi_persone.sql)
dopo 039. Amministratore, coordinatore e segreteria gestiscono i gruppi; volontari
e link pubblici non accedono alla relativa anagrafica. Gli enti già scritti come
testo nei contatti rimangono conservati: nessun raggruppamento o collegamento
automatico dei dati precedenti. I contatti ricavati dalle altre funzioni dell’app
vengono registrati stabilmente solo quando scelti per un gruppo o un’attività.


### Importare collegamenti confermati

In **Rubrica → Importa collegamenti** si può caricare un CSV UTF-8 separato da
punto e virgola con le colonne `Stato;Persona;Gruppo;Tipo gruppo`. Sono accettate
le righe con stato `CONFERMATO` o `ESPRESSO NEL FILE`; le proposte ancora da
confermare e i gruppi privi di persona vengono esclusi. Il tipo è uno tra
`parrocchia`, `associazione`, `compagnia`, `altro`. Sono gestiti anche BOM,
virgolette, punti e virgola nei valori e campi su più righe. Massimo 500 KB,
500 righe nel file e 200 collegamenti confermati per importazione.

Il file viene letto nel browser. Nell’anteprima ogni nome è confrontato con le
persone della rubrica: se non c’è una corrispondenza unica occorre scegliere il
contatto corretto, oppure escludere la riga. Anche gruppo e tipo possono essere
corretti prima di salvare. L’importazione aggiunge appartenenze e conserva
persone già presenti nel gruppo, tipo, note e referente abituale. I nuovi gruppi
non ricevono automaticamente un referente abituale. Le attività già registrate
non vengono modificate.

L’operazione è atomica: un errore o una versione cambiata del gruppo annullano
l’intero salvataggio. Ripetere lo stesso import senza modifiche intermedie non
aggiunge duplicati. Dopo l’importazione, aprire un gruppo dalla rubrica per
rinominarlo, cambiare le persone, scegliere il referente abituale o archiviarlo.
Nessun file viene ricaricato automaticamente e nessun collegamento viene
ripristinato all’apertura dell’app. Un’ulteriore importazione avviene soltanto
con una nuova azione esplicita nell’anteprima.

Richiede [`041_importa_collegamenti_gruppi.sql`](supabase/041_importa_collegamenti_gruppi.sql)
dopo 040. I CSV con nomi reali restano fuori dal repository e dal sito pubblico;
la migrazione contiene solo la funzione di importazione e i controlli dei ruoli.


### Domande condizionali per saggi di danza

Nella scheda esterna esistente, selezionando **Saggio di danza** fra i tipi di
evento si apre la sezione specifica. Non occorre un modulo o un token diverso.
Scegliendo un altro tipo, le domande spariscono e i dati danza nascosti non
vengono inviati. Le schede parrocchiali mantengono il loro percorso.

La sezione raccoglie stili e svolgimento, ballerini complessivi e contemporanei
sul palco, minori e fasce d’età, accompagnatori e responsabile adulto, pubblico
per replica, pavimento/tappeto e calzature, cambi costume e retropalco, basi
musicali e scaletta, operatore audio, luci e link tecnico facoltativo. Le domande
su minori, tappeto proprio, cambi costume e basi si aprono solo quando pertinenti.
Non vengono richiesti elenchi o dati anagrafici dei bambini.

Nelle date ogni riga indica **Prova** oppure **Saggio / replica**. Si possono
inserire più righe nello stesso giorno con accesso, allestimento, apertura porte,
inizio, fine e sgombero. Sono controllati ordine degli orari, sovrapposizioni
fra le righe e capienza del pubblico (338 in platea, 472 con galleria). Spazi,
posa/disponibilità del tappeto e dotazioni restano richieste da concordare.
Il salvataggio della scheda non cambia prezzi, prenotazioni o turni e non
prenota automaticamente prove o repliche aggiuntive.

Le risposte sono visibili nella revisione, nella scheda evento e in **La serata**
per i ruoli che possono gestire le richieste. Prima dell’approvazione, la Sala
conferma le verifiche su programma, pavimento, retropalco, tecnica e, se presenti,
minori, oltre al parere di compatibilità già previsto. Il database controlla
anche le approvazioni fatte tramite API. Un nuovo invio azzera le verifiche;
una revisione aperta prima di un cambiamento delle risposte non può approvarle
senza rileggerle. Nessuna verifica o nota interna è restituita dal link pubblico.

Le bozze vengono mantenute anche dopo un invio finché la versione server non
cambia. Il link personale mostra il riepilogo danza in sola lettura dopo
l’approvazione. Le schede già approvate prima dell’aggiornamento restano valide;
le richieste danza precedenti ancora da approvare devono essere completate
con i nuovi dettagli dallo stesso link personale.

Richiede [`042_schede_danza.sql`](supabase/042_schede_danza.sql) dopo 041.

## Diritti
© 2026 Fabio Santi, realizzata per la Sala San Tommaso Moro (Parrocchia di San Biagio). Tutti i diritti riservati:
il codice è visibile ma non può essere copiato, modificato o riusato senza autorizzazione scritta. Vedi il file `LICENSE`.
