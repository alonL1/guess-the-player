# Guess The Player

Realtime NFL player guessing battles built with `Next.js`, `Socket.IO`, `Drizzle ORM`, and `Postgres`.

## What is implemented

- Guest nickname flow with signed session cookies
- Public room creation, invite links, and join-fullest matchmaking
- Lobby settings for:
  - round count
  - timer or no timer
  - difficulty filters
  - kahoot vs sudden death
  - year labels under teams
- Server-authoritative realtime room state
- Synced `3, 2, 1` countdown before each round
- Multi-guess player search with score penalties for wrong answers
- Reveal screen, leaderboard screen, and return-to-lobby flow
- Postgres schema + seed script for a starter NFL player catalog
- Unit, integration, and browser tests

## Stack

- `Next.js` App Router + `TypeScript`
- `Tailwind CSS`
- `Socket.IO`
- `Drizzle ORM`
- `Postgres` with a local starter-catalog fallback when `DATABASE_URL` is not set

## Getting started

1. Install dependencies:

```bash
npm install
```

2. Copy env vars:

```bash
cp .env.example .env
```

3. Optional: create the Postgres schema and seed it:

```bash
npm run db:migrate
npm run db:seed
```

4. Start the app:

```bash
npm run dev
```

5. Open `http://localhost:3000`

Use one runtime environment consistently. If you install dependencies from Windows `cmd`/PowerShell, run the scripts from Windows too. If you want to work from WSL, install Linux Node inside WSL, delete `node_modules` and `package-lock.json`, then reinstall there.

## Scripts

- `npm run dev` starts the custom Next.js + Socket.IO server
- `npm run build` builds the Next.js app with Webpack for broader Windows compatibility
- `npm run start` runs the production server
- `npm run test` runs Vitest
- `npm run test:e2e` runs Playwright
- `npm run db:migrate` creates the Postgres tables
- `npm run db:seed` seeds the starter player catalog

## Notes

- The app is built for a single Node process, which matches the intended Railway deployment for this MVP.
- Room state is server-authoritative and stored in memory.
- Player catalog data is curated in-repo and can be promoted into Postgres with the included scripts.
- This repo intentionally uses direct migration/seed scripts instead of `drizzle-kit`.
