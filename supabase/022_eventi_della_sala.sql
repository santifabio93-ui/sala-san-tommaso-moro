-- Sala San Tommaso Moro — aggiornamento 22: eventi organizzati dalla Sala stessa.
-- Non sono affitti: niente scheda di richiesta da mandare, niente prezzo da incassare. Si segnano con la spunta
-- «Organizzato dalla Sala» nella prenotazione (o con «È della Sala» nelle schede). La sincronizzazione non la tocca.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

alter table public.bookings add column if not exists della_sala boolean not null default false;

notify pgrst, 'reload schema';

select exists (select 1 from information_schema.columns where table_name = 'bookings' and column_name = 'della_sala') as eventi_della_sala;
