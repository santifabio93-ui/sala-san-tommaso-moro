-- Sala San Tommaso Moro — aggiornamento 27: ruolo «Parroco».
-- Il parroco vede la sala in sola lettura: calendario, film e spettatori, resoconto del mese, serate del Comune e
-- solo i TOTALI dei conti (entrate e uscite per mese dalla prima nota). Non legge direttamente le tabelle: una
-- funzione gli prepara i dati già ridotti, senza telefoni ed email di chi affitta e senza dati dei volontari.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

-- il nuovo ruolo è ammesso nei profili e negli inviti (i ruoli già presenti restano ammessi)
do $$
declare
  extra_p text; extra_i text;
begin
  select string_agg(distinct quote_literal(ruolo), ', ') into extra_p from public.profiles
    where ruolo not in ('admin', 'coordinatore', 'segreteria', 'parroco', 'volontario', 'in_attesa', 'bloccato');
  select string_agg(distinct quote_literal(ruolo), ', ') into extra_i from public.inviti
    where ruolo not in ('admin', 'coordinatore', 'segreteria', 'parroco', 'volontario');
  alter table public.profiles drop constraint if exists profiles_ruolo_check;
  execute format('alter table public.profiles add constraint profiles_ruolo_check check (ruolo in (%s))',
    concat_ws(', ', quote_literal('admin'), quote_literal('coordinatore'), quote_literal('segreteria'), quote_literal('parroco'),
              quote_literal('volontario'), quote_literal('in_attesa'), quote_literal('bloccato'), extra_p));
  alter table public.inviti drop constraint if exists inviti_ruolo_check;
  execute format('alter table public.inviti add constraint inviti_ruolo_check check (ruolo in (%s))',
    concat_ws(', ', quote_literal('admin'), quote_literal('coordinatore'), quote_literal('segreteria'), quote_literal('parroco'),
              quote_literal('volontario'), extra_i));
end $$;

-- tutto quello che vede il parroco, in una volta (anche l'amministratore può chiederlo, per vedere cosa vede lui)
create or replace function public.parroco_dati()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  dal date := make_date(extract(year from current_date)::int - 1, 1, 1);
  n_ai int := 0;
  pul jsonb := '[]'::jsonb;
begin
  if coalesce(public.my_role(), '') not in ('parroco', 'admin') then raise exception 'Non autorizzato'; end if;
  -- attestati antincendio scaduti o in scadenza (aggiornamento 19) e note delle pulizie (aggiornamento 24), se ci sono
  begin
    execute 'select count(*) from public.volontari where attivo and antincendio <> '''' and antincendio_scadenza <= current_date + 60' into n_ai;
  exception when others then n_ai := 0;
  end;
  begin
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''giorno'', giorno, ''note'', note) order by creato desc), ''[]''::jsonb)
             from public.pulizie_fatte where note <> '''' and creato > now() - interval ''14 days''' into pul;
  exception when others then pul := '[]'::jsonb;
  end;
  return jsonb_build_object(
    'bookings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'titolo', b.titolo, 'tipo', b.tipo, 'data', b.data, 'inizio', b.inizio, 'fine', b.fine,
        'giornata_intera', b.giornata_intera, 'stato', b.stato, 'comune', b.comune, 'prezzo', b.prezzo,
        'della_sala', coalesce((to_jsonb(b)->>'della_sala')::boolean, false), 'turni', b.turni))
      from public.bookings b where b.data >= dal), '[]'::jsonb),
    'signups', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'booking_id', s.booking_id, 'slot_id', s.slot_id, 'nome', s.nome, 'creato', s.creato))
      from public.signups s join public.bookings b on b.id = s.booking_id where b.data >= dal), '[]'::jsonb),
    'films', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'titolo', f.titolo, 'locandina_url', f.locandina_url,
        'tipo', to_jsonb(f)->>'tipo', 'cinebot_info', coalesce(to_jsonb(f)->'cinebot_info', '{}'::jsonb), 'supporto', f.supporto)) from public.films f), '[]'::jsonb),
    'proiezioni', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'film_id', p.film_id, 'data', p.data, 'ora', p.ora))
      from public.proiezioni p where p.data >= dal), '[]'::jsonb),
    'c1', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'data', c.data, 'ora', c.ora, 'titolo', c.titolo, 'tipo_evento', c.tipo_evento,
        'spettatori', c.spettatori, 'lordo', c.lordo, 'film_id', c.film_id))
      from public.c1 c where c.data >= dal), '[]'::jsonb),
    -- solo i totali per mese (anno di competenza), niente movimenti
    'conti', coalesce((select jsonb_agg(jsonb_build_object('anno', x.anno, 'mese', x.mese, 'entrate', x.e, 'uscite', x.u) order by x.mese)
      from (select anno, to_char(data, 'YYYY-MM') as mese, sum(entrate) as e, sum(uscite) as u
            from public.prima_nota where anno >= extract(year from current_date)::int - 1 group by 1, 2) x), '[]'::jsonb),
    'convenzione', (select jsonb_build_object('inizio', s.convenzione_inizio, 'serate', s.convenzione_serate, 'anni', s.convenzione_anni) from public.settings s where s.id = 1),
    'avvisi', jsonb_build_object('antincendio', n_ai, 'pulizie', pul));
end $$;
revoke all on function public.parroco_dati() from public;
grant execute on function public.parroco_dati() to authenticated;

notify pgrst, 'reload schema';

select exists (select 1 from pg_proc where proname = 'parroco_dati') as ruolo_parroco;
