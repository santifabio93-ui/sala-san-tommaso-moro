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

- **Calendario nei due sensi** (account della sala): gli eventi del Google Calendar compaiono nell'app,
  e le prenotazioni create o modificate nell'app finiscono nel calendario. Nel titolo, «Ref. Nome 333-…»
  diventa referente e telefono; «EVENTO DA PERFEZIONARE» e «OPZIONE –» diventano stato *Opzione*.
  Gli eventi ricorrenti (es. cineforum) si modificano solo da Google Calendar.
- **Email**: le email che chiedono la sala compaiono in **Richieste**, con data e ora riconosciute quando
  scritte per esteso. Ricevono l'etichetta Gmail «Sala/Richieste»; un'email con quell'etichetta, messa a mano,
  entra sempre.

### Installazione
1. In Supabase esegui `supabase/002_sincronizzazione.sql` nel SQL Editor e copia il **codice di sincronizzazione** che compare.
2. Entra in https://script.google.com con l'account **salatommasomoro@gmail.com** → **Nuovo progetto**,
   cancella il contenuto e incolla `google-apps-script/Sincronizzazione.gs`. Salva.
3. **Impostazioni progetto** (ingranaggio) → **Proprietà script** → aggiungi:
   `SUPABASE_URL`, `SUPABASE_KEY` (la chiave publishable), `SYNC_TOKEN` (il codice del punto 1), `MODALITA` = `calendario+email`.
4. Torna all'editor, scegli la funzione **installa** e premi **Esegui**; accetta i permessi.
5. Ripeti i punti 2–4 con l'account **santifabio93@gmail.com**, con `MODALITA` = `email`.

## Backup
In **Economia → Esporta tutto** scarichi un file JSON con tutti i dati e un CSV delle prenotazioni
(apribile con Excel). Conviene farlo una volta al mese: il piano gratuito non ha backup scaricabili.

## Privacy
L'app conserva nomi, telefoni ed email di clienti e volontari. Prepara una breve informativa privacy
e, se la sala fa capo a una parrocchia o associazione, falla verificare da chi segue questi aspetti.
