-- Sala San Tommaso Moro — aggiornamento 24: link per il gruppo pulizie.
-- Un link solo per tutto il gruppo (senza account): mostra cosa è successo in sala dall'ultima pulizia — quando,
-- per quanto, in quali spazi, per cosa e con quante persone — e permette di segnare «pulizie fatte» con una nota.
-- Il giorno delle pulizie (di solito il martedì) si cambia dall'app; il link si può rinnovare se gira troppo.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

alter table public.settings add column if not exists pulizie_token uuid not null default gen_random_uuid();
alter table public.settings add column if not exists pulizie_giorno int not null default 2;  -- 0 domenica … 2 martedì … 6 sabato
alter table public.settings drop constraint if exists settings_pulizie_giorno_check;
alter table public.settings add constraint settings_pulizie_giorno_check check (pulizie_giorno between 0 and 6);

create table if not exists public.pulizie_fatte (
  id uuid primary key default gen_random_uuid(),
  giorno date not null,                      -- il giorno delle pulizie a cui si riferisce
  nome text not null check (length(trim(nome)) between 1 and 60),
  note text not null default '' check (length(note) <= 1000),
  creato timestamptz not null default now()
);
alter table public.pulizie_fatte enable row level security;
drop policy if exists "pulizie: staff" on public.pulizie_fatte;
create policy "pulizie: staff" on public.pulizie_fatte
  for all using (public.my_role() in ('admin', 'coordinatore'))
  with check (public.my_role() in ('admin', 'coordinatore'));
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pulizie_fatte') then
    alter publication supabase_realtime add table public.pulizie_fatte;
  end if;
end $$;

-- il giorno delle pulizie della settimana richiesta: oggi se è il giorno giusto, altrimenti il prossimo (p_settimane indietro)
create or replace function public.pulizie_giorno_di(p_settimane int)
returns date
language sql stable security definer set search_path = public as $$
  select current_date + ((s.pulizie_giorno - extract(dow from current_date)::int + 7) % 7) - 7 * greatest(0, least(coalesce(p_settimane, 0), 52))
  from public.settings s where s.id = 1
$$;

-- cosa è successo in sala nei sette giorni prima delle pulizie
create or replace function public.pulizie_apri(p_token uuid, p_settimane int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  g date;
begin
  if not exists (select 1 from public.settings where id = 1 and pulizie_token = p_token) then return null; end if;
  g := public.pulizie_giorno_di(p_settimane);
  return jsonb_build_object(
    'giorno', g, 'dal', g - 7, 'al', g - 1, 'oggi', current_date,
    'eventi', coalesce((
      select jsonb_agg(jsonb_build_object(
          'data', b.data, 'inizio', to_char(b.inizio, 'HH24:MI'), 'fine', to_char(b.fine, 'HH24:MI'),
          'giornata', coalesce(b.giornata_intera, false), 'titolo', b.titolo, 'tipo', b.tipo,
          'spazio', coalesce(nullif(b.tariffa->>'spazio', ''), sk.dati->>'fascia'),
          'pubblico', b.tariffa->>'pubblico', 'tappeto', coalesce((b.tariffa->>'tappeto')::boolean, false),
          'persone', coalesce(
            (select sum(c.online_n + c.contanti_n + c.pos_n + c.omaggi_n) from public.cassa c where c.booking_id = b.id),
            nullif(regexp_replace(coalesce(sk.dati->>'pubblico_n', ''), '\D', '', 'g'), '')::int),
          'bambini', nullif(regexp_replace(coalesce(sk.dati->>'bambini_n', ''), '\D', '', 'g'), '')::int,
          'palco', nullif(regexp_replace(coalesce(sk.dati->>'palco_n', ''), '\D', '', 'g'), '')::int)
        order by b.data, b.inizio)
      from public.bookings b
      left join lateral (
        select x.dati from public.schede x where x.booking_id = b.id and x.dati <> '{}'::jsonb
        order by x.compilata_il desc nulls last limit 1) sk on true
      where b.data between g - 7 and g - 1 and b.stato = 'confermata'
    ), '[]'::jsonb),
    'proiezioni', coalesce((
      select jsonb_agg(jsonb_build_object(
          'data', p.data, 'ora', to_char(p.ora, 'HH24:MI'), 'titolo', f.titolo, 'tipo', f.tipo, 'info', f.cinebot_info,
          'persone', (select sum(c.spettatori) from public.c1 c where c.data = p.data and c.ora = p.ora))
        order by p.data, p.ora)
      from public.proiezioni p join public.films f on f.id = p.film_id
      where p.data between g - 7 and g - 1
    ), '[]'::jsonb),
    'fatte', coalesce((
      select jsonb_agg(jsonb_build_object('nome', x.nome, 'note', x.note, 'creato', x.creato) order by x.creato)
      from public.pulizie_fatte x where x.giorno = g
    ), '[]'::jsonb));
end $$;

-- «pulizie fatte», con una nota per segnalare cosa manca o cosa non va
create or replace function public.pulizie_segna(p_token uuid, p_giorno date, p_nome text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.settings where id = 1 and pulizie_token = p_token) then
    raise exception 'Link non valido: chiedi il link nuovo a chi organizza';
  end if;
  if p_giorno is null or p_giorno < current_date - 14 or p_giorno > current_date + 7 then
    raise exception 'Si possono segnare solo le pulizie di questi giorni';
  end if;
  if length(trim(coalesce(p_nome, ''))) = 0 then raise exception 'Scrivi il tuo nome'; end if;
  if (select count(*) from public.pulizie_fatte where giorno = p_giorno) >= 20 then
    raise exception 'Per questo giorno ci sono già molte segnalazioni';
  end if;
  insert into public.pulizie_fatte (giorno, nome, note) values (p_giorno, left(trim(p_nome), 60), left(trim(coalesce(p_note, '')), 1000));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.pulizie_giorno_di(int) from public;
revoke all on function public.pulizie_apri(uuid, int) from public;
revoke all on function public.pulizie_segna(uuid, date, text, text) from public;
grant execute on function public.pulizie_apri(uuid, int) to anon, authenticated;
grant execute on function public.pulizie_segna(uuid, date, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select exists (select 1 from pg_proc where proname = 'pulizie_apri') as link_pulizie;
