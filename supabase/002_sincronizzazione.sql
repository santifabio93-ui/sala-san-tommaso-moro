-- Sala San Tommaso Moro — aggiornamento 2: sincronizzazione con Google Calendar e Gmail,
-- richieste da email, email pre-approvate.
-- Da eseguire una sola volta in Supabase: SQL Editor → New query → incolla tutto → Run.
-- Alla fine compare il CODICE DI SINCRONIZZAZIONE da inserire nello script Google.

-- ---------- prenotazioni: collegamento al calendario ----------
alter table public.bookings
  add column gcal_id text unique,
  add column giornata_intera boolean not null default false,
  add column origine text not null default 'app' check (origine in ('app', 'calendario', 'email')),
  add column sync_at timestamptz;

-- ogni modifica fatta dall'app segna "aggiornato"; le modifiche della sincronizzazione no
create or replace function public.bookings_touch() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('sala.sync', true), '') <> 'on' then
    new.aggiornato := now();
  end if;
  return new;
end $$;
create trigger bookings_touch before update on public.bookings
  for each row execute function public.bookings_touch();

-- prenotazioni cancellate nell'app che vanno tolte anche dal calendario
create table public.calendar_deletions (
  gcal_id text primary key,
  creato timestamptz not null default now()
);
alter table public.calendar_deletions enable row level security;

create or replace function public.bookings_track_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.gcal_id is not null and old.gcal_id not like '%|%'
     and coalesce(current_setting('sala.sync', true), '') <> 'on' then
    insert into public.calendar_deletions (gcal_id) values (old.gcal_id) on conflict do nothing;
  end if;
  return old;
end $$;
create trigger bookings_track_delete after delete on public.bookings
  for each row execute function public.bookings_track_delete();

-- la vista per i volontari include anche "tutto il giorno"
drop view public.eventi;
create view public.eventi as
  select id, titolo, tipo, data, inizio, fine, stato, turni, giornata_intera
  from public.bookings
  where public.my_role() in ('admin', 'coordinatore', 'volontario');
revoke all on public.eventi from anon;
grant select on public.eventi to authenticated;

-- ---------- richieste arrivate per email ----------
create table public.richieste (
  id uuid primary key default gen_random_uuid(),
  account text not null,
  thread_id text not null,
  link text not null default '',
  mittente text not null default '',
  mittente_email text not null default '',
  oggetto text not null default '',
  testo text not null default '',
  data_proposta date,
  ora_proposta time,
  ricevuta timestamptz not null default now(),
  stato text not null default 'nuova' check (stato in ('nuova', 'convertita', 'scartata')),
  booking_id uuid references public.bookings(id) on delete set null,
  unique (account, thread_id)
);
alter table public.richieste enable row level security;
create policy "richieste: staff" on public.richieste
  for all using (public.my_role() in ('admin', 'coordinatore'))
  with check (public.my_role() in ('admin', 'coordinatore'));
alter publication supabase_realtime add table public.richieste;

-- ---------- email pre-approvate ----------
create table public.inviti (
  email text primary key check (email = lower(trim(email)) and email like '%@%'),
  ruolo text not null default 'volontario' check (ruolo in ('admin', 'coordinatore', 'volontario')),
  creato timestamptz not null default now()
);
alter table public.inviti enable row level security;
create policy "inviti: admin" on public.inviti
  for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  invited text;
begin
  select ruolo into invited from public.inviti where email = lower(new.email);
  insert into public.profiles (id, email, nome, avatar, ruolo)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    case
      when not exists (select 1 from public.profiles where ruolo = 'admin') then 'admin'
      when invited is not null then invited
      else 'in_attesa'
    end
  );
  return new;
end $$;

-- ---------- stato della sincronizzazione (visibile allo staff) ----------
alter table public.settings
  add column sync_calendario timestamptz,
  add column sync_email timestamptz;

-- ---------- codice segreto per lo script Google ----------
create table public.sync_tokens (
  token text primary key default encode(gen_random_bytes(24), 'hex'),
  creato timestamptz not null default now()
);
alter table public.sync_tokens enable row level security;  -- nessuna policy: leggibile solo da qui (SQL Editor)
insert into public.sync_tokens default values;

create or replace function public.sync_check(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_token is null or not exists (select 1 from public.sync_tokens where token = p_token) then
    raise exception 'Codice di sincronizzazione non valido';
  end if;
  perform set_config('sala.sync', 'on', true);
end $$;

-- 1) lo script manda gli eventi del calendario in un intervallo di date
create or replace function public.sync_calendar_pull(p_token text, p_from date, p_to date, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ev jsonb;
  b public.bookings;
  n_new int := 0; n_upd int := 0; n_del int := 0;
  ids text[] := '{}';
begin
  perform public.sync_check(p_token);
  for ev in select * from jsonb_array_elements(p_events) loop
    ids := ids || (ev->>'gcal_id');
    -- un evento cancellato nell'app e non ancora tolto dal calendario non va ricreato
    continue when exists (select 1 from public.calendar_deletions d where d.gcal_id = ev->>'gcal_id');
    select * into b from public.bookings where gcal_id = ev->>'gcal_id';
    if not found then
      insert into public.bookings (gcal_id, origine, titolo, referente, telefono, tipo, data, inizio, fine,
                                   giornata_intera, stato, note, sync_at, aggiornato)
      values (ev->>'gcal_id', 'calendario', ev->>'titolo', coalesce(ev->>'referente', ''), coalesce(ev->>'telefono', ''),
              coalesce(ev->>'tipo', ''), (ev->>'data')::date, (ev->>'inizio')::time, (ev->>'fine')::time,
              coalesce((ev->>'giornata_intera')::boolean, false), coalesce(ev->>'stato', 'confermata'),
              coalesce(ev->>'note', ''), now(), now());
      n_new := n_new + 1;
    elsif b.sync_at is null or b.aggiornato <= b.sync_at or (ev->>'gcal_id') like '%|%' then
      -- nessuna modifica in sospeso nell'app: vale il calendario
      update public.bookings set
        titolo = ev->>'titolo',
        referente = case when coalesce(ev->>'referente', '') <> '' then ev->>'referente' else referente end,
        telefono = case when coalesce(ev->>'telefono', '') <> '' then ev->>'telefono' else telefono end,
        tipo = case when tipo = '' then coalesce(ev->>'tipo', '') else tipo end,
        data = (ev->>'data')::date, inizio = (ev->>'inizio')::time, fine = (ev->>'fine')::time,
        giornata_intera = coalesce((ev->>'giornata_intera')::boolean, false),
        stato = coalesce(ev->>'stato', stato),
        note = coalesce(ev->>'note', note),
        sync_at = now(), aggiornato = now()
      where id = b.id
        and (titolo, data, inizio, fine, giornata_intera, stato, note)
            is distinct from (ev->>'titolo', (ev->>'data')::date, (ev->>'inizio')::time, (ev->>'fine')::time,
                              coalesce((ev->>'giornata_intera')::boolean, false), coalesce(ev->>'stato', stato), coalesce(ev->>'note', note));
      if found then n_upd := n_upd + 1; end if;
    end if;
  end loop;

  -- eventi tolti dal calendario: si tolgono anche dall'app (solo nell'intervallo controllato)
  with gone as (
    delete from public.bookings
    where gcal_id is not null and data between p_from and p_to and not (gcal_id = any(ids))
    returning 1
  ) select count(*) into n_del from gone;

  update public.settings set sync_calendario = now() where id = 1;
  return jsonb_build_object('nuovi', n_new, 'aggiornati', n_upd, 'tolti', n_del);
end $$;

-- 2) lo script chiede cosa va scritto sul calendario
create or replace function public.sync_calendar_pending(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_check(p_token);
  return jsonb_build_object(
    'scrivi', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'gcal_id', gcal_id, 'titolo', titolo, 'referente', referente, 'telefono', telefono,
        'data', data, 'inizio', to_char(inizio, 'HH24:MI'), 'fine', to_char(fine, 'HH24:MI'),
        'giornata_intera', giornata_intera, 'stato', stato, 'note', note))
      from public.bookings
      where (gcal_id is null and stato <> 'annullata' and data >= current_date - 1)
         or (gcal_id is not null and gcal_id not like '%|%' and sync_at is not null and aggiornato > sync_at)
    ), '[]'::jsonb),
    'cancella', coalesce((select jsonb_agg(gcal_id) from public.calendar_deletions), '[]'::jsonb)
  );
end $$;

-- 3) lo script conferma cosa ha scritto
create or replace function public.sync_calendar_ack(p_token text, p_written jsonb, p_deleted jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  w jsonb;
begin
  perform public.sync_check(p_token);
  for w in select * from jsonb_array_elements(coalesce(p_written, '[]')) loop
    update public.bookings
      set gcal_id = coalesce(w->>'gcal_id', gcal_id), sync_at = greatest(now(), aggiornato)
      where id = (w->>'id')::uuid;
  end loop;
  delete from public.calendar_deletions where gcal_id in (select jsonb_array_elements_text(coalesce(p_deleted, '[]')));
end $$;

-- 4) lo script manda le email di richiesta trovate
create or replace function public.sync_email_push(p_token text, p_account text, p_items jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  n int := 0;
begin
  perform public.sync_check(p_token);
  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.richieste (account, thread_id, link, mittente, mittente_email, oggetto, testo,
                                  data_proposta, ora_proposta, ricevuta)
    values (p_account, it->>'thread_id', coalesce(it->>'link', ''), coalesce(it->>'mittente', ''),
            lower(coalesce(it->>'mittente_email', '')), left(coalesce(it->>'oggetto', ''), 300),
            left(coalesce(it->>'testo', ''), 4000), nullif(it->>'data_proposta', '')::date,
            nullif(it->>'ora_proposta', '')::time, coalesce((it->>'ricevuta')::timestamptz, now()))
    on conflict (account, thread_id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  update public.settings set sync_email = now() where id = 1;
  return n;
end $$;

revoke all on function public.sync_check(text) from public, anon, authenticated;
revoke all on function public.sync_calendar_pull(text, date, date, jsonb) from public;
revoke all on function public.sync_calendar_pending(text) from public;
revoke all on function public.sync_calendar_ack(text, jsonb, jsonb) from public;
revoke all on function public.sync_email_push(text, text, jsonb) from public;
grant execute on function public.sync_calendar_pull(text, date, date, jsonb) to anon;
grant execute on function public.sync_calendar_pending(text) to anon;
grant execute on function public.sync_calendar_ack(text, jsonb, jsonb) to anon;
grant execute on function public.sync_email_push(text, text, jsonb) to anon;

-- ---------- il codice da copiare nello script Google ----------
select token as "CODICE DI SINCRONIZZAZIONE (copialo nello script Google)" from public.sync_tokens;
