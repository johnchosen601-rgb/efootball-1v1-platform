-- End tournaments through the existing organizer_id ownership relationship.
-- Match result actions lock the tournament row before the match row so an end
-- action cannot race a pending result submission or bracket advancement.

create or replace function private.end_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.tournaments;
begin
  if auth.uid() is null then
    raise exception 'Sign in to end this tournament.';
  end if;

  select * into target
  from public.tournaments
  where id = p_tournament_id
  for update;

  if target.id is null or target.organizer_id is distinct from auth.uid() then
    raise exception 'Only this tournament’s organizer can end it.';
  end if;
  if target.status not in ('registration', 'in_progress') then
    raise exception 'Only an active tournament can be ended.';
  end if;

  update public.tournaments
  set status = 'completed', registration_open = false,
      completed_at = coalesce(completed_at, now())
  where id = p_tournament_id;
end;
$$;

create or replace function private.complete_tournament_match(p_match_id uuid, p_score1 integer, p_score2 integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  played public.tournament_matches;
  tournament_row public.tournaments;
  target_tournament_id uuid;
  next_match_number integer;
  next_slot text;
begin
  if p_score1 is null or p_score2 is null or p_score1 < 0 or p_score2 < 0 or p_score1 > 99 or p_score2 > 99 then
    raise exception 'Scores must be between 0 and 99.';
  end if;
  if p_score1 = p_score2 then
    raise exception 'Knockout matches need a winner. Include the extra-time or penalty result.';
  end if;

  select tournament_id into target_tournament_id
  from public.tournament_matches
  where id = p_match_id;
  if target_tournament_id is null then
    raise exception 'Tournament match not found.';
  end if;
  select * into tournament_row
  from public.tournaments
  where id = target_tournament_id
  for update;
  if tournament_row.id is null or tournament_row.status <> 'in_progress' then
    raise exception 'This tournament is no longer accepting match results.';
  end if;

  select * into played
  from public.tournament_matches
  where id = p_match_id
  for update;
  if played.id is null then raise exception 'Tournament match not found.'; end if;
  if played.status = 'completed' then raise exception 'This tournament match is already complete.'; end if;

  update public.tournament_matches
  set player1_score = p_score1, player2_score = p_score2,
      winner_id = case when p_score1 > p_score2 then played.player1_id else played.player2_id end,
      status = 'completed', completed_at = now()
  where id = p_match_id;

  if played.round_number = (
    select max(round_number) from public.tournament_matches where tournament_id = played.tournament_id
  ) then
    update public.tournaments
    set status = 'completed', registration_open = false,
        winner_id = case when p_score1 > p_score2 then played.player1_id else played.player2_id end,
        completed_at = now()
    where id = played.tournament_id;
  else
    next_match_number := (played.match_number + 1) / 2;
    next_slot := case when played.match_number % 2 = 1 then 'player1_id' else 'player2_id' end;
    if next_slot = 'player1_id' then
      update public.tournament_matches
      set player1_id = case when p_score1 > p_score2 then played.player1_id else played.player2_id end
      where tournament_id = played.tournament_id and round_number = played.round_number + 1 and match_number = next_match_number;
    else
      update public.tournament_matches
      set player2_id = case when p_score1 > p_score2 then played.player1_id else played.player2_id end
      where tournament_id = played.tournament_id and round_number = played.round_number + 1 and match_number = next_match_number;
    end if;
  end if;
end;
$$;

create or replace function private.submit_tournament_result(p_match_id uuid, p_own_score integer, p_opponent_score integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  played public.tournament_matches;
  target_tournament_id uuid;
  tournament_status text;
  user_id uuid := auth.uid();
begin
  if user_id is null then raise exception 'Sign in to submit a tournament result.'; end if;
  if p_own_score is null or p_opponent_score is null or p_own_score < 0 or p_opponent_score < 0 or p_own_score > 99 or p_opponent_score > 99 then
    raise exception 'Scores must be between 0 and 99.';
  end if;
  if p_own_score = p_opponent_score then raise exception 'Knockout matches need a winner. Include the extra-time or penalty result.'; end if;

  select tournament_id into target_tournament_id
  from public.tournament_matches
  where id = p_match_id;
  if target_tournament_id is null then raise exception 'This tournament match is unavailable.'; end if;
  select status into tournament_status
  from public.tournaments
  where id = target_tournament_id
  for update;
  if tournament_status is distinct from 'in_progress' then
    raise exception 'This tournament is no longer accepting match results.';
  end if;

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
end;
$$;

create or replace function private.resolve_tournament_result(p_match_id uuid, p_score1 integer, p_score2 integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  played public.tournament_matches;
  target_tournament_id uuid;
  tournament_row public.tournaments;
begin
  if auth.uid() is null then raise exception 'Sign in to resolve this result.'; end if;
  select tournament_id into target_tournament_id
  from public.tournament_matches
  where id = p_match_id;
  if target_tournament_id is null then raise exception 'Only the organizer can resolve a match in this tournament.'; end if;

  select * into tournament_row
  from public.tournaments
  where id = target_tournament_id
  for update;
  if tournament_row.id is null or tournament_row.organizer_id is distinct from auth.uid() or tournament_row.status <> 'in_progress' then
    raise exception 'Only the organizer can resolve a match in an active tournament.';
  end if;

  select * into played from public.tournament_matches where id = p_match_id for update;
  if played.id is null then raise exception 'Only the organizer can resolve a match in this tournament.'; end if;
  if played.status not in ('disputed', 'awaiting_confirmation') then raise exception 'This match is not waiting for organizer review.'; end if;
  perform private.complete_tournament_match(p_match_id, p_score1, p_score2);
end;
$$;

create or replace function public.end_tournament(p_tournament_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.end_tournament(p_tournament_id); $$;

revoke all on function private.end_tournament(uuid) from public, anon, authenticated;
revoke all on function public.end_tournament(uuid) from public, anon;
grant execute on function private.end_tournament(uuid) to authenticated;
grant execute on function public.end_tournament(uuid) to authenticated;
