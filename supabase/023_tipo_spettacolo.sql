-- Sala San Tommaso Moro — aggiornamento 23: non tutto quello che arriva da Cinebot è un film.
-- Su Cinebot si vendono anche teatro, danza, concerti e incontri. Lo script porta qualche indizio (sottotitolo,
-- prezzo, visto di censura) e l'app capisce da sola che cos'è; si può sempre correggere a mano nella scheda.
-- Per gli spettacoli che non sono film l'app non chiede supporto, distributore e prova di proiezione.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

alter table public.films add column if not exists tipo text;                                   -- vuoto = lo decide l'app
alter table public.films add column if not exists cinebot_info jsonb not null default '{}'::jsonb;  -- indizi da Cinebot
alter table public.films drop constraint if exists films_tipo_check;
alter table public.films add constraint films_tipo_check check (tipo is null or tipo in ('film', 'teatro', 'danza', 'musica', 'incontro', 'altro'));

create or replace function public.sync_cinebot_push(p_token text, p_films jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f jsonb; pr jsonb;
  fid uuid;
  keys text[] := '{}';
  n_pr int := 0; n_del int := 0;
begin
  perform public.sync_check(p_token);
  for f in select * from jsonb_array_elements(p_films) loop
    insert into public.films (cinebot_id, titolo, locandina_url, cinebot_url, cinebot_info)
    values (f->>'cinebot_id', f->>'titolo', coalesce(f->>'locandina', ''), coalesce(f->>'url', ''), coalesce(f->'info', '{}'::jsonb))
    on conflict (cinebot_id) do update set
      titolo = excluded.titolo,
      locandina_url = case when excluded.locandina_url <> '' then excluded.locandina_url else films.locandina_url end,
      cinebot_url = case when excluded.cinebot_url <> '' then excluded.cinebot_url else films.cinebot_url end,
      cinebot_info = case when excluded.cinebot_info <> '{}'::jsonb then excluded.cinebot_info else films.cinebot_info end
    returning id into fid;
    for pr in select * from jsonb_array_elements(coalesce(f->'proiezioni', '[]')) loop
      keys := keys || (pr->>'key');
      insert into public.proiezioni (film_id, data, ora, fonte, cinebot_key)
      values (fid, (pr->>'data')::date, (pr->>'ora')::time, 'cinebot', pr->>'key')
      on conflict (cinebot_key) do update set data = excluded.data, ora = excluded.ora, film_id = excluded.film_id;
      n_pr := n_pr + 1;
    end loop;
  end loop;
  with gone as (
    delete from public.proiezioni
    where fonte = 'cinebot' and data >= current_date and not (cinebot_key = any(keys))
    returning 1
  ) select count(*) into n_del from gone;
  update public.settings set sync_cinebot = now() where id = 1;
  return jsonb_build_object('film', jsonb_array_length(p_films), 'proiezioni', n_pr, 'tolte', n_del);
end $$;
revoke all on function public.sync_cinebot_push(text, jsonb) from public;
grant execute on function public.sync_cinebot_push(text, jsonb) to anon;

notify pgrst, 'reload schema';

select exists (select 1 from information_schema.columns where table_name = 'films' and column_name = 'cinebot_info') as tipo_spettacolo;
