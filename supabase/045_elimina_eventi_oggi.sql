-- Elimina dalla panoramica senza reimportare le proiezioni rimosse. Dopo 044; rieseguibile.
create table if not exists public.proiezioni_escluse (
 cinebot_key text primary key,
 creato timestamptz not null default now()
);
alter table public.proiezioni_escluse enable row level security;
revoke all on public.proiezioni_escluse from public,anon,authenticated;
grant select on public.proiezioni_escluse to authenticated;
drop policy if exists "proiezioni escluse: admin legge" on public.proiezioni_escluse;
create policy "proiezioni escluse: admin legge" on public.proiezioni_escluse for select to authenticated using(public.my_role()='admin');

create or replace function public.evento_elimina(p_tipo text,p_id uuid,p_data date,p_ora time,p_aggiornato timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.bookings; p public.proiezioni; titolo_film text;
begin
 if coalesce(public.my_role(),'') not in ('admin','coordinatore','segreteria') then raise exception 'Non hai i permessi per eliminare eventi'; end if;
 if p_tipo='b' then
  select * into b from public.bookings where id=p_id for update;
  if not found then raise exception 'L’evento non esiste più: aggiorna la pagina'; end if;
  if b.data is distinct from p_data or b.inizio is distinct from p_ora or b.aggiornato is distinct from p_aggiornato then raise exception 'L’evento è cambiato: aggiorna la pagina prima di eliminarlo'; end if;
  if b.gcal_id is not null or b.origine='calendario' or b.incassato>0 then
   -- Mantiene chiave di importazione e incassi già registrati: nessuna cancellazione su Google.
   update public.bookings set stato='annullata',fissato_app=true where id=b.id;
   return jsonb_build_object('esito','annullato');
  end if;
  -- Conserva il titolo negli eventuali rendiconti, anche se mancava la copia del nome.
  update public.cassa set titolo=b.titolo where booking_id=b.id and trim(coalesce(titolo,''))='';
  delete from public.bookings where id=b.id;
 elsif p_tipo='p' then
  if public.my_role() not in ('admin','coordinatore') then raise exception 'Solo i responsabili del cinema possono eliminare proiezioni'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sala.cinebot',0));
  select * into p from public.proiezioni where id=p_id for update;
  if not found then raise exception 'La proiezione non esiste più: aggiorna la pagina'; end if;
  if p.data is distinct from p_data or p.ora is distinct from p_ora then raise exception 'La proiezione è cambiata: aggiorna la pagina prima di eliminarla'; end if;
  if p.cinebot_key is not null then insert into public.proiezioni_escluse(cinebot_key) values(p.cinebot_key) on conflict do nothing; end if;
  select titolo into titolo_film from public.films where id=p.film_id;
  update public.cassa set titolo=titolo_film || ' · ' || to_char(p.ora,'HH24:MI') where proiezione_id=p.id and trim(coalesce(titolo,''))='';
  delete from public.proiezioni where id=p.id;
 else raise exception 'Tipo di evento non valido';
 end if;
 return jsonb_build_object('esito','eliminato');
end $$;
revoke all on function public.evento_elimina(text,uuid,date,time,timestamptz) from public,anon;
grant execute on function public.evento_elimina(text,uuid,date,time,timestamptz) to authenticated;

-- Stessa importazione di 023, con esclusione delle sole repliche eliminate dall’app.
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
  perform pg_advisory_xact_lock(hashtextextended('sala.cinebot',0));
  for f in select * from jsonb_array_elements(p_films) loop
    insert into public.films (cinebot_id, titolo, locandina_url, cinebot_url, cinebot_info)
    values (f->>'cinebot_id', f->>'titolo', coalesce(f->>'locandina', ''), coalesce(f->>'url', ''), coalesce(f->'info', '{}'::jsonb))
    on conflict (cinebot_id) do update set
      titolo = excluded.titolo,
      locandina_url = case when excluded.locandina_url <> '' then excluded.locandina_url else films.locandina_url end,
      cinebot_url = case when excluded.cinebot_url <> '' then excluded.cinebot_url else films.cinebot_url end,
      cinebot_info = case when excluded.cinebot_info <> '{}'::jsonb then excluded.cinebot_info else films.cinebot_info end
    returning id into fid;
    for pr in select * from jsonb_array_elements(coalesce(f->'proiezioni', '[]')) loop
      keys := keys || (pr->>'key');
      continue when exists(select 1 from public.proiezioni_escluse x where x.cinebot_key=pr->>'key');
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


-- La lettura bloccante evita che un’importazione in corso sovrascriva l’annullamento.
create or replace function public.sync_calendar_pull(p_token text, p_from date, p_to date, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ev jsonb;
  b public.bookings;
  cal jsonb;
  n_new int := 0; n_upd int := 0; n_del int := 0;
  ids text[] := '{}';
begin
  perform public.sync_check(p_token);
  for ev in select * from jsonb_array_elements(p_events) loop
    ids := ids || (ev->>'gcal_id');
    -- un evento cancellato nell'app e non ancora tolto dal calendario non va ricreato
    continue when exists (select 1 from public.calendar_deletions d where d.gcal_id = ev->>'gcal_id');
    cal := jsonb_build_object('titolo', ev->>'titolo', 'data', ev->>'data', 'inizio', ev->>'inizio', 'fine', ev->>'fine',
                              'giornata_intera', coalesce((ev->>'giornata_intera')::boolean, false), 'stato', coalesce(ev->>'stato', 'confermata'));
    select * into b from public.bookings where gcal_id = ev->>'gcal_id' for update;
    if not found then
      insert into public.bookings (gcal_id, origine, titolo, referente, telefono, tipo, data, inizio, fine,
                                   giornata_intera, stato, note, comune, cal_dati, sync_at, aggiornato)
      values (ev->>'gcal_id', 'calendario', ev->>'titolo', coalesce(ev->>'referente', ''), coalesce(ev->>'telefono', ''),
              coalesce(ev->>'tipo', ''), (ev->>'data')::date, (ev->>'inizio')::time, (ev->>'fine')::time,
              coalesce((ev->>'giornata_intera')::boolean, false), coalesce(ev->>'stato', 'confermata'),
              coalesce(ev->>'note', ''), coalesce((ev->>'comune')::boolean, false), cal, now(), now());
      n_new := n_new + 1;
    elsif b.fissato_app then
      -- modificato nell'app: si aggiorna solo il ricordo di com'è nel calendario
      update public.bookings set cal_dati = cal where id = b.id and cal_dati is distinct from cal;
    elsif b.origine = 'calendario' or b.sync_at is null or b.aggiornato <= b.sync_at or (ev->>'gcal_id') like '%|%' then
      -- eventi nati sul calendario, o nessuna modifica in sospeso nell'app: vale il calendario
      -- (le note scritte nell'app non vengono sovrascritte)
      update public.bookings set
        titolo = ev->>'titolo',
        referente = case when coalesce(ev->>'referente', '') <> '' then ev->>'referente' else referente end,
        telefono = case when coalesce(ev->>'telefono', '') <> '' then ev->>'telefono' else telefono end,
        tipo = case when tipo = '' then coalesce(ev->>'tipo', '') else tipo end,
        data = (ev->>'data')::date, inizio = (ev->>'inizio')::time, fine = (ev->>'fine')::time,
        giornata_intera = coalesce((ev->>'giornata_intera')::boolean, false),
        stato = coalesce(ev->>'stato', stato),
        cal_dati = cal, sync_at = now(), aggiornato = now()
      where id = b.id
        and (titolo, data, inizio, fine, giornata_intera, stato, cal_dati)
            is distinct from (ev->>'titolo', (ev->>'data')::date, (ev->>'inizio')::time, (ev->>'fine')::time,
                              coalesce((ev->>'giornata_intera')::boolean, false), coalesce(ev->>'stato', stato), cal);
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
revoke all on function public.sync_calendar_pull(text, date, date, jsonb) from public;
grant execute on function public.sync_calendar_pull(text, date, date, jsonb) to anon;


notify pgrst,'reload schema';
