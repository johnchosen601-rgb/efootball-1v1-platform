# eFootball 1v1

An independent eFootball player community for finding one on one matches. The platform includes Supabase authentication, player profiles, live match requests, private match rooms and chat, mutually confirmed results, player discovery and rankings, and knockout tournaments with organizer-managed rosters and bracket progression.

## Run locally

1. Install Node.js 20.19+ or 22.12+.
2. Run `npm install` and copy `.env.example` to `.env.local`.
3. Add your Supabase project URL and publishable key to `.env.local`.
4. This workspace currently targets an existing Supabase project whose initial schema was created outside the migration system. The additive request fix in `supabase/migrations/20260925150003_fix_match_request_feed.sql` has been applied there. The earlier schema draft is archived under `supabase/legacy/`; it describes a different table layout and must not be applied to this existing project.
5. Enable email authentication and configure the allowed redirect URLs for local development and your deployed domain.
6. Start the app with `npm run dev`.

The public client uses only the publishable key. Never put a service role key in a `VITE_` variable. The active migration adds a uniqueness constraint for one open request per player and enables Realtime publication for the existing request table. The older schema draft is retained for reference outside the active migrations folder because its column layout did not match the deployed database.

## Match flow

The requester creates one open request. A Postgres update claims it only while its status is still open; the match and notifications are created in the same transaction. Only match participants can read the match, room code and chat. The requester can share one room code. Each player can submit a result once. The database compares both score reports, marks conflicts as disputed without changing ratings, and updates records only for an agreed result.

## Deploy to Vercel

The repository is configured as a Vite single-page app. `vercel.json` sets the install command (`npm ci`), production build (`npm run build`), build output (`dist`) and SPA fallback rewrite. Vercel's build uses the existing TypeScript check before Vite creates the static bundle.

1. Import this GitHub repository into Vercel and keep the detected framework as **Vite**.
2. In **Project Settings → Environment Variables**, add the following variables. Select Production and Preview; add Development too if you use Vercel's local development tools.

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Supabase project URL (`https://<project-ref>.supabase.co`) |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key from the project's API settings |

3. Save the variables and deploy or redeploy so Vite includes them in the frontend build.
4. In Supabase Auth URL configuration, set the production Vercel URL as the Site URL and add the production and preview deployment URLs to the allowed redirect URLs.
5. After choosing the production domain, update the canonical URL in `index.html`, `public/robots.txt` and `public/sitemap.xml`.

The publishable key is intended for browser use and is protected by Supabase RLS. Never add a Supabase secret/service-role key to a `VITE_` variable or commit it. `.env.local`, other `.env.*` files, `.vercel/`, private key files and local credentials are ignored by Git; `.env.example` is the only environment file intentionally allowed in the repository.

For local development, copy `.env.example` to `.env.local` and enter the same two Supabase values there.

## Product setup still required

- Confirm all required migrations in `supabase/migrations/` are applied to the production Supabase project. Review the existing project schema before applying migrations; do not apply the archived schema draft under `supabase/legacy/`.
- Configure Supabase Auth Site URL and redirect URLs for the production and preview domains.
- Set up email delivery, privacy policy and terms for the production service.
- Configure a Supabase Storage avatar bucket and moderation rules before enabling avatar uploads.

Tournament registration, organizer roster management, knockout brackets, match progression, profiles and rankings use the existing Supabase-backed feature paths. Profile avatar storage still requires a configured Supabase Storage bucket and policies.

## Stack

React, TypeScript, Vite, Supabase Auth, Postgres, RLS and Supabase Realtime. The interface is responsive, keyboard navigable, uses reduced motion preferences, and includes install metadata for supported devices.
