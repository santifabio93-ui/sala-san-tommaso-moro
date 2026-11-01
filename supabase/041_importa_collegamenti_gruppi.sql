-- Importazione esplicita di appartenenze dalla rubrica autenticata. Dopo 040.
-- Nessun dato personale incorporato nella migrazione; nessun import automatico.
create or replace function public.gruppi_importa_collegamenti(p_collegamenti jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare g record; r public.gruppi; membri jsonb; persona jsonb; attesi text[]; n int; nuovi int:=0; presenti int:=0; gruppi_nuovi int:=0; totale int;
begin
 if coalesce(public.my_role(),'') not in ('admin','coordinatore','segreteria') then raise exception 'Non hai i permessi per importare i collegamenti'; end if;
 if jsonb_typeof(p_collegamenti) is distinct from 'array' or length(p_collegamenti::text)>250000 then raise exception 'File di collegamenti non valido'; end if;
 totale:=jsonb_array_length(p_collegamenti);
 if totale not between 1 and 200 then raise exception 'Scegli da 1 a 200 collegamenti'; end if;
 for persona in select value from jsonb_array_elements(p_collegamenti) loop
  if jsonb_typeof(persona) is distinct from 'object' or length(trim(coalesce(persona->>'gruppo',''))) not between 2 and 160
    or coalesce(persona->>'tipo','') not in ('parrocchia','associazione','compagnia','altro') or jsonb_typeof(persona->'persona') is distinct from 'object'
    or coalesce(persona->'persona'->>'chiave','')='' then raise exception 'Controlla gruppo, tipo e persona di ogni collegamento'; end if;
 end loop;
 -- Un ordine comune dei gruppi evita lock incrociati fra due importazioni.
 for g in select lower(trim(value->>'gruppo')) identita,min(trim(value->>'gruppo')) nome,
     min(value->>'tipo') tipo,count(distinct value->>'tipo') tipi,
     jsonb_agg(value) righe from jsonb_array_elements(p_collegamenti) group by lower(trim(value->>'gruppo')) order by 1 loop
  select array_agg(distinct coalesce(value->>'revisione_gruppo','')) into attesi from jsonb_array_elements(g.righe);
  if cardinality(attesi)<>1 then raise exception 'Le versioni del gruppo non coincidono: ricarica'; end if;
  r:=null;
  select * into r from public.gruppi where lower(trim(nome))=g.identita for update;
  if found then
   if r.archiviato then raise exception 'Il gruppo % è archiviato: riattivalo o cambia la destinazione',r.nome; end if;
   if r.revisione::text<>attesi[1] then raise exception 'Il gruppo % è cambiato: ricarica prima di importare',r.nome; end if;
  elsif attesi[1]<>'' then raise exception 'Un gruppo non è più disponibile: ricarica'; end if;
  if r.id is null and g.tipi<>1 then raise exception 'Lo stesso nuovo gruppo ha tipi diversi nel file'; end if;
  select count(*) into n from (select distinct value->'persona'->>'chiave' chiave from jsonb_array_elements(g.righe)) x
   where r.id is null or not exists(select 1 from public.gruppi_persone m where m.gruppo_id=r.id and m.persona_chiave=x.chiave);
  select count(distinct value->'persona'->>'chiave')-n into totale from jsonb_array_elements(g.righe);
  presenti:=presenti+totale;
  if n=0 then continue; end if;
  -- Riutilizza il salvataggio con validazione di 040, preservando ogni membro,
  -- referente abituale, nota e tipo dei gruppi già esistenti.
  select coalesce(jsonb_agg(jsonb_build_object('chiave',c.chiave,'nome',c.nome,'telefono',c.telefono,'email',c.email)),'[]'::jsonb)
    into membri from public.gruppi_persone m join public.rubrica c on c.chiave=m.persona_chiave where m.gruppo_id=r.id;
  select membri || jsonb_agg(value->'persona') into membri from jsonb_array_elements(g.righe);
  select jsonb_agg(x.dato) into membri from (select distinct on (value->>'chiave') value dato from jsonb_array_elements(membri) with ordinality order by value->>'chiave',ordinality) x;
  perform public.gruppo_salva(r.id,coalesce(r.nome,g.nome),coalesce(r.tipo,g.tipo),membri,r.referente_chiave,coalesce(r.note,''),false,r.revisione);
  if r.id is null then gruppi_nuovi:=gruppi_nuovi+1; end if;
  nuovi:=nuovi+n;
 end loop;
 return jsonb_build_object('collegamenti_aggiunti',nuovi,'gia_presenti',presenti,'gruppi_creati',gruppi_nuovi);
end $$;
revoke all on function public.gruppi_importa_collegamenti(jsonb) from public;
grant execute on function public.gruppi_importa_collegamenti(jsonb) to authenticated;
notify pgrst,'reload schema';
