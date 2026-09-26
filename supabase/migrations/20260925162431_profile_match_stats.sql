alter table public.profiles
  add column if not exists draws integer not null default 0;

revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_url, country, efootball_id, platform,
  favourite_club, playing_style, bio, last_seen_at) on public.profiles to authenticated;

create index if not exists matches_completed_player1_created_idx
  on public.matches (player1_id, created_at desc) where status = 'completed';
create index if not exists matches_completed_player2_created_idx
  on public.matches (player2_id, created_at desc) where status = 'completed';

create or replace function public.refresh_profile_match_stats(p_profile_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles p
  set wins = stats.wins, losses = stats.losses, draws = stats.draws
  from (
    select
      count(*) filter (where m.winner_id = p_profile_id)::integer as wins,
      count(*) filter (where m.winner_id is not null and m.winner_id <> p_profile_id)::integer as losses,
      count(*) filter (where m.winner_id is null)::integer as draws
    from public.matches m
    where m.status = 'completed'
      and (m.player1_id = p_profile_id or m.player2_id = p_profile_id)
  ) stats
  where p.id = p_profile_id
    and (p.wins, p.losses, p.draws) is distinct from (stats.wins, stats.losses, stats.draws);
$$;
revoke all on function public.refresh_profile_match_stats(uuid) from public, anon, authenticated;

create or replace function public.sync_match_profile_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.refresh_profile_match_stats(old.player1_id);
    perform public.refresh_profile_match_stats(old.player2_id);
  end if;
  if tg_op <> 'DELETE' then
    perform public.refresh_profile_match_stats(new.player1_id);
    perform public.refresh_profile_match_stats(new.player2_id);
    return new;
  end if;
  return old;
end;
$$;
revoke all on function public.sync_match_profile_stats() from public, anon, authenticated;

drop trigger if exists sync_match_profile_stats on public.matches;
create trigger sync_match_profile_stats
  after insert or update of status, winner_id, player1_id, player2_id or delete
  on public.matches
  for each row execute function public.sync_match_profile_stats();

-- Recompute counters from the deployed match rows once, and on every later
-- result change. Values shown in profiles are never editable by browser clients.
do $$
declare player record;
begin
  for player in select id from public.profiles loop
    perform public.refresh_profile_match_stats(player.id);
  end loop;
end $$;
