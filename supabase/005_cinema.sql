-- Sala San Tommaso Moro — aggiornamento 5: Cinema (film in programma, supporti, prove).
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run.
-- Si può rieseguire senza problemi: crea solo ciò che manca e aggiorna il resto.

create table if not exists public.films (
  id uuid primary key default gen_random_uuid(),
  titolo text not null check (length(trim(titolo)) > 0),
  locandina_url text not null default '',
  cinebot_id text unique,
  cinebot_url text not null default '',
  distributore text not null default '',
  -- come si proietta
  supporto text check (supporto in ('file', 'dvd', 'bluray', 'link')),
  -- se il supporto è già in sala
  acquisizione text not null default 'da_procurare' check (acquisizione in ('da_procurare', 'in_arrivo', 'disponibile')),
  disponibile_il date,
  dove text not null default '',
  -- prova di proiezione
  provato_il date,
  prova_esito text check (prova_esito in ('ok', 'problemi')),
  prova_note text not null default '',
  provato_da uuid references auth.users(id) on delete set null,
  note text not null default '',
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now()
);

create table if not exists public.proiezioni (
  id uuid primary key default gen_random_uuid(),
  film_id uuid not null references public.films(id) on delete cascade,
  data date not null,
  ora time not null,
  fonte text not null default 'manuale' check (fonte in ('manuale', 'cinebot')),
  cinebot_key text unique,
  creato timestamptz not null default now()
);
create index if not exists proiezioni_data on public.proiezioni (data, ora);

alter table public.films enable row level security;
alter table public.proiezioni enable row level security;

-- tutti gli approvati vedono la programmazione; tutti possono aggiornare supporto e prova;
-- solo lo staff aggiunge o elimina film e proiezioni
drop policy if exists "film: approvati leggono" on public.films;
create policy "film: approvati leggono" on public.films
  for select using (public.my_role() in ('admin', 'coordinatore', 'volontario'));
drop policy if exists "film: approvati aggiornano" on public.films;
create policy "film: approvati aggiornano" on public.films
  for update using (public.my_role() in ('admin', 'coordinatore', 'volontario'))
  with check (public.my_role() in ('admin', 'coordinatore', 'volontario'));
drop policy if exists "film: staff inserisce" on public.films;
create policy "film: staff inserisce" on public.films
  for insert with check (public.my_role() in ('admin', 'coordinatore'));
drop policy if exists "film: staff elimina" on public.films;
create policy "film: staff elimina" on public.films
  for delete using (public.my_role() in ('admin', 'coordinatore'));
drop policy if exists "proiezioni: approvati leggono" on public.proiezioni;
create policy "proiezioni: approvati leggono" on public.proiezioni
  for select using (public.my_role() in ('admin', 'coordinatore', 'volontario'));
drop policy if exists "proiezioni: staff gestisce" on public.proiezioni;
create policy "proiezioni: staff gestisce" on public.proiezioni
  for all using (public.my_role() in ('admin', 'coordinatore'))
  with check (public.my_role() in ('admin', 'coordinatore'));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'films') then
    alter publication supabase_realtime add table public.films;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'proiezioni') then
    alter publication supabase_realtime add table public.proiezioni;
  end if;
end $$;

alter table public.settings add column if not exists sync_cinebot timestamptz;

-- lo script Google manda la programmazione letta da Cinebot:
-- [{ "cinebot_id", "titolo", "locandina", "url", "proiezioni": [{ "key", "data": "YYYY-MM-DD", "ora": "HH:MM" }] }]
-- Film e orari nuovi si aggiungono, gli orari futuri tolti da Cinebot si tolgono.
-- Supporto, prova e note scritti nell'app non vengono mai toccati.
create or replace function public.sync_cinebot_push(p_token text, p_films jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f jsonb; pr jsonb;
  fid uuid;
  keys text[] := '{}';
  n_pr int := 0; n_del int := 0;
begin
  perform public.sync_check(p_token);
  for f in select * from jsonb_array_elements(p_films) loop
    insert into public.films (cinebot_id, titolo, locandina_url, cinebot_url)
    values (f->>'cinebot_id', f->>'titolo', coalesce(f->>'locandina', ''), coalesce(f->>'url', ''))
    on conflict (cinebot_id) do update set
      titolo = excluded.titolo,
      locandina_url = case when excluded.locandina_url <> '' then excluded.locandina_url else films.locandina_url end,
      cinebot_url = case when excluded.cinebot_url <> '' then excluded.cinebot_url else films.cinebot_url end
    returning id into fid;
    for pr in select * from jsonb_array_elements(coalesce(f->'proiezioni', '[]')) loop
      keys := keys || (pr->>'key');
      insert into public.proiezioni (film_id, data, ora, fonte, cinebot_key)
      values (fid, (pr->>'data')::date, (pr->>'ora')::time, 'cinebot', pr->>'key')
      on conflict (cinebot_key) do update set data = excluded.data, ora = excluded.ora, film_id = excluded.film_id;
      n_pr := n_pr + 1;
    end loop;
  end loop;
  with gone as (
    delete from public.proiezioni
    where fonte = 'cinebot' and data >= current_date and not (cinebot_key = any(keys))
    returning 1
  ) select count(*) into n_del from gone;
  update public.settings set sync_cinebot = now() where id = 1;
  return jsonb_build_object('film', jsonb_array_length(p_films), 'proiezioni', n_pr, 'tolte', n_del);
end $$;

revoke all on function public.sync_cinebot_push(text, jsonb) from public;
grant execute on function public.sync_cinebot_push(text, jsonb) to anon;

-- controllo finale: devono risultare tutte «true»
select
  to_regclass('public.films') is not null as tabella_film,
  to_regclass('public.proiezioni') is not null as tabella_proiezioni,
  exists (select 1 from pg_proc where proname = 'sync_cinebot_push') as funzione_cinebot,
  exists (select 1 from information_schema.columns where table_name = 'settings' and column_name = 'sync_cinebot') as colonna_sync;
