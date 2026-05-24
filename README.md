# NFL Path Guesser

Realtime NFL player guessing battles. Built with Vite + React on the client and PartyKit (Cloudflare Durable Objects) on the backend.

## Local development

1. `npm install`
2. `npm run dev` — runs Vite (http://localhost:5173) and `partykit dev` (http://localhost:1999) concurrently
3. Open http://localhost:5173

The default `VITE_PARTYKIT_HOST` points at `127.0.0.1:1999` if not set, so local dev works without any env file.

## Deployment

**One-time setup:**
1. Create a Cloudflare account.
2. Enable the **Workers Paid plan** ($5/mo — required for Durable Objects). In the Cloudflare dashboard, **set the spend cap to $5** so billing can never exceed the plan base.
3. `npx partykit login` — authenticates the CLI with Cloudflare.

**Each deploy:**
- `npm run deploy:party` — pushes party code, prints the host URL (e.g. `nfl-path-guesser.<user>.partykit.dev`)
- Set `VITE_PARTYKIT_HOST` to that URL in your Cloudflare Pages env vars
- `npm run build && npm run deploy:client` — uploads the static build to Pages (or use the Pages GitHub integration for auto-deploy on push)

## Cost & safety

Rooms auto-close when empty for 60 s, when idle in lobby for 30 minutes, or after 4 hours total lifetime — so a forgotten room cannot accrue charges indefinitely. Hibernated Durable Objects cost $0. Worst-case billing is capped at $5/mo via the Cloudflare dashboard setting above.

## Scripts

- `npm run dev` — Vite + PartyKit dev servers
- `npm run build` — typecheck + Vite production build
- `npm run preview` — preview the built client locally
- `npm run deploy:party` — deploy PartyKit code to Cloudflare
- `npm run deploy:client` — deploy the static client to Cloudflare Pages
