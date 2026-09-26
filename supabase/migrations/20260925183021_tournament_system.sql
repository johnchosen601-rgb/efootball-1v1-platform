-- Tournament system built alongside the deployed profile and legacy casual-match tables.
-- Mutations are exposed only through authenticated, ownership-checked RPCs.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 500),
  max_players integer not null check (max_players in (4, 8, 16, 32)),
  status text not null default 'registration' check (status in ('registration', 'in_progress', 'completed', 'cancelled')),
  registration_open boolean not null default true,
  starts_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  winner_id uuid references public.profiles(id) on delete set null
);

create table public.tournament_participants (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  seed integer not null check (seed > 0),
  joined_at timestamptz not null default now(),
  primary key (tournament_id, player_id),
  unique (tournament_id, seed)
);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  match_number integer not null check (match_number > 0),
  player1_id uuid references public.profiles(id) on delete set null,
  player2_id uuid references public.profiles(id) on delete set null,
  player1_submitted_for integer check (player1_submitted_for between 0 and 99),
  player1_submitted_against integer check (player1_submitted_against between 0 and 99),
  player2_submitted_for integer check (player2_submitted_for between 0 and 99),
  player2_submitted_against integer check (player2_submitted_against between 0 and 99),
  player1_score integer check (player1_score between 0 and 99),
  player2_score integer check (player2_score between 0 and 99),
  winner_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'awaiting_confirmation', 'disputed', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tournament_id, round_number, match_number),
  check (player1_id is null or player2_id is null or player1_id <> player2_id),
  check (winner_id is null or winner_id = player1_id or winner_id = player2_id)
);

create index tournaments_listing_idx on public.tournaments(status, starts_at, created_at desc);
create index tournament_participants_player_idx on public.tournament_participants(player_id, joined_at desc);
create index tournament_matches_bracket_idx on public.tournament_matches(tournament_id, round_number, match_number);
create index tournament_matches_player_idx on public.tournament_matches(player1_id, player2_id);

alter table public.tournaments enable row level security;
alter table public.tournament_participants enable row level security;
alter table public.tournament_matches enable row level security;

drop policy if exists "Authenticated players can view tournaments" on public.tournaments;
create policy "Authenticated players can view tournaments" on public.tournaments
  for select to authenticated using (true);
drop policy if exists "Authenticated players can view tournament participants" on public.tournament_participants;
create policy "Authenticated players can view tournament participants" on public.tournament_participants
  for select to authenticated using (true);
drop policy if exists "Authenticated players can view tournament brackets" on public.tournament_matches;
create policy "Authenticated players can view tournament brackets" on public.tournament_matches
  for select to authenticated using (true);

revoke all on public.tournaments, public.tournament_participants, public.tournament_matches from anon, authenticated;
grant select on public.tournaments, public.tournament_participants, public.tournament_matches to authenticated;

create or replace function private.create_tournament(
  p_title text, p_description text, p_max_players integer, p_starts_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare created_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to create a tournament.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 80 then raise exception 'Tournament title must be 3 to 80 characters.'; end if;
  if char_length(coalesce(p_description, '')) > 500 then raise exception 'Tournament description must be 500 characters or fewer.'; end if;
  if p_max_players not in (4, 8, 16, 32) then raise exception 'Choose a capacity of 4, 8, 16 or 32 players.'; end if;
  if p_starts_at is not null and p_starts_at < now() - interval '5 minutes' then raise exception 'Choose a future start time.'; end if;
  insert into public.tournaments(organizer_id, title, description, max_players, starts_at)
    values (auth.uid(), btrim(p_title), btrim(coalesce(p_description, '')), p_max_players, p_starts_at)
    returning id into created_id;
  insert into public.tournament_participants(tournament_id, player_id, seed)
    values (created_id, auth.uid(), 1);
  return created_id;
end; $$;

create or replace function private.join_tournament(p_tournament_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.tournaments; entrant_count integer;
begin
  if auth.uid() is null then raise exception 'Sign in to join a tournament.'; end if;
  select * into target from public.tournaments where id = p_tournament_id for update;
  if target.id is null then raise exception 'Tournament not found.'; end if;
  if target.status <> 'registration' or not target.registration_open then raise exception 'Registration is closed.'; end if;
  if exists(select 1 from public.tournament_participants where tournament_id = p_tournament_id and player_id = auth.uid()) then raise exception 'You have already joined this tournament.'; end if;
  select count(*) into entrant_count from public.tournament_participants where tournament_id = p_tournament_id;
  if entrant_count >= target.max_players then raise exception 'This tournament is full.'; end if;
  insert into public.tournament_participants(tournament_id, player_id, seed)
    values (p_tournament_id, auth.uid(), entrant_count + 1);
end; $$;

create or replace function private.update_tournament_settings(
  p_tournament_id uuid, p_title text, p_description text, p_max_players integer,
  p_starts_at timestamptz, p_registration_open boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare target public.tournaments; entrant_count integer;
begin
  if auth.uid() is null then raise exception 'Sign in to manage this tournament.'; end if;
  select * into target from public.tournaments where id = p_tournament_id for update;
  if target.id is null or target.organizer_id <> auth.uid() then raise exception 'Only the tournament organizer can change its settings.'; end if;
  if target.status <> 'registration' then raise exception 'Settings are locked after the tournament starts.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 80 then raise exception 'Tournament title must be 3 to 80 characters.'; end if;
  if char_length(coalesce(p_description, '')) > 500 then raise exception 'Tournament description must be 500 characters or fewer.'; end if;
  if p_max_players not in (4, 8, 16, 32) then raise exception 'Choose a capacity of 4, 8, 16 or 32 players.'; end if;
  if p_starts_at is not null and p_starts_at < now() - interval '5 minutes' then raise exception 'Choose a future start time.'; end if;
  select count(*) into entrant_count from public.tournament_participants where tournament_id = p_tournament_id;
  if entrant_count > p_max_players then raise exception 'Capacity cannot be lower than the number of registered players.'; end if;
  update public.tournaments set title = btrim(p_title), description = btrim(coalesce(p_description, '')),
    max_players = p_max_players, starts_at = p_starts_at, registration_open = p_registration_open
    where id = p_tournament_id;
end; $$;

create or replace function private.start_tournament(p_tournament_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.tournaments; entrant_count integer; round_count integer; round_idx integer; matches_this_round integer; match_idx integer;
begin
  if auth.uid() is null then raise exception 'Sign in to start a tournament.'; end if;
  select * into target from public.tournaments where id = p_tournament_id for update;
  if target.id is null or target.organizer_id <> auth.uid() then raise exception 'Only the tournament organizer can start it.'; end if;
  if target.status <> 'registration' then raise exception 'This tournament has already started or closed.'; end if;
  select count(*) into entrant_count from public.tournament_participants where tournament_id = p_tournament_id;
  if entrant_count <> target.max_players then raise exception 'The tournament can start when all player slots are filled.'; end if;
  round_count := 0;
  matches_this_round := target.max_players / 2;
  while matches_this_round >= 1 loop
    round_count := round_count + 1;
    matches_this_round := matches_this_round / 2;
  end loop;
  for round_idx in 1..round_count loop
    matches_this_round := target.max_players / (2 ^ round_idx);
    for match_idx in 1..matches_this_round loop
      if round_idx = 1 then
        insert into public.tournament_matches(tournament_id, round_number, match_number, player1_id, player2_id)
          select p_tournament_id, round_idx, match_idx,
            (select player_id from public.tournament_participants where tournament_id = p_tournament_id order by seed limit 1 offset ((match_idx - 1) * 2)),
            (select player_id from public.tournament_participants where tournament_id = p_tournament_id order by seed limit 1 offset (((match_idx - 1) * 2) + 1));
      else
        insert into public.tournament_matches(tournament_id, round_number, match_number)
          values (p_tournament_id, round_idx, match_idx);
      end if;
    end loop;
  end loop;
  update public.tournaments set status = 'in_progress', registration_open = false, started_at = now()
    where id = p_tournament_id;
end; $$;

create or replace function private.complete_tournament_match(p_match_id uuid, p_score1 integer, p_score2 integer)
returns void language plpgsql security definer set search_path = '' as $$
declare played public.tournament_matches; tournament_row public.tournaments; next_match_number integer; next_slot text; match_count integer;
begin
  if p_score1 is null or p_score2 is null or p_score1 < 0 or p_score2 < 0 or p_score1 > 99 or p_score2 > 99 then raise exception 'Scores must be between 0 and 99.'; end if;
  if p_score1 = p_score2 then raise exception 'Knockout matches need a winner. Include the extra-time or penalty result.'; end if;
  select * into played from public.tournament_matches where id = p_match_id for update;
  if played.id is null then raise exception 'Tournament match not found.'; end if;
  if played.status = 'completed' then raise exception 'This tournament match is already complete.'; end if;
  update public.tournament_matches set player1_score = p_score1, player2_score = p_score2,
    winner_id = case when p_score1 > p_score2 then played.player1_id else played.player2_id end,
    status = 'completed', completed_at = now() where id = p_match_id;
  select * into tournament_row from public.tournaments where id = played.tournament_id for update;
  select count(*) into match_count from public.tournament_matches where tournament_id = played.tournament_id and round_number = played.round_number;
  if played.round_number = (select max(round_number) from public.tournament_matches where tournament_id = played.tournament_id) then
    update public.tournaments set status = 'completed', winner_id = case when p_score1 > p_score2 then played.player1_id else played.player2_id end, completed_at = now()
      where id = played.tournament_id;
  else
    next_match_number := (played.match_number + 1) / 2;
    next_slot := case when played.match_number % 2 = 1 then 'player1_id' else 'player2_id' end;
    if next_slot = 'player1_id' then
      update public.tournament_matches set player1_id = case when p_score1 > p_score2 then played.player1_id else played.player2_id end
        where tournament_id = played.tournament_id and round_number = played.round_number + 1 and match_number = next_match_number;
    else
      update public.tournament_matches set player2_id = case when p_score1 > p_score2 then played.player1_id else played.player2_id end
        where tournament_id = played.tournament_id and round_number = played.round_number + 1 and match_number = next_match_number;
    end if;
  end if;
end; $$;

create or replace function private.submit_tournament_result(p_match_id uuid, p_own_score integer, p_opponent_score integer)
returns void language plpgsql security definer set search_path = '' as $$
declare played public.tournament_matches; user_id uuid := auth.uid();
begin
  if user_id is null then raise exception 'Sign in to submit a tournament result.'; end if;
  if p_own_score is null or p_opponent_score is null or p_own_score < 0 or p_opponent_score < 0 or p_own_score > 99 or p_opponent_score > 99 then raise exception 'Scores must be between 0 and 99.'; end if;
  if p_own_score = p_opponent_score then raise exception 'Knockout matches need a winner. Include the extra-time or penalty result.'; end if;
  select * into played from public.tournament_matches where id = p_match_id for update;
  if played.id is null or played.status = 'completed' then raise exception 'This tournament match is unavailable.'; end if;
  if played.player1_id is null or played.player2_id is null then raise exception 'This bracket match is waiting for its players.'; end if;
  if user_id = played.player1_id then
    if played.player1_submitted_for is not null then raise exception 'You already submitted this result.'; end if;
    update public.tournament_matches set player1_submitted_for = p_own_score, player1_submitted_against = p_opponent_score, status = 'awaiting_confirmation' where id = p_match_id;
  elsif user_id = played.player2_id then
    if played.player2_submitted_for is not null then raise exception 'You already submitted this result.'; end if;
    update public.tournament_matches set player2_submitted_for = p_own_score, player2_submitted_against = p_opponent_score, status = 'awaiting_confirmation' where id = p_match_id;
  else
    raise exception 'Only players in this tournament match can submit its result.';
  end if;
  select * into played from public.tournament_matches where id = p_match_id;
  if played.player1_submitted_for is not null and played.player2_submitted_for is not null then
    if played.player1_submitted_for = played.player2_submitted_against and played.player1_submitted_against = played.player2_submitted_for then
      perform private.complete_tournament_match(p_match_id, played.player1_submitted_for, played.player1_submitted_against);
    else
      update public.tournament_matches set status = 'disputed' where id = p_match_id;
    end if;
  end if;
end; $$;

create or replace function private.resolve_tournament_result(p_match_id uuid, p_score1 integer, p_score2 integer)
returns void language plpgsql security definer set search_path = '' as $$
declare played public.tournament_matches;
begin
  if auth.uid() is null then raise exception 'Sign in to resolve this result.'; end if;
  select tm.* into played from public.tournament_matches tm join public.tournaments t on t.id = tm.tournament_id
    where tm.id = p_match_id and t.organizer_id = auth.uid() and t.status = 'in_progress' for update of tm;
  if played.id is null then raise exception 'Only the organizer can resolve a match in this tournament.'; end if;
  if played.status not in ('disputed', 'awaiting_confirmation') then raise exception 'This match is not waiting for organizer review.'; end if;
  perform private.complete_tournament_match(p_match_id, p_score1, p_score2);
end; $$;

create or replace function public.create_tournament(p_title text, p_description text, p_max_players integer, p_starts_at timestamptz)
returns uuid language sql security invoker set search_path = '' as $$ select private.create_tournament(p_title, p_description, p_max_players, p_starts_at); $$;
create or replace function public.join_tournament(p_tournament_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.join_tournament(p_tournament_id); $$;
create or replace function public.update_tournament_settings(p_tournament_id uuid, p_title text, p_description text, p_max_players integer, p_starts_at timestamptz, p_registration_open boolean)
returns void language sql security invoker set search_path = '' as $$ select private.update_tournament_settings(p_tournament_id, p_title, p_description, p_max_players, p_starts_at, p_registration_open); $$;
create or replace function public.start_tournament(p_tournament_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.start_tournament(p_tournament_id); $$;
create or replace function public.submit_tournament_result(p_match_id uuid, p_own_score integer, p_opponent_score integer)
returns void language sql security invoker set search_path = '' as $$ select private.submit_tournament_result(p_match_id, p_own_score, p_opponent_score); $$;
create or replace function public.resolve_tournament_result(p_match_id uuid, p_score1 integer, p_score2 integer)
returns void language sql security invoker set search_path = '' as $$ select private.resolve_tournament_result(p_match_id, p_score1, p_score2); $$;

revoke all on function private.create_tournament(text,text,integer,timestamptz) from public, anon, authenticated;
revoke all on function private.join_tournament(uuid) from public, anon, authenticated;
revoke all on function private.update_tournament_settings(uuid,text,text,integer,timestamptz,boolean) from public, anon, authenticated;
revoke all on function private.start_tournament(uuid) from public, anon, authenticated;
revoke all on function private.complete_tournament_match(uuid,integer,integer) from public, anon, authenticated;
revoke all on function private.submit_tournament_result(uuid,integer,integer) from public, anon, authenticated;
revoke all on function private.resolve_tournament_result(uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.create_tournament(text,text,integer,timestamptz) from public, anon;
revoke all on function public.join_tournament(uuid) from public, anon;
revoke all on function public.update_tournament_settings(uuid,text,text,integer,timestamptz,boolean) from public, anon;
revoke all on function public.start_tournament(uuid) from public, anon;
revoke all on function public.submit_tournament_result(uuid,integer,integer) from public, anon;
revoke all on function public.resolve_tournament_result(uuid,integer,integer) from public, anon;
grant execute on function private.create_tournament(text,text,integer,timestamptz) to authenticated;
grant execute on function private.join_tournament(uuid) to authenticated;
grant execute on function private.update_tournament_settings(uuid,text,text,integer,timestamptz,boolean) to authenticated;
grant execute on function private.start_tournament(uuid) to authenticated;
grant execute on function private.submit_tournament_result(uuid,integer,integer) to authenticated;
grant execute on function private.resolve_tournament_result(uuid,integer,integer) to authenticated;
grant execute on function public.create_tournament(text,text,integer,timestamptz) to authenticated;
grant execute on function public.join_tournament(uuid) to authenticated;
grant execute on function public.update_tournament_settings(uuid,text,text,integer,timestamptz,boolean) to authenticated;
grant execute on function public.start_tournament(uuid) to authenticated;
grant execute on function public.submit_tournament_result(uuid,integer,integer) to authenticated;
grant execute on function public.resolve_tournament_result(uuid,integer,integer) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournaments') then alter publication supabase_realtime add table public.tournaments; end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournament_participants') then alter publication supabase_realtime add table public.tournament_participants; end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournament_matches') then alter publication supabase_realtime add table public.tournament_matches; end if;
  end if;
end $$;
