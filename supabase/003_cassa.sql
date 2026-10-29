-- Sala San Tommaso Moro — aggiornamento 3: Cassa (biglietti, fondo cassa, chiusure).
-- Da eseguire una sola volta in Supabase: SQL Editor → New query → incolla tutto → Run.

-- chi può fare cassa: amministratori, coordinatori e i volontari abilitati in «Persone»
alter table public.profiles add column cassa boolean not null default false;

create or replace function public.can_cassa() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (ruolo in ('admin', 'coordinatore') or (ruolo = 'volontario' and cassa))
  )
$$;

-- prezzo proposto per i biglietti (modificabili in Economia → Tariffe)
alter table public.settings
  add column prezzo_biglietto numeric(10, 2);

create table public.cassa (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  booking_id uuid references public.bookings(id) on delete set null,
  titolo text not null default '',
  fondo_iniziale numeric(10, 2) not null default 0 check (fondo_iniziale >= 0),
  online_n int not null default 0 check (online_n >= 0),
  online_euro numeric(10, 2) not null default 0 check (online_euro >= 0),
  contanti_n int not null default 0 check (contanti_n >= 0),
  contanti_euro numeric(10, 2) not null default 0 check (contanti_euro >= 0),
  pos_n int not null default 0 check (pos_n >= 0),
  pos_euro numeric(10, 2) not null default 0 check (pos_euro >= 0),
  omaggi_n int not null default 0 check (omaggi_n >= 0),
  contati numeric(10, 2) check (contati >= 0),
  conteggio jsonb not null default '{}'::jsonb,
  prelievo numeric(10, 2) not null default 0 check (prelievo >= 0),
  fondo_finale numeric(10, 2) not null default 0,
  note text not null default '',
  stato text not null default 'aperta' check (stato in ('aperta', 'chiusa')),
  creato_da uuid references auth.users(id) on delete set null,
  chiuso_da uuid references auth.users(id) on delete set null,
  chiuso_il timestamptz,
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now()
);
create index cassa_data on public.cassa (data desc, creato desc);

alter table public.cassa enable row level security;
create policy "cassa: chi fa cassa legge" on public.cassa
  for select using (public.can_cassa());
create policy "cassa: chi fa cassa inserisce" on public.cassa
  for insert with check (public.can_cassa());
-- una cassa chiusa la modifica solo l'amministratore
create policy "cassa: chi fa cassa modifica le aperte" on public.cassa
  for update using (public.can_cassa() and (stato = 'aperta' or public.my_role() = 'admin'))
  with check (public.can_cassa());
create policy "cassa: solo admin elimina" on public.cassa
  for delete using (public.my_role() = 'admin');

alter publication supabase_realtime add table public.cassa;

-- chi fa cassa legge i prezzi proposti dei biglietti
create policy "tariffe: chi fa cassa legge" on public.settings
  for select using (public.can_cassa());
