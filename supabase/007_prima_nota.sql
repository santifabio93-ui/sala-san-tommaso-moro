-- Sala San Tommaso Moro — aggiornamento 7: Prima nota (contabilità) per l'Economia.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

create table if not exists public.prima_nota (
  id uuid primary key default gen_random_uuid(),
  n int,
  data date not null,
  anno int not null,
  cod_settore int,
  settore text not null default '',
  cod_cat text not null default '',
  categoria text not null default '',
  controparte text not null default '',
  descrizione text not null default '',
  n_documento text not null default '',
  evento text not null default '',
  entrate numeric(12, 2) not null default 0,
  uscite numeric(12, 2) not null default 0,
  tipo_movimento text not null default 'Movimento',
  documento text not null default '',
  note text not null default '',
  file_nome text not null default '',
  importato timestamptz not null default now()
);
create index if not exists prima_nota_data on public.prima_nota (data);

alter table public.prima_nota enable row level security;
drop policy if exists "prima nota: admin legge" on public.prima_nota;
create policy "prima nota: admin legge" on public.prima_nota
  for select using (public.my_role() = 'admin');

alter table public.settings add column if not exists sync_prima_nota timestamptz;
alter table public.settings add column if not exists prima_nota_file text;

-- lo script Google manda tutti i movimenti del file: sostituiscono quelli precedenti
create or replace function public.sync_prima_nota_push(p_token text, p_file text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  perform public.sync_check(p_token);
  if jsonb_array_length(coalesce(p_rows, '[]')) = 0 then
    raise exception 'Prima nota vuota: non sostituisco i movimenti esistenti';
  end if;
  delete from public.prima_nota where true;
  insert into public.prima_nota (n, data, anno, cod_settore, settore, cod_cat, categoria, controparte, descrizione,
                                 n_documento, evento, entrate, uscite, tipo_movimento, documento, note, file_nome)
  select (r->>'n')::int, (r->>'data')::date, coalesce((r->>'anno')::int, extract(year from (r->>'data')::date)::int),
         nullif(r->>'cod_settore', '')::int, coalesce(r->>'settore', ''), coalesce(r->>'cod_cat', ''), coalesce(r->>'categoria', ''),
         coalesce(r->>'controparte', ''), coalesce(r->>'descrizione', ''), coalesce(r->>'n_documento', ''), coalesce(r->>'evento', ''),
         coalesce((r->>'entrate')::numeric, 0), coalesce((r->>'uscite')::numeric, 0), coalesce(nullif(r->>'tipo_movimento', ''), 'Movimento'),
         coalesce(r->>'documento', ''), coalesce(r->>'note', ''), coalesce(p_file, '')
  from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  update public.settings set sync_prima_nota = now(), prima_nota_file = p_file where id = 1;
  return jsonb_build_object('movimenti', n);
end $$;

revoke all on function public.sync_prima_nota_push(text, text, jsonb) from public;
grant execute on function public.sync_prima_nota_push(text, text, jsonb) to anon;

-- fa vedere subito le funzioni nuove all'app
notify pgrst, 'reload schema';

-- controllo finale: devono risultare tutte «true»
select
  to_regclass('public.prima_nota') is not null as tabella_prima_nota,
  exists (select 1 from pg_proc where proname = 'sync_prima_nota_push') as funzione_prima_nota,
  exists (select 1 from information_schema.columns where table_name = 'settings' and column_name = 'sync_prima_nota') as colonna_sync;
