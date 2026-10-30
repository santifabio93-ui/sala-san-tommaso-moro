-- Sala San Tommaso Moro — aggiornamento 15: preventivo dell'anno per settore.
-- Per ogni anno, entrate e uscite previste di ogni settore della prima nota: {"2026": {"101": {"nome": "...", "e": 1000, "u": 800}}}.
-- Da eseguire in Supabase: SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

alter table public.settings add column if not exists preventivo jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';

select exists (select 1 from information_schema.columns where table_name = 'settings' and column_name = 'preventivo') as preventivo;
