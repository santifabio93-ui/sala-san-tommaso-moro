-- Sala San Tommaso Moro — aggiornamento 46: le fatture dei film lette dalla cartella Drive «FATTURE FILM 2026».
-- Lo script Google (modalità «+fatture») legge i PDF delle fatture elettroniche (distributore, numero, data, film,
-- condizioni, imponibile, IVA, totale, scadenza) e li copia qui. L'app le abbina ai movimenti della prima nota:
-- quelle già registrate non si contano una seconda volta, quelle che mancano si segnalano.
-- Le vede solo l'amministratore (come la prima nota).
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

create table if not exists public.fatture_film (
  file_id text primary key,                  -- id del PDF su Drive
  file_nome text not null default '',
  link text not null default '',
  fornitore text not null default '',
  numero text not null default '',
  data date,
  tipo_documento text not null default '',  -- TD01 fattura, TD04 nota di credito
  tipo text not null default '',             -- Noleggio film, Licenza MPLC, Servizi Cinebot
  film text not null default '',
  voci jsonb not null default '[]'::jsonb,   -- più film nella stessa fattura: [{film, data}]
  data_proiezione date,
  percentuale numeric,
  minimo numeric,
  imponibile numeric not null default 0,
  iva numeric not null default 0,
  totale numeric not null default 0,
  scadenza date,
  letto timestamptz not null default now()
);
alter table public.fatture_film enable row level security;
drop policy if exists "fatture film: amministratore" on public.fatture_film;
create policy "fatture film: amministratore" on public.fatture_film
  for select using (public.my_role() = 'admin');
alter table public.settings add column if not exists sync_fatture timestamptz;

-- lo script manda le fatture lette e l'elenco dei PDF ancora nella cartella (quelli tolti spariscono anche qui)
create or replace function public.sync_fatture_push(p_token text, p_fatture jsonb, p_presenti text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n int; tolte int := 0;
begin
  perform public.sync_check(p_token);
  insert into public.fatture_film as f (file_id, file_nome, link, fornitore, numero, data, tipo_documento, tipo, film, voci,
                                        data_proiezione, percentuale, minimo, imponibile, iva, totale, scadenza, letto)
  select x->>'file_id', left(coalesce(x->>'file_nome', ''), 200), left(coalesce(x->>'link', ''), 300), left(coalesce(x->>'fornitore', ''), 160),
         left(coalesce(x->>'numero', ''), 60), nullif(x->>'data', '')::date, left(coalesce(x->>'tipo_documento', ''), 8), left(coalesce(x->>'tipo', ''), 60),
         left(coalesce(x->>'film', ''), 200), case when jsonb_typeof(x->'voci') = 'array' then x->'voci' else '[]'::jsonb end,
         nullif(x->>'data_proiezione', '')::date, nullif(x->>'percentuale', '')::numeric, nullif(x->>'minimo', '')::numeric,
         coalesce(nullif(x->>'imponibile', '')::numeric, 0), coalesce(nullif(x->>'iva', '')::numeric, 0), coalesce(nullif(x->>'totale', '')::numeric, 0),
         nullif(x->>'scadenza', '')::date, now()
  from jsonb_array_elements(coalesce(p_fatture, '[]'::jsonb)) x
  where coalesce(x->>'file_id', '') <> ''
  on conflict (file_id) do update set
    file_nome = excluded.file_nome, link = excluded.link, fornitore = excluded.fornitore, numero = excluded.numero, data = excluded.data,
    tipo_documento = excluded.tipo_documento, tipo = excluded.tipo, film = excluded.film, voci = excluded.voci,
    data_proiezione = excluded.data_proiezione, percentuale = excluded.percentuale, minimo = excluded.minimo,
    imponibile = excluded.imponibile, iva = excluded.iva, totale = excluded.totale, scadenza = excluded.scadenza, letto = now();
  get diagnostics n = row_count;
  if p_presenti is not null then
    delete from public.fatture_film where not (file_id = any(p_presenti));
    get diagnostics tolte = row_count;
  end if;
  update public.settings set sync_fatture = now() where id = 1;
  return jsonb_build_object('lette', n, 'tolte', tolte);
end $$;
revoke all on function public.sync_fatture_push(text, jsonb, text[]) from public;
grant execute on function public.sync_fatture_push(text, jsonb, text[]) to anon;

notify pgrst, 'reload schema';

select to_regclass('public.fatture_film') is not null as fatture_film;
