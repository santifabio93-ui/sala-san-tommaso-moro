-- Sala San Tommaso Moro — aggiornamento 8: schede dei donatori (contatti, ringraziamenti, ricevute).
-- Le donazioni arrivano dalla prima nota (categoria E03); qui si salvano solo le informazioni aggiunte nell'app.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

create table if not exists public.donatori (
  chiave text primary key,                 -- nome normalizzato, come nella prima nota
  nome text not null default '',
  tipo text check (tipo in ('azienda', 'associazione', 'privato', 'ente')),
  email text not null default '',
  telefono text not null default '',
  indirizzo text not null default '',
  note text not null default '',
  ringraziati jsonb not null default '{}'::jsonb,   -- { "2026": "2026-10-30" }
  ricevute jsonb not null default '{}'::jsonb,      -- { "2026": "2026-10-30" }
  aggiornato timestamptz not null default now()
);

alter table public.donatori enable row level security;
drop policy if exists "donatori: admin" on public.donatori;
create policy "donatori: admin" on public.donatori
  for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'donatori') then
    alter publication supabase_realtime add table public.donatori;
  end if;
end $$;

notify pgrst, 'reload schema';

select to_regclass('public.donatori') is not null as tabella_donatori;
