-- Run after applying 20261025121000_match_evidence_elo.sql to a local Supabase DB.
begin;
do $$
begin
  if private.elo_delta(1000,1000,1) <> 16 then raise exception 'Equal-rating win delta should be +16'; end if;
  if private.elo_delta(1000,1000,0) <> -16 then raise exception 'Equal-rating loss delta should be -16'; end if;
  if private.elo_delta(1000,1000,0.5) <> 0 then raise exception 'Equal-rating draw delta should be 0'; end if;
  if greatest(1000,1000 + private.elo_delta(1000,1000,0)) <> 1000 then raise exception 'Rating floor should be 1000'; end if;
  if private.elo_delta(1200,1000,1) <> 8 then raise exception 'Expected higher-rated win delta should be +8'; end if;
end;
$$;
rollback;
