-- Sala San Tommaso Moro — aggiornamento 13: tariffe 2026 a giornata, in base allo spazio usato.
-- Galleria 400 €, platea 500 €, platea e galleria 800 € (+ IVA); supplementi: biglietteria 100 €,
-- tappeto danza 200 €, attività commerciale 100 €. Le cifre si cambiano poi dall'app (Economia → Spese e tariffe).
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

alter table public.settings add column if not exists tariffe jsonb not null default
  '{"galleria": 400, "platea": 500, "tutta": 800, "iva": 22, "iva_supplementi": false, "biglietteria": 100, "tappeto": 200, "commerciale": 100}'::jsonb;

-- per ogni prenotazione: spazio e supplementi scelti, così riaprendola si vede come è stato calcolato il prezzo
alter table public.bookings add column if not exists tariffa jsonb;

notify pgrst, 'reload schema';

select tariffe from public.settings where id = 1;
