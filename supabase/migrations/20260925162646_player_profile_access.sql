-- The auth trigger remains attached to auth.users; browser roles do not need to
-- invoke its SECURITY DEFINER trigger function through the Data API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Combine the pre-existing participant read and profile-history read rules into
-- a single policy with equivalent participant access and completed results.
drop policy if exists "Players can view their matches" on public.matches;
drop policy if exists "Authenticated users can view completed matches" on public.matches;
create policy "Players can view their matches"
  on public.matches for select to authenticated
  using (status = 'completed' or (select auth.uid()) = player1_id or (select auth.uid()) = player2_id);
