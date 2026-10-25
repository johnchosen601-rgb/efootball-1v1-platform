# Gates: eFootball platform reliability pass

OWNS: src/**, supabase/migrations/**, docs/**

Scope: preserve the current platform while correcting auth recovery, 1v1 acceptance, tournament history, About navigation, and notifications.

- [ ] G1: the production bundle type-checks and builds
  CHECK: npm run build
  EXPECT: ✓ built in
  EVIDENCE: pending

- [ ] G2: the deployed match-request RPC uses the current schema and atomically limits acceptance to one player
  EVIDENCE: pending

- [ ] G3: password recovery and profile password change use Supabase Auth without exposing passwords
  EVIDENCE: pending

- [ ] G4: completed tournaments leave the active list and remain visible in match history with participants and results
  EVIDENCE: pending

- [ ] G5: About sections and the Coming Soon notification navigate correctly on desktop and mobile
  EVIDENCE: pending

- [ ] G6: two authenticated players complete acceptance and a third/concurrent accepter is rejected accurately
  EVIDENCE: pending

- [ ] G7: password-reset email delivery and password change are verified on localhost and the live production origin
  EVIDENCE: pending
