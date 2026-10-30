-- Sala San Tommaso Moro — aggiornamento 12: ruolo «Social», archivio delle locandine, programma da pubblicare.
-- Il ruolo Social vede solo programmazione del cinema, eventi pubblicabili e locandine:
-- niente prezzi di affitto, contatti, cassa, economia o donatori.
-- Richiede gli aggiornamenti 5 (cinema) e 10 (schede). Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run.
-- Si può rieseguire senza problemi.

-- ---------- nuovo ruolo ----------
do $$
declare c record;
begin
  for c in select conname, conrelid::regclass as tab from pg_constraint
           where contype = 'c' and conrelid in ('public.profiles'::regclass, 'public.inviti'::regclass)
             and pg_get_constraintdef(oid) like '%ruolo%'
  loop
    execute format('alter table %s drop constraint %I', c.tab, c.conname);
  end loop;
end $$;
alter table public.profiles add constraint profiles_ruolo_check
  check (ruolo in ('admin', 'coordinatore', 'volontario', 'social', 'in_attesa', 'bloccato'));
alter table public.inviti add constraint inviti_ruolo_check
  check (ruolo in ('admin', 'coordinatore', 'volontario', 'social'));

-- il Social legge la programmazione del cinema (non la modifica)
drop policy if exists "film: approvati leggono" on public.films;
create policy "film: approvati leggono" on public.films
  for select using (public.my_role() in ('admin', 'coordinatore', 'volontario', 'social'));
drop policy if exists "proiezioni: approvati leggono" on public.proiezioni;
create policy "proiezioni: approvati leggono" on public.proiezioni
  for select using (public.my_role() in ('admin', 'coordinatore', 'volontario', 'social'));

-- ---------- quali eventi si possono pubblicare ----------
-- null = decide la scheda dell'organizzatore («possiamo pubblicare?»); true/false = deciso dalla sala
alter table public.bookings add column if not exists pubblico boolean;

-- programma tra due date: lo staff vede tutti gli eventi non annullati con la scelta,
-- il Social solo quelli confermati e pubblicabili, senza contatti né prezzi d'affitto
create or replace function public.programma_pubblico(p_da date, p_a date)
returns table (id uuid, titolo text, tipo text, data date, inizio text, fine text, giornata_intera boolean, stato text,
               pubblico boolean, scelta boolean, dalla_scheda text, ente text, descrizione text, ingresso text,
               prezzo_biglietto text, locandina_entro date)
language sql stable security definer set search_path = public as $$
  with r as (select public.my_role() as ruolo),
  e as (
    select b.*, sk.dati as dati
    from public.bookings b
    left join lateral (
      select s.dati from public.schede s
      where s.booking_id = b.id and s.stato in ('compilata', 'approvata')
      order by s.compilata_il desc nulls last limit 1
    ) sk on true
    where b.data between p_da and p_a and b.stato <> 'annullata'
  )
  select e.id, coalesce(nullif(e.dati->>'titolo', ''), e.titolo), e.tipo, e.data,
    to_char(e.inizio, 'HH24:MI'), to_char(e.fine, 'HH24:MI'), coalesce(e.giornata_intera, false), e.stato,
    coalesce(e.pubblico, e.dati->>'pubblicabile' = 'si', false), e.pubblico, e.dati->>'pubblicabile',
    coalesce(e.dati->>'ente', ''), coalesce(e.dati->>'descrizione', ''), coalesce(e.dati->>'ingresso', ''),
    coalesce(e.dati->>'prezzo', ''),
    case when coalesce(e.dati->>'locandina_entro', '') ~ '^\d{4}-\d{2}-\d{2}$' then (e.dati->>'locandina_entro')::date end
  from e, r
  where r.ruolo in ('admin', 'coordinatore')
     or (r.ruolo = 'social' and e.stato = 'confermata' and coalesce(e.pubblico, e.dati->>'pubblicabile' = 'si', false))
  order by e.data, e.inizio
$$;
revoke all on function public.programma_pubblico(date, date) from public;
grant execute on function public.programma_pubblico(date, date) to authenticated;

-- ---------- archivio delle locandine ----------
create table if not exists public.locandine (
  id uuid primary key default gen_random_uuid(),
  percorso text not null unique,          -- file nello spazio «locandine»
  nome text not null default '',
  titolo text not null default '',
  data date,
  booking_id uuid references public.bookings(id) on delete set null,
  film_id uuid references public.films(id) on delete set null,
  fonte text not null default 'sala' check (fonte in ('sala', 'organizzatore')),
  caricato_da uuid references auth.users(id) on delete set null default auth.uid(),
  creato timestamptz not null default now()
);
create index if not exists locandine_data on public.locandine (data);

alter table public.locandine enable row level security;
drop policy if exists "locandine: leggono" on public.locandine;
create policy "locandine: leggono" on public.locandine
  for select using (public.my_role() in ('admin', 'coordinatore', 'social'));
drop policy if exists "locandine: caricano" on public.locandine;
create policy "locandine: caricano" on public.locandine
  for insert with check (public.my_role() in ('admin', 'coordinatore', 'social') and fonte = 'sala' and percorso like 'sala/%');
drop policy if exists "locandine: modificano" on public.locandine;
create policy "locandine: modificano" on public.locandine
  for update using (public.my_role() in ('admin', 'coordinatore', 'social'))
  with check (public.my_role() in ('admin', 'coordinatore', 'social'));
drop policy if exists "locandine: eliminano" on public.locandine;
create policy "locandine: eliminano" on public.locandine
  for delete using (public.my_role() in ('admin', 'coordinatore', 'social'));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'locandine') then
    alter publication supabase_realtime add table public.locandine;
  end if;
end $$;

-- spazio file: immagini e PDF fino a 15 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('locandine', 'locandine', false, 15728640,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- (uguale all'aggiornamento 11: vero se il codice del link è di una scheda ancora modificabile)
create or replace function public.scheda_token_valido(p_token text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.schede
    where token::text = p_token and stato not in ('approvata', 'non_serve')
  )
$$;
revoke all on function public.scheda_token_valido(text) from public;
grant execute on function public.scheda_token_valido(text) to anon, authenticated;

-- l'organizzatore carica la locandina dalla sua scheda, nella cartella con il codice del link
drop policy if exists "locandine file: organizzatore carica" on storage.objects;
create policy "locandine file: organizzatore carica" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'locandine' and public.scheda_token_valido((storage.foldername(name))[1]));
-- staff e Social caricano nella cartella «sala», leggono ed eliminano tutto
drop policy if exists "locandine file: sala carica" on storage.objects;
create policy "locandine file: sala carica" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'locandine' and (storage.foldername(name))[1] = 'sala'
              and public.my_role() in ('admin', 'coordinatore', 'social'));
drop policy if exists "locandine file: leggono" on storage.objects;
create policy "locandine file: leggono" on storage.objects
  for select to authenticated
  using (bucket_id = 'locandine' and public.my_role() in ('admin', 'coordinatore', 'social'));
drop policy if exists "locandine file: eliminano" on storage.objects;
create policy "locandine file: eliminano" on storage.objects
  for delete to authenticated
  using (bucket_id = 'locandine' and public.my_role() in ('admin', 'coordinatore', 'social'));

-- quando l'organizzatore invia la scheda, le sue locandine entrano nell'archivio
-- (solo file della sua cartella e solo se ha detto che l'evento si può pubblicare)
create or replace function public.schede_locandine() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.dati->>'pubblicabile' = 'si' and jsonb_typeof(new.dati->'locandina_file') = 'array' then
    insert into public.locandine (percorso, nome, titolo, data, booking_id, fonte, caricato_da)
    select f->>'percorso', left(coalesce(f->>'nome', ''), 200),
      coalesce(nullif(new.dati->>'titolo', ''), new.titolo), new.data_evento, new.booking_id, 'organizzatore', null
    from jsonb_array_elements(new.dati->'locandina_file') f
    where f->>'percorso' like new.token::text || '/%'
    on conflict (percorso) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists schede_locandine on public.schede;
create trigger schede_locandine after insert or update of dati on public.schede
  for each row execute function public.schede_locandine();

notify pgrst, 'reload schema';

select to_regclass('public.locandine') is not null as archivio_locandine,
  exists (select 1 from storage.buckets where id = 'locandine') as spazio_file,
  exists (select 1 from pg_proc where proname = 'programma_pubblico') as programma;
