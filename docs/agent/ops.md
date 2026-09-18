# Ops — layout, logging, deploy, Vercel/Neon CLI

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

## Project layout & logging (tidied 2026-09-09)

- Root holds only config + `AGENTS.md` / `CLAUDE.md` / `README.md`. `AGENTS.md`
  is the canonical instruction index; `CLAUDE.md` imports it (2026-09-18). Screenshots, the May-2026 ManyChat-era docs, research
  exports and the xlsx sources live under `docs/archive/` (see its README).
- `scripts/`: `name.ts` = reusable tool, `_name.ts` = scratch that something
  still references, `scripts/_archive/` = unreferenced scratch (160 moved on
  2026-09-09). Convention in [scripts/README.md](scripts/README.md).
- **Logging goes through [lib/observability/log.ts](lib/observability/log.ts)
  — `logger(feature)` + `withRequestLog(feature, handler)` for routes.** One
  JSON line per event with `feature` / `event` / `sid` / `request_id`; console
  always, Axiom ingest when `AXIOM_TOKEN` + `AXIOM_DATASET` are set. `feature`
  is a closed list (`FEATURES`) — extend it, don't invent strings. **Every
  `app/api/**/route.ts` (156) is wrapped and every `console.*` in app/lib/
  integrations is migrated (done 2026-09-09)**; the only survivors are the
  operator-stdout lines in the two one-shot CLIs (`integrations/ghl/bootstrap.ts`,
  `register-conversation-provider.ts`). [instrumentation.ts](instrumentation.ts)
  (`onRequestError`) is the safety net under everything else — an unhandled
  server error still lands as one tagged line. A new route MUST use
  `withRequestLog`; a new `console.log` is a regression.
- **Verify coverage** with the two greps in `scripts/README.md` spirit:
  `grep -rE 'console\.(log|error|warn|info)\(' app lib integrations` → only the
  two CLIs; `for f in $(find app/api -name route.ts); do grep -q withRequestLog $f || echo $f; done` → nothing.
- **Axiom is LIVE via direct ingest (2026-09-09):** org `eli-azsm`, dataset
  **`albadi_crm`** (underscore), stream at
  https://app.axiom.co/eli-azsm/stream/albadi_crm. `AXIOM_TOKEN` (token
  "albadi-crm ingest", ingest-only, scoped to that dataset) + `AXIOM_DATASET`
  are Production env vars. The Vercel↔Axiom Marketplace integration (log
  drain) was tried and **refused** ("The installation could not be started") —
  it is Pro/Enterprise-only and this team is Hobby, so don't retry it; the
  logger's own ingest is the path. An ingest token cannot QUERY (403 on
  `_apl`); read the data in the Axiom UI or mint a separate query token.
  Query by `feature` / `event` / `sid` / `request_id`.

## Deploy

Push to `main` → Vercel **usually** auto-deploys via GitHub integration.

**Gotcha (seen 2026-06-07):** the GitHub→Vercel webhook silently doesn't fire sometimes. After pushing, run `vercel ls` and check the top deployment age. If it's older than your last commit, trigger manually:

```bash
~/.local/node/bin/vercel deploy --prod --yes   # or: vercel deploy --prod
```

The CLI deploy uses the linked project from `.vercel/project.json` — no need to specify the project name. Build runs on Vercel (not local).

## Working with Vercel + Neon from the CLI

**Vercel env vars are encrypted by default.** Running `vercel env pull .env` produces a file where sensitive values (`DATABASE_URL`, all `GHL_*`, all `BRIDGE_*`, etc.) come back as empty strings — the CLI cannot decrypt them. The masking is silent: there's no error, the file looks complete.

To actually query the DB or call GHL from local:

- **Neon (DB):** `neonctl` lives at `~/.local/node/bin/neonctl` (npm global, not on `$PATH` by default) and is already authed. Project id: `fragrant-morning-71359670`. Org id: `org-frosty-star-50411125`. One-liner to feed any tsx script the live DATABASE_URL:
  ```bash
  DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/<name>.ts
  ```
  If `neonctl` is missing on a fresh machine: `npm i -g neonctl && neon auth` (OAuth browser flow).
- **GHL API:** the OAuth access tokens live in `ghl_oauth_tokens` table — pull from the DB connection above (`SELECT access_token, location_id FROM ghl_oauth_tokens ORDER BY updated_at DESC LIMIT 1`) and hit `services.leadconnectorhq.com` directly.
- **Vercel env writes:** `vercel env add NAME production` reads value from stdin (`echo VALUE | vercel env add ...`). `vercel env rm NAME production --yes` for removal. Production writes require explicit user authorization in this harness — auto-approve is blocked.
