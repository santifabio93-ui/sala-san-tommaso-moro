-- Dettagli condizionali per tipo=danza nella scheda esterna esistente. Dopo 041.
alter table public.schede add column if not exists danza_verifica jsonb not null default '{}'::jsonb;
create or replace function public.danza_valida(d jsonb) returns void
language plpgsql set search_path=public as $$
declare k text; v text; n numeric; limite numeric; o jsonb; inizio time; fine time; da time; a time; porta time; sgombero time;
begin
 if d->'danza_versione' is distinct from '1'::jsonb then raise exception 'Completa la sezione Saggio di danza nel modulo aggiornato'; end if;
 foreach k in array array['ente','referente','cellulare','titolo'] loop
  if length(trim(coalesce(d->>k,''))) < (case when k='cellulare' then 6 when k='referente' then 3 else 1 end) then raise exception 'Completa organizzatore, referente, cellulare e titolo'; end if;
 end loop;
 if d->'ok_regole' is distinct from 'true'::jsonb or d->'ok_dichiarazione' is distinct from 'true'::jsonb or d->'ok_privacy' is distinct from 'true'::jsonb then raise exception 'Accetta regole, dichiarazione e informativa privacy'; end if;
 if coalesce(d->>'fascia','') not in ('platea','tutta') then raise exception 'Per la danza serve la platea con il palco'; end if;
 foreach k in array array['danza_stili','danza_calzature','danza_audio_responsabile','danza_audio_cell','danza_luci'] loop
  if length(trim(coalesce(d->>k,''))) < (case when k like '%_cell' then 6 else 3 end) then raise exception 'Completa le informazioni danza: %',case k when 'danza_stili' then 'stili e svolgimento' when 'danza_calzature' then 'calzature e pavimento' when 'danza_audio_responsabile' then 'responsabile audio' when 'danza_audio_cell' then 'cellulare del responsabile audio' else 'esigenze luci' end; end if;
 end loop;
 for k,v in select * from jsonb_each_text(d) where key like 'danza_%' loop
  if k not like '%_n' and k not in ('danza_versione','danza_conferma') and jsonb_typeof(d->k)<>'string' then raise exception 'Le descrizioni danza devono essere testi'; end if;
  if length(coalesce(v,''))>4000 then raise exception 'Una risposta danza supera i 4000 caratteri'; end if;
 end loop;
 foreach k in array array['danza_ballerini_n','danza_minori_n','danza_accompagnatori_n','danza_pubblico_n','danza_retro_n','palco_n'] loop
  v:=d->>k;
  if coalesce(v,'') !~ '^[0-9]+$' then raise exception 'Indica quantità intere per ballerini, minori, accompagnatori, pubblico, palco e retropalco'; end if;
  n:=v::numeric;
  limite:=case k when 'danza_minori_n' then (d->>'danza_ballerini_n')::numeric when 'palco_n' then (d->>'danza_ballerini_n')::numeric when 'danza_accompagnatori_n' then 200 when 'danza_pubblico_n' then (case when d->>'fascia'='tutta' then 472 else 338 end) when 'danza_retro_n' then 1200 else 1000 end;
  if n>(limite) or n<(case when k in ('danza_ballerini_n','palco_n') then 1 else 0 end) then raise exception 'Quantità incoerenti con ballerini, palco o capienza del pubblico'; end if;
 end loop;
 if coalesce(d->>'danza_pavimento','') not in ('sala','tappeto_sala','tappeto_proprio') then raise exception 'Indica il pavimento o tappeto richiesto'; end if;
 if d->>'danza_pavimento'='tappeto_proprio' and length(trim(coalesce(d->>'danza_tappeto_note','')))<3 then raise exception 'Descrivi dimensioni e posa del tappeto proprio'; end if;
 if coalesce(d->>'danza_cambi','') not in ('si','no') then raise exception 'Indica se servono spazi per cambi costume'; end if;
 if d->>'danza_cambi'='si' and length(trim(coalesce(d->>'danza_cambi_note','')))<3 then raise exception 'Descrivi le esigenze per i cambi costume'; end if;
 if coalesce(d->>'danza_musica','') not in ('registrata','vivo','mista') then raise exception 'Indica il tipo di musica'; end if;
 if d->>'danza_musica' in ('registrata','mista') and length(trim(coalesce(d->>'danza_audio_supporto','')))<3 then raise exception 'Indica formato, consegna e scaletta delle basi musicali'; end if;
 if (d->>'danza_minori_n')::numeric>0 then
  if (d->>'danza_accompagnatori_n')::numeric<1 then raise exception 'Indica almeno un adulto al seguito dei minori'; end if;
  if length(trim(coalesce(d->>'danza_eta','')))<3 or length(trim(coalesce(d->>'danza_responsabile_minori','')))<3 or length(trim(coalesce(d->>'danza_responsabile_cell','')))<6 then raise exception 'Indica fasce d’età, responsabile dei minori e cellulare'; end if;
 end if;
 if coalesce(d->>'danza_link_tecnico','')<>'' and (d->>'danza_link_tecnico') !~ '^https?://' then raise exception 'Il link tecnico deve iniziare con http:// o https://'; end if;
 if d->'danza_conferma' is distinct from 'true'::jsonb then raise exception 'Conferma che le esigenze sono da concordare con la Sala'; end if;
 if jsonb_typeof(d->'orari') is distinct from 'array' then raise exception 'Indica gli orari delle prove e repliche'; end if;
 if jsonb_array_length(d->'orari') not between 1 and 30 then raise exception 'Indica da 1 a 30 prove o repliche'; end if;
 for o in select value from jsonb_array_elements(d->'orari') loop
  if coalesce(o->>'utilizzo','') not in ('prove','saggio') or coalesce(o->>'data','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Indica data e utilizzo (prova o replica) per ogni riga'; end if;
  perform (o->>'data')::date;
  foreach k in array array['inizio','fine','all_da','all_a','porte','sgombero'] loop
   if coalesce(o->>k,'')<>'' and (o->>k) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Un orario non è valido'; end if;
  end loop;
  inizio:=nullif(o->>'inizio','')::time;fine:=nullif(o->>'fine','')::time;
  da:=nullif(o->>'all_da','')::time;a:=nullif(o->>'all_a','')::time;porta:=nullif(o->>'porte','')::time;sgombero:=nullif(o->>'sgombero','')::time;
  if inizio is null or fine is null or fine<=inizio then raise exception 'Completa inizio e fine di ogni prova o replica'; end if;
  if (da is not null and da>inizio) or (a is not null and (da is null or a<da or a>inizio)) or (porta is not null and porta>inizio) or (sgombero is not null and sgombero<fine) then raise exception 'Controlla l’ordine degli orari di accesso, allestimento, porte, attività e sgombero'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(d->'orari') with ordinality x(o,i),jsonb_array_elements(d->'orari') with ordinality y(o,i)
  where x.i<y.i and x.o->>'data'=y.o->>'data'
  and least((x.o->>'inizio')::time,nullif(x.o->>'all_da','')::time,nullif(x.o->>'porte','')::time)<greatest((y.o->>'fine')::time,nullif(y.o->>'sgombero','')::time)
  and least((y.o->>'inizio')::time,nullif(y.o->>'all_da','')::time,nullif(y.o->>'porte','')::time)<greatest((x.o->>'fine')::time,nullif(x.o->>'sgombero','')::time)) then raise exception 'Prove e repliche si sovrappongono: includi una sola volta ciascuna fascia di occupazione'; end if;
end $$;
create or replace function public.scheda_danza_controlla() returns trigger
language plpgsql security definer set search_path=public as $$
declare k text;
begin
 if new.percorso<>'esterno' then return new; end if;
 if new.dati->>'tipo'='danza' then new.aggiornato:=now(); end if;
 if new.stato='compilata' and (tg_op='INSERT' or new.dati is distinct from old.dati or old.stato is distinct from new.stato or new.compilata_il is distinct from old.compilata_il) then
  new.danza_verifica:='{}'::jsonb;
  if new.dati->>'tipo'='danza' then perform public.danza_valida(new.dati); end if;
 end if;
 if new.dati->>'tipo'='danza' and new.stato='approvata' and (new.dati->>'danza_versione'='1' or tg_op='INSERT' or old.stato is distinct from 'approvata' or new.dati is distinct from old.dati) then
  perform public.danza_valida(new.dati);
  if new.sicurezza is null or new.sicurezza not in ('compatibile','condizioni') then raise exception 'Indica la compatibilità con la Sala prima di approvare'; end if;
  if jsonb_typeof(new.danza_verifica) is distinct from 'object' then raise exception 'Completa le verifiche della Sala per la danza'; end if;
  foreach k in array array['programma','pavimento','retropalco','tecnica'] loop
   if new.danza_verifica->k is distinct from 'true'::jsonb then raise exception 'Completa tutte le verifiche della Sala per la danza'; end if;
  end loop;
  if (new.dati->>'danza_minori_n')::numeric>0 and new.danza_verifica->'minori' is distinct from 'true'::jsonb then raise exception 'Verifica anche la gestione dei minori'; end if;
 end if;
 return new;
end $$;
revoke all on function public.danza_valida(jsonb) from public;
revoke all on function public.scheda_danza_controlla() from public;
drop trigger if exists scheda_danza_controlla on public.schede;
create trigger scheda_danza_controlla before insert or update on public.schede for each row execute function public.scheda_danza_controlla();
notify pgrst,'reload schema';

-- Il link personale danza continua a mostrare le sole risposte del richiedente,
-- anche dopo l’approvazione; nessuna verifica o nota interna nel DTO pubblico.
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
    'dati', case when s.percorso = 'parrocchia' or s.stato in ('compilata', 'respinta') or (s.stato='approvata' and s.dati->>'tipo'='danza') then s.dati else '{}'::jsonb end,
    'chiusa', s.stato = 'approvata',
    -- evento co-organizzato con la sala: la SIAE la fa la sala (scelta nella scheda, o evento «Organizzato dalla Sala»)
    'siae_sala', coalesce(s.siae_sala, false) or coalesce((to_jsonb(b)->>'della_sala')::boolean, false)
  );
end $$;


revoke all on function public.scheda_apri(uuid) from public;
grant execute on function public.scheda_apri(uuid) to anon,authenticated;
notify pgrst,'reload schema';
