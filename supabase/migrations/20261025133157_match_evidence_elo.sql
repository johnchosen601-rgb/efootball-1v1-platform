-- Private evidence and atomic rating/stat updates for mutually confirmed results.
alter table public.matches
  add column if not exists player1_evidence_path text,
  add column if not exists player2_evidence_path text;

alter table public.profiles
  add constraint profiles_rating_minimum check (rating >= 1000) not valid;
alter table public.profiles validate constraint profiles_rating_minimum;

-- Elo K=32; calculations use each player's ratings immediately before the
-- finalization transaction updates either one.
create or replace function private.elo_delta(p_rating integer, p_opponent_rating integer, p_actual numeric)
returns integer
language sql
immutable
set search_path = ''
as $$
  select round(32 * (p_actual - (1 / (1 + power(10::numeric, (p_opponent_rating-p_rating)::numeric / 400)))) )::integer
$$;
revoke all on function private.elo_delta(integer,integer,numeric) from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('match-evidence', 'match-evidence', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false, file_size_limit = 8388608,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Match participants can view result evidence" on storage.objects;
create policy "Match participants can view result evidence"
on storage.objects for select to authenticated
using (
  bucket_id = 'match-evidence'
  and exists (
    select 1 from public.matches m
    where m.id::text = split_part(name, '/', 1)
      and (m.player1_id = (select auth.uid()) or m.player2_id = (select auth.uid()))
  )
);

drop policy if exists "Players can upload their own match evidence" on storage.objects;
create policy "Players can upload their own match evidence"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'match-evidence'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and exists (
    select 1 from public.matches m
    where m.id::text = split_part(name, '/', 1)
      and (m.player1_id = (select auth.uid()) or m.player2_id = (select auth.uid()))
  )
);

drop policy if exists "Players can remove their unsubmitted match evidence" on storage.objects;
create policy "Players can remove their unsubmitted match evidence"
on storage.objects for delete to authenticated
using (
  bucket_id = 'match-evidence'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and not exists (
    select 1 from public.matches m
    where (m.player1_evidence_path = name or m.player2_evidence_path = name)
  )
);

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
  actual_one numeric;
  rating_one integer;
  rating_two integer;
  delta_one integer;
  delta_two integer;
begin
  if current_user_id is null then
    raise exception using errcode='P0001', message='Sign in to submit a result.';
  end if;
  if p_own_score is null or p_opponent_score is null
     or p_own_score not between 0 and 99 or p_opponent_score not between 0 and 99 then
    raise exception using errcode='P0001', message='Enter scores between 0 and 99.';
  end if;

  select * into played from public.matches where id=p_match_id for update;
  if played.id is null or played.status not in ('active','awaiting_results','disputed') then
    raise exception using errcode='P0001', message='This match is not accepting results.';
  end if;
  if played.room_code is null then
    raise exception using errcode='P0001', message='Wait for the room code before submitting a result.';
  end if;
  if p_evidence_path is not null then
    if p_evidence_path !~ ('^' || p_match_id::text || '/' || current_user_id::text || '/[^/]+$')
       or not exists (select 1 from storage.objects o where o.bucket_id='match-evidence' and o.name=p_evidence_path) then
      raise exception using errcode='P0001', message='The uploaded match screenshot is unavailable.';
    end if;
  end if;

  if current_user_id = played.player1_id then
    if played.player1_submitted_for is not null and played.status <> 'disputed' then
      raise exception using errcode='P0001', message='You already submitted your result.';
    end if;
    update public.matches set player1_submitted_for=p_own_score,
      player1_submitted_against=p_opponent_score,
      player1_evidence_path=coalesce(p_evidence_path, player1_evidence_path),
      status='awaiting_results' where id=p_match_id;
  elsif current_user_id = played.player2_id then
    if played.player2_submitted_for is not null and played.status <> 'disputed' then
      raise exception using errcode='P0001', message='You already submitted your result.';
    end if;
    update public.matches set player2_submitted_for=p_own_score,
      player2_submitted_against=p_opponent_score,
      player2_evidence_path=coalesce(p_evidence_path, player2_evidence_path),
      status='awaiting_results' where id=p_match_id;
  else
    raise exception using errcode='P0001', message='Only players in this match can submit a result.';
  end if;

  select * into played from public.matches where id=p_match_id;
  if played.player1_submitted_for is not null and played.player2_submitted_for is not null then
    if played.player1_submitted_for=played.player2_submitted_against
       and played.player1_submitted_against=played.player2_submitted_for then
      actual_one := case when played.player1_submitted_for > played.player1_submitted_against then 1
                         when played.player1_submitted_for < played.player1_submitted_against then 0 else 0.5 end;
      perform 1 from public.profiles
      where id in (played.player1_id, played.player2_id)
      order by id
      for update;
      select p1.rating, p2.rating into rating_one, rating_two
      from public.profiles p1 join public.profiles p2 on p2.id=played.player2_id
      where p1.id=played.player1_id;
      if rating_one is null or rating_two is null then
        raise exception using errcode='P0001', message='Player ratings are unavailable.';
      end if;
      delta_one := private.elo_delta(rating_one, rating_two, actual_one);
      delta_two := private.elo_delta(rating_two, rating_one, 1-actual_one);

      update public.profiles set rating=greatest(1000, rating + delta_one) where id=played.player1_id;
      update public.profiles set rating=greatest(1000, rating + delta_two) where id=played.player2_id;
      update public.matches
      set player1_score=played.player1_submitted_for,
          player2_score=played.player1_submitted_against,
          winner_id=case when actual_one=1 then played.player1_id when actual_one=0 then played.player2_id else null end,
          status='completed', completed_at=clock_timestamp()
      where id=p_match_id and status <> 'completed';
      if not found then raise exception using errcode='P0001', message='This match result was already finalized.'; end if;
      result_status := 'completed';
      insert into public.notifications(user_id,kind,match_id,message)
      values
        (played.player1_id,'match_completed',p_match_id,'Both result reports matched. The match is complete.'),
        (played.player2_id,'match_completed',p_match_id,'Both result reports matched. The match is complete.');
    else
      update public.matches set status='disputed' where id=p_match_id;
      result_status := 'disputed';
      insert into public.notifications(user_id,kind,match_id,message)
      values (case when current_user_id=played.player1_id then played.player2_id else played.player1_id end,
        'match_disputed',p_match_id,'The reported scores differ. Review the match and submit the correct score.');
    end if;
  else
    result_status := 'awaiting_results';
    insert into public.notifications(user_id,kind,match_id,message)
    values (case when current_user_id=played.player1_id then played.player2_id else played.player1_id end,
      'result_submitted',p_match_id,'Your opponent submitted a match result.');
  end if;
  return result_status;
end;
$$;

create or replace function public.submit_match_result(
  p_match_id uuid, p_own_score integer, p_opponent_score integer, p_evidence_path text
)
returns text
language sql
set search_path = ''
as $$ select private.submit_match_result(p_match_id,p_own_score,p_opponent_score,p_evidence_path); $$;

-- Disable the old three-argument route so all newly finalized results pass
-- through the one atomic Elo/evidence implementation.
revoke all on function private.submit_match_result(uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.submit_match_result(uuid,integer,integer) from public, anon, authenticated;
revoke all on function private.submit_match_result(uuid,integer,integer,text) from public, anon, authenticated;
revoke all on function public.submit_match_result(uuid,integer,integer,text) from public, anon;
grant execute on function private.submit_match_result(uuid,integer,integer,text) to authenticated;
grant execute on function public.submit_match_result(uuid,integer,integer,text) to authenticated;
