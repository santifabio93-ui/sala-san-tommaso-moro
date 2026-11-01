-- Cassa con il solo badge della Sala: nessun account del computer. Dopo 042.
-- Solo i volontari esplicitamente abilitati possono creare sessioni limitate alla cassa.
-- I nuovi badge usano casualità crittografica; i badge già stampati restano validi.
create or replace function public.nuovo_badge() returns text language sql volatile as $$
 select 'STM'||string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',1+(get_byte(casuale,i)%32),1),'')
 from (select sha256(convert_to(gen_random_uuid()::text,'UTF8')) casuale) q,generate_series(0,7) i
$$;

alter table public.volontari add column if not exists cassa_badge boolean not null default false;
alter table public.cassa add column if not exists proiezione_id uuid references public.proiezioni(id) on delete set null;
alter table public.cassa add column if not exists aperta_volontario_id uuid references public.volontari(id) on delete set null;
alter table public.cassa add column if not exists chiusa_volontario_id uuid references public.volontari(id) on delete set null;
alter table public.cassa add column if not exists aggiornata_volontario_id uuid references public.volontari(id) on delete set null;
alter table public.cassa add column if not exists aggiornata_da_nome text not null default '';
create table if not exists public.cassa_badge_sessioni(
 impronta text primary key,volontario_id uuid not null references public.volontari(id) on delete cascade,
 badge_impronta text not null,scade timestamptz not null,ultimo_uso timestamptz not null default now()
);
create index if not exists cassa_badge_scadenze on public.cassa_badge_sessioni(scade);
alter table public.cassa_badge_sessioni enable row level security;
create table if not exists public.cassa_badge_limiti(id int primary key check(id=1),finestra timestamptz not null,tentativi int not null);
alter table public.cassa_badge_limiti enable row level security;

create or replace function public.cassa_badge_limite() returns boolean
language plpgsql security definer set search_path=public as $$
declare n int;
begin
 insert into public.cassa_badge_limiti values(1,now(),1) on conflict(id) do update set
 tentativi=case when cassa_badge_limiti.finestra<now()-interval '1 minute' then 1 else cassa_badge_limiti.tentativi+1 end,
 finestra=case when cassa_badge_limiti.finestra<now()-interval '1 minute' then now() else cassa_badge_limiti.finestra end returning tentativi into n;
 return n<=120;
end $$;
create or replace function public.cassa_badge_accesso(p_badge text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v public.volontari; codice text; token uuid:=gen_random_uuid(); scadenza timestamptz:=now()+interval '8 hours';
begin
 if not public.cassa_badge_limite() then return jsonb_build_object('ok',false,'errore','Troppi tentativi: attendi un minuto e riprova'); end if;
 if length(coalesce(p_badge,''))>100 then return jsonb_build_object('ok',false,'errore','Badge non riconosciuto o non abilitato alla cassa'); end if;
 codice:=upper(regexp_replace(coalesce(p_badge,''),'[^A-Za-z0-9]','','g'));
 if codice !~ '^STM[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' then return jsonb_build_object('ok',false,'errore','Badge non riconosciuto o non abilitato alla cassa'); end if;
 select * into v from public.volontari where badge=codice and attivo and cassa_badge;
 if not found then return jsonb_build_object('ok',false,'errore','Badge non riconosciuto o non abilitato alla cassa'); end if;
 delete from public.cassa_badge_sessioni where scade<now() or ultimo_uso<now()-interval '1 hour';
 insert into public.cassa_badge_sessioni(impronta,volontario_id,badge_impronta,scade)
 values(encode(sha256(convert_to(token::text,'UTF8')),'hex'),v.id,encode(sha256(convert_to(v.badge,'UTF8')),'hex'),scadenza);
 return jsonb_build_object('ok',true,'sessione',token,'nome',v.nome,'scade',scadenza);
end $$;
create or replace function public.cassa_badge_controlla(p_sessione uuid) returns public.volontari
language plpgsql security definer set search_path=public as $$
declare s public.cassa_badge_sessioni; v public.volontari;
begin
 select * into s from public.cassa_badge_sessioni where impronta=encode(sha256(convert_to(p_sessione::text,'UTF8')),'hex') and scade>now() and ultimo_uso>now()-interval '20 minutes' for update;
 if not found then raise exception 'Sessione scaduta: leggi nuovamente il badge'; end if;
 select * into v from public.volontari where id=s.volontario_id and attivo and cassa_badge and encode(sha256(convert_to(badge,'UTF8')),'hex')=s.badge_impronta;
 if not found then raise exception 'Sessione revocata: chiedi al responsabile della Sala'; end if;
 update public.cassa_badge_sessioni set ultimo_uso=now() where impronta=s.impronta;
 return v;
end $$;
create or replace function public.cassa_badge_data_valida(d date) returns boolean
language sql stable set search_path=public as $$
 select d=(now() at time zone 'Europe/Rome')::date or (extract(hour from now() at time zone 'Europe/Rome')<6 and d=(now() at time zone 'Europe/Rome')::date-1)
$$;
create or replace function public.cassa_badge_riga(c public.cassa) returns jsonb
language sql stable set search_path=public as $$
 select jsonb_build_object('id',c.id,'data',c.data,'booking_id',c.booking_id,'proiezione_id',c.proiezione_id,'titolo',coalesce(nullif(c.titolo,''),(select titolo from public.bookings where id=c.booking_id),'Evento della Sala'),
 'fondo_iniziale',c.fondo_iniziale,'online_n',c.online_n,'online_euro',c.online_euro,'contanti_n',c.contanti_n,'contanti_euro',c.contanti_euro,'pos_n',c.pos_n,'pos_euro',c.pos_euro,'omaggi_n',c.omaggi_n,
 'contati',c.contati,'conteggio',c.conteggio,'prelievo',c.prelievo,'fondo_finale',c.fondo_finale,'note',c.note,'stato',c.stato,'aggiornato',c.aggiornato,'aperta_da_nome',c.aperta_da_nome,'chiusa_da_nome',c.chiusa_da_nome,'aggiornata_da_nome',c.aggiornata_da_nome)
$$;
create or replace function public.cassa_badge_leggi(p_sessione uuid,p_data date default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v public.volontari; d date:=coalesce(p_data,(now() at time zone 'Europe/Rome')::date); oggi date:=(now() at time zone 'Europe/Rome')::date;
begin
 v:=public.cassa_badge_controlla(p_sessione);
 if not public.cassa_badge_data_valida(d) then raise exception 'Da questa pagina puoi gestire solo la serata corrente'; end if;
 return jsonb_build_object('ok',true,'nome',v.nome,'data',d,'oggi',oggi,'ieri_consentito',extract(hour from now() at time zone 'Europe/Rome')<6,
 'prezzo_biglietto',(select prezzo_biglietto from public.settings where id=1),
 'fondo_proposto',coalesce((select fondo_finale from public.cassa where stato='chiusa' and data<=d order by data desc,chiuso_il desc nulls last,creato desc limit 1),0),
 'eventi',coalesce((select jsonb_agg(jsonb_build_object('valore','b:'||b.id,'titolo',b.titolo,'ora',to_char(b.inizio,'HH24:MI')) order by b.inizio) from public.bookings b where b.data=d and b.stato<>'annullata'),'[]'::jsonb)
 ||coalesce((select jsonb_agg(jsonb_build_object('valore','p:'||p.id,'titolo',f.titolo,'ora',to_char(p.ora,'HH24:MI')) order by p.ora) from public.proiezioni p join public.films f on f.id=p.film_id where p.data=d),'[]'::jsonb),
 'casse',coalesce((select jsonb_agg(public.cassa_badge_riga(c) order by c.creato) from public.cassa c where c.data=d),'[]'::jsonb));
end $$;
create or replace function public.cassa_badge_conta(d jsonb) returns numeric
language plpgsql immutable set search_path=public as $$
declare k text;v text;tot numeric:=0;
begin
 if jsonb_typeof(d) is distinct from 'object' then raise exception 'Conteggio non valido'; end if;
 for k,v in select * from jsonb_each_text(d) loop
  if k not in ('200','100','50','20','10','5','2','1','0.5','0.2','0.1','0.05','0.02','0.01') or coalesce(v,'') !~ '^[0-9]+$' then raise exception 'Taglio o numero di pezzi non valido'; end if;
  if v::numeric>100000 then raise exception 'Numero di pezzi eccessivo'; end if;
  tot:=tot+k::numeric*v::numeric;
 end loop;
 return round(tot,2);
end $$;
create or replace function public.cassa_badge_salva(p_sessione uuid,p_id uuid,p_dati jsonb,p_chiudi boolean default false,p_revisione timestamptz default null,p_badge_chiusura text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v public.volontari; chiude public.volontari; c public.cassa; d date; b uuid; p uuid; titolo_cassa text; k text; val text; n numeric; nuovo boolean; conteggio_cassa jsonb;
 fondo numeric; contati_cassa numeric; prelievo_cassa numeric; saldo numeric; contante numeric;
begin
 v:=public.cassa_badge_controlla(p_sessione);
 if jsonb_typeof(p_dati) is distinct from 'object' or length(p_dati::text)>15000 then raise exception 'Dati cassa non validi'; end if;
 for k in select jsonb_object_keys(p_dati) loop
  if k not in ('data','evento','titolo','fondo_iniziale','online_n','online_euro','contanti_n','contanti_euro','pos_n','pos_euro','omaggi_n','contati','conteggio','prelievo','note') then raise exception 'Campo cassa non modificabile'; end if;
 end loop;
 d:=nullif(p_dati->>'data','')::date;
 if d is null or not public.cassa_badge_data_valida(d) then raise exception 'Da questa pagina puoi gestire solo la serata corrente'; end if;
 foreach k in array array['fondo_iniziale','online_n','online_euro','contanti_n','contanti_euro','pos_n','pos_euro','omaggi_n','prelievo'] loop
  val:=p_dati->>k;
  if jsonb_typeof(p_dati->k) is distinct from 'number' or coalesce(val,'') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Inserisci numeri positivi o zero negli importi e nei biglietti'; end if;
  n:=val::numeric;
  if (k like '%_n' and (n<>trunc(n) or n>1000000)) or n>99999999.99 then raise exception 'Numero di biglietti o importo oltre il limite supportato'; end if;
 end loop;
 if coalesce(p_dati->>'evento','')<>'' then
  if p_dati->>'evento' like 'b:%' then
   b:=substring(p_dati->>'evento' from 3)::uuid;
   select x.titolo into titolo_cassa from public.bookings x where x.id=b and x.data=d and x.stato<>'annullata';
  elsif p_dati->>'evento' like 'p:%' then
   p:=substring(p_dati->>'evento' from 3)::uuid;
   select f.titolo||' · '||to_char(x.ora,'HH24:MI') into titolo_cassa from public.proiezioni x join public.films f on f.id=x.film_id where x.id=p and x.data=d;
  else raise exception 'Evento non valido'; end if;
  if titolo_cassa is null then raise exception 'Evento non disponibile per questa data'; end if;
 else titolo_cassa:=trim(coalesce(p_dati->>'titolo','')); end if;
 if length(titolo_cassa) not between 1 and 200 or length(coalesce(p_dati->>'note',''))>2000 then raise exception 'Controlla titolo e note della cassa'; end if;
 fondo:=(p_dati->>'fondo_iniziale')::numeric;contante:=(p_dati->>'contanti_euro')::numeric;prelievo_cassa:=(p_dati->>'prelievo')::numeric;
 contati_cassa:=nullif(p_dati->>'contati','')::numeric;
 if contati_cassa is not null and (contati_cassa<0 or contati_cassa>99999999.99 or contati_cassa<>round(contati_cassa,2)) then raise exception 'Contanti contati non validi'; end if;
 conteggio_cassa:=coalesce(p_dati->'conteggio','{}'::jsonb);
 if jsonb_typeof(conteggio_cassa) is distinct from 'object' then raise exception 'Conteggio non valido'; end if;
 if conteggio_cassa?'_fondo' and (select count(*) from jsonb_object_keys(conteggio_cassa->'_fondo'))>0 then fondo:=public.cassa_badge_conta(conteggio_cassa->'_fondo'); end if;
 if (select count(*) from jsonb_object_keys(conteggio_cassa-'_fondo'))>0 then contati_cassa:=public.cassa_badge_conta(conteggio_cassa-'_fondo'); end if;
 saldo:=round(coalesce(contati_cassa,fondo+contante)-prelievo_cassa,2);
 if saldo<0 then raise exception 'Il prelievo supera i contanti disponibili'; end if;
 if p_chiudi then
  if contati_cassa is null then raise exception 'Per chiudere indica i contanti contati'; end if;
  if not public.cassa_badge_limite() then return jsonb_build_object('ok',false,'errore','Troppi tentativi: attendi un minuto'); end if;
  if length(coalesce(p_badge_chiusura,''))>100 then return jsonb_build_object('ok',false,'errore','Badge di chiusura non valido'); end if;
  select * into chiude from public.volontari where attivo and cassa_badge and badge=upper(regexp_replace(coalesce(p_badge_chiusura,''),'[^A-Za-z0-9]','','g'));
  if not found then return jsonb_build_object('ok',false,'errore','Leggi il badge abilitato della persona che chiude'); end if;
 end if;
 -- Serializza anche due aperture simultanee per lo stesso evento.
 perform pg_advisory_xact_lock(hashtextextended('cassa-badge:'||d||':'||coalesce(b::text,p::text,lower(titolo_cassa)),0));
 if exists(select 1 from public.cassa where data=d and (p_id is null or id<>p_id) and ((b is not null and booking_id=b) or (p is not null and proiezione_id=p) or (b is null and p is null and lower(trim(public.cassa.titolo))=lower(titolo_cassa)))) then raise exception 'Esiste già una cassa per questo evento: ricarica'; end if;
 nuovo:=p_id is null;
 if not nuovo then
  select * into c from public.cassa where id=p_id for update;
  if not found or c.data<>d then raise exception 'Cassa non disponibile per questa serata'; end if;
  if c.stato='chiusa' then raise exception 'La cassa è già chiusa: le correzioni le fa il responsabile'; end if;
  if p_revisione is distinct from c.aggiornato then raise exception 'La cassa è cambiata: ricarica prima di salvare'; end if;
 elsif p_revisione is not null then raise exception 'Ricarica la cassa';
 else

  insert into public.cassa(data,titolo,aperta_da_nome,aperta_volontario_id) values(d,titolo_cassa,v.nome,v.id) returning * into c;
 end if;
 update public.cassa set booking_id=b,proiezione_id=p,titolo=titolo_cassa,
 fondo_iniziale=fondo,online_n=(p_dati->>'online_n')::int,online_euro=(p_dati->>'online_euro')::numeric,
 contanti_n=(p_dati->>'contanti_n')::int,contanti_euro=contante,pos_n=(p_dati->>'pos_n')::int,pos_euro=(p_dati->>'pos_euro')::numeric,omaggi_n=(p_dati->>'omaggi_n')::int,
 contati=contati_cassa,conteggio=conteggio_cassa,prelievo=prelievo_cassa,fondo_finale=saldo,note=coalesce(p_dati->>'note',''),stato=case when p_chiudi then 'chiusa' else 'aperta' end,
 chiusa_da_nome=case when p_chiudi then chiude.nome else chiusa_da_nome end,chiusa_volontario_id=case when p_chiudi then chiude.id else chiusa_volontario_id end,
 chiuso_il=case when p_chiudi then now() else chiuso_il end,aggiornato=clock_timestamp(),aggiornata_volontario_id=v.id,aggiornata_da_nome=v.nome where id=c.id returning * into c;
 return jsonb_build_object('ok',true,'cassa',public.cassa_badge_riga(c));
end $$;
create or replace function public.cassa_badge_esci(p_sessione uuid) returns void
language sql security definer set search_path=public as $$ delete from public.cassa_badge_sessioni where impronta=encode(sha256(convert_to(p_sessione::text,'UTF8')),'hex') $$;
-- Revoca permanente delle sessioni correnti, anche se il badge viene poi riabilitato.
create or replace function public.cassa_badge_revoca() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if row(new.cassa_badge,new.attivo,new.badge) is distinct from row(old.cassa_badge,old.attivo,old.badge) then
  delete from public.cassa_badge_sessioni where volontario_id=new.id;
 end if;
 return new;
end $$;
drop trigger if exists cassa_badge_revoca on public.volontari;
create trigger cassa_badge_revoca after update of cassa_badge,attivo,badge on public.volontari for each row execute function public.cassa_badge_revoca();
revoke all on function public.cassa_badge_revoca() from public,anon,authenticated;
revoke all on function public.cassa_badge_limite() from public,anon,authenticated;
revoke all on function public.cassa_badge_controlla(uuid) from public,anon,authenticated;
revoke all on function public.cassa_badge_data_valida(date) from public,anon,authenticated;
revoke all on function public.cassa_badge_riga(public.cassa) from public,anon,authenticated;
revoke all on function public.cassa_badge_conta(jsonb) from public,anon,authenticated;
revoke all on function public.cassa_badge_accesso(text) from public,anon,authenticated;
revoke all on function public.cassa_badge_leggi(uuid,date) from public,anon,authenticated;
revoke all on function public.cassa_badge_salva(uuid,uuid,jsonb,boolean,timestamptz,text) from public,anon,authenticated;
revoke all on function public.cassa_badge_esci(uuid) from public,anon,authenticated;
grant execute on function public.cassa_badge_accesso(text),public.cassa_badge_leggi(uuid,date),public.cassa_badge_salva(uuid,uuid,jsonb,boolean,timestamptz,text),public.cassa_badge_esci(uuid) to anon,authenticated;
notify pgrst,'reload schema';
