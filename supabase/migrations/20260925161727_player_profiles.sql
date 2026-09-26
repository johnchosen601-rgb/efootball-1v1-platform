-- Extend the deployed profiles table in place. The archived initial schema does
-- not match production and must not be applied to this project.
alter table public.profiles
  add column if not exists country text,
  add column if not exists efootball_id text,
  add column if not exists platform text,
  add column if not exists favourite_club text,
  add column if not exists playing_style text,
  add column if not exists bio text,
  add column if not exists last_seen_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_country_length,
  drop constraint if exists profiles_efootball_id_length,
  drop constraint if exists profiles_platform_length,
  drop constraint if exists profiles_favourite_club_length,
  drop constraint if exists profiles_playing_style_length,
  drop constraint if exists profiles_bio_length,
  add constraint profiles_country_length check (country is null or char_length(country) <= 64),
  add constraint profiles_efootball_id_length check (efootball_id is null or char_length(efootball_id) <= 64),
  add constraint profiles_platform_length check (platform is null or char_length(platform) <= 32),
  add constraint profiles_favourite_club_length check (favourite_club is null or char_length(favourite_club) <= 64),
  add constraint profiles_playing_style_length check (playing_style is null or char_length(playing_style) <= 64),
  add constraint profiles_bio_length check (bio is null or char_length(bio) <= 240);

-- Keep a player's public details editable while protecting competitive values.
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_url, country, efootball_id, platform,
  favourite_club, playing_style, bio, last_seen_at) on public.profiles to authenticated;

-- Completed scorelines are public competitive records. Pending/private matches
-- remain visible only to their participants under the existing policy.
drop policy if exists "Authenticated users can view completed matches" on public.matches;
create policy "Authenticated users can view completed matches"
  on public.matches for select to authenticated
  using (status = 'completed');

-- Profile pictures are public assets; uploads and changes are restricted to the
-- authenticated player's own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-avatars', 'player-avatars', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can view player avatars" on storage.objects;
create policy "Authenticated users can view player avatars"
  on storage.objects for select to authenticated
  using (bucket_id = 'player-avatars');

drop policy if exists "Players can upload their own avatar" on storage.objects;
create policy "Players can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'player-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Players can update their own avatar" on storage.objects;
create policy "Players can update their own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'player-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'player-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Players can delete their own avatar" on storage.objects;
create policy "Players can delete their own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'player-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
