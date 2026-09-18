---
paths:
  - "lib/manychat/stages.ts"
  - "docs/CUSTOMER-FLOW.md"
---

# Stages, labels, client-bundle rule

> Moved verbatim from CLAUDE.md on 2026-09-18. Short versions are in AGENTS.md hard rules.

## Pipeline stages (post 2026-06-07 funnel rename)

4-active-stage funnel, 6 total + WON/LOST/sides. Internal names match GHL exactly — no translation layer.

| Stage | Hebrew | When | Who sets |
|---|---|---|---|
| `NULL` | בשאלון | first inbound, questionnaire active | bot (`upsertLeadFromBridgeEvent` leaves NULL) |
| `INTAKE` | שאלון + הצעה אוטומטית | questionnaire complete + auto-quote sent; includes the 24h+ silent state | bot (`handleInbound`) |
| `DISCAVERY` | שיחת בירור | customer engaged, salesperson runs discovery / commitment-signal call | bot or salesperson |
| `FACTORY_WAIT` | בדיקת מפעל | non-standard spec, factory check in flight | bot (`routeToFactory`) / Eli (subFlow=awaiting_factory_estimate) |
| `CONSIDERATION` | שוקל הצעה / מו״מ | final quote in customer's hands; haggling lives here | bot (`handleDecisionInbound`) |
| `WON` / `LOST` | terminal | customer confirmed payment / explicit refusal | bot or Eli (LOST requires `loss_reason`) |

Side stages (operator drags manually, bot doesn't transition): `FUTURE_FOLLOW_UP`, `NO_RESPONSE_REENGAGE`.

Source of truth: `V2_PIPELINE_STAGES` in [lib/manychat/stages.ts](lib/manychat/stages.ts). Full transition table: [docs/CUSTOMER-FLOW.md](docs/CUSTOMER-FLOW.md).

**Rename rule.** When renaming or merging a stage: ADD the old name to `LEGACY_STAGE_MAP` (don't remove existing entries). Pattern proven 2026-06-07 — stale DB rows, log entries, and external API payloads keep normalizing cleanly. Run the DB backfill (`UPDATE leads SET pipeline_stage = ...`) AFTER the code lands, never before.

## Client-bundle import rule (READ BEFORE TOUCHING SHARED CONSTANTS)

`"use client"` components must NEVER import from server-only modules that
throw on missing env vars. The historical offender is
[lib/manychat/config.ts](lib/manychat/config.ts) which starts with:
```ts
if (!process.env.MANYCHAT_TOKEN) throw new Error("MANYCHAT_TOKEN is not set");
```
Server: fine. Client: the bundler inlines the whole module → process.env is
undefined in the browser → module evaluation throws → React unmounts the
tree. Vercel runtime logs show 200 OK (SSR was fine); only DevTools console
shows the actual error.

**Rule:** client-safe constants live in [lib/manychat/stages.ts](lib/manychat/stages.ts) —
`V2_PIPELINE_STAGES`, `V2PipelineStage`, `V2_FLAG_TAG_IDS`, `V2FlagName`,
`V2_FLAG_NAMES`. Add new client-safe constants there, not in config.ts.

**Debug playbook for a "blank/crashed" dashboard page:**
1. DevTools → Console. First uncaught exception is the answer.
2. Vercel runtime logs only cover SSR — they will not show client throws.
3. If the error mentions a server-only env var, the import path is wrong.

Do NOT chase "DOM weight" or "hydration" before reading the console.

## Display labels: use Eli's working vocabulary

Only stage labels changed 2026-07-01 — the internal keys (`INTAKE` /
`DISCAVERY` / `FACTORY_WAIT` / `CONSIDERATION` / `WON` / `LOST`) are
untouched. Every UI surface reads:

  INTAKE        → **קליטה**              (was: שאלון + הצעה אוטומטית)
  DISCAVERY     → **אפיון**              (was: שיחת בירור)
  FACTORY_WAIT  → **מחכה למפעל**          (was: בדיקת מפעל)
  CONSIDERATION → **שוקל / משא ומתן**    (was: שוקל הצעה / מו״מ)
  LOST          → **אבוד**               (was: לא נסגר)

Source of truth: `V2_STAGE_LABELS` in
[lib/manychat/stages.ts](lib/manychat/stages.ts). NULL and INTAKE both
render as "קליטה" in the audit — Eli doesn't distinguish "still in
questionnaire" from "questionnaire done + auto-quote".
