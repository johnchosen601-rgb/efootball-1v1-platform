-- Early termination preserves confirmed bracket results but never invents a
-- champion. A winner is retained only when a completed final actually exists.
create or replace function private.end_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.tournaments; final_winner uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to end this tournament.'; end if;
  select * into target from public.tournaments where id=p_tournament_id for update;
  if target.id is null or target.organizer_id is distinct from auth.uid() then
    raise exception 'Only this tournament’s organizer can end it.';
  end if;
  if target.status not in ('registration','in_progress') then
    raise exception 'Only an active tournament can be ended.';
  end if;

  select tm.winner_id into final_winner
  from public.tournament_matches tm
  where tm.tournament_id=p_tournament_id
    and tm.round_number=(select max(round_number) from public.tournament_matches where tournament_id=p_tournament_id)
    and tm.status='completed' and tm.winner_id is not null
  order by tm.match_number
  limit 1;

  update public.tournaments
  set status='completed', registration_open=false,
      winner_id=final_winner, completed_at=coalesce(completed_at,clock_timestamp())
  where id=p_tournament_id;
end;
$$;

create or replace function public.end_tournament(p_tournament_id uuid)
returns void
language sql
set search_path = ''
as $$ select private.end_tournament(p_tournament_id); $$;

revoke all on function private.end_tournament(uuid) from public,anon,authenticated;
revoke all on function public.end_tournament(uuid) from public,anon;
grant execute on function private.end_tournament(uuid) to authenticated;
grant execute on function public.end_tournament(uuid) to authenticated;
