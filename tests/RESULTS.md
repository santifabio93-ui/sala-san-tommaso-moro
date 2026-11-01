# Esiti della validazione

## Eventi della Sala e sezioni per l’ospite: 28 test superati

Suite completa su Supabase locale reale e Chromium: OK, 28 test in circa
75 secondi. Database ricostruito da zero da 39 file SQL; migrazione 039
rieseguita con successo per controllarne anche l’idempotenza.

Verificati il salvataggio di una conferenza senza campi teatrali, la selezione
delle sezioni delegate, la compilazione pubblica di audio e palco, la revisione
della Sala e il riepilogo operativo nella serata. Una risposta successiva annulla
la precedente conferma. Cambi di orario richiedono nuova verifica; annullamento
e cambio di incarico revocano i link precedenti. I controlli di revisione
impediscono le sovrascritture di dati cambiati nel frattempo.

Le API pubbliche restituiscono soltanto titolo, data/orari, tipo, sezioni e
risposte dell’ospite: nessuna nota interna o informazione economica. Testati
rifiuto di campi non assegnati, permessi dei ruoli, quantità e link tecnici
non validi, bozza incompleta e conferma prematura. Controllati il trasferimento
esplicito dei soli testi autorizzati al dialogo social, senza salvataggio
automatico, e la presenza dei nuovi dati nel backup JSON.

Moduli interno e ospite verificati a 390 px senza scorrimento orizzontale.
Sintassi e compressione con Terser 5.49.2 superate per i quattro moduli coinvolti.
Nessuna modifica al database reale e nessuna pubblicazione; per l’attivazione
applicare 039 dopo le migrazioni precedenti, prima della pubblicazione dell’app.

## Link personali e riepilogo approvato: 24 test superati

Riprodotto il percorso che, dopo l’approvazione, mostrava solo conferma e date:
ora espone anche attività, persone, sala, allestimento, dotazioni ed esigenze
in sola lettura. Testati contenuti del riepilogo e assenza di un modulo inviabile.
La suite completa ha terminato con OK (24 test, circa 65 secondi). Dopo la
rifinitura di compatibilità è passata anche la prova mirata con una vecchia
pagina HTML servita su HTTP locale e script aggiornati, senza disabilitare i
controlli di sicurezza del browser. Controllati versione nei link, percorso
visibile e compressione Terser.

La lettura diretta di GitHub Pages è bloccata dalla policy di rete della sessione:
queste prove non verificano il dominio o la cache del browser dell’utilizzatore.
Nessuna nuova migrazione SQL e nessuna modifica alle richieste reali.

## Richieste parrocchiali dettagliate: 23 test eseguiti, 23 superati

Il modulo raccoglie descrizione obbligatoria dell’attività, utilizzo delle sale,
allestimento e palco, contenuti/collegamento della proiezione, uso dell’audio e
quantità delle dotazioni, tecnico, attrezzature/materiali propri ed esigenze
organizzative. Verificati validazione dei campi condizionali, incompatibilità
con la galleria e visibilità dei dettagli nella revisione e nella scheda evento.
Il responsabile diverso dal referente viene conservato.

Ricostruzione del database locale da 38 file SQL e suite completa terminata con
OK (23 test, circa 67 secondi). Dopo la rifinitura delle bozze, rieseguito e
superato anche il test completo modulo → ricaricamento → invio → gestore → scheda
evento. La bozza di una richiesta già inviata conserva le modifiche sul dispositivo
quando la versione server non è cambiata. Ispezionata la vista mobile dettagliata
a 390 px, senza scorrimento orizzontale. Compressione Terser verificata.
Nessuna modifica al database reale; per l’attivazione applicare 038 dopo 037.

## Percorso parrocchiale: 21 test eseguiti, 21 superati

Verificato il flusso dal gestore che predispone il link all’invio del referente,
alla verifica e approvazione e alla creazione di più incontri gratuiti.
Controllati blocco delle sovrapposizioni con rollback dell’intera richiesta,
riapprovazione senza duplicati, tempi di preparazione/riordino, dati del gruppo,
capienza, attività ammesse e gestione delle opere protette. Gli utenti esterni
non possono assegnarsi il percorso o approvarsi; anche la segreteria non può
assegnare il percorso o cambiare le date degli incontri parrocchiali.
Prezzi/incassi diversi da zero, distacco dalla richiesta e date non approvate
vengono bloccati nel database. Il riepilogo del richiedente riflette gli incontri
correnti dopo le modifiche del gestore.

Le 37 migrazioni sono state ricostruite da zero; l’ultima versione di 037 è stata
anche rieseguita incrementalmente senza errori, poi l’intera suite ha terminato
con OK (21 test, circa 64 secondi). Verificata la vista a 390 px, senza scorrimento
orizzontale, e ispezionato uno screenshot. Il modulo cartaceo mantiene 2 pagine.
Verificata la compressione con Terser 5.49.2. Nessuna operazione sul database reale.
Per l’attivazione online è necessario applicare 037 prima della pubblicazione.

## Preventivo affitti: 16 test eseguiti, 16 superati

Verificati tariffa a giornata, supplementi e IVA nelle due configurazioni,
importi concordati e differenze rispetto alla prenotazione, bozze riaperte dopo
un cambio del prezzo, dati incompleti delle richieste email e importi/validità
non ammessi. La stampa apre un documento separato e Chromium genera un PDF
reale; il testo estratto dal PDF conferma destinatario, totale e condizioni,
senza le note interne della prenotazione. I testi vengono mostrati come testo,
senza eseguire markup inserito dall’utente. Verificata anche la vista mobile.
La generazione non modifica prenotazioni, incassi o richieste. Nessun nuovo SQL.
Le bozze sono conservate solo nella memoria della pagina aperta.

## Scheda evento: 12 test eseguiti, 12 superati

La suite estesa verifica l’apertura della scheda dalla prenotazione, la
persistenza del collegamento, i pagamenti, i turni filtrati per evento, documenti
e materiali, i limiti della vista volontario, gli eventi annullati o mancanti e
le risposte di errore dei servizi. I controlli precedenti rimangono attivi.
Verificata la vista mobile a 390 px, senza scorrimento orizzontale, e ispezionato
uno screenshot. Anche la compressione di app.js ed evento.js con Terser 5.49.2
è riuscita. Nessun nuovo aggiornamento SQL; verifiche eseguite su dati locali.

## Baseline precedente

Validazione locale sul codice presente il 31 ottobre 2026, con Supabase CLI
2.122.0, PostgreSQL 17 e Chromium, su dati esclusivamente fittizi.

Lo schema e tutti i 34 aggiornamenti numerati (002–035) si applicano da zero:
35 file SQL in totale. Non è stata verificata la corrispondenza con lo schema
attualmente installato nel progetto Supabase reale.

## Suite: 7 test eseguiti, 6 superati, 1 fallito

Superati:

- Creazione di una prenotazione dal browser e verifica dopo ricaricamento.
- Incasso parziale di 150 su 500, persistito e saldo di 350 mostrato.
- Iscrizione ripetuta in sequenza senza duplicati e rifiuto di un link inventato.
- Richiesta di cambio che conserva il titolare fino all'accettazione; rifiuto di
  una seconda accettazione della stessa richiesta.
- Permessi API per volontari, utenti in attesa e bloccati, inclusi tentativi di
  modifica delle prenotazioni e di promozione autonoma ad amministratore;
  assenza dei campi economici e dei contatti nella vista dei volontari.
- Iscrizione e scambio di turno dal browser tramite i link personali.

Fallito: `test_concurrent_signup_is_successful_exactly_once`.
Due richieste simultanee di iscrizione dello stesso volontario allo stesso turno
lasciano correttamente una sola iscrizione, ma una richiesta riceve HTTP 409,
SQLSTATE 23505 (`signups_volontario_una_volta`).

La riproduzione è deterministica: il test blocca temporaneamente la riga
dell'evento nel database locale, attende che entrambe le richieste API siano
in attesa del blocco, poi lo rilascia. Nessuna modifica alle funzioni SQL viene
usata per riprodurre il problema.

Causa: in `supabase/031_turni_oltre.sql`, `turni_segna` controlla se il volontario
è già iscritto **prima** di acquisire il blocco sull'evento. Entrambe le richieste
possono superare il controllo, poi una trova il vincolo univoco all'inserimento.
La correzione è nel nuovo aggiornamento
`supabase/036_turni_iscrizione_simultanea.sql`: acquisisce il blocco prima di
controllare l’iscrizione. Conserva il vincolo univoco, i permessi e il limite di
10 persone oltre i posti. Le migrazioni precedenti restano invariate.

## Dopo la correzione: 7 test eseguiti, 7 superati

L’aggiornamento 036 è stato applicato due volte al database locale senza errori,
poi la suite completa è terminata con `OK` (7 test, circa 9 secondi).
Il test concorrente resta attivo con la stessa sincronizzazione deterministica:
entrambe le richieste ora riescono e nel database rimane una sola iscrizione.

La ricostruzione da zero dei primi 35 file era già stata verificata. Il nuovo
aggiornamento è stato verificato incrementalmente su quel database; lo script
`prepare.py` include automaticamente anche 036 nelle ricostruzioni successive.

Per rendere effettiva la correzione online, eseguire il contenuto di 036 nel
SQL Editor del progetto Supabase. I test locali non modificano il progetto reale.
Non sono stati eseguiti login Google, pubblicazioni o push su GitHub.
L’esecuzione remota del workflow GitHub Actions resta da verificare dopo il
caricamento dei file nel repository.
