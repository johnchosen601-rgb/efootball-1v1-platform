# Match ratings and result evidence

Player ratings start at 1000. A result changes ratings only when both match participants submit inverse score reports that agree. The server locks the match row, reads and locks both profile rows in ID order, computes both Elo deltas from those pre-update ratings, applies the deltas with a floor of 1000, and marks the match complete in the same database transaction.

The expected score for player A is `1 / (1 + 10 ^ ((ratingB - ratingA) / 400))`. With K = 32, the delta is `round(32 * (actualScore - expectedScore))`, where a win is 1, a draw is 0.5 and a loss is 0. Disputed matches do not change ratings or verified match statistics. The completion status guard and row lock prevent a result from being finalized twice.

Screenshots are optional. Uploaded evidence is stored in the private `match-evidence` bucket under `<match-id>/<player-id>/<random-file-name>`. Storage policies and signed URL access are restricted to the two match participants. Evidence paths are stored with the corresponding score report.

The database migration in `supabase/migrations/20261025121000_match_evidence_elo.sql` contains the implementation. The SQL regression checks are in `supabase/tests/elo_rating.sql` and require a local Supabase database with that migration applied.
