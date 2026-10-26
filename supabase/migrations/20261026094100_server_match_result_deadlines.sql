-- Match lifecycle is server-owned. Sharing the room code starts a 30 minute
-- result window; a lone report with evidence gets an additional five minutes.
alter table public.matches
  add column if not exists result_deadline_at timestamptz,
  add column if not exists opponent_deadline_at timestamptz,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.matches'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.matches drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.matches add constraint matches_status_check
  check (status = any (array['pending','active','awaiting_results','disputed','completed','cancelled','voided']::text[]));

create index if not exists matches_result_deadlines_idx
  on public.matches (result_deadline_at, opponent_deadline_at)
  where status in ('active','awaiting_results');

-- Existing open rooms get a one-time 30 minute grace period after deploy.
update public.matches
set result_deadline_at = clock_timestamp() + interval '30 minutes'
where room_code is not null and status = 'active' and result_deadline_at is null;
update public.matches
set result_deadline_at = clock_timestamp() + interval '30 minutes',
    opponent_deadline_at = clock_timestamp() + interval '5 minutes'
where status = 'awaiting_results' and opponent_deadline_at is null
  and ((player1_submitted_for is null) <> (player2_submitted_for is null));

create or replace function private.set_match_result_deadline()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.room_code is null and new.room_code is not null and new.result_deadline_at is null then
    new.result_deadline_at := clock_timestamp() + interval '30 minutes';
  end if;
  return new;
end;
$$;
revoke all on function private.set_match_result_deadline() from public, anon, authenticated;
drop trigger if exists set_match_result_deadline on public.matches;
create trigger set_match_result_deadline
before update of room_code on public.matches
for each row execute function private.set_match_result_deadline();

create or replace function private.finalize_match_score(
  p_match_id uuid, p_player1_score integer, p_player2_score integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  played public.matches;
  rating_one integer;
  rating_two integer;
  actual_one numeric;
  delta_one integer;
  delta_two integer;
begin
  select * into played from public.matches where id = p_match_id for update;
  if played.id is null or played.status in ('completed','voided','cancelled') then return false; end if;
  if p_player1_score is null or p_player2_score is null
     or p_player1_score not between 0 and 99 or p_player2_score not between 0 and 99 then
    raise exception using errcode = '22023', message = 'Invalid final score.';
  end if;

  perform 1 from public.profiles
  where id in (played.player1_id, played.player2_id)
  order by id for update;
  select p1.rating, p2.rating into rating_one, rating_two
  from public.profiles p1 join public.profiles p2 on p2.id = played.player2_id
  where p1.id = played.player1_id;
  if rating_one is null or rating_two is null then
    raise exception using errcode = 'P0001', message = 'Player ratings are unavailable.';
  end if;

  actual_one := case when p_player1_score > p_player2_score then 1
                     when p_player1_score < p_player2_score then 0 else 0.5 end;
  delta_one := private.elo_delta(rating_one, rating_two, actual_one);
  delta_two := private.elo_delta(rating_two, rating_one, 1 - actual_one);

  update public.profiles set rating = greatest(1000, rating + delta_one) where id = played.player1_id;
  update public.profiles set rating = greatest(1000, rating + delta_two) where id = played.player2_id;
  update public.matches
  set player1_score = p_player1_score,
      player2_score = p_player2_score,
      winner_id = case when actual_one = 1 then played.player1_id
                       when actual_one = 0 then played.player2_id else null end,
      status = 'completed', completed_at = clock_timestamp(),
      opponent_deadline_at = null, void_reason = null
  where id = p_match_id and status not in ('completed','voided','cancelled');
  if not found then return false; end if;

  insert into public.notifications(user_id, kind, match_id, message)
  values
    (played.player1_id, 'match_completed', p_match_id, 'The match result is finalized.'),
    (played.player2_id, 'match_completed', p_match_id, 'The match result is finalized.');
  return true;
end;
$$;
revoke all on function private.finalize_match_score(uuid, integer, integer) from public, anon, authenticated;

create or replace function private.submit_match_result(
  p_match_id uuid, p_own_score integer, p_opponent_score integer, p_evidence_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  played public.matches;
  current_user_id uuid := auth.uid();
  result_status text;
  did_finalize boolean;
begin
  if not private.is_active_player() then
    raise exception using errcode = '42501', message = 'Sign in with an active player account to submit a result.';
  end if;
  if p_own_score is null or p_opponent_score is null
     or p_own_score not between 0 and 99 or p_opponent_score not between 0 and 99 then
    raise exception using errcode = '22023', message = 'Enter scores between 0 and 99.';
  end if;

  select * into played from public.matches where id = p_match_id for update;
  if played.id is null or played.status not in ('active','awaiting_results','disputed') then
    raise exception using errcode = 'P0001', message = 'This match is not accepting results.';
  end if;
  if played.room_code is null or played.result_deadline_at is null then
    raise exception using errcode = 'P0001', message = 'Wait for the room code before submitting a result.';
  end if;
  if played.status <> 'disputed' and clock_timestamp() > coalesce(played.opponent_deadline_at, played.result_deadline_at) then
    raise exception using errcode = 'P0001', message = 'The result submission window has closed.';
  end if;
  if p_evidence_path is not null and (
    p_evidence_path !~ ('^' || p_match_id::text || '/' || current_user_id::text || '/[^/]+$')
    or not exists (select 1 from storage.objects o where o.bucket_id = 'match-evidence' and o.name = p_evidence_path)
  ) then
    raise exception using errcode = 'P0001', message = 'The uploaded match screenshot is unavailable.';
  end if;

  if current_user_id = played.player1_id then
    if played.player1_submitted_for is not null and played.status <> 'disputed' then
      raise exception using errcode = 'P0001', message = 'You already submitted your result.';
    end if;
    update public.matches
    set player1_submitted_for = p_own_score,
        player1_submitted_against = p_opponent_score,
        player1_evidence_path = coalesce(p_evidence_path, player1_evidence_path),
        status = 'awaiting_results',
        opponent_deadline_at = coalesce(opponent_deadline_at, clock_timestamp() + interval '5 minutes')
    where id = p_match_id;
  elsif current_user_id = played.player2_id then
    if played.player2_submitted_for is not null and played.status <> 'disputed' then
      raise exception using errcode = 'P0001', message = 'You already submitted your result.';
    end if;
    update public.matches
    set player2_submitted_for = p_own_score,
        player2_submitted_against = p_opponent_score,
        player2_evidence_path = coalesce(p_evidence_path, player2_evidence_path),
        status = 'awaiting_results',
        opponent_deadline_at = coalesce(opponent_deadline_at, clock_timestamp() + interval '5 minutes')
    where id = p_match_id;
  else
    raise exception using errcode = '42501', message = 'Only match participants can submit a result.';
  end if;

  select * into played from public.matches where id = p_match_id;
  if played.player1_submitted_for is not null and played.player2_submitted_for is not null then
    if played.player1_submitted_for = played.player2_submitted_against
       and played.player1_submitted_against = played.player2_submitted_for then
      did_finalize := private.finalize_match_score(p_match_id, played.player1_submitted_for, played.player1_submitted_against);
      if not did_finalize then raise exception using errcode = 'P0001', message = 'This result was already finalized.'; end if;
      result_status := 'completed';
    else
      update public.matches set status = 'disputed' where id = p_match_id;
      insert into public.notifications(user_id, kind, match_id, message)
      values (case when current_user_id = played.player1_id then played.player2_id else played.player1_id end,
        'match_disputed', p_match_id, 'The reported scores differ. Review the result and submit the agreed score.');
      result_status := 'disputed';
    end if;
  else
    insert into public.notifications(user_id, kind, match_id, message)
    values (case when current_user_id = played.player1_id then played.player2_id else played.player1_id end,
      'result_submitted', p_match_id, 'Your opponent submitted a match result. You have five minutes to respond.');
    result_status := 'awaiting_results';
  end if;
  return result_status;
end;
$$;

create or replace function public.submit_match_result(
  p_match_id uuid, p_own_score integer, p_opponent_score integer, p_evidence_path text
)
returns text language sql set search_path = ''
as $$ select private.submit_match_result(p_match_id, p_own_score, p_opponent_score, p_evidence_path); $$;

revoke all on function private.submit_match_result(uuid, integer, integer, text) from public, anon, authenticated;
revoke all on function public.submit_match_result(uuid, integer, integer, text) from public, anon;
grant execute on function private.submit_match_result(uuid, integer, integer, text) to authenticated;
grant execute on function public.submit_match_result(uuid, integer, integer, text) to authenticated;

create or replace function private.process_match_result_deadlines()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  played public.matches;
  changed integer := 0;
  finalized boolean;
  score_one integer;
  score_two integer;
  evidence_path text;
begin
  for played in
    select * from public.matches
    where (status = 'active' and result_deadline_at <= clock_timestamp())
       or (status = 'awaiting_results' and opponent_deadline_at <= clock_timestamp())
    order by coalesce(opponent_deadline_at, result_deadline_at)
    for update skip locked
  loop
    if played.status = 'awaiting_results'
       and played.player1_submitted_for is not null
       and played.player2_submitted_for is null then
      score_one := played.player1_submitted_for;
      score_two := played.player1_submitted_against;
      evidence_path := played.player1_evidence_path;
    elsif played.status = 'awaiting_results'
       and played.player2_submitted_for is not null
       and played.player1_submitted_for is null then
      score_one := played.player2_submitted_against;
      score_two := played.player2_submitted_for;
      evidence_path := played.player2_evidence_path;
    else
      score_one := null;
      score_two := null;
      evidence_path := null;
    end if;

    if score_one is not null and evidence_path is not null
       and exists (select 1 from storage.objects o where o.bucket_id = 'match-evidence' and o.name = evidence_path) then
      finalized := private.finalize_match_score(played.id, score_one, score_two);
      if finalized then changed := changed + 1; end if;
    else
      update public.matches
      set status = 'voided', voided_at = clock_timestamp(),
          completed_at = null, winner_id = null, player1_score = null, player2_score = null,
          opponent_deadline_at = null,
          void_reason = case when played.status = 'active'
            then 'No result was submitted before the server deadline.'
            else 'A result was not confirmed and the required screenshot evidence was unavailable.' end
      where id = played.id and status in ('active','awaiting_results');
      if found then
        changed := changed + 1;
        insert into public.notifications(user_id, kind, match_id, message)
        values
          (played.player1_id, 'match_voided', played.id, 'The match was voided without changing ratings or player records.'),
          (played.player2_id, 'match_voided', played.id, 'The match was voided without changing ratings or player records.');
      end if;
    end if;
  end loop;
  return changed;
end;
$$;
revoke all on function private.process_match_result_deadlines() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
grant usage on schema private to postgres;
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'process-match-result-deadlines' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('process-match-result-deadlines', '* * * * *', 'select private.process_match_result_deadlines();');
end;
$$;
