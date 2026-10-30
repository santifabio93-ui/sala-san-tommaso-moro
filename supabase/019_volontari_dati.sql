-- Sala San Tommaso Moro — aggiornamento 19: scheda dei volontari.
-- Data di nascita (per gli auguri) e attestato antincendio: livello, data del corso o dell'ultimo aggiornamento,
-- scadenza (di solito 5 anni dopo) e il file dell'attestato. Lo vedono solo admin e coordinatori.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

alter table public.volontari add column if not exists data_nascita date;
alter table public.volontari add column if not exists antincendio text not null default '';
alter table public.volontari add column if not exists antincendio_data date;
alter table public.volontari add column if not exists antincendio_scadenza date;
alter table public.volontari add column if not exists antincendio_file text not null default '';
alter table public.volontari add column if not exists note text not null default '';
alter table public.volontari drop constraint if exists volontari_antincendio_check;
alter table public.volontari add constraint volontari_antincendio_check check (antincendio in ('', '1', '2', '3'));

-- spazio file privato per gli attestati, massimo 10 MB per file, solo PDF e immagini
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('volontari', 'volontari', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "attestati volontari: staff" on storage.objects;
create policy "attestati volontari: staff" on storage.objects
  for all to authenticated
  using (bucket_id = 'volontari' and public.my_role() in ('admin', 'coordinatore'))
  with check (bucket_id = 'volontari' and public.my_role() in ('admin', 'coordinatore'));

notify pgrst, 'reload schema';

select exists (select 1 from information_schema.columns where table_name = 'volontari' and column_name = 'data_nascita') as scheda_volontari,
  exists (select 1 from storage.buckets where id = 'volontari') as spazio_attestati;
