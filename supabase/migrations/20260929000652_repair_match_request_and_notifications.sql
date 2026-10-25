-- Repository copy of the repair already present in the connected project at
-- migration version 20260929000652. Verified against the live table columns,
-- function signatures, RLS policies, and Realtime publication.
alter table public.matches
  add column if not exists request_id uuid references public.match_requests(id) on delete set null,
  add column if not exists room_code text,
  add column if not exists player1_submitted_for integer,
  add column if not exists player1_submitted_against integer,
  add column if not exists player2_submitted_for integer,
  add column if not exists player2_submitted_against integer;
alter table public.matches alter column player1_score drop not null;
alter table public.matches alter column player2_score drop not null;
alter table public.chat_messages
  add column if not exists match_id uuid references public.matches(id) on delete cascade;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  message text not null,
  match_id uuid references public.matches(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, update (read_at) on public.notifications to authenticated;
drop policy if exists "Players read own notifications" on public.notifications;
drop policy if exists "Players mark own notifications read" on public.notifications;
create policy "Players read own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Players mark own notifications read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.match_requests enable row level security;
alter table public.matches enable row level security;
alter table public.chat_messages enable row level security;
revoke update, delete on public.match_requests from anon, authenticated;
revoke insert, update, delete on public.matches from anon, authenticated;
revoke update, delete on public.chat_messages from anon, authenticated;
revoke insert, update, delete on public.notifications from anon, authenticated;
grant select, insert on public.match_requests to authenticated;
grant select on public.matches to authenticated;
grant select, insert on public.chat_messages to authenticated;
create index if not exists chat_messages_match_created_idx
  on public.chat_messages (match_id, created_at);

drop policy if exists "Players can create their own requests" on public.match_requests;
drop policy if exists "Players can view open or related requests" on public.match_requests;
drop policy if exists "Players can view their matches" on public.matches;
drop policy if exists "Match participants can read private chat" on public.chat_messages;
drop policy if exists "Match participants can send private chat" on public.chat_messages;
drop policy if exists "Players read own notifications" on public.notifications;
drop policy if exists "Players mark own notifications read" on public.notifications;
create policy "Players can create their own requests" on public.match_requests
  for insert to authenticated with check (player_id=(select auth.uid()) and status='open' and accepted_by is null);
create policy "Players can view open or related requests" on public.match_requests
  for select to authenticated using (status='open' or player_id=(select auth.uid()) or accepted_by=(select auth.uid()));
create policy "Players can view their matches" on public.matches
  for select to authenticated using (status='completed' or player1_id=(select auth.uid()) or player2_id=(select auth.uid()));
create policy "Match participants can read private chat" on public.chat_messages
  for select to authenticated using (exists (select 1 from public.matches m where m.id=match_id and (m.player1_id=(select auth.uid()) or m.player2_id=(select auth.uid()))));
create policy "Match participants can send private chat" on public.chat_messages
  for insert to authenticated with check (
    sender_id=(select auth.uid()) and char_length(btrim(message)) between 1 and 1000
    and exists (select 1 from public.matches m where m.id=match_id and (m.player1_id=(select auth.uid()) or m.player2_id=(select auth.uid())))
  );
create policy "Players read own notifications" on public.notifications
  for select to authenticated using (user_id=(select auth.uid()));
create policy "Players mark own notifications read" on public.notifications
  for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create or replace function private.join_match_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target public.match_requests; match_uuid uuid; accepter uuid := auth.uid();
begin
  if accepter is null then raise exception using errcode='P0001', message='Sign in to join a match.'; end if;
  select * into target from public.match_requests where id=p_request_id for update;
  if not found or target.status <> 'open' or target.accepted_by is not null then raise exception using errcode='P0001', message='Request is no longer available.'; end if;
  if target.player_id=accepter then raise exception using errcode='P0001', message='You cannot accept your own request.'; end if;
  update public.match_requests set status='accepted', accepted_by=accepter where id=p_request_id and status='open' and accepted_by is null;
  if not found then raise exception using errcode='P0001', message='Request is no longer available.'; end if;
  insert into public.matches(request_id,player1_id,player2_id,status) values(target.id,target.player_id,accepter,'active') returning id into match_uuid;
  insert into public.notifications(user_id,kind,match_id,message) values
    (target.player_id,'match_joined',match_uuid,'A player joined your match request. Your private room is ready.'),
    (accepter,'match_joined',match_uuid,'You joined a match. Your private room is ready.');
  return match_uuid;
end; $$;
create or replace function public.join_match_request(p_request_id uuid)
returns uuid language sql set search_path = '' as $$ select private.join_match_request(p_request_id); $$;

create or replace function private.cancel_match_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using errcode='P0001', message='Sign in to cancel a request.'; end if;
  update public.match_requests set status='cancelled' where id=p_request_id and player_id=auth.uid() and status='open';
  if not found then raise exception using errcode='P0001', message='This open request is no longer available.'; end if;
end; $$;
create or replace function public.cancel_match_request(p_request_id uuid)
returns void language sql set search_path = '' as $$ select private.cancel_match_request(p_request_id); $$;

create or replace function private.share_match_room_code(p_match_id uuid,p_room_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.matches;
begin
  if auth.uid() is null then raise exception using errcode='P0001', message='Sign in to share a room code.'; end if;
  if p_room_code is null or p_room_code !~ '^[A-Za-z0-9-]{4,24}$' then raise exception using errcode='P0001', message='Enter a valid room code.'; end if;
  select * into target from public.matches where id=p_match_id for update;
  if target.id is null or target.player1_id <> auth.uid() then raise exception using errcode='P0001', message='Only the requester can share the room code.'; end if;
  if target.status <> 'active' or target.room_code is not null then raise exception using errcode='P0001', message='This match cannot accept a room code.'; end if;
  update public.matches set room_code=p_room_code where id=p_match_id;
  insert into public.notifications(user_id,kind,match_id,message) values(target.player2_id,'room_code_shared',p_match_id,'Your opponent shared the eFootball room code.');
end; $$;
create or replace function public.share_match_room_code(p_match_id uuid,p_room_code text)
returns void language sql set search_path = '' as $$ select private.share_match_room_code(p_match_id,p_room_code); $$;

create or replace function private.submit_match_result(p_match_id uuid,p_own_score integer,p_opponent_score integer)
returns text language plpgsql security definer set search_path = '' as $$
declare played public.matches; current_user_id uuid := auth.uid(); result_status text;
begin
  if current_user_id is null then raise exception using errcode='P0001', message='Sign in to submit a result.'; end if;
  if p_own_score is null or p_opponent_score is null or p_own_score not between 0 and 99 or p_opponent_score not between 0 and 99 then raise exception using errcode='P0001', message='Enter scores between 0 and 99.'; end if;
  select * into played from public.matches where id=p_match_id for update;
  if played.id is null or played.status not in ('active','awaiting_results') then raise exception using errcode='P0001', message='This match is not accepting results.'; end if;
  if played.room_code is null then raise exception using errcode='P0001', message='Wait for the room code before submitting a result.'; end if;
  if current_user_id=played.player1_id then
    if played.player1_submitted_for is not null then raise exception using errcode='P0001', message='You already submitted your result.'; end if;
    update public.matches set player1_submitted_for=p_own_score,player1_submitted_against=p_opponent_score,status='awaiting_results' where id=p_match_id;
  elsif current_user_id=played.player2_id then
    if played.player2_submitted_for is not null then raise exception using errcode='P0001', message='You already submitted your result.'; end if;
    update public.matches set player2_submitted_for=p_own_score,player2_submitted_against=p_opponent_score,status='awaiting_results' where id=p_match_id;
  else raise exception using errcode='P0001', message='Only players in this match can submit a result.';
  end if;
  select * into played from public.matches where id=p_match_id;
  if played.player1_submitted_for is not null and played.player2_submitted_for is not null then
    if played.player1_submitted_for=played.player2_submitted_against and played.player1_submitted_against=played.player2_submitted_for then
      update public.matches set player1_score=played.player1_submitted_for,player2_score=played.player1_submitted_against,
        winner_id=case when played.player1_submitted_for>played.player1_submitted_against then played.player1_id when played.player2_submitted_for>played.player2_submitted_against then played.player2_id else null end,
        status='completed',completed_at=now() where id=p_match_id;
      result_status:='completed';
      insert into public.notifications(user_id,kind,match_id,message) values
        (played.player1_id,'match_completed',p_match_id,'Both result reports matched. The match is complete.'),
        (played.player2_id,'match_completed',p_match_id,'Both result reports matched. The match is complete.');
    else
      update public.matches set status='disputed' where id=p_match_id; result_status:='disputed';
      insert into public.notifications(user_id,kind,match_id,message) values(case when current_user_id=played.player1_id then played.player2_id else played.player1_id end,'result_submitted',p_match_id,'Your opponent submitted a result. The reports do not match yet.');
    end if;
  else
    result_status:='awaiting_results';
    insert into public.notifications(user_id,kind,match_id,message) values(case when current_user_id=played.player1_id then played.player2_id else played.player1_id end,'result_submitted',p_match_id,'Your opponent submitted a match result.');
  end if;
  return result_status;
end; $$;
create or replace function public.submit_match_result(p_match_id uuid,p_own_score integer,p_opponent_score integer)
returns text language sql set search_path = '' as $$ select private.submit_match_result(p_match_id,p_own_score,p_opponent_score); $$;

revoke all on function private.join_match_request(uuid),private.cancel_match_request(uuid),private.share_match_room_code(uuid,text),private.submit_match_result(uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.join_match_request(uuid),public.cancel_match_request(uuid),public.share_match_room_code(uuid,text),public.submit_match_result(uuid,integer,integer) from public,anon;
grant execute on function private.join_match_request(uuid),private.cancel_match_request(uuid),private.share_match_room_code(uuid,text),private.submit_match_result(uuid,integer,integer) to authenticated;
grant execute on function public.join_match_request(uuid),public.cancel_match_request(uuid),public.share_match_room_code(uuid,text),public.submit_match_result(uuid,integer,integer) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then alter publication supabase_realtime add table public.notifications; end if;
  end if;
end $$;
