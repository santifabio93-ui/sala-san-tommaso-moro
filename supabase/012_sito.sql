-- Sala San Tommaso Moro — aggiornamento 12: controllo del sito www.salasantommasomoro.it.
-- L'app confronta il sito con il programma e prepara l'avviso per chi lo aggiorna.
-- Qui si salvano il contatto di chi aggiorna il sito, le segnalazioni già mandate e quelle da ignorare.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

alter table public.settings add column if not exists sito_nome text not null default 'Riccardo';
alter table public.settings add column if not exists sito_cellulare text not null default '';
alter table public.settings add column if not exists sito_avvisati jsonb not null default '[]'::jsonb;  -- segnalazioni già mandate
alter table public.settings add column if not exists sito_avvisato_il timestamptz;
alter table public.settings add column if not exists sito_ignora jsonb not null default '[]'::jsonb;    -- segnalazioni da non mostrare

-- i coordinatori non modificano le impostazioni: segnano avvisi e voci da ignorare con questa funzione
create or replace function public.sito_segna(p_avvisati jsonb default null, p_ignora jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() not in ('admin', 'coordinatore') then raise exception 'Non autorizzato'; end if;
  if (p_avvisati is not null and jsonb_typeof(p_avvisati) <> 'array') or (p_ignora is not null and jsonb_typeof(p_ignora) <> 'array') then
    raise exception 'Dati non validi';
  end if;
  update public.settings set
    sito_avvisati = case when p_avvisati is null then sito_avvisati else p_avvisati end,
    sito_avvisato_il = case when p_avvisati is null then sito_avvisato_il else now() end,
    sito_ignora = case when p_ignora is null then sito_ignora else p_ignora end
  where id = 1;
end $$;
revoke all on function public.sito_segna(jsonb, jsonb) from public;
grant execute on function public.sito_segna(jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

select exists (select 1 from information_schema.columns where table_name = 'settings' and column_name = 'sito_ignora') as impostazioni_sito,
  exists (select 1 from pg_proc where proname = 'sito_segna') as funzione_sito;
