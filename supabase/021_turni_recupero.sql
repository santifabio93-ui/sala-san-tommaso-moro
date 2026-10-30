-- Sala San Tommaso Moro — aggiornamento 21: il volontario che ha perso il suo link dei turni lo recupera da solo.
-- Dalla pagina dei turni (senza codice) scrive cellulare e data di nascita: se corrispondono a un volontario attivo
-- riceve di nuovo il suo link. Pochi tentativi sbagliati all'ora, poi la pagina si ferma per un po'.
-- Serve l'aggiornamento 19 (data di nascita dei volontari).
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

create table if not exists public.turni_recuperi (
  id bigint generated always as identity primary key,
  riuscito boolean not null,
  creato timestamptz not null default now()
);
alter table public.turni_recuperi enable row level security;  -- nessuna policy: la legge solo la funzione

-- solo le cifre, senza prefisso internazionale italiano
create or replace function public.solo_cellulare(t text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(t, ''), '\D', '', 'g'), '^(0039|39)(3\d{8,9})$', '\2')
$$;

create or replace function public.turni_recupera(p_cellulare text, p_nascita date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tok uuid;
begin
  if length(public.solo_cellulare(p_cellulare)) < 8 or p_nascita is null then return null; end if;  -- non conta come tentativo
  if (select count(*) from public.turni_recuperi where not riuscito and creato > now() - interval '1 hour') >= 20 then
    raise exception 'Troppi tentativi: riprova tra un''ora o chiedi il link a chi organizza i turni';
  end if;
  select token into tok from public.volontari
  where attivo and data_nascita = p_nascita
    and public.solo_cellulare(cellulare) = public.solo_cellulare(p_cellulare)
  limit 1;
  insert into public.turni_recuperi (riuscito) values (tok is not null);
  delete from public.turni_recuperi where creato < now() - interval '7 days';
  return tok;
end $$;
revoke all on function public.turni_recupera(text, date) from public;
grant execute on function public.turni_recupera(text, date) to anon, authenticated;

notify pgrst, 'reload schema';

select exists (select 1 from pg_proc where proname = 'turni_recupera') as recupero_link;
