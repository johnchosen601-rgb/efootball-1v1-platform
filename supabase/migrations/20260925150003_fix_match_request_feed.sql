-- Safe additive fix for the already deployed match_requests table.
-- The owner foreign key and RLS insert policy are part of the existing schema.
-- A partial unique index prevents concurrent duplicate open requests per player.
create unique index if not exists match_requests_one_open_per_player
  on public.match_requests (player_id)
  where status = 'open';

-- Realtime needs the table in the publication. Existing row visibility still
-- follows the table's RLS policies.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'match_requests'
     ) then
    alter publication supabase_realtime add table public.match_requests;
  end if;
end;
$$;
