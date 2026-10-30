-- Sala San Tommaso Moro — aggiornamento 26: contapersone dal vivo alla porta.
-- Il volontario alla porta tocca +1 a ogni ingresso e −1 a ogni uscita; tutti i telefoni vedono le persone in sala,
-- la capienza (galleria 134, platea 338, platea e galleria 472), gli entrati in tutto e il picco della serata.
-- Si apre dal link personale dei turni (senza account) o dall'app. Serve l'aggiornamento 14 (link dei volontari).
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

create table if not exists public.conteggi (
  chiave text primary key,              -- b:<prenotazione> oppure p:<proiezione>
  data date not null,
  titolo text not null default '',
  capienza int not null default 338 check (capienza between 1 and 1000),
  entrati int not null default 0 check (entrati >= 0),
  usciti int not null default 0 check (usciti >= 0),
  picco int not null default 0 check (picco >= 0),
  aggiornato timestamptz not null default now()
);
alter table public.conteggi enable row level security;
drop policy if exists "conteggi: approvati leggono" on public.conteggi;
create policy "conteggi: approvati leggono" on public.conteggi
  for select using (public.my_role() in ('admin', 'coordinatore', 'segreteria', 'volontario'));
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conteggi') then
    alter publication supabase_realtime add table public.conteggi;
  end if;
end $$;

-- chi può contare: un volontario con il suo link oppure chi è entrato nell'app
create or replace function public.conta_ok(p_token uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select (p_token is not null and exists (select 1 from public.volontari where token = p_token and attivo))
      or coalesce(public.my_role() in ('admin', 'coordinatore', 'segreteria', 'volontario'), false)
$$;

-- gli eventi di oggi (ora italiana) con il loro conteggio
create or replace function public.conta_oggi(p_token uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  oggi date := (now() at time zone 'Europe/Rome')::date;
begin
  if not public.conta_ok(p_token) then return null; end if;
  return jsonb_build_object('oggi', oggi, 'eventi', coalesce((
    select jsonb_agg(e order by e->>'ora') from (
      select jsonb_build_object('chiave', 'b:' || b.id, 'titolo', b.titolo,
          'ora', case when coalesce(b.giornata_intera, false) then '' else to_char(b.inizio, 'HH24:MI') end,
          'capienza', coalesce(c.capienza, case coalesce(b.tariffa->>'spazio', '') when 'galleria' then 134 when 'tutta' then 472 else 338 end),
          'entrati', coalesce(c.entrati, 0), 'usciti', coalesce(c.usciti, 0), 'picco', coalesce(c.picco, 0)) as e
        from public.bookings b left join public.conteggi c on c.chiave = 'b:' || b.id
        where b.data = oggi and b.stato = 'confermata'
      union all
      select jsonb_build_object('chiave', 'p:' || p.id, 'titolo', f.titolo, 'ora', to_char(p.ora, 'HH24:MI'),
          'capienza', coalesce(c.capienza, 338),
          'entrati', coalesce(c.entrati, 0), 'usciti', coalesce(c.usciti, 0), 'picco', coalesce(c.picco, 0))
        from public.proiezioni p join public.films f on f.id = p.film_id left join public.conteggi c on c.chiave = 'p:' || p.id
        where p.data = oggi
    ) x), '[]'::jsonb));
end $$;

-- un tocco: entrati e usciti in più (anche negativi per correggere), e la capienza se cambia
create or replace function public.conta_passo(p_token uuid, p_chiave text, p_entrati int default 0, p_usciti int default 0, p_capienza int default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  oggi date := (now() at time zone 'Europe/Rome')::date;
  tit text; cap int; r public.conteggi;
begin
  if not public.conta_ok(p_token) then raise exception 'Link non valido: chiedi il link nuovo a chi organizza i turni'; end if;
  if abs(coalesce(p_entrati, 0)) > 50 or abs(coalesce(p_usciti, 0)) > 50 then raise exception 'Troppi in un colpo solo'; end if;
  -- solo gli eventi di oggi
  if p_chiave like 'b:%' then
    select b.titolo, case coalesce(b.tariffa->>'spazio', '') when 'galleria' then 134 when 'tutta' then 472 else 338 end into tit, cap
    from public.bookings b where 'b:' || b.id = p_chiave and b.data = oggi and b.stato = 'confermata';
  elsif p_chiave like 'p:%' then
    select f.titolo, 338 into tit, cap from public.proiezioni p join public.films f on f.id = p.film_id where 'p:' || p.id = p_chiave and p.data = oggi;
  end if;
  if tit is null then raise exception 'Questo evento non è di oggi'; end if;
  insert into public.conteggi (chiave, data, titolo, capienza) values (p_chiave, oggi, tit, coalesce(p_capienza, cap))
    on conflict (chiave) do nothing;
  update public.conteggi set
      entrati = greatest(0, entrati + coalesce(p_entrati, 0)),
      usciti = least(greatest(0, usciti + coalesce(p_usciti, 0)), greatest(0, entrati + coalesce(p_entrati, 0))),
      capienza = coalesce(p_capienza, capienza),
      aggiornato = now()
    where chiave = p_chiave
    returning * into r;
  update public.conteggi set picco = greatest(picco, entrati - usciti) where chiave = p_chiave returning * into r;
  return jsonb_build_object('chiave', r.chiave, 'capienza', r.capienza, 'entrati', r.entrati, 'usciti', r.usciti, 'picco', r.picco);
end $$;

revoke all on function public.conta_ok(uuid) from public;
revoke all on function public.conta_oggi(uuid) from public;
revoke all on function public.conta_passo(uuid, text, int, int, int) from public;
grant execute on function public.conta_oggi(uuid) to anon, authenticated;
grant execute on function public.conta_passo(uuid, text, int, int, int) to anon, authenticated;

notify pgrst, 'reload schema';

select exists (select 1 from pg_proc where proname = 'conta_passo') as contapersone;
