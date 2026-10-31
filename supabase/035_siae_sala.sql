-- Sala San Tommaso Moro — aggiornamento 35: SIAE a carico della sala per gli eventi co-organizzati.
-- Nella scheda di richiesta si può segnare «la SIAE la fa la sala»: l'organizzatore non deve allegare il permesso.
-- Per gli eventi segnati «Organizzato dalla Sala» vale da sola.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

alter table public.schede add column if not exists siae_sala boolean not null default false;

create or replace function public.scheda_apri(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.schede;
  b public.bookings;
begin
  select * into s from public.schede where token = p_token;
  if not found or s.stato = 'non_serve' then return null; end if;
  if s.aperta_il is null then
    update public.schede set aperta_il = now(),
      stato = case when stato in ('da_inviare', 'inviata') then 'aperta' else stato end
    where id = s.id;
  end if;
  if s.booking_id is not null then select * into b from public.bookings where id = s.booking_id; end if;
  return jsonb_build_object(
    'titolo', coalesce(nullif(s.titolo, ''), b.titolo, ''),
    'data', coalesce(s.data_evento, b.data),
    'inizio', to_char(b.inizio, 'HH24:MI'), 'fine', to_char(b.fine, 'HH24:MI'),
    'giornata_intera', coalesce(b.giornata_intera, false),
    'referente', coalesce(nullif(s.destinatario, ''), b.referente, ''),
    'telefono', coalesce(b.telefono, ''), 'email', coalesce(b.email, ''),
    'stato', s.stato, 'compilata_il', s.compilata_il,
    'dati', case when s.stato in ('compilata', 'respinta') then s.dati else '{}'::jsonb end,
    'chiusa', s.stato = 'approvata',
    -- evento co-organizzato con la sala: la SIAE la fa la sala (scelta nella scheda, o evento «Organizzato dalla Sala»)
    'siae_sala', coalesce(s.siae_sala, false) or coalesce((to_jsonb(b)->>'della_sala')::boolean, false)
  );
end $$;

revoke all on function public.scheda_apri(uuid) from public;
grant execute on function public.scheda_apri(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

select exists (select 1 from information_schema.columns where table_name = 'schede' and column_name = 'siae_sala') as siae_della_sala;
