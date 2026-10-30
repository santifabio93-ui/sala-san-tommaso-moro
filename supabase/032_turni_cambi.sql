-- Sala San Tommaso Moro — aggiornamento 32: scambio di turno tra volontari.
-- Chi non può più chiede il cambio dal suo link: il turno resta suo finché un altro volontario tocca «Lo prendo io»;
-- allora il turno passa da solo all'altro. Le richieste aperte si vedono nei link dei volontari e nell'app.
-- Serve l'aggiornamento 14 (link dei volontari). Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run.
-- Si può rieseguire senza problemi.

create table if not exists public.turni_cambi (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  slot_id text not null,
  da_volontario uuid not null references public.volontari(id) on delete cascade,
  da_nome text not null,
  stato text not null default 'aperta' check (stato in ('aperta', 'presa', 'annullata')),
  preso_da uuid references public.volontari(id) on delete set null,
  preso_nome text not null default '',
  creato timestamptz not null default now(),
  chiuso_il timestamptz
);
create unique index if not exists turni_cambi_una_aperta on public.turni_cambi (booking_id, slot_id, da_volontario) where stato = 'aperta';
alter table public.turni_cambi enable row level security;
drop policy if exists "cambi: staff legge" on public.turni_cambi;
create policy "cambi: staff legge" on public.turni_cambi
  for select using (public.my_role() in ('admin', 'coordinatore'));
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'turni_cambi') then
    alter publication supabase_realtime add table public.turni_cambi;
  end if;
end $$;

-- le richieste ancora valide (evento futuro, chi chiede è ancora in quel turno)
create or replace function public.turni_cambi_aperti(p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v public.volontari;
begin
  select * into v from public.volontari where token = p_token and attivo;
  if not found then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'booking_id', c.booking_id, 'slot_id', c.slot_id, 'da_nome', c.da_nome,
        'mia', c.da_volontario = v.id, 'data', b.data, 'titolo', b.titolo, 'fascia', t->>'label', 'inizio', t->>'inizio', 'fine', t->>'fine',
        'gia_dentro', exists (select 1 from public.signups s where s.booking_id = c.booking_id and s.slot_id = c.slot_id and s.volontario_id = v.id))
      order by b.data, t->>'inizio')
    from public.turni_cambi c
    join public.bookings b on b.id = c.booking_id and b.stato = 'confermata' and b.data >= current_date
    cross join lateral (select x as t from jsonb_array_elements(b.turni) x where x->>'id' = c.slot_id) tt
    where c.stato = 'aperta'
      and exists (select 1 from public.signups s where s.booking_id = c.booking_id and s.slot_id = c.slot_id and s.volontario_id = c.da_volontario)
  ), '[]'::jsonb);
end $$;

-- chiedere il cambio di un proprio turno
create or replace function public.turni_cambio_chiedi(p_token uuid, p_booking uuid, p_slot text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.volontari;
begin
  select * into v from public.volontari where token = p_token and attivo;
  if not found then raise exception 'Link non valido: chiedi un link nuovo a chi organizza i turni'; end if;
  if not exists (select 1 from public.signups s join public.bookings b on b.id = s.booking_id
                 where s.booking_id = p_booking and s.slot_id = p_slot and s.volontario_id = v.id and b.data >= current_date) then
    raise exception 'Puoi chiedere il cambio solo per un tuo turno che deve ancora arrivare';
  end if;
  insert into public.turni_cambi (booking_id, slot_id, da_volontario, da_nome) values (p_booking, p_slot, v.id, v.nome)
    on conflict (booking_id, slot_id, da_volontario) where stato = 'aperta' do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- ritirare la propria richiesta (alla fine ci si va)
create or replace function public.turni_cambio_annulla(p_token uuid, p_cambio uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.volontari;
begin
  select * into v from public.volontari where token = p_token and attivo;
  if not found then raise exception 'Link non valido'; end if;
  update public.turni_cambi set stato = 'annullata', chiuso_il = now() where id = p_cambio and da_volontario = v.id and stato = 'aperta';
  return jsonb_build_object('ok', true);
end $$;

-- «Lo prendo io»: il turno passa da chi l'ha chiesto a chi lo prende, tutto insieme
create or replace function public.turni_cambio_prendi(p_token uuid, p_cambio uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.volontari;
  c public.turni_cambi;
begin
  select * into v from public.volontari where token = p_token and attivo;
  if not found then raise exception 'Link non valido: chiedi un link nuovo a chi organizza i turni'; end if;
  select * into c from public.turni_cambi where id = p_cambio for update;
  if not found or c.stato <> 'aperta' then raise exception 'Qualcuno l''ha già preso: grazie lo stesso!'; end if;
  if c.da_volontario = v.id then raise exception 'È la tua richiesta: per annullarla tocca «Ci vado io»'; end if;
  if not exists (select 1 from public.bookings where id = c.booking_id and stato = 'confermata' and data >= current_date) then
    raise exception 'Questo evento non è più disponibile';
  end if;
  if exists (select 1 from public.signups where booking_id = c.booking_id and slot_id = c.slot_id and volontario_id = v.id) then
    raise exception 'Sei già in questo turno';
  end if;
  delete from public.signups where booking_id = c.booking_id and slot_id = c.slot_id and volontario_id = c.da_volontario;
  insert into public.signups (booking_id, slot_id, nome, volontario_id) values (c.booking_id, c.slot_id, v.nome, v.id);
  update public.turni_cambi set stato = 'presa', preso_da = v.id, preso_nome = v.nome, chiuso_il = now() where id = c.id;
  return jsonb_build_object('ok', true, 'da', c.da_nome);
end $$;

revoke all on function public.turni_cambi_aperti(uuid) from public;
revoke all on function public.turni_cambio_chiedi(uuid, uuid, text) from public;
revoke all on function public.turni_cambio_annulla(uuid, uuid) from public;
revoke all on function public.turni_cambio_prendi(uuid, uuid) from public;
grant execute on function public.turni_cambi_aperti(uuid) to anon, authenticated;
grant execute on function public.turni_cambio_chiedi(uuid, uuid, text) to anon, authenticated;
grant execute on function public.turni_cambio_annulla(uuid, uuid) to anon, authenticated;
grant execute on function public.turni_cambio_prendi(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

select to_regclass('public.turni_cambi') is not null as scambio_turni;
