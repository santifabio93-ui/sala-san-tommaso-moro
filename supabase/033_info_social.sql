-- Sala San Tommaso Moro — aggiornamento 33: le informazioni di ogni evento per chi cura i social.
-- Un link solo per loro (senza account): film, spettacoli ed eventi della Sala dei prossimi due mesi con date, orari,
-- ingresso, regista, collaborazioni, distributore, descrizione, note, biglietti, locandina e cartella dei materiali.
-- Quello che l'app sa lo riempie da sola; il resto si completa nell'app (Sito web → Info per i social).
-- Dal link possono fare domande su un evento: si risponde dall'app e la risposta compare nel loro link.
-- Le locandine caricate nell'app (anche per leggerne le informazioni) vanno nello spazio file pubblico «locandine».
-- Gli affitti privati non compaiono. Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run.
-- Si può rieseguire senza problemi.

alter table public.settings add column if not exists social_token uuid not null default gen_random_uuid();

-- le informazioni scritte a mano per un evento: 'f:<film>' oppure 'b:<prenotazione>'
create table if not exists public.eventi_info (
  chiave text primary key,
  regista text not null default '',
  collaborazioni text not null default '',
  ingresso text not null default '',          -- es. «ingresso libero», «7 €, ridotto 5 €»: se vuoto vale il prezzo di Cinebot
  descrizione text not null default '',
  note text not null default '',               -- note per i social (hashtag, ospiti, cose da dire)
  materiali text not null default '',          -- link alla cartella Drive con locandina, trailer, foto
  aggiornato timestamptz not null default now()
);
alter table public.eventi_info enable row level security;
drop policy if exists "info eventi: staff" on public.eventi_info;
create policy "info eventi: staff" on public.eventi_info
  for all using (public.my_role() in ('admin', 'coordinatore')) with check (public.my_role() in ('admin', 'coordinatore'));
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'eventi_info') then
    alter publication supabase_realtime add table public.eventi_info;
  end if;
exception when undefined_object then null;
end $$;

-- le domande di chi cura i social, con la risposta data dall'app
create table if not exists public.social_domande (
  id uuid primary key default gen_random_uuid(),
  chiave text not null,
  titolo text not null default '',
  testo text not null,
  chi text not null default '',
  creato timestamptz not null default now(),
  risposta text not null default '',
  risposto_il timestamptz
);
alter table public.social_domande enable row level security;
drop policy if exists "domande social: staff" on public.social_domande;
create policy "domande social: staff" on public.social_domande
  for all using (public.my_role() in ('admin', 'coordinatore')) with check (public.my_role() in ('admin', 'coordinatore'));
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'social_domande') then
    alter publication supabase_realtime add table public.social_domande;
  end if;
exception when undefined_object then null;
end $$;

-- la locandina caricata nell'app (vale più di quella di Cinebot)
alter table public.eventi_info add column if not exists locandina text not null default '';

-- spazio file pubblico per le locandine (si vedono dal link dei social), massimo 10 MB, solo immagini
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('locandine', 'locandine', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "locandine: staff carica" on storage.objects;
create policy "locandine: staff carica" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'locandine' and public.my_role() in ('admin', 'coordinatore', 'segreteria'));
drop policy if exists "locandine: staff elimina" on storage.objects;
create policy "locandine: staff elimina" on storage.objects
  for delete to authenticated
  using (bucket_id = 'locandine' and public.my_role() in ('admin', 'coordinatore', 'segreteria'));

-- regista e distributore già noti all'app (richieste e conferme del SAS), se ci sono
create or replace function public.info_da_sas(p_titolo text, p_campo text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  r text;
begin
  if p_campo = 'regista' then
    select coalesce(
      (select nullif(regista, '') from public.richieste_film where lower(titolo) = lower(p_titolo) and regista <> '' order by creato desc limit 1),
      (select nullif(regista, '') from public.catalogo_film where lower(titolo) = lower(p_titolo) and regista <> '' order by creato desc limit 1)) into r;
  else
    select coalesce(
      (select nullif(distributore, '') from public.programmazione where lower(titolo) = lower(p_titolo) and distributore <> '' order by data desc limit 1),
      (select nullif(distributore, '') from public.richieste_film where lower(titolo) = lower(p_titolo) and distributore <> '' order by creato desc limit 1)) into r;
  end if;
  return coalesce(r, '');
exception when undefined_table or undefined_column then return '';
end $$;
revoke all on function public.info_da_sas(text, text) from public, anon, authenticated;

create or replace function public.social_apri(p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  dal date := current_date;
  al date := current_date + 60;
begin
  if not exists (select 1 from public.settings where id = 1 and social_token = p_token) then return null; end if;
  return jsonb_build_object('aggiornato', now(), 'eventi', coalesce((select jsonb_agg(e order by e->>'prima') from (
    -- film e spettacoli (da Cinebot o inseriti nell'app): uno per titolo, con tutti gli orari
    select jsonb_build_object(
        'chiave', 'f:' || f.id, 'titolo', f.titolo,
        'tipo', case coalesce(to_jsonb(f)->>'tipo', '') when 'teatro' then 'Teatro' when 'danza' then 'Danza' when 'musica' then 'Musica'
                  when 'incontro' then 'Incontro' when 'altro' then 'Spettacolo' else 'Cinema' end,
        'orari', (select jsonb_agg(jsonb_build_object('data', p.data, 'ora', to_char(p.ora, 'HH24:MI')) order by p.data, p.ora)
                  from public.proiezioni p where p.film_id = f.id and p.data between dal and al),
        'prima', (select min(p.data) from public.proiezioni p where p.film_id = f.id and p.data between dal and al),
        'prezzo', to_jsonb(f)->'cinebot_info'->'prezzo',
        'locandina', coalesce(nullif(i.locandina, ''), f.locandina_url), 'biglietti', f.cinebot_url,
        'regista', coalesce(nullif(i.regista, ''), public.info_da_sas(f.titolo, 'regista')),
        'distributore', coalesce(nullif(f.distributore, ''), public.info_da_sas(f.titolo, 'distributore')),
        'collaborazioni', coalesce(i.collaborazioni, ''), 'ingresso', coalesce(i.ingresso, ''), 'descrizione', coalesce(i.descrizione, ''),
        'note', coalesce(i.note, ''), 'materiali', coalesce(i.materiali, '')) as e
      from public.films f left join public.eventi_info i on i.chiave = 'f:' || f.id
      where exists (select 1 from public.proiezioni p where p.film_id = f.id and p.data between dal and al)
    union all
    -- eventi organizzati dalla Sala e serate del Comune (mai gli affitti privati)
    select jsonb_build_object(
        'chiave', 'b:' || b.id, 'titolo', b.titolo, 'tipo', case when b.comune then 'Con il Comune' else 'Evento della Sala' end,
        'orari', jsonb_build_array(jsonb_build_object('data', b.data, 'ora', case when coalesce(b.giornata_intera, false) then '' else to_char(b.inizio, 'HH24:MI') end)),
        'prima', b.data, 'prezzo', null, 'locandina', coalesce(i.locandina, ''), 'biglietti', '',
        'regista', coalesce(i.regista, ''), 'distributore', '',
        'collaborazioni', coalesce(i.collaborazioni, ''), 'ingresso', coalesce(i.ingresso, ''), 'descrizione', coalesce(i.descrizione, ''),
        'note', coalesce(i.note, ''), 'materiali', coalesce(i.materiali, '')) as e
      from public.bookings b left join public.eventi_info i on i.chiave = 'b:' || b.id
      where b.data between dal and al and b.stato = 'confermata'
        and (b.comune or coalesce((to_jsonb(b)->>'della_sala')::boolean, false))
        and not (b.titolo ~* '(cinema|proiezion|cineforum)' and exists (select 1 from public.proiezioni p where p.data = b.data))
  ) x), '[]'::jsonb),
    'domande', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'chiave', d.chiave, 'titolo', d.titolo, 'testo', d.testo, 'chi', d.chi,
        'creato', d.creato, 'risposta', d.risposta, 'risposto_il', d.risposto_il) order by d.creato desc)
      from public.social_domande d where d.creato > now() - interval '60 days'), '[]'::jsonb));
end $$;
revoke all on function public.social_apri(uuid) from public;
grant execute on function public.social_apri(uuid) to anon, authenticated;

-- una domanda a chi organizza
create or replace function public.social_chiedi(p_token uuid, p_chiave text, p_titolo text, p_testo text, p_nome text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.settings where id = 1 and social_token = p_token) then raise exception 'Link non valido: chiedi quello nuovo'; end if;
  if coalesce(btrim(p_testo), '') = '' then raise exception 'Scrivi la domanda'; end if;
  if (select count(*) from public.social_domande where creato > now() - interval '1 hour') >= 30 then raise exception 'Troppe domande in poco tempo: riprova più tardi'; end if;
  insert into public.social_domande (chiave, titolo, testo, chi)
    values (left(coalesce(p_chiave, ''), 40), left(coalesce(p_titolo, ''), 200), left(btrim(p_testo), 1000), left(btrim(coalesce(p_nome, '')), 40));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.social_chiedi(uuid, text, text, text, text) from public;
grant execute on function public.social_chiedi(uuid, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select exists (select 1 from pg_proc where proname = 'social_chiedi') and to_regclass('public.social_domande') is not null as info_per_i_social;
