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

## v2 Dashboard — DOM-weight crash rule (READ BEFORE EDITING /dashboard/v2)

**The Inbox and stage-detail pages crash the browser if they render too many state-bearing widgets per row.** Multiple attempts have hit this; each one cost a full revert.

**Stable baseline:** commit `6d0652b` (PR #26). InboxRow has only checkbox + Approve + Reject buttons. Stage detail is a plain server-rendered table. No per-row textarea, no per-row `<select>`, no NotesEditor mounted inline.

**Re-introduced inline editors → crashed even though…**
- typecheck was green
- server returned 200 OK on every render
- editors were conditionally rendered (`{expanded && <NotesEditor/>}`)
- moved to a dedicated `/dashboard/v2/lead/[sid]` route

Three PRs all crashed in Eli's env (Vercel logs showed no server error, so the crash is purely client-side):
- PR #28 — inline NotesEditor + override select per row → crash
- PR #29 — dedicated `/lead/[sid]` page (heavy server fetches) → crash on open
- PR #30 — collapsed-by-default inline editor → crash

Root cause was never definitively isolated within reasonable time. Likely contributors found by review:
- Many `useState` + `useTransition` + `useRouter` instances per row (9+ rows × multiple hooks)
- `useState<Set<number>>(new Set(items.map(...)))` recomputed each render in `InboxList.tsx`
- `router.refresh()` inside per-row `useTransition` callbacks, cascading invalidations
- `setTimeout` in `NotesEditor` without cleanup on unmount
- Lack of per-call timeout on `getSubscriber` in `lib/manychat/client.ts` — a hanging ManyChat call freezes SSR until Vercel's `maxDuration` fires

**Rules for any future dashboard change:**
1. **Never** add a `<textarea>`, `<select>`, or extra state-bearing client component to InboxRow or stage-detail rows — even conditionally. Each row must stay near the d583a61/6d0652b shape.
2. If editing UI is required (notes, override stage, override flags), put it on a **separate route or modal that mounts a single instance** for the lead the user is acting on. Not one per row.
3. Notes editing for now happens directly in **ManyChat UI** → custom field `notes` (id 14447147). The classifier skill (`lib/manychat/client.ts → getSubscriber` + `albadi-classify`) already reads that field and weaves it into the suggestion `reason`. The `notes` field belongs to subscriber custom fields, not the ManyChat conversation notes panel — that panel is **not** exposed by the public API (verified — all `getNotes`-style endpoints 404).
4. The server action `updateLeadNotes` exists in `app/actions/v2.ts` and writes to the `notes` custom field. It's safe to call from a new isolated UI, just don't sprinkle the caller across every row.
5. When you do build that isolated UI, add a per-call timeout to `getSubscriber` (or use `AbortController`) so a slow ManyChat call cannot freeze the page.

**If a crash report comes in again:** first ask whether the user is on the `6d0652b`-shaped Inbox. If yes, suspect something else (ManyChat hang, hydration mismatch). If a recent PR has added inline per-row editors, revert that PR before debugging further.
