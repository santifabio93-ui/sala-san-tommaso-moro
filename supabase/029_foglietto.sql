-- Sala San Tommaso Moro — aggiornamento 29: programma per il foglietto parrocchiale.
-- Ogni giovedì mattina lo script Google (modalità «+foglietto») manda un'email al parroco con gli appuntamenti
-- pubblici della sala dalla domenica alla domenica dopo: film e spettacoli, eventi della Sala, serate del Comune.
-- Gli affitti privati e gli eventi da confermare non compaiono. Destinatario, firma e note si impostano dall'app.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

alter table public.settings add column if not exists foglietto_attivo boolean not null default false;
alter table public.settings add column if not exists foglietto_email text not null default '';
alter table public.settings add column if not exists foglietto_nome text not null default 'don Giorgio';
alter table public.settings add column if not exists foglietto_firma text not null default '';
alter table public.settings add column if not exists foglietto_note text not null default '';
alter table public.settings add column if not exists foglietto_inviato date;

-- gli appuntamenti pubblici dalla prossima domenica (o da oggi, se è domenica) alla domenica dopo
create or replace function public.sync_foglietto(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  oggi date := (now() at time zone 'Europe/Rome')::date;
  dal date;
  s public.settings;
begin
  perform public.sync_check(p_token);
  dal := oggi + ((7 - extract(dow from oggi)::int) % 7);
  select * into s from public.settings where id = 1;
  return jsonb_build_object(
    'attivo', s.foglietto_attivo, 'email', s.foglietto_email, 'nome', s.foglietto_nome, 'firma', s.foglietto_firma,
    'note', s.foglietto_note, 'inviato', s.foglietto_inviato, 'oggi', oggi, 'dal', dal, 'al', dal + 7,
    'voci', coalesce((select jsonb_agg(v order by v->>'data', v->>'ora') from (
      select jsonb_build_object('data', p.data, 'ora', to_char(p.ora, 'HH24:MI'), 'titolo', f.titolo,
          'tipo', case coalesce(to_jsonb(f)->>'tipo', '') when 'teatro' then 'Teatro' when 'danza' then 'Danza' when 'musica' then 'Musica'
                    when 'incontro' then 'Incontro' when 'altro' then 'Spettacolo' else 'Cinema' end,
          'prezzo', to_jsonb(f)->'cinebot_info'->'prezzo') as v
        from public.proiezioni p join public.films f on f.id = p.film_id
        where p.data between dal and dal + 7
      union all
      select jsonb_build_object('data', b.data, 'ora', case when coalesce(b.giornata_intera, false) then '' else to_char(b.inizio, 'HH24:MI') end,
          'titolo', b.titolo, 'tipo', case when b.comune then 'Comune' else 'Sala' end, 'prezzo', null)
        from public.bookings b
        where b.data between dal and dal + 7 and b.stato = 'confermata'
          and (b.comune or coalesce((to_jsonb(b)->>'della_sala')::boolean, false))
          and not (b.titolo ~* '(cinema|proiezion|cineforum)' and exists (select 1 from public.proiezioni p where p.data = b.data))
    ) x), '[]'::jsonb));
end $$;

create or replace function public.sync_foglietto_inviato(p_token text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_check(p_token);
  update public.settings set foglietto_inviato = (now() at time zone 'Europe/Rome')::date where id = 1;
end $$;

revoke all on function public.sync_foglietto(text) from public;
revoke all on function public.sync_foglietto_inviato(text) from public;
grant execute on function public.sync_foglietto(text) to anon;
grant execute on function public.sync_foglietto_inviato(text) to anon;

notify pgrst, 'reload schema';

select exists (select 1 from pg_proc where proname = 'sync_foglietto') as foglietto;
