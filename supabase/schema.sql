-- Sala San Tommaso Moro — schema del database
-- Da eseguire una sola volta in Supabase: SQL Editor → New query → incolla tutto → Run.
--
-- Ruoli:
--   admin         gestisce tutto: prenotazioni, economia, tariffe, turni, utenti
--   coordinatore  gestisce prenotazioni e turni, non vede spese e tariffe
--   volontario    vede calendario e turni (senza prezzi né contatti) e si segna ai turni
--   in_attesa     ha fatto l'accesso con Google ma non è ancora stato approvato
--   bloccato      non vede nulla
-- La prima persona che accede diventa automaticamente admin.

create extension if not exists pgcrypto;

-- ---------- profili ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nome text not null default '',
  avatar text,
  ruolo text not null default 'in_attesa'
    check (ruolo in ('admin', 'coordinatore', 'volontario', 'in_attesa', 'bloccato')),
  creato timestamptz not null default now()
);

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select ruolo from public.profiles where id = auth.uid()
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nome, avatar, ruolo)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    case when exists (select 1 from public.profiles where ruolo = 'admin') then 'in_attesa' else 'admin' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- impedisce di restare senza amministratori
create or replace function public.keep_one_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.ruolo = 'admin' and new.ruolo <> 'admin'
     and not exists (select 1 from public.profiles where ruolo = 'admin' and id <> old.id) then
    raise exception 'Serve almeno un amministratore';
  end if;
  return new;
end $$;

create trigger keep_one_admin
  before update on public.profiles
  for each row execute function public.keep_one_admin();

-- ---------- prenotazioni ----------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  titolo text not null check (length(trim(titolo)) > 0),
  referente text not null default '',
  tipo text not null default '',
  telefono text not null default '',
  email text not null default '',
  data date not null,
  inizio time not null,
  fine time not null,
  prezzo numeric(10, 2) not null default 0 check (prezzo >= 0),
  incassato numeric(10, 2) not null default 0 check (incassato >= 0),
  stato text not null default 'opzione' check (stato in ('opzione', 'confermata', 'annullata')),
  note text not null default '',
  turni jsonb not null default '[]'::jsonb,
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now(),
  check (fine > inizio)
);
create index bookings_data on public.bookings (data);

-- vista per i volontari: eventi e turni, senza prezzi, incassi e contatti
create view public.eventi as
  select id, titolo, tipo, data, inizio, fine, stato, turni
  from public.bookings
  where public.my_role() in ('admin', 'coordinatore', 'volontario');

-- ---------- spese ----------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  categoria text not null default 'Altro',
  descrizione text not null default '',
  importo numeric(10, 2) not null check (importo > 0),
  creato timestamptz not null default now()
);

-- ---------- tariffe ----------
create table public.settings (
  id int primary key default 1 check (id = 1),
  tariffa_ora numeric(10, 2) not null default 25,
  tariffa_mezza numeric(10, 2) not null default 80,
  tariffa_giorno numeric(10, 2) not null default 150
);
insert into public.settings (id) values (1);

-- ---------- iscrizioni ai turni ----------
create table public.signups (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  slot_id text not null,
  nome text not null check (length(trim(nome)) between 1 and 60),
  user_id uuid references auth.users(id) on delete set null,
  creato timestamptz not null default now()
);
create unique index signups_una_volta on public.signups (booking_id, slot_id, user_id) where user_id is not null;

-- ---------- permessi (Row Level Security) ----------
alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.expenses enable row level security;
alter table public.settings enable row level security;
alter table public.signups enable row level security;

create policy "profili: ognuno legge il proprio, lo staff tutti" on public.profiles
  for select using (id = auth.uid() or public.my_role() in ('admin', 'coordinatore'));
create policy "profili: solo admin cambia ruoli" on public.profiles
  for update using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy "prenotazioni: staff" on public.bookings
  for all using (public.my_role() in ('admin', 'coordinatore'))
  with check (public.my_role() in ('admin', 'coordinatore'));

create policy "spese: admin" on public.expenses
  for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy "tariffe: staff legge" on public.settings
  for select using (public.my_role() in ('admin', 'coordinatore'));
create policy "tariffe: admin modifica" on public.settings
  for update using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy "turni: chi è approvato legge" on public.signups
  for select using (public.my_role() in ('admin', 'coordinatore', 'volontario'));
create policy "turni: staff iscrive chiunque, volontario sé stesso" on public.signups
  for insert with check (
    public.my_role() in ('admin', 'coordinatore')
    or (public.my_role() = 'volontario' and user_id = auth.uid())
  );
create policy "turni: staff toglie chiunque, volontario sé stesso" on public.signups
  for delete using (
    public.my_role() in ('admin', 'coordinatore')
    or (public.my_role() = 'volontario' and user_id = auth.uid())
  );

revoke all on public.eventi from anon;
grant select on public.eventi to authenticated;

-- ---------- aggiornamenti in tempo reale ----------
alter publication supabase_realtime add table public.bookings, public.signups, public.expenses;
