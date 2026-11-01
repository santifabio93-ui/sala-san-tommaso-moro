-- Persone della rubrica, gruppi e associazioni alle attività. Dopo 039; rieseguibile.
create table if not exists public.gruppi (
 id uuid primary key default gen_random_uuid(),
 nome text not null check(length(trim(nome)) between 2 and 160),
 tipo text not null default 'altro' check(tipo in ('parrocchia','associazione','compagnia','altro')),
 referente_chiave text references public.rubrica(chiave) on delete restrict,
 note text not null default '' check(length(note)<=2000),
 archiviato boolean not null default false,
 revisione uuid not null default gen_random_uuid()
);
create unique index if not exists gruppi_nome_unico on public.gruppi(lower(trim(nome)));
create table if not exists public.gruppi_persone (
 gruppo_id uuid not null references public.gruppi(id) on delete cascade,
 persona_chiave text not null references public.rubrica(chiave) on delete restrict,
 primary key(gruppo_id,persona_chiave)
);
alter table public.gruppi enable row level security;
alter table public.gruppi_persone enable row level security;
drop policy if exists "gruppi: staff legge" on public.gruppi;
create policy "gruppi: staff legge" on public.gruppi for select to authenticated using(public.my_role() in ('admin','coordinatore','segreteria'));
drop policy if exists "gruppi persone: staff legge" on public.gruppi_persone;
create policy "gruppi persone: staff legge" on public.gruppi_persone for select to authenticated using(public.my_role() in ('admin','coordinatore','segreteria'));
alter table public.bookings add column if not exists gruppo_id uuid references public.gruppi(id) on delete restrict;
alter table public.bookings add column if not exists persona_chiave text references public.rubrica(chiave) on delete restrict;
alter table public.schede add column if not exists gruppo_id uuid references public.gruppi(id) on delete restrict;
alter table public.schede add column if not exists persona_chiave text references public.rubrica(chiave) on delete restrict;
create index if not exists bookings_gruppo on public.bookings(gruppo_id) where gruppo_id is not null;
create index if not exists bookings_persona on public.bookings(persona_chiave) where persona_chiave is not null;

create or replace function public.gruppo_salva(p_id uuid, p_nome text, p_tipo text, p_persone jsonb, p_referente text, p_note text default '', p_archiviato boolean default false, p_revisione uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.gruppi; p jsonb; k text; membri text[] := '{}';
begin
 if coalesce(public.my_role(),'') not in ('admin','coordinatore','segreteria') then raise exception 'Non hai i permessi per gestire i gruppi'; end if;
 if p_nome is null or length(trim(p_nome)) not between 2 and 160 or p_tipo is null or p_tipo not in ('parrocchia','associazione','compagnia','altro') or length(coalesce(p_note,''))>2000 then raise exception 'Controlla nome, tipo e note del gruppo'; end if;
 if jsonb_typeof(p_persone) is distinct from 'array' then raise exception 'Persone non valide'; end if;
 if jsonb_array_length(p_persone)>200 then raise exception 'Troppi contatti per un gruppo'; end if;
 if p_id is not null then
  select * into r from public.gruppi where id=p_id for update;
  if not found or r.revisione is distinct from p_revisione then raise exception 'Il gruppo è cambiato: ricarica prima di salvare'; end if;
 elsif p_revisione is not null then raise exception 'Ricarica il gruppo'; end if;
 for p in select value from jsonb_array_elements(p_persone) loop
  k := p->>'chiave';
  if jsonb_typeof(p) is distinct from 'object' or coalesce(k,'')='' or length(k)>300 or length(trim(coalesce(p->>'nome',''))) not between 1 and 120 or length(coalesce(p->>'telefono',''))>60 or length(coalesce(p->>'email',''))>160 then raise exception 'Contatto non valido: indica il nome della persona'; end if;
  -- Conserva eventuali correzioni e note già presenti. Persisti solo i contatti scelti.
  insert into public.rubrica(chiave,nome,telefono,email,ente,categoria)
    values(k,trim(p->>'nome'),coalesce(p->>'telefono',''),coalesce(p->>'email',''),left(coalesce(p->>'ente',''),160),left(coalesce(nullif(p->>'categoria',''),'Organizzatore'),80)) on conflict(chiave) do nothing;
  if not exists(select 1 from public.rubrica where chiave=k and trim(nome)<>'') then raise exception 'Scegli una persona con il nome compilato'; end if;
  membri := array_append(membri,k);
 end loop;
 if nullif(p_referente,'') is not null and not(p_referente=any(membri)) then raise exception 'Il referente abituale deve essere una delle persone del gruppo'; end if;
 if p_id is null then
  insert into public.gruppi(nome,tipo) values(trim(p_nome),p_tipo) returning * into r;
 end if;
 update public.gruppi set nome=trim(p_nome),tipo=p_tipo,referente_chiave=nullif(p_referente,''),note=coalesce(p_note,''),archiviato=coalesce(p_archiviato,false),revisione=gen_random_uuid() where id=r.id returning * into r;
 delete from public.gruppi_persone where gruppo_id=r.id and not(persona_chiave=any(membri));
 insert into public.gruppi_persone(gruppo_id,persona_chiave) select r.id,x from unnest(membri) x on conflict do nothing;
 return to_jsonb(r);
end $$;
revoke all on function public.gruppo_salva(uuid,text,text,jsonb,text,text,boolean,uuid) from public;
grant execute on function public.gruppo_salva(uuid,text,text,jsonb,text,text,boolean,uuid) to authenticated;

-- I riferimenti sono assegnati dallo staff; il modulo pubblico non può cambiarli.
create or replace function public.attivita_controlla_associazione() returns trigger
language plpgsql security definer set search_path=public as $$
declare s public.schede;
begin
 if tg_table_name='bookings' then
 if tg_op='INSERT' and new.scheda_parrocchia_id is not null then
  select * into s from public.schede where id=new.scheda_parrocchia_id;
  -- Non attribuire a una persona/gruppo una risposta pubblica con un'identità diversa.
  if s.gruppo_id is not null and exists(select 1 from public.gruppi where id=s.gruppo_id and lower(trim(nome))=lower(trim(s.dati->>'gruppo'))) then new.gruppo_id:=s.gruppo_id; end if;
  if s.persona_chiave is not null and exists(select 1 from public.rubrica where chiave=s.persona_chiave and lower(trim(nome))=lower(trim(new.referente))) then new.persona_chiave:=s.persona_chiave; end if;
 end if;
 end if;
 if tg_op='UPDATE' and new.gruppo_id is not distinct from old.gruppo_id then return new; end if;
 if new.gruppo_id is not null and not exists(select 1 from public.gruppi where id=new.gruppo_id and not archiviato) then raise exception 'Scegli un gruppo attivo'; end if;
 return new;
end $$;
revoke all on function public.attivita_controlla_associazione() from public;
drop trigger if exists attivita_controlla_associazione on public.bookings;
create trigger attivita_controlla_associazione before insert or update of gruppo_id,persona_chiave on public.bookings for each row execute function public.attivita_controlla_associazione();
drop trigger if exists attivita_controlla_associazione on public.schede;
create trigger attivita_controlla_associazione before insert or update of gruppo_id,persona_chiave on public.schede for each row execute function public.attivita_controlla_associazione();
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='gruppi') then alter publication supabase_realtime add table public.gruppi; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='gruppi_persone') then alter publication supabase_realtime add table public.gruppi_persone; end if;
end $$;
notify pgrst,'reload schema';
