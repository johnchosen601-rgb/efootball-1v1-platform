-- Remove unnecessary SQL capabilities and protect active private-room rows.
revoke all on public.profiles, public.match_requests, public.matches,
  public.chat_messages, public.notifications, public.tournaments,
  public.tournament_participants, public.tournament_matches
from anon;

revoke truncate, references, trigger on public.profiles, public.match_requests,
  public.matches, public.chat_messages, public.notifications, public.tournaments,
  public.tournament_participants, public.tournament_matches
from authenticated;

revoke delete, insert, truncate, references, trigger on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, country, efootball_id, platform,
  favourite_club, playing_style, bio, avatar_url, last_seen_at)
on public.profiles to authenticated;

revoke update, delete, truncate, references, trigger on public.match_requests from authenticated;
grant select, insert on public.match_requests to authenticated;

revoke insert, update, delete, truncate, references, trigger on public.matches from authenticated;
grant select on public.matches to authenticated;

revoke update, delete, truncate, references, trigger on public.chat_messages from authenticated;
grant select, insert on public.chat_messages to authenticated;

revoke insert, delete, truncate, references, trigger on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant select, update (read_at) on public.notifications to authenticated;

revoke insert, update, delete, truncate, references, trigger on public.tournaments,
  public.tournament_participants, public.tournament_matches from authenticated;
grant select on public.tournaments, public.tournament_participants,
  public.tournament_matches to authenticated;

-- Active and completed private matches are visible as rows only to participants.
drop policy if exists "Players can view their matches" on public.matches;
drop policy if exists "Authenticated users can view completed matches" on public.matches;
create policy "Only match participants can view match rows"
on public.matches for select to authenticated
using ((select auth.uid()) = player1_id or (select auth.uid()) = player2_id);

-- Public profile cards may show confirmed results, but never expose room codes.
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
  if auth.uid() is null then raise exception using errcode='P0001', message='Sign in to view match history.'; end if;
  if p_profile_id is null then raise exception using errcode='22023', message='Player profile is required.'; end if;
  return query
  select m.id,m.player1_id,m.player2_id,m.player1_score,m.player2_score,m.winner_id,m.status,m.created_at
  from public.matches m
  where m.status='completed' and (m.player1_id=p_profile_id or m.player2_id=p_profile_id)
  order by m.created_at desc limit greatest(1,least(coalesce(p_limit,10),50));
end;
$$;
revoke all on function public.get_profile_match_history(uuid,integer) from public, anon;
grant execute on function public.get_profile_match_history(uuid,integer) to authenticated;
