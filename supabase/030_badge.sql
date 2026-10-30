-- Sala San Tommaso Moro — aggiornamento 30: badge dei volontari (QR code e codice a barre).
-- Ogni volontario ha un codice casuale (es. STM7K3QX9PA) da stampare su una tesserina o da mostrare dal telefono:
-- alla postazione della cassa vale come la tessera sanitaria. Il codice non contiene dati personali.
-- Serve l'aggiornamento 28 (cassa con la tessera). Da eseguire in Supabase: SQL Editor → New query → incolla tutto
-- → Run. Si può rieseguire senza problemi.

create or replace function public.nuovo_badge()
returns text
language sql volatile as $$
  -- 8 caratteri senza quelli che si confondono (0/O, 1/I)
  select 'STM' || string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 8)
$$;

alter table public.volontari add column if not exists badge text;
update public.volontari set badge = public.nuovo_badge() where badge is null;
alter table public.volontari alter column badge set default public.nuovo_badge();
create unique index if not exists volontari_badge on public.volontari (badge) where badge is not null;

-- alla postazione: tessera sanitaria oppure badge
create or replace function public.cassa_tessera(p_cf text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v public.volontari;
  codice text := upper(regexp_replace(coalesce(p_cf, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.can_cassa() then raise exception 'Questa postazione non è abilitata alla cassa'; end if;
  select * into v from public.volontari
  where attivo and ((codice like 'STM%' and badge = codice) or cf_impronta = public.impronta_cf(codice))
  limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', v.id, 'nome', v.nome);
end $$;
revoke all on function public.cassa_tessera(text) from public, anon;
grant execute on function public.cassa_tessera(text) to authenticated;

-- badge perso: se ne fa uno nuovo e il vecchio non vale più (admin e coordinatori)
create or replace function public.volontario_badge_nuovo(p_volontario uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  b text;
begin
  if coalesce(public.my_role(), '') not in ('admin', 'coordinatore') then raise exception 'Non autorizzato'; end if;
  loop
    b := public.nuovo_badge();
    exit when not exists (select 1 from public.volontari where badge = b);
  end loop;
  update public.volontari set badge = b where id = p_volontario;
  return b;
end $$;
revoke all on function public.volontario_badge_nuovo(uuid) from public, anon;
grant execute on function public.volontario_badge_nuovo(uuid) to authenticated;

-- il volontario vede il suo badge nel link personale dei turni
create or replace function public.turni_badge(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nome', nome, 'badge', badge) from public.volontari where token = p_token and attivo
$$;
revoke all on function public.turni_badge(uuid) from public;
grant execute on function public.turni_badge(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

select count(*) filter (where badge is not null) as volontari_con_badge from public.volontari;
