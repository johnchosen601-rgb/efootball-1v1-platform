-- Keep competitive history when an administrator removes an Auth account.
-- The profile row becomes a non-identifying historical player record and is
-- intentionally detached from auth.users. Match and tournament foreign keys
-- continue to reference that row, preserving scores, brackets and champions.

alter table public.profiles
  add column if not exists is_deleted boolean not null default false;

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

create or replace function private.is_active_player()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_deleted = false
  );
$$;
revoke all on function private.is_active_player() from public, anon;
grant execute on function private.is_active_player() to authenticated;
grant usage on schema private to authenticated;

create or replace function private.guard_active_player_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.is_active_player() then
    raise exception using errcode = '42501', message = 'This account is no longer active.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_active_player_mutation() from public, anon, authenticated;

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'profiles', 'match_requests', 'matches', 'chat_messages', 'notifications',
    'tournaments', 'tournament_participants', 'tournament_matches'
  ] loop
    execute format('drop trigger if exists require_active_player on public.%I', target_table);
    execute format(
      'create trigger require_active_player before insert or update or delete on public.%I for each row execute function private.guard_active_player_mutation()',
      target_table
    );
  end loop;
end;
$$;

create or replace function private.preserve_profile_on_auth_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set username = 'deleted_' || substr(replace(old.id::text, '-', ''), 1, 16),
      display_name = 'Deleted player',
      avatar_url = null,
      country = null,
      efootball_id = null,
      platform = null,
      favourite_club = null,
      playing_style = null,
      bio = null,
      last_seen_at = null,
      is_deleted = true
  where id = old.id;

  delete from public.match_requests where player_id = old.id;
  update public.match_requests
  set accepted_by = null,
      status = case when status = 'accepted' then 'cancelled' else status end
  where accepted_by = old.id;
  update public.matches set player1_evidence_path = null where player1_id = old.id;
  update public.matches set player2_evidence_path = null where player2_id = old.id;
  delete from public.notifications where user_id = old.id;
  delete from public.chat_messages where sender_id = old.id;

  return old;
end;
$$;
revoke all on function private.preserve_profile_on_auth_delete() from public, anon, authenticated;

drop trigger if exists preserve_profile_on_auth_delete on auth.users;
create trigger preserve_profile_on_auth_delete
before delete on auth.users
for each row execute function private.preserve_profile_on_auth_delete();

-- Private match data and user-owned data are inaccessible to a deleted account,
-- even while an old JWT remains valid until its normal expiry.
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) and is_deleted = false and (select private.is_active_player()))
  with check (id = (select auth.uid()) and is_deleted = false and (select private.is_active_player()));

drop policy if exists "Players can create their own requests" on public.match_requests;
create policy "Players can create their own requests" on public.match_requests
  for insert to authenticated
  with check (player_id = (select auth.uid()) and status = 'open' and (select private.is_active_player()));
drop policy if exists "Players can view open or related requests" on public.match_requests;
create policy "Players can view open or related requests" on public.match_requests
  for select to authenticated
  using ((select private.is_active_player()) and (status = 'open' or player_id = (select auth.uid()) or accepted_by = (select auth.uid())));

drop policy if exists "Only match participants can view match rows" on public.matches;
create policy "Only active match participants can view match rows"
  on public.matches for select to authenticated
  using ((select private.is_active_player()) and ((select auth.uid()) = player1_id or (select auth.uid()) = player2_id));

drop policy if exists "Match participants can read private chat" on public.chat_messages;
create policy "Active match participants can read private chat" on public.chat_messages
  for select to authenticated
  using ((select private.is_active_player()) and exists (
    select 1 from public.matches m where m.id = match_id
      and ((select auth.uid()) = m.player1_id or (select auth.uid()) = m.player2_id)
  ));
drop policy if exists "Match participants can send private chat" on public.chat_messages;
create policy "Active match participants can send private chat" on public.chat_messages
  for insert to authenticated
  with check ((select private.is_active_player()) and sender_id = (select auth.uid()) and exists (
    select 1 from public.matches m where m.id = match_id
      and ((select auth.uid()) = m.player1_id or (select auth.uid()) = m.player2_id)
  ));

drop policy if exists "Players read own notifications" on public.notifications;
create policy "Players read own notifications" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_player()));
drop policy if exists "Players mark own notifications read" on public.notifications;
create policy "Players mark own notifications read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_player()))
  with check (user_id = (select auth.uid()) and (select private.is_active_player()));

drop policy if exists "Match participants can view result evidence" on storage.objects;
create policy "Match participants can view result evidence"
on storage.objects for select to authenticated
using (bucket_id = 'match-evidence' and (select private.is_active_player()) and exists (
  select 1 from public.matches m where m.id::text = split_part(name, '/', 1)
    and (m.player1_id = (select auth.uid()) or m.player2_id = (select auth.uid()))
));

drop policy if exists "Players can upload their own match evidence" on storage.objects;
create policy "Players can upload their own match evidence"
on storage.objects for insert to authenticated
with check (bucket_id = 'match-evidence' and (select private.is_active_player())
  and split_part(name, '/', 2) = (select auth.uid())::text and exists (
    select 1 from public.matches m where m.id::text = split_part(name, '/', 1)
      and (m.player1_id = (select auth.uid()) or m.player2_id = (select auth.uid()))
  ));

drop policy if exists "Players can remove their unsubmitted match evidence" on storage.objects;
create policy "Players can remove their unsubmitted match evidence"
on storage.objects for delete to authenticated
using (bucket_id = 'match-evidence' and (select private.is_active_player())
  and split_part(name, '/', 2) = (select auth.uid())::text and not exists (
    select 1 from public.matches m where m.player1_evidence_path = name or m.player2_evidence_path = name
  ));

drop policy if exists "Players can upload their own avatar" on storage.objects;
create policy "Players can upload their own avatar" on storage.objects for insert to authenticated
with check (bucket_id = 'player-avatars' and (select private.is_active_player())
  and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Players can update their own avatar" on storage.objects;
create policy "Players can update their own avatar" on storage.objects for update to authenticated
using (bucket_id = 'player-avatars' and (select private.is_active_player())
  and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'player-avatars' and (select private.is_active_player())
  and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Players can delete their own avatar" on storage.objects;
create policy "Players can delete their own avatar" on storage.objects for delete to authenticated
using (bucket_id = 'player-avatars' and (select private.is_active_player())
  and (storage.foldername(name))[1] = (select auth.uid())::text);

-- The public history RPC is intentionally readable by all authenticated active
-- players, but must not be callable with a deleted account's still-valid JWT.
create or replace function public.get_profile_match_history(p_profile_id uuid, p_limit integer default 10)
returns table (
  id uuid, player1_id uuid, player2_id uuid, player1_score integer,
  player2_score integer, winner_id uuid, status text, created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_player() then
    raise exception using errcode = '42501', message = 'Sign in with an active player account to view match history.';
  end if;
  if p_profile_id is null then raise exception using errcode = '22023', message = 'Player profile is required.'; end if;
  return query
  select m.id, m.player1_id, m.player2_id, m.player1_score, m.player2_score,
         m.winner_id, m.status, m.created_at
  from public.matches m
  where m.status = 'completed' and (m.player1_id = p_profile_id or m.player2_id = p_profile_id)
  order by m.created_at desc limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;
revoke all on function public.get_profile_match_history(uuid, integer) from public, anon;
grant execute on function public.get_profile_match_history(uuid, integer) to authenticated;
