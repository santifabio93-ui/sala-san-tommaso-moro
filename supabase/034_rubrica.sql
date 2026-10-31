-- Sala San Tommaso Moro — aggiornamento 34: rubrica della sala.
-- La rubrica raccoglie da sola i contatti di chi ha avuto a che fare con la sala (prenotazioni, schede di richiesta,
-- email, sopralluoghi, volontari). In questa tabella si salvano i contatti aggiunti a mano (fornitori, tecnici, enti…)
-- e le correzioni a quelli trovati dall'app: categoria, ente, note, oppure «nascondi».
-- La vedono amministratori, coordinatori e segreteria.
-- Con «+rubrica» nella MODALITA dello script Google (account della sala) entrano anche le persone con cui la sala
-- ha scambiato email: nome, indirizzo, e dalla firma telefono, ente, ruolo e sito; le ultime conversazioni.
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

-- i contatti della posta della sala (li manda lo script Google)
create table if not exists public.rubrica_mail (
  email text primary key,
  nome text not null default '',
  telefono text not null default '',
  oggetto text not null default '',
  link text not null default '',
  primo timestamptz,
  ultimo timestamptz,
  aggiornato timestamptz not null default now()
);
alter table public.rubrica_mail add column if not exists ente text not null default '';
alter table public.rubrica_mail add column if not exists ruolo text not null default '';
alter table public.rubrica_mail add column if not exists sito text not null default '';
alter table public.rubrica_mail add column if not exists conversazioni jsonb not null default '[]'::jsonb;  -- [{data, oggetto, link}], le ultime 12
alter table public.rubrica_mail enable row level security;
drop policy if exists "rubrica mail: staff e segreteria leggono" on public.rubrica_mail;
create policy "rubrica mail: staff e segreteria leggono" on public.rubrica_mail
  for select using (public.my_role() in ('admin', 'coordinatore', 'segreteria'));
drop policy if exists "rubrica mail: admin elimina" on public.rubrica_mail;
create policy "rubrica mail: admin elimina" on public.rubrica_mail
  for delete using (public.my_role() = 'admin');
alter table public.settings add column if not exists sync_rubrica timestamptz;

create or replace function public.sync_rubrica_push(p_token text, p_items jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  perform public.sync_check(p_token);
  insert into public.rubrica_mail as r (email, nome, telefono, oggetto, link, primo, ultimo, ente, ruolo, sito, conversazioni)
  select distinct on (lower(btrim(x->>'email')))
         lower(btrim(x->>'email')), left(coalesce(x->>'nome', ''), 120), left(coalesce(x->>'telefono', ''), 40),
         left(coalesce(x->>'oggetto', ''), 200), left(coalesce(x->>'link', ''), 300), (x->>'primo')::timestamptz, (x->>'ultimo')::timestamptz,
         left(coalesce(x->>'ente', ''), 120), left(coalesce(x->>'ruolo', ''), 120), left(coalesce(x->>'sito', ''), 200),
         case when jsonb_typeof(x->'conversazioni') = 'array' then x->'conversazioni' else '[]'::jsonb end
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  where coalesce(x->>'email', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  order by lower(btrim(x->>'email')), (x->>'ultimo') desc
  on conflict (email) do update set
    nome = case when excluded.nome <> '' and (r.nome = '' or excluded.ultimo >= r.ultimo) then excluded.nome else r.nome end,
    telefono = case when excluded.telefono <> '' then excluded.telefono else r.telefono end,
    oggetto = case when excluded.ultimo >= coalesce(r.ultimo, excluded.ultimo) then excluded.oggetto else r.oggetto end,
    link = case when excluded.ultimo >= coalesce(r.ultimo, excluded.ultimo) then excluded.link else r.link end,
    primo = least(r.primo, excluded.primo),
    ultimo = greatest(r.ultimo, excluded.ultimo),
    ente = case when excluded.ente <> '' then excluded.ente else r.ente end,
    ruolo = case when excluded.ruolo <> '' then excluded.ruolo else r.ruolo end,
    sito = case when excluded.sito <> '' then excluded.sito else r.sito end,
    -- le conversazioni: unione senza doppioni (per link), le 12 più recenti
    conversazioni = (select coalesce(jsonb_agg(c order by c->>'data' desc), '[]'::jsonb) from (
        select c from (select distinct on (c->>'link') c from jsonb_array_elements(r.conversazioni || excluded.conversazioni) c
                       order by c->>'link', c->>'data' desc) d
        order by c->>'data' desc limit 12) z),
    aggiornato = now();
  get diagnostics n = row_count;
  update public.settings set sync_rubrica = now() where id = 1;
  return n;
end $$;
revoke all on function public.sync_rubrica_push(text, jsonb) from public;
grant execute on function public.sync_rubrica_push(text, jsonb) to anon;

notify pgrst, 'reload schema';

select to_regclass('public.rubrica') is not null and to_regclass('public.rubrica_mail') is not null as rubrica;
