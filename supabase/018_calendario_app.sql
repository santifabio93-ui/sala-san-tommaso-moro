-- Sala San Tommaso Moro — aggiornamento 18: un secondo calendario Google gestito dall'app.
-- Il calendario principale della sala resta in sola lettura; in un calendario a parte (es. «Sala – App») lo script
-- tiene allineati: prenotazioni nate nell'app o dalle email, proiezioni del cinema, sopralluoghi.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

-- gli eventi che il calendario dell'app deve contenere, da 30 giorni fa a un anno avanti
create or replace function public.sync_calendario_app(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  dal date := current_date - 30;
  al date := current_date + 365;
begin
  perform public.sync_check(p_token);
  return coalesce((
    -- prenotazioni nate nell'app o dalle email (quelle del calendario principale ci sono già)
    select jsonb_agg(jsonb_build_object(
      'chiave', 'b:' || b.id,
      'titolo', case when b.stato = 'opzione' then '(opzione) ' else '' end || b.titolo,
      'data', b.data, 'inizio', to_char(b.inizio, 'HH24:MI'), 'fine', to_char(b.fine, 'HH24:MI'),
      'giornata', coalesce(b.giornata_intera, false),
      'descrizione', concat_ws(E'\n',
        nullif(b.tipo, ''),
        case when b.referente <> '' then 'Referente: ' || b.referente end,
        (select 'Turni:' || string_agg(E'\n• ' || (t->>'label') || ' ' || (t->>'inizio') || '–' || (t->>'fine') || ': ' ||
                  coalesce((select string_agg(s.nome, ', ' order by s.creato) from public.signups s where s.booking_id = b.id and s.slot_id = t->>'id'), 'nessuno'), '')
           from jsonb_array_elements(b.turni) t having count(*) > 0),
        nullif(b.note, ''))))
    from public.bookings b
    where b.data between dal and al and b.stato <> 'annullata' and b.origine <> 'calendario' and b.gcal_id is null
  ), '[]'::jsonb)
  || coalesce((
    -- proiezioni del cinema (due ore e un quarto)
    select jsonb_agg(jsonb_build_object(
      'chiave', 'p:' || p.id, 'titolo', '🎬 ' || f.titolo,
      'data', p.data, 'inizio', to_char(p.ora, 'HH24:MI'), 'fine', to_char(case when p.ora > time '21:44' then time '23:59' else p.ora + interval '135 minutes' end, 'HH24:MI'),
      'giornata', false,
      'descrizione', concat_ws(E'\n', 'Proiezione da Cinebot', case when f.supporto is not null then 'Supporto: ' || case f.supporto when 'dvd' then 'DVD' when 'bluray' then 'Blu-ray' else initcap(f.supporto) end end, nullif(f.dove, ''))))
    from public.proiezioni p join public.films f on f.id = p.film_id
    where p.data between dal and al
  ), '[]'::jsonb)
  || coalesce((
    -- sopralluoghi da fare
    select jsonb_agg(jsonb_build_object(
      'chiave', 's:' || s.id, 'titolo', 'Sopralluogo: ' || s.nome || case when s.evento <> '' then ' (' || s.evento || ')' else '' end,
      'data', s.data, 'inizio', to_char(s.ora, 'HH24:MI'), 'fine', to_char(case when s.ora + make_interval(mins => s.durata_min) < s.ora then time '23:59' else s.ora + make_interval(mins => s.durata_min) end, 'HH24:MI'),
      'giornata', false, 'descrizione', concat_ws(E'\n', nullif(s.ente, ''), case when array_length(s.esigenze, 1) > 0 then 'Esigenze: ' || array_to_string(s.esigenze, ', ') end)))
    from public.sopralluoghi s
    where s.data between dal and al and s.stato = 'da_fare'
  ), '[]'::jsonb);
end $$;
revoke all on function public.sync_calendario_app(text) from public;
grant execute on function public.sync_calendario_app(text) to anon;

notify pgrst, 'reload schema';

select exists (select 1 from pg_proc where proname = 'sync_calendario_app') as calendario_app;
