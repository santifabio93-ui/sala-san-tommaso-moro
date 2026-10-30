-- Sala San Tommaso Moro — aggiornamento 17: le email del SAS lette dallo script Google.
-- Lo script (modalità «+sas») copia le email arrivate da acectriveneta.it; l'app ne ricava la programmazione
-- confermata (data, film, agenzia, distributore, supporto, condizioni) e le risposte alle richieste di film.
-- Richiede l'aggiornamento 16. Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire.

create table if not exists public.sas_email (
  id text primary key,                         -- id del messaggio Gmail
  thread_id text not null default '',
  data timestamptz not null default now(),
  mittente text not null default '',
  oggetto text not null default '',
  testo text not null default '',
  link text not null default '',
  elaborata boolean not null default false,
  creato timestamptz not null default now()
);

create table if not exists public.programmazione (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  titolo text not null,
  originale text not null default '',
  agenzia text not null default '',
  distributore text not null default '',
  supporto text not null default '',
  minimo numeric(10, 2),
  percentuale numeric(5, 2),
  fisso numeric(10, 2),
  note text not null default '',
  email_id text not null default '',
  fatti jsonb not null default '{}'::jsonb,    -- cose da fare già fatte: { "pagamento": "2026-10-20", ... }
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now()
);
create unique index if not exists programmazione_unica on public.programmazione (data, lower(titolo));

alter table public.richieste_film add column if not exists fatti jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists sync_sas timestamptz;

alter table public.sas_email enable row level security;
alter table public.programmazione enable row level security;
drop policy if exists "sas email: staff" on public.sas_email;
create policy "sas email: staff" on public.sas_email
  for all using (public.my_role() in ('admin', 'coordinatore'))
  with check (public.my_role() in ('admin', 'coordinatore'));
drop policy if exists "programmazione: staff" on public.programmazione;
create policy "programmazione: staff" on public.programmazione
  for all using (public.my_role() in ('admin', 'coordinatore'))
  with check (public.my_role() in ('admin', 'coordinatore'));

-- lo script Google consegna le email (con il codice di sincronizzazione, come per le altre letture)
create or replace function public.sync_sas_push(p_token text, p_messaggi jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  m jsonb;
  n int := 0;
begin
  perform public.sync_check(p_token);
  for m in select * from jsonb_array_elements(p_messaggi) loop
    insert into public.sas_email (id, thread_id, data, mittente, oggetto, testo, link)
    values (m->>'id', coalesce(m->>'thread_id', ''), coalesce((m->>'data')::timestamptz, now()), left(coalesce(m->>'mittente', ''), 200),
            left(coalesce(m->>'oggetto', ''), 300), left(coalesce(m->>'testo', ''), 20000), coalesce(m->>'link', ''))
    on conflict (id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  update public.settings set sync_sas = now() where id = 1;
  return n;
end $$;
revoke all on function public.sync_sas_push(text, jsonb) from public;
grant execute on function public.sync_sas_push(text, jsonb) to anon;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'programmazione') then
    alter publication supabase_realtime add table public.programmazione;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sas_email') then
    alter publication supabase_realtime add table public.sas_email;
  end if;
end $$;

notify pgrst, 'reload schema';

select to_regclass('public.sas_email') is not null as email_sas,
  to_regclass('public.programmazione') is not null as programmazione,
  exists (select 1 from pg_proc where proname = 'sync_sas_push') as funzione_script;
