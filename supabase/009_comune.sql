-- Sala San Tommaso Moro — aggiornamento 9: serate in convenzione con il Comune.
-- Il Comune ha diritto a un certo numero di serate l'anno (25) per un certo numero di anni (20).
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

alter table public.bookings add column if not exists comune boolean not null default false;

alter table public.settings add column if not exists convenzione_inizio date;
alter table public.settings add column if not exists convenzione_serate int not null default 25;
alter table public.settings add column if not exists convenzione_anni int not null default 20;

-- prima proposta: gli eventi già in calendario con «Comune», «comunale» (es. Amministrazione comunale) nel titolo
-- (si correggono poi dall'app con la spunta «Serata del Comune»; si applica una volta sola)
do $$
begin
  if not exists (select 1 from public.bookings where comune) then
    update public.bookings set comune = true
    where titolo ~* '\m(comune|comunale|comunali)\M';
  end if;
end $$;

-- la sincronizzazione del calendario porta la spunta solo sugli eventi nuovi: quelle cambiate nell'app restano
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
                                   giornata_intera, stato, note, comune, sync_at, aggiornato)
      values (ev->>'gcal_id', 'calendario', ev->>'titolo', coalesce(ev->>'referente', ''), coalesce(ev->>'telefono', ''),
              coalesce(ev->>'tipo', ''), (ev->>'data')::date, (ev->>'inizio')::time, (ev->>'fine')::time,
              coalesce((ev->>'giornata_intera')::boolean, false), coalesce(ev->>'stato', 'confermata'),
              coalesce(ev->>'note', ''), coalesce((ev->>'comune')::boolean, false), now(), now());
      n_new := n_new + 1;
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
        sync_at = now(), aggiornato = now()
      where id = b.id
        and (titolo, data, inizio, fine, giornata_intera, stato)
            is distinct from (ev->>'titolo', (ev->>'data')::date, (ev->>'inizio')::time, (ev->>'fine')::time,
                              coalesce((ev->>'giornata_intera')::boolean, false), coalesce(ev->>'stato', stato));
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

notify pgrst, 'reload schema';

select
  exists (select 1 from information_schema.columns where table_name = 'bookings' and column_name = 'comune') as colonna_comune,
  exists (select 1 from information_schema.columns where table_name = 'settings' and column_name = 'convenzione_inizio') as impostazioni,
  (select count(*) from public.bookings where comune) as serate_del_comune_trovate;
