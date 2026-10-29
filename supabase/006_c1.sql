-- Sala San Tommaso Moro — aggiornamento 6: riepiloghi C1 (SIAE) dei film.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

create table if not exists public.c1 (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  ora time not null default '00:00',
  titolo text not null,
  autore text not null default '',
  nazionalita text not null default '',
  tipo_evento text not null default '',
  spettatori int not null default 0,
  paganti int not null default 0,
  omaggi int not null default 0,
  lordo numeric(10, 2) not null default 0,
  imponibile_iva numeric(10, 2) not null default 0,
  iva numeric(10, 2) not null default 0,
  righe jsonb not null default '[]'::jsonb,
  fonte text not null default 'drive' check (fonte in ('drive', 'email')),
  fonte_id text not null default '',
  file_nome text not null default '',
  film_id uuid references public.films(id) on delete set null,
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now()
);
-- la stessa proiezione può arrivare sia da Drive sia per email: la tengo una volta sola
create unique index if not exists c1_evento on public.c1 (data, ora, lower(titolo));
create index if not exists c1_film on public.c1 (film_id);

alter table public.c1 enable row level security;
drop policy if exists "c1: staff legge" on public.c1;
create policy "c1: staff legge" on public.c1
  for select using (public.my_role() in ('admin', 'coordinatore'));
drop policy if exists "c1: admin elimina" on public.c1;
create policy "c1: admin elimina" on public.c1
  for delete using (public.my_role() = 'admin');

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'c1') then
    alter publication supabase_realtime add table public.c1;
  end if;
end $$;

alter table public.settings add column if not exists sync_c1 timestamptz;

-- lo script Google manda i C1 letti dai PDF (Drive o allegati email)
create or replace function public.sync_c1_push(p_token text, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  fid uuid;
  n int := 0;
begin
  perform public.sync_check(p_token);
  for it in select * from jsonb_array_elements(p_items) loop
    -- collego il C1 al film: prima per data e ora della proiezione, poi per titolo
    select p.film_id into fid from public.proiezioni p
      where p.data = (it->>'data')::date and p.ora = (it->>'ora')::time limit 1;
    if fid is null then
      select f.id into fid from public.films f
        where lower(regexp_replace(f.titolo, '[^[:alnum:]]', '', 'g')) = lower(regexp_replace(it->>'titolo', '[^[:alnum:]]', '', 'g'))
        limit 1;
    end if;
    insert into public.c1 (data, ora, titolo, autore, nazionalita, tipo_evento, spettatori, paganti, omaggi,
                           lordo, imponibile_iva, iva, righe, fonte, fonte_id, file_nome, film_id)
    values ((it->>'data')::date, coalesce((it->>'ora')::time, '00:00'), it->>'titolo', coalesce(it->>'autore', ''),
            coalesce(it->>'nazionalita', ''), coalesce(it->>'tipo_evento', ''), coalesce((it->>'spettatori')::int, 0),
            coalesce((it->>'paganti')::int, 0), coalesce((it->>'omaggi')::int, 0), coalesce((it->>'lordo')::numeric, 0),
            coalesce((it->>'imponibile_iva')::numeric, 0), coalesce((it->>'iva')::numeric, 0), coalesce(it->'righe', '[]'),
            coalesce(it->>'fonte', 'drive'), coalesce(it->>'fonte_id', ''), coalesce(it->>'file_nome', ''), fid)
    on conflict (data, ora, lower(titolo)) do update set
      autore = excluded.autore, nazionalita = excluded.nazionalita, tipo_evento = excluded.tipo_evento,
      spettatori = excluded.spettatori, paganti = excluded.paganti, omaggi = excluded.omaggi,
      lordo = excluded.lordo, imponibile_iva = excluded.imponibile_iva, iva = excluded.iva, righe = excluded.righe,
      fonte = excluded.fonte, fonte_id = excluded.fonte_id, file_nome = excluded.file_nome,
      film_id = coalesce(c1.film_id, excluded.film_id), aggiornato = now();
    n := n + 1;
    fid := null;
  end loop;
  update public.settings set sync_c1 = now() where id = 1;
  return jsonb_build_object('c1', n);
end $$;

revoke all on function public.sync_c1_push(text, jsonb) from public;
grant execute on function public.sync_c1_push(text, jsonb) to anon;

-- controllo finale: devono risultare tutte «true»
select
  to_regclass('public.c1') is not null as tabella_c1,
  exists (select 1 from pg_proc where proname = 'sync_c1_push') as funzione_c1,
  exists (select 1 from information_schema.columns where table_name = 'settings' and column_name = 'sync_c1') as colonna_sync;
