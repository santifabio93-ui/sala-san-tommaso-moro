-- Sala San Tommaso Moro — aggiornamento 14: i volontari si segnano ai turni dal loro link personale.
-- Ogni volontario ha un link con un codice segreto: senza account vede le fasce dei prossimi 30 giorni e quante
-- persone servono ancora, con i nomi di chi è già segnato, e si segna o si toglie. I nomi arrivano nei turni dell'app.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

create table if not exists public.volontari (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 1 and 60),
  cellulare text not null default '',
  token uuid not null unique default gen_random_uuid(),   -- il codice del link personale
  attivo boolean not null default true,
  creato timestamptz not null default now()
);
alter table public.volontari enable row level security;
drop policy if exists "volontari: staff" on public.volontari;
create policy "volontari: staff" on public.volontari
  for all using (public.my_role() in ('admin', 'coordinatore'))
  with check (public.my_role() in ('admin', 'coordinatore'));

alter table public.signups add column if not exists volontario_id uuid references public.volontari(id) on delete cascade;
create unique index if not exists signups_volontario_una_volta on public.signups (booking_id, slot_id, volontario_id) where volontario_id is not null;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'volontari') then
    alter publication supabase_realtime add table public.volontari;
  end if;
end $$;

-- il volontario apre il suo link: il suo nome e le fasce dei prossimi 30 giorni, con chi c'è già e i posti liberi
create or replace function public.turni_apri(p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v public.volontari;
begin
  select * into v from public.volontari where token = p_token and attivo;
  if not found then return null; end if;
  return jsonb_build_object('nome', v.nome, 'fasce', coalesce((
    select jsonb_agg(jsonb_build_object(
        'booking_id', b.id, 'slot_id', t->>'id', 'data', b.data, 'titolo', b.titolo,
        'inizio_evento', to_char(b.inizio, 'HH24:MI'), 'giornata_intera', coalesce(b.giornata_intera, false),
        'fascia', t->>'label', 'inizio', t->>'inizio', 'fine', t->>'fine',
        'posti', coalesce((t->>'posti')::int, 1),
        'presi', (select count(*) from public.signups s where s.booking_id = b.id and s.slot_id = t->>'id'),
        'nomi', coalesce((select jsonb_agg(s.nome order by s.creato) from public.signups s where s.booking_id = b.id and s.slot_id = t->>'id'), '[]'::jsonb),
        'mio', exists (select 1 from public.signups s where s.booking_id = b.id and s.slot_id = t->>'id' and s.volontario_id = v.id))
      order by b.data, t->>'inizio')
    from public.bookings b, jsonb_array_elements(b.turni) t
    where b.stato = 'confermata' and b.data between current_date and current_date + 30
  ), '[]'::jsonb));
end $$;

-- si segna (p_si = true) o si toglie da una fascia
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
    if presi >= coalesce((t->>'posti')::int, 1) then raise exception 'Questa fascia è già al completo, grazie lo stesso!'; end if;
    insert into public.signups (booking_id, slot_id, nome, volontario_id) values (b.id, p_slot, v.nome, v.id);
  else
    delete from public.signups where booking_id = b.id and slot_id = p_slot and volontario_id = v.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.turni_apri(uuid) from public;
revoke all on function public.turni_segna(uuid, uuid, text, boolean) from public;
grant execute on function public.turni_apri(uuid) to anon, authenticated;
grant execute on function public.turni_segna(uuid, uuid, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';

select to_regclass('public.volontari') is not null as elenco_volontari,
  exists (select 1 from pg_proc where proname = 'turni_segna') as funzioni_turni;
