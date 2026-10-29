-- Sala San Tommaso Moro — aggiornamento 4: Sopralluoghi.
-- Da eseguire una sola volta in Supabase: SQL Editor → New query → incolla tutto → Run.

create table public.sopralluoghi (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  ora time not null,
  durata_min int not null default 30 check (durata_min between 5 and 480),
  nome text not null check (length(trim(nome)) > 0),
  ente text not null default '',
  telefono text not null default '',
  email text not null default '',
  evento text not null default '',
  data_evento date,
  accompagnatore_id uuid references auth.users(id) on delete set null,
  esigenze text[] not null default '{}',
  stato text not null default 'da_fare' check (stato in ('da_fare', 'fatto', 'annullato')),
  esito text not null default '',
  richiesta_id uuid references public.richieste(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now()
);
create index sopralluoghi_data on public.sopralluoghi (data, ora);

alter table public.sopralluoghi enable row level security;
-- lo staff gestisce tutto; chi accompagna vede e aggiorna i propri sopralluoghi
create policy "sopralluoghi: staff" on public.sopralluoghi
  for all using (public.my_role() in ('admin', 'coordinatore'))
  with check (public.my_role() in ('admin', 'coordinatore'));
create policy "sopralluoghi: chi accompagna legge" on public.sopralluoghi
  for select using (accompagnatore_id = auth.uid() and public.my_role() = 'volontario');
create policy "sopralluoghi: chi accompagna aggiorna" on public.sopralluoghi
  for update using (accompagnatore_id = auth.uid() and public.my_role() = 'volontario')
  with check (accompagnatore_id = auth.uid());

alter publication supabase_realtime add table public.sopralluoghi;
