-- eFootball 1v1 initial schema. Apply once to a new Supabase project.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  country text check (country is null or char_length(country) <= 56),
  avatar_url text,
  rating integer not null default 1000 check (rating between 0 and 10000),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  matches_played integer not null default 0 check (matches_played >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.match_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'open' check (status in ('open','matched','cancelled','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);
create unique index match_requests_one_open_per_user on public.match_requests(user_id) where status = 'open';
create index match_requests_open_created on public.match_requests(created_at) where status = 'open';

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.match_requests(id),
  requester_id uuid not null references public.profiles(id),
  player_one_id uuid not null references public.profiles(id),
  player_two_id uuid not null references public.profiles(id),
  room_code text check (room_code is null or room_code ~ '^[A-Za-z0-9-]{4,24}$'),
  status text not null default 'matched' check (status in ('matched','room_ready','in_progress','awaiting_results','completed','disputed','cancelled')),
  player_one_submitted_for_one smallint check (player_one_submitted_for_one between 0 and 99),
  player_one_submitted_for_two smallint check (player_one_submitted_for_two between 0 and 99),
  player_two_submitted_for_two smallint check (player_two_submitted_for_two between 0 and 99),
  player_two_submitted_for_one smallint check (player_two_submitted_for_one between 0 and 99),
  player_one_score smallint check (player_one_score between 0 and 99),
  player_two_score smallint check (player_two_score between 0 and 99),
  winner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint matches_distinct_players check (player_one_id <> player_two_id),
  constraint matches_requester_is_player check (requester_id = player_one_id)
);
create index matches_player_one_created on public.matches(player_one_id, created_at desc);
create index matches_player_two_created on public.matches(player_two_id, created_at desc);

create table public.match_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index match_messages_match_created on public.match_messages(match_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('match_joined','room_code_shared','result_submitted','match_completed','match_disputed')),
  match_id uuid references public.matches(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 240),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_created on public.notifications(user_id, created_at desc);

create function private.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger requests_updated_at before update on public.match_requests for each row execute function private.set_updated_at();
create trigger matches_updated_at before update on public.matches for each row execute function private.set_updated_at();

create function private.create_profile_for_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare base_name text; chosen_name text;
begin
  base_name := lower(regexp_replace(coalesce(split_part(new.email, '@', 1), 'player'), '[^a-zA-Z0-9_]', '', 'g'));
  if char_length(base_name) < 3 then base_name := 'player'; end if;
  base_name := left(base_name, 17);
  chosen_name := base_name || '_' || left(replace(new.id::text, '-', ''), 6);
  insert into public.profiles(id, username, display_name) values (new.id, chosen_name, left(base_name, 40));
  return new;
end; $$;
create trigger on_auth_user_created_profile after insert on auth.users for each row execute function private.create_profile_for_user();

alter table public.profiles enable row level security;
alter table public.match_requests enable row level security;
alter table public.matches enable row level security;
alter table public.match_messages enable row level security;
alter table public.notifications enable row level security;

grant select on public.profiles to anon, authenticated;
grant update (username, display_name, country, avatar_url) on public.profiles to authenticated;
grant select on public.match_requests to authenticated;
grant select on public.matches to authenticated;
grant select on public.match_messages to authenticated;
grant insert (match_id, body) on public.match_messages to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "Public player cards" on public.profiles for select to anon, authenticated using (true);
create policy "Players update their editable profile" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Authenticated players see open requests" on public.match_requests for select to authenticated
  using (status = 'open' or user_id = (select auth.uid()));
create policy "Participants read private matches" on public.matches for select to authenticated
  using ((select auth.uid()) in (player_one_id, player_two_id));
create policy "Participants read private chat" on public.match_messages for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and (select auth.uid()) in (m.player_one_id, m.player_two_id)));
create policy "Participants send private chat" on public.match_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and exists (select 1 from public.matches m where m.id = match_id and (select auth.uid()) in (m.player_one_id, m.player_two_id)));
create policy "Players read own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "Players mark own notifications read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Privileged helpers are kept in a non-exposed schema. Every helper binds work to auth.uid().
create function private.create_match_request() returns uuid language plpgsql security definer set search_path = '' as $$
declare created_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to request a match.'; end if;
  update public.match_requests set status = 'expired' where user_id = auth.uid() and status = 'open' and expires_at <= now();
  insert into public.match_requests(user_id) values (auth.uid()) returning id into created_id;
  return created_id;
end; $$;
create function public.create_match_request() returns uuid language sql security invoker set search_path = '' as $$ select private.create_match_request(); $$;

create function private.cancel_match_request(p_request_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to cancel a request.'; end if;
  update public.match_requests set status = 'cancelled' where id = p_request_id and user_id = auth.uid() and status = 'open';
  if not found then raise exception 'This open request is no longer available.'; end if;
end; $$;
create function public.cancel_match_request(p_request_id uuid) returns void language sql security invoker set search_path = '' as $$ select private.cancel_match_request(p_request_id); $$;

create function private.join_match_request(p_request_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare claimed public.match_requests; match_uuid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to join a match.'; end if;
  update public.match_requests set status = 'matched' where id = p_request_id and status = 'open' and user_id <> auth.uid() and expires_at > now() returning * into claimed;
  if claimed.id is null then raise exception 'This request was just claimed or is no longer available.'; end if;
  insert into public.matches(request_id, requester_id, player_one_id, player_two_id)
    values (claimed.id, claimed.user_id, claimed.user_id, auth.uid()) returning id into match_uuid;
  insert into public.notifications(user_id, kind, match_id, message) values
    (claimed.user_id, 'match_joined', match_uuid, 'A player joined your match request.'),
    (auth.uid(), 'match_joined', match_uuid, 'You joined a match. Your private room is ready.');
  return match_uuid;
end; $$;
create function public.join_match_request(p_request_id uuid) returns uuid language sql security invoker set search_path = '' as $$ select private.join_match_request(p_request_id); $$;

create function private.share_match_room_code(p_match_id uuid, p_room_code text) returns void language plpgsql security definer set search_path = '' as $$
declare target public.matches;
begin
  if auth.uid() is null then raise exception 'Sign in to share a room code.'; end if;
  if p_room_code !~ '^[A-Za-z0-9-]{4,24}$' then raise exception 'Enter a valid room code.'; end if;
  select * into target from public.matches where id = p_match_id for update;
  if target.id is null or target.requester_id <> auth.uid() then raise exception 'Only the requester can share the room code.'; end if;
  if target.status not in ('matched','room_ready','in_progress') or target.room_code is not null then raise exception 'This match cannot accept a room code.'; end if;
  update public.matches set room_code = p_room_code, status = 'room_ready' where id = p_match_id;
  insert into public.notifications(user_id, kind, match_id, message) values (target.player_two_id, 'room_code_shared', p_match_id, 'Your opponent shared the eFootball room code.');
end; $$;
create function public.share_match_room_code(p_match_id uuid, p_room_code text) returns void language sql security invoker set search_path = '' as $$ select private.share_match_room_code(p_match_id, p_room_code); $$;

create function private.submit_match_result(p_match_id uuid, p_own_score smallint, p_opponent_score smallint) returns text language plpgsql security definer set search_path = '' as $$
declare target public.matches; p1_score smallint; p2_score smallint; winner uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to submit a result.'; end if;
  if p_own_score is null or p_opponent_score is null or p_own_score < 0 or p_own_score > 99 or p_opponent_score < 0 or p_opponent_score > 99 then raise exception 'Scores must be between 0 and 99.'; end if;
  select * into target from public.matches where id = p_match_id for update;
  if target.id is null or auth.uid() not in (target.player_one_id, target.player_two_id) then raise exception 'This private match is unavailable.'; end if;
  if target.status not in ('room_ready','in_progress','awaiting_results') then raise exception 'This match is not accepting results.'; end if;
  if target.room_code is null then raise exception 'Play the match before submitting a result.'; end if;
  if auth.uid() = target.player_one_id then
    if target.player_one_submitted_for_one is not null then raise exception 'You have already submitted your result.'; end if;
    update public.matches set player_one_submitted_for_one = p_own_score, player_one_submitted_for_two = p_opponent_score, status = 'awaiting_results' where id = p_match_id;
    if target.player_two_submitted_for_two is null then
      insert into public.notifications(user_id, kind, match_id, message) values (target.player_two_id, 'result_submitted', p_match_id, 'Your opponent submitted a result.');
      return 'awaiting_results';
    end if;
    p1_score := p_own_score; p2_score := p_opponent_score;
    if p1_score <> target.player_two_submitted_for_one or p2_score <> target.player_two_submitted_for_two then
      update public.matches set status = 'disputed' where id = p_match_id;
      insert into public.notifications(user_id, kind, match_id, message) values (target.player_one_id,'match_disputed',p_match_id,'Submitted results differ; this match needs review.'),(target.player_two_id,'match_disputed',p_match_id,'Submitted results differ; this match needs review.');
      return 'disputed';
    end if;
  else
    if target.player_two_submitted_for_two is not null then raise exception 'You have already submitted your result.'; end if;
    update public.matches set player_two_submitted_for_two = p_own_score, player_two_submitted_for_one = p_opponent_score, status = 'awaiting_results' where id = p_match_id;
    if target.player_one_submitted_for_one is null then
      insert into public.notifications(user_id, kind, match_id, message) values (target.player_one_id, 'result_submitted', p_match_id, 'Your opponent submitted a result.');
      return 'awaiting_results';
    end if;
    p1_score := target.player_one_submitted_for_one; p2_score := target.player_one_submitted_for_two;
    if p1_score <> p_opponent_score or p2_score <> p_own_score then
      update public.matches set status = 'disputed' where id = p_match_id;
      insert into public.notifications(user_id, kind, match_id, message) values (target.player_one_id,'match_disputed',p_match_id,'Submitted results differ; this match needs review.'),(target.player_two_id,'match_disputed',p_match_id,'Submitted results differ; this match needs review.');
      return 'disputed';
    end if;
  end if;
  if p1_score > p2_score then winner := target.player_one_id; elsif p2_score > p1_score then winner := target.player_two_id; end if;
  update public.matches set status = 'completed', player_one_score = p1_score, player_two_score = p2_score, winner_id = winner, completed_at = now() where id = p_match_id;
  if winner is null then
    update public.profiles set draws = draws + 1, matches_played = matches_played + 1 where id in (target.player_one_id, target.player_two_id);
  else
    update public.profiles set wins = wins + 1, matches_played = matches_played + 1, rating = rating + 16 where id = winner;
    update public.profiles set losses = losses + 1, matches_played = matches_played + 1, rating = greatest(0, rating - 16) where id = case when winner = target.player_one_id then target.player_two_id else target.player_one_id end;
  end if;
  insert into public.notifications(user_id, kind, match_id, message) values (target.player_one_id,'match_completed',p_match_id,'Both players agreed on the result.'),(target.player_two_id,'match_completed',p_match_id,'Both players agreed on the result.');
  return 'completed';
end; $$;
create function public.submit_match_result(p_match_id uuid, p_own_score smallint, p_opponent_score smallint) returns text language sql security invoker set search_path = '' as $$ select private.submit_match_result(p_match_id, p_own_score, p_opponent_score); $$;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.create_match_request() from public, anon;
revoke all on function public.cancel_match_request(uuid) from public, anon;
revoke all on function public.join_match_request(uuid) from public, anon;
revoke all on function public.share_match_room_code(uuid,text) from public, anon;
revoke all on function public.submit_match_result(uuid,smallint,smallint) from public, anon;
grant execute on function private.create_match_request() to authenticated;
grant execute on function private.cancel_match_request(uuid) to authenticated;
grant execute on function private.join_match_request(uuid) to authenticated;
grant execute on function private.share_match_room_code(uuid,text) to authenticated;
grant execute on function private.submit_match_result(uuid,smallint,smallint) to authenticated;
grant execute on function public.create_match_request() to authenticated;
grant execute on function public.cancel_match_request(uuid) to authenticated;
grant execute on function public.join_match_request(uuid) to authenticated;
grant execute on function public.share_match_room_code(uuid,text) to authenticated;
grant execute on function public.submit_match_result(uuid,smallint,smallint) to authenticated;

-- Explicit grants are needed for projects where new public tables are not auto exposed through Data API.
grant select on public.profiles to anon, authenticated;
grant select on public.match_requests, public.matches, public.match_messages, public.notifications to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.match_requests;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.matches;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.match_messages;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null; end $$;
