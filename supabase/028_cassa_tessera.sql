-- Sala San Tommaso Moro — aggiornamento 28: cassa con la tessera sanitaria.
-- Il computer della biglietteria resta collegato con un account «postazione» che vede solo la cassa; il volontario
-- passa la tessera sanitaria con il lettore di codici a barre e la cassa si apre e si chiude a suo nome.
-- Il codice fiscale NON viene salvato: si tiene solo un'impronta cifrata (SHA-256 con un «sale» segreto).
-- Serve l'aggiornamento 14 (volontari). Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run.
-- Si può rieseguire senza problemi.

alter table public.volontari add column if not exists cf_impronta text;
create unique index if not exists volontari_cf_impronta on public.volontari (cf_impronta) where cf_impronta is not null;
alter table public.profiles add column if not exists solo_cassa boolean not null default false;  -- account della postazione
alter table public.cassa add column if not exists aperta_da_nome text not null default '';
alter table public.cassa add column if not exists chiusa_da_nome text not null default '';

-- il «sale» segreto sta in una tabella che nessuno legge dall'app
create table if not exists public.segreti (chiave text primary key, valore text not null);
alter table public.segreti enable row level security;
insert into public.segreti (chiave, valore) values ('sale_tessera', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (chiave) do nothing;

-- impronta di un codice fiscale (maiuscolo, senza spazi); null se il codice non ha la forma giusta
create or replace function public.impronta_cf(p_cf text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  cf text := upper(regexp_replace(coalesce(p_cf, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if cf !~ '^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$' then return null; end if;
  return encode(sha256(convert_to((select valore from public.segreti where chiave = 'sale_tessera') || cf, 'UTF8')), 'hex');
end $$;
revoke all on function public.impronta_cf(text) from public, anon, authenticated;

-- registrare (o togliere, con p_cf vuoto) la tessera di un volontario: admin e coordinatori
create or replace function public.volontario_tessera(p_volontario uuid, p_cf text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  imp text;
begin
  if coalesce(public.my_role(), '') not in ('admin', 'coordinatore') then raise exception 'Non autorizzato'; end if;
  if coalesce(trim(p_cf), '') = '' then
    update public.volontari set cf_impronta = null where id = p_volontario;
    return jsonb_build_object('ok', true, 'tolta', true);
  end if;
  imp := public.impronta_cf(p_cf);
  if imp is null then raise exception 'Codice fiscale non valido: ripassa la tessera'; end if;
  if exists (select 1 from public.volontari where cf_impronta = imp and id <> p_volontario) then
    raise exception 'Questa tessera è già registrata per un altro volontario';
  end if;
  update public.volontari set cf_impronta = imp where id = p_volontario;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.volontario_tessera(uuid, text) from public, anon;
grant execute on function public.volontario_tessera(uuid, text) to authenticated;

-- chi ha passato la tessera alla postazione: solo chi può fare cassa
create or replace function public.cassa_tessera(p_cf text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v public.volontari;
begin
  if not public.can_cassa() then raise exception 'Questa postazione non è abilitata alla cassa'; end if;
  select * into v from public.volontari where attivo and cf_impronta = public.impronta_cf(p_cf);
  if not found then return null; end if;
  return jsonb_build_object('id', v.id, 'nome', v.nome);
end $$;
revoke all on function public.cassa_tessera(text) from public, anon;
grant execute on function public.cassa_tessera(text) to authenticated;

notify pgrst, 'reload schema';

select exists (select 1 from pg_proc where proname = 'cassa_tessera') as cassa_tessera;
