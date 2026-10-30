-- Sala San Tommaso Moro — aggiornamento 25: ruolo «Segreteria».
-- Per chi aiuta a tenere l'agenda della sala: calendario, prenotazioni, richieste, schede di richiesta e sopralluoghi.
-- Non vede cassa, incassi dei film, prima nota, donazioni, dati dei volontari, SAS e impostazioni.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

-- il nuovo ruolo è ammesso nei profili e negli inviti
-- (se nel database c'è qualche ruolo di prove vecchie, resta ammesso: non si cambiano i dati)
do $$
declare
  extra_p text; extra_i text;
begin
  select string_agg(distinct quote_literal(ruolo), ', ') into extra_p from public.profiles
    where ruolo not in ('admin', 'coordinatore', 'segreteria', 'volontario', 'in_attesa', 'bloccato');
  select string_agg(distinct quote_literal(ruolo), ', ') into extra_i from public.inviti
    where ruolo not in ('admin', 'coordinatore', 'segreteria', 'volontario');
  alter table public.profiles drop constraint if exists profiles_ruolo_check;
  execute format('alter table public.profiles add constraint profiles_ruolo_check check (ruolo in (%s))',
    concat_ws(', ', quote_literal('admin'), quote_literal('coordinatore'), quote_literal('segreteria'), quote_literal('volontario'),
              quote_literal('in_attesa'), quote_literal('bloccato'), extra_p));
  alter table public.inviti drop constraint if exists inviti_ruolo_check;
  execute format('alter table public.inviti add constraint inviti_ruolo_check check (ruolo in (%s))',
    concat_ws(', ', quote_literal('admin'), quote_literal('coordinatore'), quote_literal('segreteria'), quote_literal('volontario'), extra_i));
end $$;

-- prenotazioni, richieste, schede (anche gli allegati SIAE), sopralluoghi: legge e scrive
drop policy if exists "prenotazioni: segreteria" on public.bookings;
create policy "prenotazioni: segreteria" on public.bookings
  for all using (public.my_role() = 'segreteria') with check (public.my_role() = 'segreteria');
drop policy if exists "richieste: segreteria" on public.richieste;
create policy "richieste: segreteria" on public.richieste
  for all using (public.my_role() = 'segreteria') with check (public.my_role() = 'segreteria');
drop policy if exists "schede: segreteria" on public.schede;
create policy "schede: segreteria" on public.schede
  for all using (public.my_role() = 'segreteria') with check (public.my_role() = 'segreteria');
drop policy if exists "sopralluoghi: segreteria" on public.sopralluoghi;
create policy "sopralluoghi: segreteria" on public.sopralluoghi
  for all using (public.my_role() = 'segreteria') with check (public.my_role() = 'segreteria');
drop policy if exists "schede allegati: segreteria legge" on storage.objects;
create policy "schede allegati: segreteria legge" on storage.objects
  for select to authenticated using (bucket_id = 'schede' and public.my_role() = 'segreteria');

-- in sola lettura: tariffe e impostazioni (per i prezzi), turni e proiezioni (per vedere la sala occupata)
drop policy if exists "tariffe: segreteria legge" on public.settings;
create policy "tariffe: segreteria legge" on public.settings
  for select using (public.my_role() = 'segreteria');
drop policy if exists "turni: segreteria legge" on public.signups;
create policy "turni: segreteria legge" on public.signups
  for select using (public.my_role() = 'segreteria');
drop policy if exists "film: segreteria legge" on public.films;
create policy "film: segreteria legge" on public.films
  for select using (public.my_role() = 'segreteria');
drop policy if exists "proiezioni: segreteria legge" on public.proiezioni;
create policy "proiezioni: segreteria legge" on public.proiezioni
  for select using (public.my_role() = 'segreteria');

-- le scorte che mancano le può segnare anche la segreteria (se c'è già l'aggiornamento 24)
do $$
begin
  if to_regclass('public.scorte') is not null then
    drop policy if exists "scorte: segreteria" on public.scorte;
    create policy "scorte: segreteria" on public.scorte
      for all using (public.my_role() = 'segreteria') with check (public.my_role() = 'segreteria');
  end if;
end $$;

notify pgrst, 'reload schema';

select exists (select 1 from pg_policies where policyname = 'prenotazioni: segreteria') as ruolo_segreteria;
