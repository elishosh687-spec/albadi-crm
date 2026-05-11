# Albadi CRM — Claude Instructions

## Architecture

Next.js app deployed on Vercel. Neon PostgreSQL via Drizzle ORM. ManyChat API for WhatsApp.

**Deployed URL:** `https://albadi-crm.vercel.app`
**DB:** Neon (see `DATABASE_URL` in `.env`)
**ManyChat account:** see `MANYCHAT_TOKEN` in `.env`

## Key API Routes

| Route | Purpose |
|-------|---------|
| `POST /api/bot/cron` | Hourly bot — classify leads, save decisions. Called by cloud routine every hour. |
| `POST /api/bot/restart-send` | One-time batch — send re-engagement WhatsApp templates to all stuck leads via ManyChat Flows. |
| `POST /api/bot/new-lead` | Register new lead in DB. Called by ManyChat Flow when new subscriber enters. |

All routes require: `Authorization: Bearer <BOT_SECRET>`

## Cloud Routine

URL: `https://claude.ai/code/routines/trig_01VWAWDtdHXqMMProUCseKbj`
Calls `/api/bot/cron` every hour.

## ManyChat Flows (WhatsApp Templates)

Templates sent via `sendFlow` (not `sendContent` — ManyChat API does not support direct template sending).

| Flow name | flow_ns | Template |
|-----------|---------|---------|
| send_followup_quote_sent | content20260508151701_091472 | albadi_followup_quote_sent |
| send_after_holiday | content20260508152934_109626 | albadi_after_holiday |
| send_price_too_high | content20260508180816_402346 | albadi_price_too_high |
| send_call_request_followup | content20260508152941_860840 | albadi_call_request_followup |
| send_questionnaire_incomplete | content20260508152940_284953 | albadi_questionnaire_incomplete |
| send_last_attempt | content20260508152938_498910 | albadi_last_attempt |

## Leads Table

Leads stored in `leads` table — NOT hardcoded. To add leads manually:
```bash
npx tsx scripts/seed-leads.ts
```

New leads auto-register via ManyChat webhook → `/api/bot/new-lead`. Must configure HTTP Request action in each ManyChat entry Flow.

## Common Commands

```bash
# DB migration after schema change
npx drizzle-kit push

# Seed leads table
npx tsx scripts/seed-leads.ts

# Dry run batch send (no actual send)
npx tsx scripts/restart-send.ts

# Actually send batch
npx tsx scripts/restart-send.ts --confirm
```

## Known Hardcoded Values (still to fix)

- `TAG_IDS` / `FIELD_IDS` in `lib/manychat/config.ts` — should come from ManyChat API
- `FLOW_NS` in `app/api/bot/restart-send/route.ts` — should move to `.env`
- Business thresholds: `10000` NIS high-value, `5` days no-contact (in `cron/route.ts`)
- Phone numbers in `legacy/daily_calls.py` — security risk, do not commit

## Deploy

Push to `main` → Vercel auto-deploys. No manual steps needed.

## v2 Dashboard — client-bundle import rule (READ BEFORE EDITING /dashboard/v2)

**Every "crash" on /dashboard/v2 reported by Eli (PRs #28-30, #33-34) had the same root cause: a `throw` at module-load on the client bundle.**

[lib/manychat/config.ts](lib/manychat/config.ts) starts with:
```ts
if (!process.env.MANYCHAT_TOKEN) throw new Error("MANYCHAT_TOKEN is not set");
```
This is fine on the server. But the moment a `"use client"` component imports anything from that module — even just a constant like `V2_PIPELINE_STAGES` — the bundler inlines the whole module into the browser chunk. `process.env.MANYCHAT_TOKEN` is undefined in the browser, the module evaluation throws, and React unmounts the page tree. The Vercel runtime logs show 200 OK (server SSR is fine); only the DevTools console shows the actual error.

**Rule:** client components must NEVER import from `@/lib/manychat/config`. Client-safe constants live in [lib/manychat/stages.ts](lib/manychat/stages.ts) — `V2_PIPELINE_STAGES`, `V2PipelineStage`, `V2_FLAG_TAG_IDS`, `V2FlagName`, `V2_FLAG_NAMES`. Add new client-safe constants there, not in config.ts. Server-side code can keep importing from config.ts; it re-exports the same names for compatibility.

When you add or move a constant the classifier or dashboard depends on, double-check the import path in every `"use client"` file before merging.

**Stable shape today:**
- Inbox row: checkbox + Approve + Reject + a plain `<button>` that opens a single-instance `NotesModal` ([app/dashboard/v2/NotesModal.tsx](app/dashboard/v2/NotesModal.tsx)) mounted once at `InboxList` root.
- `NotesModal` holds the textarea, "+ הוסף תאריך עכשיו" stamper, and the stage-override `<select>`. Only one instance of all of those exists in the DOM at a time, regardless of how many leads are pending.
- `updateLeadNotes` in [app/actions/v2.ts](app/actions/v2.ts) writes the ManyChat `notes` custom field (id 14447147) via `setCustomFields`. The classifier skill reads it back via `getSubscriber` and weaves it into the suggestion `reason`.
- [lib/manychat/client.ts](lib/manychat/client.ts) wraps every ManyChat call with an 8-second `AbortController` timeout, so a hanging request cannot freeze SSR.

**Background note on conversation notes:** ManyChat's "Notes" panel (the per-conversation sidebar notes) is **not** exposed by the public API — every `getNotes`-style endpoint we tested returns 404. The `notes` custom field is separate from that panel; Eli writes to it via ManyChat's "Custom User Fields" section in the same conversation view, and it's the only ManyChat-side notes surface we can read.

**Debug playbook if /dashboard/v2 ever "crashes" again:**
1. Open DevTools → Console. The actual JS error (and the module path) will be the first uncaught exception.
2. Vercel runtime logs show only SSR — they will not surface client throws.
3. If the error mentions `MANYCHAT_TOKEN is not set` or similar module-load throw, find the new client component importing from config.ts (or any server-only module) and reroute the import to `stages.ts` (or a similar client-safe split).
4. If you see hydration mismatch errors instead, audit any locale/date/random-id values passed from server to client.

**Do not** assume "DOM weight" before reading the console. The previous CLAUDE.md entry chased that hypothesis through multiple PRs and never closed the bug.
