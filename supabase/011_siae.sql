-- Sala San Tommaso Moro — aggiornamento 11: allegati della scheda online (permesso SIAE).
-- L'organizzatore carica il permesso SIAE dalla sua scheda; i file li vede solo lo staff.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

-- spazio file privato, massimo 10 MB per file, solo PDF e immagini
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('schede', 'schede', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- vero se il codice del link corrisponde a una scheda ancora modificabile
-- (security definer: chi non ha account non può leggere la tabella delle schede)
create or replace function public.scheda_token_valido(p_token text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.schede
    where token::text = p_token and stato not in ('approvata', 'non_serve')
  )
$$;
revoke all on function public.scheda_token_valido(text) from public;
grant execute on function public.scheda_token_valido(text) to anon, authenticated;

-- l'organizzatore carica solo nella cartella della sua scheda (il nome della cartella è il codice del link)
drop policy if exists "schede allegati: organizzatore carica" on storage.objects;
create policy "schede allegati: organizzatore carica" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'schede' and public.scheda_token_valido((storage.foldername(name))[1]));

-- lo staff legge ed elimina gli allegati
drop policy if exists "schede allegati: staff legge" on storage.objects;
create policy "schede allegati: staff legge" on storage.objects
  for select to authenticated
  using (bucket_id = 'schede' and public.my_role() in ('admin', 'coordinatore'));
drop policy if exists "schede allegati: staff elimina" on storage.objects;
create policy "schede allegati: staff elimina" on storage.objects
  for delete to authenticated
  using (bucket_id = 'schede' and public.my_role() in ('admin', 'coordinatore'));

select exists (select 1 from storage.buckets where id = 'schede') as spazio_file,
  exists (select 1 from pg_proc where proname = 'scheda_token_valido') as funzione_controllo;
