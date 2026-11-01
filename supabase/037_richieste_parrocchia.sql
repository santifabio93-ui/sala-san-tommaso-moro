-- Percorso parrocchiale assegnato dallo staff: invio senza prenotazione,
-- approvazione atomica di tutti gli incontri, sempre gratuiti.
-- Eseguire dopo gli aggiornamenti precedenti. Rieseguibile.
alter table public.schede add column if not exists percorso text not null default 'esterno'
  check (percorso in ('esterno', 'parrocchia'));
alter table public.schede add column if not exists parrocchia_siae_verificata boolean not null default false;
alter table public.bookings add column if not exists scheda_parrocchia_id uuid references public.schede(id) on delete restrict;
alter table public.bookings add column if not exists parrocchia_riga integer;
create unique index if not exists bookings_parrocchia_riga on public.bookings(scheda_parrocchia_id, parrocchia_riga)
  where scheda_parrocchia_id is not null;

create or replace function public.parrocchia_valida(d jsonb) returns void
language plpgsql set search_path = public as $$
declare o jsonb; n int; cap int; inizio time; fine time; prep time; prep_fine time; porte time; sgombero time;
begin
  if jsonb_typeof(d) is distinct from 'object' or length(d::text) > 30000 then raise exception 'Dati non validi'; end if;
  if coalesce(d->>'attivita_parrocchiale', '') not in ('consiglio_pastorale','catechismo','conferenza','fidanzati','altra_parrocchia') then
    raise exception 'Scegli un’attività parrocchiale ammessa. Feste private e corsi esterni non sono ammessi in questo percorso'; end if;
  if length(trim(coalesce(d->>'gruppo',''))) < 3 or length(trim(coalesce(d->>'titolo',''))) < 3
     or length(trim(coalesce(d->>'referente',''))) < 3 or length(trim(coalesce(d->>'cellulare',''))) < 6
     or length(trim(coalesce(d->>'resp_sera',''))) < 3 or length(trim(coalesce(d->>'resp_cell',''))) < 6 then
    raise exception 'Indica gruppo, titolo, referente e responsabile presente con i rispettivi cellulari'; end if;
  if coalesce(d->>'minori','') not in ('si','no') or coalesce(d->>'siae','') not in ('si','no') then
    raise exception 'Indica la presenza di minori e l’uso di musica o proiezioni'; end if;
  if d->>'siae' = 'si' and length(trim(coalesce(d->>'siae_opere',''))) < 3 then raise exception 'Descrivi le opere o proiezioni previste'; end if;
  if d->>'attivita_parrocchiale' = 'altra_parrocchia' and length(trim(coalesce(d->>'descrizione',''))) < 3 then raise exception 'Descrivi l’attività parrocchiale da valutare'; end if;
  cap := case d->>'fascia' when 'galleria' then 134 when 'platea' then 338 when 'tutta' then 472 else 0 end;
  if coalesce(d->>'pubblico_n','') !~ '^[0-9]+$' then raise exception 'Indica il numero previsto di partecipanti'; end if;
  n := (d->>'pubblico_n')::int;
  if cap = 0 or n < 1 or n > cap then raise exception 'Partecipanti non compatibili con la capienza dello spazio scelto'; end if;
  if coalesce(d->>'ok_regole','') <> 'true' or coalesce(d->>'ok_privacy','') <> 'true' then raise exception 'Accetta regole della sala e informativa sui dati'; end if;
  if jsonb_typeof(d->'orari') is distinct from 'array' then raise exception 'Indica le date richieste'; end if;
  if jsonb_array_length(d->'orari') not between 1 and 52 then raise exception 'Indica da 1 a 52 incontri'; end if;
  for o in select * from jsonb_array_elements(d->'orari') loop
    if coalesce(o->>'data','') !~ '^\d{4}-\d{2}-\d{2}$' or (o->>'data')::date < current_date then raise exception 'Ogni incontro deve avere una data valida, non passata'; end if;
    if coalesce(o->>'inizio','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(o->>'fine','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Indica inizio e fine per ogni incontro'; end if;
    inizio := (o->>'inizio')::time; fine := (o->>'fine')::time;
    prep := nullif(o->>'all_da','')::time; prep_fine := nullif(o->>'all_a','')::time;
    porte := nullif(o->>'porte','')::time; sgombero := nullif(o->>'sgombero','')::time;
    if fine <= inizio or (prep is null) <> (prep_fine is null)
       or (prep is not null and (prep_fine <= prep or prep_fine > inizio))
       or (porte is not null and porte > inizio) or (sgombero is not null and sgombero < fine) then
      raise exception 'Controlla gli orari di incontro, preparazione, apertura porte e riordino'; end if;
  end loop;
end $$;
revoke all on function public.parrocchia_valida(jsonb) from public;

create or replace function public.parrocchia_scheda_proteggi() returns trigger
language plpgsql security definer set search_path = public as $$
declare gestore boolean;
begin
  gestore := coalesce(public.my_role(),'') in ('admin','coordinatore') or coalesce(auth.role(),'') = 'service_role'
    or (auth.role() is null and session_user in ('postgres','supabase_admin'));
  if tg_op = 'INSERT' then
    if new.percorso = 'parrocchia' and (not gestore or new.booking_id is not null or new.stato not in ('da_inviare','inviata')) then
      raise exception 'Il link parrocchiale deve essere predisposto da un gestore, prima della richiesta'; end if;
  else
    if new.percorso is distinct from old.percorso then raise exception 'Il percorso assegnato non si modifica: crea un nuovo link'; end if;
    if old.percorso = 'parrocchia' then
      if old.stato = 'approvata' and (new.stato is distinct from old.stato or new.dati is distinct from old.dati) then raise exception 'Richiesta già approvata: modifica gli incontri dal calendario'; end if;
      if new.stato = 'approvata' and old.stato <> 'approvata' then
        if not gestore or old.stato <> 'compilata' then raise exception 'Solo un gestore può approvare una richiesta parrocchiale compilata'; end if;
        if coalesce(new.sicurezza,'') not in ('compatibile','condizioni') then raise exception 'Serve un parere di sicurezza compatibile'; end if;
        if new.sicurezza = 'condizioni' and length(trim(coalesce(new.sicurezza_note,''))) < 3 then raise exception 'Descrivi le condizioni da rispettare'; end if;
        if new.dati->>'siae' = 'si' and not new.parrocchia_siae_verificata then raise exception 'Verifica la gestione delle opere protette prima di approvare'; end if;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists parrocchia_scheda_proteggi on public.schede;
create trigger parrocchia_scheda_proteggi before insert or update on public.schede
  for each row execute function public.parrocchia_scheda_proteggi();

create or replace function public.parrocchia_prenotazione_proteggi() returns trigger
language plpgsql security definer set search_path = public as $$
declare gestore boolean; o jsonb;
begin
  gestore := coalesce(public.my_role(),'') in ('admin','coordinatore') or coalesce(auth.role(),'') = 'service_role'
    or (auth.role() is null and session_user in ('postgres','supabase_admin'));
  if new.scheda_parrocchia_id is not null and tg_op = 'INSERT' then
    if not gestore then raise exception 'Solo un gestore può creare gli incontri parrocchiali approvati'; end if;
    select dati->'orari'->(new.parrocchia_riga - 1) into o from public.schede where id = new.scheda_parrocchia_id;
    if o is null or new.data <> (o->>'data')::date
      or new.inizio <> least((o->>'inizio')::time, nullif(o->>'all_da','')::time, nullif(o->>'porte','')::time)
      or new.fine <> greatest((o->>'fine')::time, nullif(o->>'sgombero','')::time) then
      raise exception 'L’incontro deve corrispondere a una data approvata della richiesta'; end if;
  end if;
  if tg_op = 'UPDATE' and old.scheda_parrocchia_id is not null and not gestore
     and (new.data, new.inizio, new.fine, new.stato) is distinct from (old.data, old.inizio, old.fine, old.stato) then
    raise exception 'Solo un gestore può modificare le date e lo stato degli incontri parrocchiali'; end if;
  if tg_op = 'UPDATE' and old.scheda_parrocchia_id is not null and
    (new.scheda_parrocchia_id is distinct from old.scheda_parrocchia_id or new.parrocchia_riga is distinct from old.parrocchia_riga) then
    raise exception 'Il collegamento alla richiesta parrocchiale va conservato'; end if;
  if new.scheda_parrocchia_id is not null then
    if not exists (select 1 from public.schede where id = new.scheda_parrocchia_id and percorso = 'parrocchia' and stato = 'approvata') then
      raise exception 'La richiesta parrocchiale non è stata approvata'; end if;
    if new.prezzo <> 0 or new.incassato <> 0 or (new.tariffa is not null and new.tariffa - 'pubblico' <> '{}'::jsonb) or not new.della_sala or new.comune
       or new.parrocchia_riga is null or new.parrocchia_riga < 1 then
      raise exception 'Le attività parrocchiali approvate sono sempre gratuite e senza tariffe'; end if;
  end if;
  return new;
end $$;
drop trigger if exists parrocchia_prenotazione_proteggi on public.bookings;
create trigger parrocchia_prenotazione_proteggi before insert or update on public.bookings
  for each row execute function public.parrocchia_prenotazione_proteggi();

create or replace function public.parrocchia_crea_incontri() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; o jsonb; inizio_occupazione time; fine_occupazione time; bid uuid; primo uuid;
begin
  if new.percorso <> 'parrocchia' or new.stato <> 'approvata' or old.stato = 'approvata' then return new; end if;
  perform public.parrocchia_valida(new.dati);
  -- Serializza il controllo con gli inserimenti/modifiche normali del calendario.
  lock table public.bookings in share row exclusive mode;
  for r in select value, ordinality from jsonb_array_elements(new.dati->'orari') with ordinality loop
    o := r.value;
    inizio_occupazione := least((o->>'inizio')::time, nullif(o->>'all_da','')::time, nullif(o->>'porte','')::time);
    fine_occupazione := greatest((o->>'fine')::time, nullif(o->>'sgombero','')::time);
    if exists (select 1 from public.bookings b where b.stato <> 'annullata' and b.data = (o->>'data')::date and b.inizio < fine_occupazione and inizio_occupazione < b.fine) then
      raise exception 'Sovrapposizione il %: nessun incontro è stato confermato. Correggi le date o gli orari', o->>'data'; end if;
    insert into public.bookings(titolo, referente, telefono, email, tipo, data, inizio, fine, prezzo, incassato, tariffa, stato, origine, della_sala, comune, scheda_parrocchia_id, parrocchia_riga, note)
      values(new.dati->>'titolo', new.dati->>'referente', new.dati->>'cellulare', coalesce(new.dati->>'email',''), 'Attività parrocchiale', (o->>'data')::date, inizio_occupazione, fine_occupazione, 0, 0, null, 'confermata', 'app', true, false, new.id, r.ordinality::int,
        'Attività della Parrocchia · ' || (new.dati->>'gruppo') || '. Orari comprensivi di preparazione e riordino.') returning id into bid;
    if primo is null then primo := bid; end if;
  end loop;
  update public.schede set booking_id = primo where id = new.id;
  return new;
end $$;
drop trigger if exists parrocchia_crea_incontri on public.schede;
create trigger parrocchia_crea_incontri after update of stato on public.schede
  for each row execute function public.parrocchia_crea_incontri();

create or replace function public.parrocchia_approva(p_scheda uuid, p_sicurezza text, p_note text default '', p_siae_verificata boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.schede;
begin
  if coalesce(public.my_role(),'') not in ('admin','coordinatore') then raise exception 'Solo un gestore può approvare'; end if;
  select * into s from public.schede where id = p_scheda and percorso = 'parrocchia' for update;
  if not found then raise exception 'Richiesta parrocchiale non trovata'; end if;
  if s.stato <> 'approvata' then
    update public.schede set stato = 'approvata', sicurezza = p_sicurezza, sicurezza_note = coalesce(p_note,''),
      parrocchia_siae_verificata = coalesce(p_siae_verificata,false), verificata_da = auth.uid(), verificata_il = now(), aggiornato = now()
      where id = s.id;
  end if;
  return jsonb_build_object('ok',true,'incontri', (select count(*) from public.bookings where scheda_parrocchia_id = s.id));
end $$;
revoke all on function public.parrocchia_approva(uuid,text,text,boolean) from public;
grant execute on function public.parrocchia_approva(uuid,text,text,boolean) to authenticated;

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
    'percorso', s.percorso, 'gratuito', s.percorso = 'parrocchia',
    'incontri', case when s.percorso = 'parrocchia' and s.stato = 'approvata' then
      coalesce((select jsonb_agg(jsonb_build_object('data', ib.data, 'inizio', to_char(ib.inizio,'HH24:MI'), 'fine', to_char(ib.fine,'HH24:MI'), 'stato', ib.stato) order by ib.data, ib.inizio)
        from public.bookings ib where ib.scheda_parrocchia_id = s.id), '[]'::jsonb) else null end,
    'stato', s.stato, 'compilata_il', s.compilata_il,
    'dati', case when s.percorso = 'parrocchia' or s.stato in ('compilata', 'respinta') then s.dati else '{}'::jsonb end,
    'chiusa', s.stato = 'approvata',
    -- evento co-organizzato con la sala: la SIAE la fa la sala (scelta nella scheda, o evento «Organizzato dalla Sala»)
    'siae_sala', coalesce(s.siae_sala, false) or coalesce((to_jsonb(b)->>'della_sala')::boolean, false)
  );
end $$;

revoke all on function public.scheda_apri(uuid) from public;
grant execute on function public.scheda_apri(uuid) to anon, authenticated;

create or replace function public.scheda_invia(p_token uuid, p_dati jsonb, p_firma text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.schede; d jsonb := p_dati;
begin
  select * into s from public.schede where token = p_token for update;
  if not found or s.stato = 'non_serve' then raise exception 'Scheda non trovata'; end if;
  if s.stato = 'approvata' then raise exception 'La scheda è già stata approvata: contatta la sala per modifiche'; end if;
  if jsonb_typeof(d) is distinct from 'object' or length(d::text) > 30000 then raise exception 'Dati non validi'; end if;
  if length(trim(coalesce(p_firma,''))) < 3 then raise exception 'Manca il nome di chi firma'; end if;
  if s.percorso = 'parrocchia' then
    perform public.parrocchia_valida(d);
    d := (d - 'cf' - 'indirizzo' - 'prezzo' - 'incassato' - 'tariffa') || jsonb_build_object('ente','Parrocchia di San Biagio','a_titolo','parrocchia','tipo','conferenza');
  end if;
  update public.schede set dati = d, firma_nome = left(trim(p_firma),120), stato = 'compilata', compilata_il = now(),
    aggiornato = now(), aperta_il = coalesce(aperta_il,now()), data_evento = case when s.percorso = 'parrocchia' then (d->'orari'->0->>'data')::date else data_evento end,
    titolo = case when s.percorso = 'parrocchia' then d->>'titolo' else titolo end
    where id = s.id;
  return jsonb_build_object('ok',true,'compilata_il',now(),'in_attesa_approvazione',s.percorso = 'parrocchia');
end $$;
revoke all on function public.scheda_invia(uuid,jsonb,text) from public;
grant execute on function public.scheda_invia(uuid,jsonb,text) to anon, authenticated;
notify pgrst, 'reload schema';

revoke all on function public.parrocchia_scheda_proteggi() from public;
revoke all on function public.parrocchia_prenotazione_proteggi() from public;
revoke all on function public.parrocchia_crea_incontri() from public;
