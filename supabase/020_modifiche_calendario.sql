-- Sala San Tommaso Moro — aggiornamento 20: gli eventi del Google Calendar si possono modificare anche dall'app.
-- Se nell'app cambi titolo, data, orario o stato di un evento nato sul calendario, la tua versione resta:
-- la sincronizzazione non la sovrascrive più. Il calendario Google non viene toccato (resta in sola lettura);
-- l'app si ricorda cosa c'è scritto nel calendario e lo mostra, con il bottone per tornare a quella versione.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

alter table public.bookings add column if not exists fissato_app boolean not null default false;  -- modificato nell'app: vale l'app
alter table public.bookings add column if not exists cal_dati jsonb;                                -- com'è l'evento nel calendario

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
    select * into b from public.bookings where gcal_id = ev->>'gcal_id';
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

notify pgrst, 'reload schema';

select exists (select 1 from information_schema.columns where table_name = 'bookings' and column_name = 'fissato_app') as modifiche_dall_app;
