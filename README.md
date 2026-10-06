# RailYatra demo

A railway-style booking demo built with Next.js, Supabase, and Vercel. It uses the open Indian railway station and train-route dataset for station autocomplete and scheduled train searches, with Supabase email/password accounts, account-scoped trip history, database-backed demo reservations, and optional confirmation email through Resend.

> **Demo only:** the imported dataset's routes and timetables are third-party reference data and may be outdated; confirm details with the railway operator. The dataset does not supply real-time availability, seat inventory, fares, or payments. This app simulates capacity, fares, and payment: no card details are requested, no payment is processed, and a confirmation is not a valid rail ticket.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Configure the services below, then import the railway dataset to enable station search, train search, and bookings.

## Configure Supabase

1. Create a Supabase project and copy its Project URL and publishable (or legacy anon) key into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Open the project's SQL Editor and run [`supabase/schema.sql`](./supabase/schema.sql). It creates the station directory, train timetable catalogue, account-private bookings, row-level security policies, and the atomic demo-booking/search functions.
3. Enable email/password authentication in Supabase Auth. The signup form stores a username in the user's metadata. To sign up and sign in without email verification for local/demo use, open **Authentication → Sign In / Providers → Email**, turn off **Confirm email**, and save. Keep email confirmation enabled in production and configure an SMTP provider.
4. For the one-time dataset import, also set `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` and run `npm run data:import`. **The service-role key is an importer-only secret; never prefix it with `NEXT_PUBLIC_`, commit it, or add it to a client-side environment.** The importer downloads the pinned MIT-licensed dataset, streams the large train schedule file in batches, and upserts station and train records. See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for attribution and license.
5. Remove the service-role key from the local environment after importing. Never deploy it to Vercel. The running app uses only the user's Supabase session and public key; row-level security limits trip history to its owner, and booking writes are restricted to the validated database function.
6. To install the demo fare schedule, rerun `supabase/schema.sql` in the SQL Editor after applying updates. Fares start above ₹4,000 and vary by class and distance. The app displays INR or USD using a fixed demo rate of ₹83 per US dollar; bookings remain stored in INR. Demo payments do not charge money.

Example `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
# Importing only; never deploy this key or expose it to client code.
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
RESEND_API_KEY=re_your_resend_api_key
EMAIL_FROM=RailYatra <bookings@your-verified-domain.example>
```

## Confirmation email

The app sends a plain-text demo ticket summary through Resend **after** the demo booking is saved. Verify the sender domain in Resend, then set `RESEND_API_KEY` and `EMAIL_FROM`. If email is not configured or the provider rejects the send, the booking remains confirmed and the interface reports that email delivery did not succeed; no false email-success message is shown.

## Checks and deployment pipeline

The GitHub Actions workflow in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs lint, TypeScript checks, and a production build for pull requests and pushes to `main`.

To publish:

1. Push this project to a GitHub repository and connect that repository to a new Vercel project.
2. Add the four environment variables above to Vercel's Production and Preview environments.
3. Vercel's Git integration builds preview deployments for pull requests and deploys `main` to production. GitHub Actions verifies each change independently; merge only after CI passes.
4. In Supabase Auth, add the deployed Vercel URL to the allowed redirect/site URL configuration.

Vercel/GitHub linking and cloud resources require accounts and credentials that are not present in this workspace, so the app is prepared for deployment but has not been published to a live URL.

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm start
```
