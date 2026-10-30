-- Sala San Tommaso Moro — aggiornamento 10: scheda di richiesta online.
-- L'organizzatore riceve un link personale (con un codice segreto) e compila la scheda senza account;
-- lo staff segue nel cruscotto se è da inviare, inviata, aperta, compilata, approvata.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

create table if not exists public.schede (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),   -- il codice del link: chi lo ha vede solo questa scheda
  booking_id uuid references public.bookings(id) on delete set null,
  richiesta_id uuid references public.richieste(id) on delete set null,
  titolo text not null default '',
  data_evento date,
  destinatario text not null default '',
  contatto text not null default '',
  stato text not null default 'da_inviare'
    check (stato in ('da_inviare', 'inviata', 'aperta', 'compilata', 'approvata', 'respinta', 'non_serve')),
  inviata_il timestamptz,
  aperta_il timestamptz,
  compilata_il timestamptz,
  sollecitata_il timestamptz,
  dati jsonb not null default '{}'::jsonb,
  firma_nome text not null default '',
  sicurezza text check (sicurezza in ('compatibile', 'condizioni', 'non_compatibile')),
  sicurezza_note text not null default '',
  verificata_da uuid references auth.users(id) on delete set null,
  verificata_il timestamptz,
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now()
);
create index if not exists schede_booking on public.schede (booking_id);

alter table public.schede enable row level security;
drop policy if exists "schede: staff" on public.schede;
create policy "schede: staff" on public.schede
  for all using (public.my_role() in ('admin', 'coordinatore'))
  with check (public.my_role() in ('admin', 'coordinatore'));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'schede') then
    alter publication supabase_realtime add table public.schede;
  end if;
end $$;

-- l'organizzatore apre il link: riceve solo i dati della sua scheda (e la prima apertura viene registrata)
create or replace function public.scheda_apri(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.schede;
  b public.bookings;
begin
  select * into s from public.schede where token = p_token;
  if not found or s.stato = 'non_serve' then return null; end if;
  if s.aperta_il is null then
    update public.schede set aperta_il = now(),
      stato = case when stato in ('da_inviare', 'inviata') then 'aperta' else stato end
    where id = s.id;
  end if;
  if s.booking_id is not null then select * into b from public.bookings where id = s.booking_id; end if;
  return jsonb_build_object(
    'titolo', coalesce(nullif(s.titolo, ''), b.titolo, ''),
    'data', coalesce(s.data_evento, b.data),
    'inizio', to_char(b.inizio, 'HH24:MI'), 'fine', to_char(b.fine, 'HH24:MI'),
    'giornata_intera', coalesce(b.giornata_intera, false),
    'referente', coalesce(nullif(s.destinatario, ''), b.referente, ''),
    'telefono', coalesce(b.telefono, ''), 'email', coalesce(b.email, ''),
    'stato', s.stato, 'compilata_il', s.compilata_il,
    'dati', case when s.stato in ('compilata', 'respinta') then s.dati else '{}'::jsonb end,
    'chiusa', s.stato = 'approvata'
  );
end $$;

-- l'organizzatore invia la scheda compilata (si può reinviare finché non è approvata)
create or replace function public.scheda_invia(p_token uuid, p_dati jsonb, p_firma text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.schede;
begin
  select * into s from public.schede where token = p_token;
  if not found or s.stato = 'non_serve' then raise exception 'Scheda non trovata'; end if;
  if s.stato = 'approvata' then raise exception 'La scheda è già stata approvata: per modifiche contattate la sala'; end if;
  if jsonb_typeof(p_dati) <> 'object' or length(p_dati::text) > 30000 then raise exception 'Dati non validi'; end if;
  if length(trim(coalesce(p_firma, ''))) < 3 then raise exception 'Manca il nome di chi firma'; end if;
  update public.schede set dati = p_dati, firma_nome = left(trim(p_firma), 120), stato = 'compilata',
    compilata_il = now(), aggiornato = now(), aperta_il = coalesce(aperta_il, now())
  where id = s.id;
  return jsonb_build_object('ok', true, 'compilata_il', now());
end $$;

revoke all on function public.scheda_apri(uuid) from public;
revoke all on function public.scheda_invia(uuid, jsonb, text) from public;
grant execute on function public.scheda_apri(uuid) to anon, authenticated;
grant execute on function public.scheda_invia(uuid, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';

select to_regclass('public.schede') is not null as tabella_schede,
  exists (select 1 from pg_proc where proname = 'scheda_invia') as funzioni_scheda;
