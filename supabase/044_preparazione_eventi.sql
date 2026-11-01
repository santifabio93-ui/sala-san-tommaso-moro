-- La Sala oggi e preparazione condivisa di prenotazioni e proiezioni.
-- Dopo 043; rieseguibile. Non modifica eventi, richieste, turni o incassi.
create table if not exists public.evento_preparazione (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid references public.bookings(id) on delete cascade,
 proiezione_id uuid references public.proiezioni(id) on delete cascade,
 data_evento date not null,
 ora_evento time not null,
 compito text not null check(compito in ('tecnico','chiavi','allestimento','cassa','volontari')),
 stato text not null check(stato in ('da_fare','in_corso','pronto','non_serve','problema')),
 responsabile text not null default '' check(length(responsabile)<=120),
 note text not null default '' check(length(note)<=2000),
 aggiornato timestamptz not null default now(),
 aggiornato_da uuid references auth.users(id) on delete set null,
 revisione uuid not null default gen_random_uuid(),
 check(num_nonnulls(booking_id,proiezione_id)=1),
 unique(booking_id,compito), unique(proiezione_id,compito)
);
alter table public.evento_preparazione enable row level security;
drop policy if exists "preparazione: staff legge" on public.evento_preparazione;
create policy "preparazione: staff legge" on public.evento_preparazione for select to authenticated
 using(public.my_role() in ('admin','coordinatore','segreteria'));
revoke all on public.evento_preparazione from anon,authenticated;
grant select on public.evento_preparazione to authenticated;

-- I volontari ricevono soltanto stato e nome operativo, senza note interne o dati delle richieste.
create or replace view public.preparazione_operativa as
 select p.booking_id,p.proiezione_id,p.compito,p.stato,p.responsabile,p.data_evento,p.ora_evento
 from public.evento_preparazione p
 where public.my_role() in ('admin','coordinatore','segreteria','volontario')
 and (p.booking_id is null or exists(select 1 from public.bookings b where b.id=p.booking_id and b.stato<>'annullata'));
revoke all on public.preparazione_operativa from public,anon;
grant select on public.preparazione_operativa to authenticated;

create or replace function public.preparazione_salva(p_booking uuid,p_proiezione uuid,p_compito text,p_stato text,p_data date,p_ora time,p_responsabile text default '',p_note text default '',p_revisione uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.evento_preparazione; giorno date; ora time;
begin
 if coalesce(public.my_role(),'') not in ('admin','coordinatore','segreteria') then raise exception 'Non hai i permessi per gestire la preparazione'; end if;
 if num_nonnulls(p_booking,p_proiezione)<>1 then raise exception 'Scegli un evento o una proiezione'; end if;
 if p_compito is null or p_compito not in ('tecnico','chiavi','allestimento','cassa','volontari') or p_stato is null or p_stato not in ('da_fare','in_corso','pronto','non_serve','problema')
 or length(coalesce(p_responsabile,''))>120 or length(coalesce(p_note,''))>2000 then raise exception 'Controlla stato, responsabile e note'; end if;
 if p_compito='volontari' and p_booking is not null then raise exception 'Per le prenotazioni la copertura viene dai turni'; end if;
 if p_stato in ('pronto','in_corso') and trim(coalesce(p_responsabile,''))='' then raise exception 'Indica chi se ne occupa'; end if;
 -- Blocca l’evento anche alla prima registrazione, evitando doppioni concorrenti.
 if p_booking is not null then
  select data,inizio into giorno,ora from public.bookings where id=p_booking and stato<>'annullata' for update;
 else
  select data,proiezioni.ora into giorno,ora from public.proiezioni where id=p_proiezione for update;
 end if;
 if not found then raise exception 'Evento non disponibile o annullato'; end if;
 if giorno is distinct from p_data or ora is distinct from p_ora then raise exception 'Data o orario cambiati: ricarica l’evento prima di salvare'; end if;
 select * into r from public.evento_preparazione
 where compito=p_compito and (booking_id=p_booking or proiezione_id=p_proiezione) for update;
 if r.id is not null and r.revisione is distinct from p_revisione then raise exception 'La preparazione è cambiata: ricarica prima di salvare'; end if;
 if r.id is null and p_revisione is not null then raise exception 'La voce non esiste più: ricarica prima di salvare'; end if;
 if r.id is null then
  insert into public.evento_preparazione(booking_id,proiezione_id,compito,stato,data_evento,ora_evento) values(p_booking,p_proiezione,p_compito,p_stato,giorno,ora) returning * into r;
 end if;
 update public.evento_preparazione set stato=p_stato,data_evento=giorno,ora_evento=ora,responsabile=trim(coalesce(p_responsabile,'')),note=trim(coalesce(p_note,'')),
 aggiornato=now(),aggiornato_da=auth.uid(),revisione=gen_random_uuid() where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.preparazione_salva(uuid,uuid,text,text,date,time,text,text,uuid) from public,anon;
grant execute on function public.preparazione_salva(uuid,uuid,text,text,date,time,text,text,uuid) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='evento_preparazione') then
  alter publication supabase_realtime add table public.evento_preparazione;
 end if;
end $$;
notify pgrst,'reload schema';
