-- Eventi organizzati dalla Sala: informazioni interne e sezioni tecniche delegate.
-- Nessuna creazione o modifica automatica di prenotazioni, prezzi o informazioni pubbliche.
create table if not exists public.eventi_sala (
 booking_id uuid primary key references public.bookings(id) on delete cascade,
 tipo text not null check (tipo in ('conferenza','teatro','concerto','danza','proiezione')),
 interni jsonb not null default '{}'::jsonb,
 interni_completi boolean not null default false,
 tecnica_sala jsonb not null default '{}'::jsonb,
 sezioni_ospite text[] not null default '{}',
 ospite_token uuid unique,
 ospite_dati jsonb not null default '{}'::jsonb,
 ospite_nome text not null default '',
 ospite_contatto text not null default '',
 stato_ospite text not null default 'non_richiesto' check (stato_ospite in ('non_richiesto','da_compilare','da_verificare','confermato')),
 tecnica_confermata jsonb,
 verificata_da uuid references auth.users(id) on delete set null,
 verificata_il timestamptz,
 aggiornato_da uuid references auth.users(id) on delete set null,
 aggiornato timestamptz not null default now(),
 revisione uuid not null default gen_random_uuid()
);
alter table public.eventi_sala enable row level security;
drop policy if exists "eventi sala: staff legge" on public.eventi_sala;
create policy "eventi sala: staff legge" on public.eventi_sala for select to authenticated
 using (public.my_role() in ('admin','coordinatore','segreteria'));

create or replace function public.evento_sala_sezioni(p_tipo text) returns text[]
language sql immutable set search_path = public as $$
 select case p_tipo when 'conferenza' then array['audio','video','logistica'] when 'proiezione' then array['video','audio','logistica']
 when 'teatro' then array['palco','audio','luci','video','logistica'] when 'concerto' then array['palco','audio','luci','video','logistica']
 when 'danza' then array['palco','audio','luci','video','logistica'] else '{}'::text[] end
$$;
create or replace function public.evento_sala_campi(p_sezioni text[]) returns text[]
language plpgsql immutable set search_path = public as $$
declare result text[] := array['documento_tecnico_url']; s text;
begin
 foreach s in array p_sezioni loop
  result := result || case s
   when 'audio' then array['audio_uso','mic_filo_n','radiomic_n','mic_tavolo_n','impianto_proprio','audio_note']
   when 'video' then array['contenuti_video','supporto_video','connessione_video','sottotitoli','video_note']
   when 'palco' then array['persone_palco','disposizione_palco','scenografie','palco_note']
   when 'luci' then array['esigenze_luci','luci_proprie','luci_note']
   when 'logistica' then array['arrivo','montaggio_dalle','prove_dalle','prove_alle','smontaggio_entro','referente_tecnico','cellulare_tecnico','logistica_note']
   else '{}'::text[] end;
 end loop;
 return result;
end $$;
create or replace function public.evento_sala_valida_tecnica(d jsonb, sezioni text[], obbligatorie text[] default '{}') returns void
language plpgsql set search_path = public as $$
declare k text; v text;
begin
 if jsonb_typeof(d) is distinct from 'object' or length(d::text) > 25000 then raise exception 'Dati tecnici non validi'; end if;
 for k,v in select * from jsonb_each_text(d) loop
  if not (k = any(public.evento_sala_campi(sezioni))) then raise exception 'Campo non assegnato o non previsto per questo evento: %', k; end if;
  if jsonb_typeof(d->k) not in ('string','number') or length(coalesce(v,'')) > 4000 then raise exception 'Valore non valido per %', k; end if;
  if k in ('mic_filo_n','radiomic_n','mic_tavolo_n','persone_palco') and coalesce(v,'') <> '' then
   if v !~ '^[0-9]+$' then raise exception 'Le quantità devono essere numeri interi'; end if;
   if v::numeric not between 0 and 100 then raise exception 'Quantità tecnica non valida'; end if;
  end if;
  if k in ('arrivo','montaggio_dalle','prove_dalle','prove_alle','smontaggio_entro') and coalesce(v,'') <> '' and v !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Orario non valido'; end if;
  if k = 'documento_tecnico_url' and coalesce(v,'') <> '' and v !~ '^https?://' then raise exception 'Il link alla scheda tecnica deve iniziare con https:// o http://'; end if;
 end loop;
 if coalesce(d->>'prove_dalle','') <> '' and coalesce(d->>'prove_alle','') <> '' and (d->>'prove_alle')::time <= (d->>'prove_dalle')::time then raise exception 'La fine delle prove deve seguire l’inizio'; end if;
 if 'audio' = any(obbligatorie) and length(trim(coalesce(d->>'audio_uso',''))) < 3 then raise exception 'Descrivi come sarà usato l’audio'; end if;
 if 'video' = any(obbligatorie) and (length(trim(coalesce(d->>'contenuti_video',''))) < 3 or length(trim(coalesce(d->>'supporto_video',''))) < 3) then raise exception 'Indica contenuto e formato/supporto della proiezione'; end if;
 if 'palco' = any(obbligatorie) and (length(trim(coalesce(d->>'disposizione_palco',''))) < 3 or coalesce(d->>'persone_palco','') !~ '^[1-9][0-9]*$') then raise exception 'Indica disposizione e persone sul palco'; end if;
 if 'luci' = any(obbligatorie) and length(trim(coalesce(d->>'esigenze_luci',''))) < 3 then raise exception 'Descrivi le esigenze delle luci'; end if;
 if 'logistica' = any(obbligatorie) and (length(trim(coalesce(d->>'referente_tecnico',''))) < 3 or length(trim(coalesce(d->>'cellulare_tecnico',''))) < 6 or coalesce(d->>'arrivo','') = '') then raise exception 'Indica arrivo, referente tecnico/operativo e cellulare'; end if;
end $$;
create or replace function public.evento_sala_valida_interni(d jsonb) returns boolean
language plpgsql set search_path = public as $$
declare k text;
begin
 if jsonb_typeof(d) is distinct from 'object' or length(d::text) > 25000 then raise exception 'Informazioni interne non valide'; end if;
 for k in select jsonb_object_keys(d) loop
  if k not in ('referente_interno','ospite_nome','ospite_contatto','programma','durata_minuti','pubblico_n','accessibilita','note_interne','descrizione_pubblica','nomi_pubblicabili','materiali_pubblici','autorizza_promozione') then raise exception 'Campo interno non previsto: %', k; end if;
  if k <> 'autorizza_promozione' and (jsonb_typeof(d->k) not in ('string','number') or length(d->>k) > 5000) then raise exception 'Informazione interna non valida'; end if;
 end loop;
 foreach k in array array['durata_minuti','pubblico_n'] loop
  if coalesce(d->>k,'') <> '' then
   if d->>k !~ '^[1-9][0-9]*$' then raise exception 'Durata e partecipanti devono essere numeri interi positivi'; end if;
   if (d->>k)::numeric > (case k when 'pubblico_n' then 472 else 1440 end) then raise exception 'Durata o partecipanti oltre il limite previsto'; end if;
  end if;
 end loop;
 if coalesce(d->>'materiali_pubblici','') <> '' and d->>'materiali_pubblici' !~ '^https?://' then raise exception 'Il link ai materiali deve iniziare con http:// o https://'; end if;
 if d ? 'autorizza_promozione' and jsonb_typeof(d->'autorizza_promozione') <> 'boolean' then raise exception 'Indica se i materiali sono autorizzati per la promozione'; end if;
 return length(trim(coalesce(d->>'referente_interno',''))) >= 3 and length(trim(coalesce(d->>'ospite_nome',''))) >= 3
   and length(trim(coalesce(d->>'ospite_contatto',''))) >= 6 and length(trim(coalesce(d->>'programma',''))) >= 10
   and coalesce(d->>'durata_minuti','') <> '' and coalesce(d->>'pubblico_n','') <> '';
end $$;

create or replace function public.evento_sala_salva(p_booking uuid, p_tipo text, p_interni jsonb, p_tecnica jsonb, p_sezioni text[], p_revisione uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.eventi_sala; completo boolean; sezioni text[]; nuovo boolean; cambia boolean;
begin
 if coalesce(public.my_role(),'') not in ('admin','coordinatore','segreteria') then raise exception 'Non hai i permessi per gestire l’invito'; end if;
 perform 1 from public.bookings where id = p_booking and della_sala and stato <> 'annullata' for update;
 if not found then raise exception 'L’evento deve essere organizzato dalla Sala e non annullato'; end if;
 if cardinality(public.evento_sala_sezioni(p_tipo)) = 0 then raise exception 'Tipo di evento non valido'; end if;
 select coalesce(array_agg(distinct x order by x), '{}') into sezioni from unnest(coalesce(p_sezioni,'{}')) x;
 if not sezioni <@ public.evento_sala_sezioni(p_tipo) then raise exception 'Sezioni non pertinenti al tipo di evento'; end if;
 completo := public.evento_sala_valida_interni(p_interni);
 perform public.evento_sala_valida_tecnica(p_tecnica, public.evento_sala_sezioni(p_tipo));
 select * into r from public.eventi_sala where booking_id = p_booking for update;
 nuovo := not found;
 if nuovo then
  if p_revisione is not null then raise exception 'La scheda non esiste più: ricarica'; end if;
  insert into public.eventi_sala(booking_id,tipo) values(p_booking,p_tipo) returning * into r;
 elsif p_revisione is distinct from r.revisione then raise exception 'Le informazioni sono cambiate: ricarica prima di salvare'; end if;
 cambia := nuovo or r.tipo <> p_tipo or r.sezioni_ospite is distinct from sezioni;
 update public.eventi_sala set tipo = p_tipo, interni = p_interni, interni_completi = completo, tecnica_sala = p_tecnica,
  sezioni_ospite = sezioni, ospite_token = case when cardinality(sezioni) = 0 then null when cambia then gen_random_uuid() else coalesce(ospite_token,gen_random_uuid()) end,
  ospite_dati = case when cambia then '{}'::jsonb else ospite_dati end,
  ospite_nome = case when cambia then '' else ospite_nome end, ospite_contatto = case when cambia then '' else ospite_contatto end,
  stato_ospite = case when cardinality(sezioni) = 0 then 'non_richiesto' when cambia then 'da_compilare' when stato_ospite = 'confermato' then 'da_verificare' else stato_ospite end,
  tecnica_confermata = null, verificata_da = null, verificata_il = null,
  aggiornato_da = auth.uid(), aggiornato = now(), revisione = gen_random_uuid()
 where booking_id = p_booking returning * into r;
 return to_jsonb(r);
end $$;

create or replace function public.ospite_evento_apri(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.eventi_sala; b public.bookings;
begin
 select * into r from public.eventi_sala where ospite_token = p_token;
 if not found or cardinality(r.sezioni_ospite) = 0 then return null; end if;
 select * into b from public.bookings where id = r.booking_id and della_sala and stato <> 'annullata';
 if not found then return null; end if;
 return jsonb_build_object('titolo',b.titolo,'data',b.data,'inizio',to_char(b.inizio,'HH24:MI'),'fine',to_char(b.fine,'HH24:MI'),
  'tipo',r.tipo,'sezioni',r.sezioni_ospite,'dati',r.ospite_dati,'nome_compilatore',r.ospite_nome,'contatto_compilatore',r.ospite_contatto,
  'stato',r.stato_ospite,'revisione',r.revisione);
end $$;
create or replace function public.ospite_evento_invia(p_token uuid, p_dati jsonb, p_nome text, p_contatto text, p_revisione uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.eventi_sala;
begin
 select * into r from public.eventi_sala where ospite_token = p_token for update;
 if not found or cardinality(r.sezioni_ospite) = 0 then raise exception 'Link non valido o revocato'; end if;
 if not exists(select 1 from public.bookings where id = r.booking_id and della_sala and stato <> 'annullata') then raise exception 'Evento non disponibile'; end if;
 if r.revisione is distinct from p_revisione then raise exception 'La richiesta è cambiata: ricarica la pagina prima di inviare'; end if;
 if length(trim(coalesce(p_nome,''))) < 3 or length(trim(coalesce(p_contatto,''))) < 6 then raise exception 'Indica nome e contatto di chi compila'; end if;
 perform public.evento_sala_valida_tecnica(p_dati,r.sezioni_ospite,r.sezioni_ospite);
 update public.eventi_sala set ospite_dati = p_dati, ospite_nome = left(trim(p_nome),120), ospite_contatto = left(trim(p_contatto),200),
  stato_ospite = 'da_verificare', tecnica_confermata = null, verificata_da = null, verificata_il = null,
  aggiornato = now(), revisione = gen_random_uuid() where booking_id = r.booking_id;
 return jsonb_build_object('ok',true,'da_verificare',true);
end $$;
create or replace function public.evento_sala_conferma(p_booking uuid, p_revisione uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.eventi_sala; richieste text[]; tecnica jsonb;
begin
 if coalesce(public.my_role(),'') not in ('admin','coordinatore','segreteria') then raise exception 'Non hai i permessi per confermare'; end if;
 perform 1 from public.bookings where id = p_booking and della_sala and stato <> 'annullata' for update;
 if not found then raise exception 'Evento non disponibile'; end if;
 select * into r from public.eventi_sala where booking_id = p_booking for update;
 if not found or r.revisione is distinct from p_revisione then raise exception 'Le informazioni sono cambiate: ricarica'; end if;
 if not public.evento_sala_valida_interni(r.interni) then raise exception 'Completa la parte interna prima di confermare'; end if;
 if cardinality(r.sezioni_ospite) > 0 and r.stato_ospite not in ('da_verificare','confermato') then raise exception 'La parte assegnata all’ospite non è ancora stata inviata'; end if;
 richieste := case r.tipo when 'teatro' then array['palco'] when 'concerto' then array['palco','audio'] when 'danza' then array['palco','audio'] when 'proiezione' then array['video'] else '{}'::text[] end;
 tecnica := r.tecnica_sala || r.ospite_dati;
 perform public.evento_sala_valida_tecnica(tecnica,public.evento_sala_sezioni(r.tipo),richieste || r.sezioni_ospite);
 update public.eventi_sala set tecnica_confermata = tecnica, stato_ospite = case when cardinality(sezioni_ospite)>0 then 'confermato' else 'non_richiesto' end,
  verificata_da = auth.uid(), verificata_il = now(), aggiornato_da = auth.uid(), aggiornato = now(), revisione = gen_random_uuid()
  where booking_id = p_booking returning * into r;
 return to_jsonb(r);
end $$;
-- Anche un cambio di programma/orario richiede una nuova verifica.
-- Annullamento o rimozione del contrassegno Sala revocano definitivamente il link.
create or replace function public.evento_sala_booking_cambia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
 if row(new.titolo,new.data,new.inizio,new.fine,new.giornata_intera,new.stato,new.della_sala)
    is not distinct from row(old.titolo,old.data,old.inizio,old.fine,old.giornata_intera,old.stato,old.della_sala) then return new; end if;
 update public.eventi_sala set
  tecnica_confermata = null, verificata_da = null, verificata_il = null,
  ospite_token = case when not new.della_sala or new.stato = 'annullata' then null else ospite_token end,
  ospite_dati = case when not new.della_sala or new.stato = 'annullata' then '{}'::jsonb else ospite_dati end,
  ospite_nome = case when not new.della_sala or new.stato = 'annullata' then '' else ospite_nome end,
  ospite_contatto = case when not new.della_sala or new.stato = 'annullata' then '' else ospite_contatto end,
  stato_ospite = case when cardinality(sezioni_ospite)=0 then 'non_richiesto'
   when not new.della_sala or new.stato='annullata' or stato_ospite='da_compilare' then 'da_compilare' else 'da_verificare' end,
  aggiornato = now(), revisione = gen_random_uuid()
 where booking_id = new.id;
 return new;
end $$;
drop trigger if exists evento_sala_booking_cambia on public.bookings;
create trigger evento_sala_booking_cambia after update of titolo,data,inizio,fine,giornata_intera,stato,della_sala on public.bookings
 for each row execute function public.evento_sala_booking_cambia();
revoke all on function public.evento_sala_booking_cambia() from public;
revoke all on function public.evento_sala_sezioni(text) from public;
revoke all on function public.evento_sala_campi(text[]) from public;
revoke all on function public.evento_sala_valida_tecnica(jsonb,text[],text[]) from public;
revoke all on function public.evento_sala_valida_interni(jsonb) from public;
revoke all on function public.evento_sala_salva(uuid,text,jsonb,jsonb,text[],uuid) from public;
revoke all on function public.evento_sala_conferma(uuid,uuid) from public;
revoke all on function public.ospite_evento_apri(uuid) from public;
revoke all on function public.ospite_evento_invia(uuid,jsonb,text,text,uuid) from public;
grant execute on function public.evento_sala_salva(uuid,text,jsonb,jsonb,text[],uuid) to authenticated;
grant execute on function public.evento_sala_conferma(uuid,uuid) to authenticated;
grant execute on function public.ospite_evento_apri(uuid) to anon,authenticated;
grant execute on function public.ospite_evento_invia(uuid,jsonb,text,text,uuid) to anon,authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='eventi_sala') then
  alter publication supabase_realtime add table public.eventi_sala;
 end if;
end $$;
notify pgrst,'reload schema';
