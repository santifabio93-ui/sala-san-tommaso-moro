# Esiti della validazione

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
