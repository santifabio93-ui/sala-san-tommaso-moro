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
