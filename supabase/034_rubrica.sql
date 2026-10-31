-- Sala San Tommaso Moro — aggiornamento 34: rubrica della sala.
-- La rubrica raccoglie da sola i contatti di chi ha avuto a che fare con la sala (prenotazioni, schede di richiesta,
-- email, sopralluoghi, volontari). In questa tabella si salvano i contatti aggiunti a mano (fornitori, tecnici, enti…)
-- e le correzioni a quelli trovati dall'app: categoria, ente, note, oppure «nascondi».
-- La vedono amministratori, coordinatori e segreteria.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

create table if not exists public.rubrica (
  chiave text primary key,                      -- 'tel:…', 'mail:…', 'nome:…' per i contatti trovati, 'man:…' per quelli a mano
  nome text not null default '',
  ente text not null default '',
  categoria text not null default '',
  telefono text not null default '',
  email text not null default '',
  note text not null default '',
  nascosto boolean not null default false,
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now()
);
alter table public.rubrica enable row level security;
drop policy if exists "rubrica: staff e segreteria" on public.rubrica;
create policy "rubrica: staff e segreteria" on public.rubrica
  for all using (public.my_role() in ('admin', 'coordinatore', 'segreteria'))
  with check (public.my_role() in ('admin', 'coordinatore', 'segreteria'));
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'rubrica') then
    alter publication supabase_realtime add table public.rubrica;
  end if;
exception when undefined_object then null;
end $$;

notify pgrst, 'reload schema';

select to_regclass('public.rubrica') is not null as rubrica;
