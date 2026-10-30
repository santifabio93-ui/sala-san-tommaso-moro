-- Sala San Tommaso Moro — aggiornamento 16: richieste di film al SAS (ACEC Triveneta).
-- Catalogo dei film da cui scegliere (gli elenchi mandati dal SAS) e richieste con date, stato e condizioni
-- confermate (agenzia, distributore, supporto, minimo garantito, percentuale).
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

create table if not exists public.catalogo_film (
  id uuid primary key default gen_random_uuid(),
  titolo text not null check (length(trim(titolo)) > 0),
  anno int,
  regista text not null default '',
  link text not null default '',
  sezione text not null default '',
  fonte text not null default '',
  creato timestamptz not null default now()
);
create unique index if not exists catalogo_film_unico on public.catalogo_film (lower(titolo), coalesce(anno, 0));

create table if not exists public.richieste_film (
  id uuid primary key default gen_random_uuid(),
  titolo text not null check (length(trim(titolo)) > 0),
  anno int,
  regista text not null default '',
  link text not null default '',
  date jsonb not null default '[]'::jsonb,     -- [{ "data": "2026-12-03", "fasce": "pomeriggio e sera" }]
  motivo text not null default '',
  biglietto boolean not null default true,
  note text not null default '',
  stato text not null default 'bozza' check (stato in ('bozza', 'inviata', 'confermata', 'non_disponibile')),
  agenzia text not null default '',
  distributore text not null default '',
  supporto text not null default '',
  minimo numeric(10, 2),
  percentuale numeric(5, 2),
  risposta text not null default '',
  inviata_il timestamptz,
  risposta_il timestamptz,
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now()
);

alter table public.catalogo_film enable row level security;
alter table public.richieste_film enable row level security;
drop policy if exists "catalogo film: staff" on public.catalogo_film;
create policy "catalogo film: staff" on public.catalogo_film
  for all using (public.my_role() in ('admin', 'coordinatore'))
  with check (public.my_role() in ('admin', 'coordinatore'));
drop policy if exists "richieste film: staff" on public.richieste_film;
create policy "richieste film: staff" on public.richieste_film
  for all using (public.my_role() in ('admin', 'coordinatore'))
  with check (public.my_role() in ('admin', 'coordinatore'));

-- a chi si scrivono le richieste: i referenti del SAS, [{ "nome": "…", "email": "…" }]
alter table public.settings add column if not exists sas_contatti jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'richieste_film') then
    alter publication supabase_realtime add table public.richieste_film;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'catalogo_film') then
    alter publication supabase_realtime add table public.catalogo_film;
  end if;
end $$;

notify pgrst, 'reload schema';

select to_regclass('public.richieste_film') is not null as richieste_film,
  to_regclass('public.catalogo_film') is not null as catalogo_film;
