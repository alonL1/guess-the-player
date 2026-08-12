# Path Guesser

Realtime career-path guessing games for the NFL and NBA. Both editions share the Vite + React client and PartyKit room engine while keeping separate catalogs, visual themes, Daily Challenges, domains, and PartyKit deployments.

## Local development

1. `npm install`
2. Run one edition:
   - `npm run dev` - NFL client at http://localhost:5173 and PartyKit at http://localhost:1999
   - `npm run dev:nba` - NBA client at http://localhost:5174 and PartyKit at http://localhost:2000
3. The localhost-only catalog inspector is available at `/catalog` in either edition.

The clients use those local PartyKit ports when `VITE_PARTYKIT_HOST` is not set.

## Player catalog

The NFL pool is generated from nflverse roster and regular-season player-stat releases. `npm run generate:catalog` writes `src/lib/generated-player-catalog.ts`.

The NBA pool combines historical FiveThirtyEight RAPTOR records, dated ESPN box-score appearances published by sportsdataverse, ESPN player-core status data, and ESPN's live team rosters. The live-roster overlay captures offseason signings before a player appears in a game for the new team. `npm run generate:catalog:nba` writes the NBA catalog, debug breakdown, and stable Daily Challenge schedule. It keeps only players with at least two NBA franchises and displays season-spanning years as calendar membership years: a 2003-04 through 2009-10 stint is `2003–2010`.

NBA catalog tools:

- `npm run validate:catalog:nba` - validate IDs, franchises, stints, and the Daily schedule
- `npm run difficulty:nba` - show all-player difficulty and position-group counts
- `npm run difficulty:nba:current` - show the same distribution for current/free-agent players

Generated catalog files are committed so Cloudflare Pages builds are deterministic. NBA source downloads are cached locally in `.cache/nba-catalog`; that cache is intentionally not committed.

## Deployment

**One-time setup:**
1. Create a Cloudflare account.
2. `npx partykit login` - authenticate the CLI with Cloudflare.
3. Create separate Cloudflare Pages projects for the NFL and NBA domains.

**NFL deploy:**

- `npm run deploy:party`
- Set the NFL Pages project's `VITE_PARTYKIT_HOST` to the printed NFL PartyKit host.
- `npm run build && npm run deploy:client`

**NBA deploy:**

- `npm run deploy:party:nba`
- Set the NBA Pages project's `VITE_PARTYKIT_HOST` to the printed PartyKit host.
- Use `npm run build:nba` with output directory `dist-nba`, then `npm run deploy:client:nba`.
- The production domain is `https://nba.pathguessr.app`; configure that subdomain on the NBA Pages project.

Both editions share the provisioned `nfl-path-guesser` PartyKit hostname, but use isolated party namespaces: NFL uses `main`/`lobby`, while NBA uses `nba`/`nbalobby`. Rooms and public lobby listings therefore never cross leagues.

## Cost & safety

Rooms auto-close when empty for 60 seconds, when idle in the lobby for 30 minutes, or after four hours total lifetime. Check the current Cloudflare and PartyKit plan limits before launch; the app does not assume a particular paid tier.

## Scripts

- `npm run dev` - NFL Vite + PartyKit servers
- `npm run dev:nba` - NBA Vite + PartyKit servers
- `npm run build` / `npm run build:nba` - production builds
- `npm run deploy:party` / `npm run deploy:party:nba` - realtime server deploys
- `npm run deploy:client` / `npm run deploy:client:nba` - Cloudflare Pages deploys

## Data and marks

Player data and headshots come from the upstream datasets and URLs named above. Team names and logos are trademarks of their respective owners; historical marks are display metadata, not bundled source artwork. Review upstream terms and trademark requirements before commercial launch.
