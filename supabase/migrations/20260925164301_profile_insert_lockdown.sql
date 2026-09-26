-- New profile rows are created by the existing auth.users trigger as its owner.
-- Do not let browser clients insert their own competitive counters.
drop policy if exists "Users can create their own profile" on public.profiles;
revoke insert on public.profiles from authenticated;
