-- Cover organizer, winner and player lookups on tournament foreign keys.
create index tournaments_organizer_idx on public.tournaments(organizer_id);
create index tournaments_winner_idx on public.tournaments(winner_id) where winner_id is not null;
create index tournament_matches_player2_idx on public.tournament_matches(player2_id) where player2_id is not null;
create index tournament_matches_winner_idx on public.tournament_matches(winner_id) where winner_id is not null;
