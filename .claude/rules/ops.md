---
paths:
  - "lib/observability/**"
  - "instrumentation.ts"
  - "vercel.json"
  - "next.config.*"
  - "scripts/README.md"
  - ".vercel/**"
---

# Ops — logging, deploy, Vercel/Neon CLI
- All logging goes through `lib/observability/log.ts`: `logger(feature)` and `withRequestLog(feature, handler)`. A new route MUST use `withRequestLog`; a new `console.log` is a regression (only the two one-shot CLIs are exempt).
- `feature` is a closed list (`FEATURES`) — extend it, don't invent strings.
- `instrumentation.ts` (`onRequestError`) is the safety net for unhandled server errors.
- Axiom ingest runs when `AXIOM_TOKEN` + `AXIOM_DATASET` (`albadi_crm`) are set; the ingest token cannot query. The Vercel log drain is Pro-only — don't retry it.
- `scripts/`: `name.ts` = tool, `_name.ts` = referenced scratch, `scripts/_archive/` = unreferenced (see `scripts/README.md`).
- Push to `main` usually auto-deploys, but the webhook sometimes silently doesn't fire: check `vercel ls`, else `~/.local/node/bin/vercel deploy --prod --yes`.
- `vercel env pull` silently blanks sensitive vars (`DATABASE_URL`, `GHL_*`, `BRIDGE_*`); get the DB via `~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125`.
- GHL tokens come from the `ghl_oauth_tokens` table.
- Production env writes (`vercel env add`/`rm`) need explicit user authorization.

Full detail: `docs/agent/ops.md` — read it before non-trivial changes here.
