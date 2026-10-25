-- Match requests expire after five minutes. Expiry is enforced in the database
-- even when the requester is offline; the RPC/feed also materialize expired rows.
alter table public.match_requests
  add column if not exists expires_at timestamptz;

update public.match_requests
set expires_at = created_at + interval '5 minutes'
where expires_at is null;

alter table public.match_requests
  alter column expires_at set default (now() + interval '5 minutes'),
  alter column expires_at set not null;

create index if not exists match_requests_open_expiry_idx
  on public.match_requests (expires_at, created_at)
  where status = 'open';

create or replace function private.expire_match_requests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare expired_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'Sign in to refresh the live field.';
  end if;
  update public.match_requests
  set status = 'expired'
  where status = 'open' and expires_at <= clock_timestamp();
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

create or replace function public.expire_match_requests()
returns integer
language sql
set search_path = ''
as $$ select private.expire_match_requests(); $$;

revoke all on function private.expire_match_requests() from public, anon, authenticated;
revoke all on function public.expire_match_requests() from public, anon;
grant execute on function private.expire_match_requests() to authenticated;
grant execute on function public.expire_match_requests() to authenticated;

create or replace function private.join_match_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.match_requests;
  match_uuid uuid;
  accepter uuid := auth.uid();
begin
  if accepter is null then
    raise exception using errcode = 'P0001', message = 'Sign in to join a match.';
  end if;

  select * into target
  from public.match_requests
  where id = p_request_id
  for update;

  if not found or target.status <> 'open' or target.accepted_by is not null then
    raise exception using errcode = 'P0001', message = 'Request is no longer available.';
  end if;
  if target.expires_at <= clock_timestamp() then
    update public.match_requests set status = 'expired' where id = target.id;
    return null;
  end if;
  if target.player_id = accepter then
    raise exception using errcode = 'P0001', message = 'You cannot accept your own request.';
  end if;

  update public.match_requests
  set status = 'accepted', accepted_by = accepter
  where id = p_request_id and status = 'open' and accepted_by is null
    and expires_at > clock_timestamp();
  if not found then
    raise exception using errcode = 'P0001', message = 'Request is no longer available.';
  end if;

  insert into public.matches(request_id, player1_id, player2_id, status)
  values (target.id, target.player_id, accepter, 'active')
  returning id into match_uuid;

  insert into public.notifications(user_id, kind, match_id, message)
  values
    (target.player_id, 'match_joined', match_uuid, 'A player joined your match request. Your private room is ready.'),
    (accepter, 'match_joined', match_uuid, 'You joined a match. Your private room is ready.');

  return match_uuid;
end;
$$;

create or replace function public.join_match_request(p_request_id uuid)
returns uuid
language sql
set search_path = ''
as $$ select private.join_match_request(p_request_id); $$;

revoke all on function private.join_match_request(uuid) from public, anon, authenticated;
revoke all on function public.join_match_request(uuid) from public, anon;
grant execute on function private.join_match_request(uuid) to authenticated;
grant execute on function public.join_match_request(uuid) to authenticated;
