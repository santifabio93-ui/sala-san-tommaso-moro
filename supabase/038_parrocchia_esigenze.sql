-- Completa la richiesta parrocchiale: programma, spazi, allestimento e dotazioni.
-- Eseguire dopo 037. Rieseguibile; gli incontri già approvati non cambiano.
-- Le richieste ancora da approvare devono essere integrate con i nuovi dettagli.

create or replace function public.parrocchia_valida(d jsonb) returns void
language plpgsql set search_path = public as $$
declare nome text; limite int; o jsonb; n int; cap int; inizio time; fine time; prep time; prep_fine time; porte time; sgombero time;
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
  if length(trim(coalesce(d->>'descrizione',''))) < 10 then raise exception 'Descrivete concretamente cosa farete durante gli incontri'; end if;
  if length(trim(coalesce(d->>'utilizzo_spazi',''))) < 10 then raise exception 'Descrivete come userete gli spazi richiesti'; end if;
  if coalesce(d->>'disposizione','') not in ('seduti','tavolo','gruppi','altro') then raise exception 'Indicate l’allestimento richiesto'; end if;
  if d->>'disposizione' = 'altro' and length(trim(coalesce(d->>'disposizione_dettagli',''))) < 3 then raise exception 'Descrivete l’allestimento da concordare'; end if;
  if coalesce(d->>'palco','') not in ('si','no') then raise exception 'Indicate se serve il palco'; end if;
  if d->>'fascia' = 'galleria' and (d->>'luci' = 'true' or d->>'sipario' = 'true') then raise exception 'Luci di scena e sipario richiedono la platea'; end if;
  if d->>'palco' = 'si' then
    if d->>'fascia' = 'galleria' then raise exception 'La galleria non dispone del palco: richiedete la platea o entrambe le sale'; end if;
    if coalesce(d->>'palco_n','') !~ '^[0-9]+$' then raise exception 'Indicate quante persone saranno sul palco'; end if;
    if (d->>'palco_n')::numeric not between 1 and 472 or length(trim(coalesce(d->>'palco_uso',''))) < 3 then raise exception 'Descrivete l’utilizzo del palco e il numero di persone'; end if;
  end if;
  if coalesce(d->>'conferma_esigenze','') <> 'true' then raise exception 'Confermate di avere indicato tutte le esigenze da verificare'; end if;
  if coalesce(d->>'tecnico','') not in ('nessuno','nostro') then raise exception 'Indicate chi gestisce la parte tecnica'; end if;
  if d->>'tecnico' = 'nostro' and (length(trim(coalesce(d->>'tecnico_nome',''))) < 3 or length(trim(coalesce(d->>'tecnico_cell',''))) < 6) then raise exception 'Indicate nome e cellulare del tecnico'; end if;
  if d->>'proiettore' = 'true' and (length(trim(coalesce(d->>'contenuti_proiezione',''))) < 3 or length(trim(coalesce(d->>'collegamento_video',''))) < 3) then raise exception 'Indicate cosa proiettate e il dispositivo/collegamento previsto'; end if;
  if d->>'audio' = 'true' and length(trim(coalesce(d->>'audio_uso',''))) < 3 then raise exception 'Descrivete per che cosa serve l’audio'; end if;
  if coalesce(d->>'attrezzature','') not in ('si','no') or coalesce(d->>'scenografie','') not in ('si','no') then raise exception 'Indicate se portate attrezzature elettriche o altri materiali'; end if;
  if d->>'attrezzature' = 'si' and length(trim(coalesce(d->>'attrezzature_quali',''))) < 3 then raise exception 'Descrivete le attrezzature vostre e i collegamenti'; end if;
  if d->>'scenografie' = 'si' and length(trim(coalesce(d->>'scenografie_quali',''))) < 3 then raise exception 'Descrivete i materiali e la loro collocazione'; end if;
  foreach nome in array array['mic_filo','radiomic','mic_tavolo','tavolo'] loop
    if d->>nome = 'true' then
      if nome <> 'tavolo' and coalesce(d->>'audio','') <> 'true' then raise exception 'I microfoni richiedono l’impianto audio'; end if;
      if coalesce(d->>(nome || '_n'),'') !~ '^[0-9]+$' then raise exception 'Indicate la quantità richiesta per %', nome; end if;
      limite := case nome when 'mic_filo' then 5 when 'radiomic' then 2 when 'mic_tavolo' then 3 else 10 end;
      if (d->>(nome || '_n'))::numeric not between 1 and limite then raise exception 'Quantità non valida per % (massimo %)', nome, limite; end if;
    end if;
  end loop;
  if coalesce(d->>'potenza_w','') <> '' and coalesce(d->>'potenza_w','') !~ '^[0-9]+$' then raise exception 'La potenza, se nota, va indicata in Watt senza lettere'; end if;
  if coalesce(d->>'carrozzina_n','') <> '' and coalesce(d->>'carrozzina_n','') !~ '^[0-9]+$' then raise exception 'Indicate un numero valido di persone in carrozzina'; end if;
  cap := case d->>'fascia' when 'galleria' then 134 when 'platea' then 338 when 'tutta' then 472 else 0 end;
  if coalesce(d->>'pubblico_n','') !~ '^[0-9]+$' then raise exception 'Indica il numero previsto di partecipanti'; end if;
  n := (d->>'pubblico_n')::int;
  if cap = 0 or n < 1 or n > cap then raise exception 'Partecipanti non compatibili con la capienza dello spazio scelto'; end if;
  if coalesce(d->>'carrozzina_n','') <> '' and (d->>'carrozzina_n')::numeric > n then raise exception 'Le persone in carrozzina non possono superare i partecipanti complessivi'; end if;
  if d->>'palco' = 'si' and (d->>'palco_n')::numeric > n then raise exception 'Le persone sul palco non possono superare i partecipanti complessivi'; end if;
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

notify pgrst, 'reload schema';
