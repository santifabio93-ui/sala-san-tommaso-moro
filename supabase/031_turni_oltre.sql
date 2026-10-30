-- Sala San Tommaso Moro — aggiornamento 31: ci si può segnare anche nelle fasce al completo.
-- Dal link personale «Ci sono» funziona sempre: chi si aggiunge a una fascia già piena compare con il suo nome come
-- gli altri (una mano in più fa sempre comodo). Limite di sicurezza: al massimo 10 persone oltre i posti.
-- Serve l'aggiornamento 14 (link dei volontari). Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run.
-- Si può rieseguire senza problemi.

create or replace function public.turni_segna(p_token uuid, p_booking uuid, p_slot text, p_si boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.volontari;
  b public.bookings;
  t jsonb;
  presi int;
begin
  select * into v from public.volontari where token = p_token and attivo;
  if not found then raise exception 'Link non valido: chiedi un link nuovo a chi organizza i turni'; end if;
  select * into b from public.bookings where id = p_booking and stato = 'confermata' and data >= current_date;
  if not found then raise exception 'Questo evento non è più disponibile'; end if;
  select x into t from jsonb_array_elements(b.turni) x where x->>'id' = p_slot;
  if t is null then raise exception 'Questa fascia non esiste più: ricarica la pagina'; end if;
  if p_si then
    if exists (select 1 from public.signups where booking_id = b.id and slot_id = p_slot and volontario_id = v.id) then
      return jsonb_build_object('ok', true);
    end if;
    perform 1 from public.bookings where id = b.id for update;  -- un posto alla volta
    select count(*) into presi from public.signups where booking_id = b.id and slot_id = p_slot;
    if presi >= coalesce((t->>'posti')::int, 1) + 10 then raise exception 'In questa fascia ci sono già tante persone, grazie lo stesso!'; end if;
    insert into public.signups (booking_id, slot_id, nome, volontario_id) values (b.id, p_slot, v.nome, v.id);
    return jsonb_build_object('ok', true);
  else
    delete from public.signups where booking_id = b.id and slot_id = p_slot and volontario_id = v.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.turni_segna(uuid, uuid, text, boolean) from public;
grant execute on function public.turni_segna(uuid, uuid, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';

select exists (select 1 from pg_proc where proname = 'turni_segna' and prosrc like '%+ 10%') as turni_oltre_i_posti;
