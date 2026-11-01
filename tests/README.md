# Test di regressione

I test usano un Supabase **locale e dedicato**, ricostruito da `schema.sql` e da
tutti gli aggiornamenti numerati in ordine. Non servono credenziali reali.
`config.js` non viene modificato: Playwright sostituisce la risposta HTTP con la
configurazione locale e blocca le richieste al dominio Supabase di produzione.

Prerequisiti: Docker avviato, Python 3.12+, Node 22+.

```sh
npm install --prefix /tmp/sala-test-tools supabase@2.122.0
python3 -m pip install -r tests/requirements.txt
python3 -m playwright install --with-deps chromium
SUPABASE_CLI=/tmp/sala-test-tools/node_modules/.bin/supabase python3 tests/prepare.py
python3 -m unittest discover -s tests -v
```

Se Chromium è già installato, usare `CHROMIUM_PATH=/usr/bin/chromium` nel comando
dei test. Nel cloud conservare proxy e certificati configurati; non disabilitare
la verifica TLS. La CLI usa il mirror ufficiale Docker Hub. I proxy Docker devono escludere
`localhost`, `127.0.0.1`, `::1`, `0.0.0.0` e i servizi interni `kong`, `db`,
`rest`, `auth`, `storage`, `realtime` tramite `noProxy`, preservando le altre
impostazioni e credenziali Docker. Dopo una modifica ricreare i container.
Lo script aggiunge inoltre nei soli container Auth e Storage un wrapper per BusyBox wget:
soltanto le richieste esatte a `http://127.0.0.1:9999/health` e
`http://127.0.0.1:5000/status` usano `-Y off`,
perché quel client ignora `no_proxy`. Tutte le altre richieste mantengono il proxy.

`prepare.py` azzera **solo** il database del progetto locale
`sala-regression-tests` (API 55321, database 55322). Non usare queste porte per
altri progetti. La configurazione generata e le chiavi esclusivamente locali
restano in `tests/.runtime/`, ignorato da Git. Il server HTTP dei test usa 8765.
I file SQL originali non vengono alterati. L'accesso Google non viene simulato:
i test creano account email/password solo nell'autenticazione locale.

Scenari: creazione prenotazione dal browser e persistenza dopo ricaricamento;
incasso parziale e saldo mostrato; iscrizione ripetuta e concorrente; rifiuto di
link inventati; cambio turno solo dopo accettazione e rifiuto della seconda
accettazione; lettura/scrittura vietata ai ruoli volontario, in attesa e bloccato,
con controllo dei campi della vista del database per i volontari.
L’esito iniziale e il difetto rilevato sono documentati in [RESULTS.md](RESULTS.md).
Le operazioni sui turni vengono esercitate contro le RPC reali e dal browser;
anche prenotazioni e incassi passano dall'interfaccia reale. Non sono test completi di tutti i
ruoli o funzionalità dell'app.

GitHub Actions esegue la suite per le pull request e su avvio manuale; non
pubblica il sito e non richiede secrets. Il controllo diventa attivo quando i
file vengono caricati su GitHub. Per renderlo obbligatorio prima del merge,
selezionare il job `regression` nelle regole del branch.

Per fermare ed eliminare i dati locali di prova:

```sh
/tmp/sala-test-tools/node_modules/.bin/supabase --workdir tests/.runtime stop --no-backup
```

## Applicare la correzione online

La suite ha identificato e verificato la correzione delle iscrizioni simultanee.
Nel SQL Editor del progetto Supabase eseguire
[`036_turni_iscrizione_simultanea.sql`](../supabase/036_turni_iscrizione_simultanea.sql),
dopo gli aggiornamenti precedenti. Non serve modificare `config.js` o ripubblicare
il frontend per questa correzione. Il file può essere rieseguito senza problemi.
La modifica è stata applicata solo al database locale durante questi test.

## Scheda evento

La suite verifica anche l’apertura dalla prenotazione, la persistenza del link
all’evento, il pagamento aggiornato dalla scheda, i turni filtrati per evento,
i documenti e i materiali di un affitto privato, l’assenza di dati riservati nella
vista volontario, eventi annullati o inesistenti e servizi temporaneamente non
disponibili. La vista mobile è controllata a 390 px per evitare scorrimento
orizzontale. Per salvare uno screenshot di prova, impostare `SALA_SCREENSHOT`
a un percorso locale durante l’esecuzione.

## Preventivo per affitti

I test verificano l’IVA sul solo spazio e sui supplementi, la conservazione
dell’importo concordato, le differenze con le tariffe attuali, la riapertura
della bozza, le richieste email con dati incompleti e il blocco di importi negativi
o validità incoerenti. La stampa viene aperta in un popup reale e viene generato
un PDF con Chromium, verificando che non contenga note interne o script eseguibili.
I controlli confermano che prenotazioni, incassi e richieste non vengano modificati.
Per conservare gli artefatti della prova impostare `SALA_QUOTE_PDF` e, per la vista
mobile, `SALA_QUOTE_SCREENSHOT` a percorsi locali.

## Richieste parrocchiali

La migrazione 037 viene applicata automaticamente da `prepare.py`. I test
verificano il percorso completo gestore → link → invio → approvazione → incontri
gratuiti, la riapprovazione senza duplicati, il collegamento delle risposte a
più incontri, il blocco di sovrapposizioni senza inserimenti parziali, i tempi
di preparazione/riordino, i permessi di assegnazione e approvazione, la gratuità
anche contro modifiche API e la validazione di attività, capienza e opere protette.
Le richieste di prova e tutti gli incontri generati vengono eliminati dal solo
Supabase locale a fine test. Nessuna credenziale reale necessaria.

### Dettagli del percorso parrocchiale

L’aggiornamento 038 viene applicato dopo 037. Le prove includono una conferenza
con palco, relatori, proiettore, più tipi di microfono, tecnico e materiali
propri; controllano salvataggio e modifica dal modulo, revisione del gestore e
riepilogo nella scheda evento. Altri casi verificano descrizione/uso degli spazi
obbligatori, dotazioni incompatibili con la galleria, quantità e recapiti mancanti,
accessibilità e pulizia dei campi disattivati. Il responsabile presente già
indicato viene conservato quando è diverso dal referente.

### Link personali e cache

La suite controlla che i link copiati abbiano la versione dell’app, che la pagina
indichi il percorso esterno/parrocchiale e che le richieste approvate mostrino
il riepilogo completo senza tornare modificabili. Una pagina HTML precedente
viene servita tramite HTTP locale per verificare la compatibilità con script
aggiornati, mantenendo attivi i normali controlli di origine e rete del browser.

## Panoramica e preparazione degli eventi

La migrazione 044 aggiunge stati condivisi per prenotazioni e proiezioni.
I test controllano il salvataggio e la persistenza dal browser, il programma di
oggi e domani, l’esclusione degli annullati, le persone nei turni, le proiezioni,
i problemi e la vista mobile. Le API locali verificano i permessi di tutti i
ruoli, la vista ridotta per i volontari, il divieto di scrittura diretta,
i salvataggi concorrenti, la validazione, i cambi di data/orario e la cancellazione
in cascata. I servizi non disponibili restano esplicitamente da verificare.
Per salvare l’anteprima mobile impostare `SALA_TODAY_SCREENSHOT` a un percorso locale.

### Elimina dalla panoramica

L’aggiornamento 045 viene incluso nella ricostruzione locale. I test verificano
Annulla/conferma, persistenza dopo ricaricamento, errore senza cancellazione,
permessi, pagine rimaste indietro, preparazione rimossa in cascata e conservazione
degli incassi. Le importazioni reali tramite RPC locali confermano che gli eventi
Google restino annullati nell’app e le repliche Cinebot eliminate non ricompaiano,
conservando film e altri orari. Non vengono chiamati Google o Cinebot reali.
