-- Organizer-only manual roster controls. The bracket reads this same participant table.
create or replace function private.add_tournament_player(p_tournament_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.tournaments; entrant_count integer;
begin
  if auth.uid() is null then raise exception 'Sign in to manage tournament players.'; end if;
  select * into target from public.tournaments where id = p_tournament_id for update;
  if target.id is null or target.organizer_id <> auth.uid() then raise exception 'Only the tournament organizer can add players.'; end if;
  if target.status <> 'registration' then raise exception 'Players can only be added before the tournament starts.'; end if;
  if p_player_id is null or not exists(select 1 from public.profiles where id = p_player_id) then raise exception 'Choose a registered player.'; end if;
  if exists(select 1 from public.tournament_participants where tournament_id = p_tournament_id and player_id = p_player_id) then
    raise exception 'This player is already registered.';
  end if;
  select count(*) into entrant_count from public.tournament_participants where tournament_id = p_tournament_id;
  if entrant_count >= target.max_players then raise exception 'This tournament is full.'; end if;
  insert into public.tournament_participants(tournament_id, player_id, seed)
    values (p_tournament_id, p_player_id, entrant_count + 1);
end; $$;

create or replace function private.remove_tournament_player(p_tournament_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.tournaments;
begin
  if auth.uid() is null then raise exception 'Sign in to manage tournament players.'; end if;
  select * into target from public.tournaments where id = p_tournament_id for update;
  if target.id is null or target.organizer_id <> auth.uid() then raise exception 'Only the tournament organizer can remove players.'; end if;
  if target.status <> 'registration' then raise exception 'Players can only be removed before the tournament starts.'; end if;
  if p_player_id = target.organizer_id then raise exception 'The organizer must remain registered.'; end if;
  delete from public.tournament_participants where tournament_id = p_tournament_id and player_id = p_player_id;
  if not found then raise exception 'This player is not registered in the tournament.'; end if;
  -- Compact seeds so the existing join flow can continue using count + 1 safely.
  update public.tournament_participants set seed = seed + 1000000 where tournament_id = p_tournament_id;
  with reseeded as (
    select player_id, row_number() over (order by joined_at, player_id)::integer as new_seed
    from public.tournament_participants where tournament_id = p_tournament_id
  )
  update public.tournament_participants participant set seed = reseeded.new_seed
    from reseeded where participant.tournament_id = p_tournament_id and participant.player_id = reseeded.player_id;
end; $$;

create or replace function public.add_tournament_player(p_tournament_id uuid, p_player_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.add_tournament_player(p_tournament_id, p_player_id); $$;
create or replace function public.remove_tournament_player(p_tournament_id uuid, p_player_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.remove_tournament_player(p_tournament_id, p_player_id); $$;

revoke all on function private.add_tournament_player(uuid,uuid) from public, anon, authenticated;
revoke all on function private.remove_tournament_player(uuid,uuid) from public, anon, authenticated;
revoke all on function public.add_tournament_player(uuid,uuid) from public, anon;
revoke all on function public.remove_tournament_player(uuid,uuid) from public, anon;
grant execute on function private.add_tournament_player(uuid,uuid) to authenticated;
grant execute on function private.remove_tournament_player(uuid,uuid) to authenticated;
grant execute on function public.add_tournament_player(uuid,uuid) to authenticated;
grant execute on function public.remove_tournament_player(uuid,uuid) to authenticated;
