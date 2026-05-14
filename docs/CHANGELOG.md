# Albadi CRM — Changelog

> רק שינויים גדולים (pivots, מהפכות, ארכיטקטורה). שינויים יומיומיים = `git log`.
> פורמט: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + semver רופף.

---

## v3 — 2026-05 — "Dashboard v3 + Retool supervisor console"

### Added
- **Dashboard v3** (`/dashboard/v3/*`) — Kanban 4-bucket leads board, WhatsApp-style chat view, analytics, pipeline metrics, settings editor.
- **In-app drafts queue** (`/dashboard/v3/drafts`, `/dashboard/v2/drafts`).
- **Retool supervisor console** (external — `elishosh.retool.com`) — pending drafts feed + state override.
- **REST API for Retool** — `/api/drafts/pending`, `/api/drafts/:id/approve`, `/api/drafts/:id/reject`, `/api/leads/:id/override`.
- **Money-moment drafts** (`bot_drafts` table) — feature-flagged via `ENABLE_DRAFT_QUEUE`.
- **Sender attribution** on `messages` table (`lead | bot | eli`).
- **Manual name+phone editing** on lead detail (workaround for bridge lid JIDs without contact info).
- **Dark-mode v3 theme**.

### Changed
- **`/dashboard/v2/lead/[sid]/page.tsx`** — conversation view + manual reply + LLM drafts + quick actions.
- **Bot copy** rewritten in Eli's voice (closes v2 gaps).
- **Follow-up cadence** aligned to CUSTOMER-FLOW v2.

### Migration notes
- v2 dashboard still live (fallback). v3 is the new primary.
- Retool resources: hand-built per `retool/SETUP.md`. No JSON import.

---

## v2 — 2026-04 — "Bridge cutover (off ManyChat)"

### Added
- **whatsapp-bridge-node tenant** — self-hosted Fly.io VPS for WhatsApp send/receive.
- **`/api/bridge/webhook`** — HMAC-signed inbound, 5-min replay window.
- **`bridge_events` table** — audit log per webhook envelope (UNIQUE `evt_id` for dedupe).
- **`USE_BRIDGE` feature flag** — flips messaging adapter between ManyChat and bridge.
- **DB-authoritative state** — `leads` row holds all custom fields previously in ManyChat (`pipeline_stage`, `next_action`, `bot_summary`, etc.).
- **`lead_tags` table** — tag membership by Hebrew name (numeric IDs retained for backward compat only).
- **`messages.wa_message_id`** — dedupe key for bridge inbound retries.
- **`lib/messaging/index.ts`** — adapter layer; server code imports from here, not from bridge/manychat clients directly.

### Removed (deprecated, still in code)
- ManyChat templates / Flows path (`restart-send`) — bridge has no 24h limit, no template need.
- ManyChat new-lead webhook + inbound webhook — bridge handles intake.

### Migration steps
1. `npx tsx scripts/backfill-from-manychat.ts --confirm`
2. Register bridge webhook subscription via `POST /v1/subscriptions`.
3. `USE_BRIDGE=1` in Vercel envs.
4. Watch one full cycle.
5. (pending) Delete `MANYCHAT_TOKEN`, `lib/manychat/client.ts`, deprecated routes.

---

## v1 — 2026-03 — "Dashboard v2 + supervisor inbox"

### Added
- **`/dashboard/v2/*`** — inbox by pipeline_stage, lead detail (notes + tags + conversation), pending drafts.
- **NotesModal** — single-instance modal at InboxList root (textarea + date stamper + stage override). Fixes the v2 client-bundle crash (PRs #28-30, #33-34) caused by importing from `lib/manychat/config.ts` in client components.
- **`lib/manychat/stages.ts`** — client-safe constants (V2_PIPELINE_STAGES, V2PipelineStage, V2_FLAG_TAG_IDS, V2FlagName). Client code MUST import from here, never from config.ts (which throws on missing `MANYCHAT_TOKEN` at module-load).
- **`updateLeadNotes`** in `app/actions/v2.ts` — writes ManyChat `notes` custom field (id 14447147) via `setCustomFields`.
- **8s AbortController timeout** on every ManyChat HTTP call (`lib/manychat/client.ts`) — prevents SSR freeze.

### Changed
- Followup cron downgraded to **daily** (Vercel Hobby plan limit).

### Lessons
- **Module-load throws in client bundle** = silent React unmount. Server SSR logs are 200 OK; only DevTools console shows the actual error. See CLAUDE.md §v2 for the debug playbook.

---

## v0 — 2026-02 — "Initial ManyChat-based bot"

### Added
- ManyChat-based WhatsApp bot — Flows for re-engagement templates, custom fields for state.
- LLM classifier as **separate cron job** (hourly, posts decisions to `pipeline_suggestions`).
- Initial Drizzle schema: `leads`, `messages`, `pipeline_suggestions` (dropped in v1).
- Vercel cron `/api/bot/cron`.
- Hardcoded `TAG_IDS`, `FIELD_IDS` in `lib/manychat/config.ts`, `FLOW_NS` in restart-send route.

### Notes
- Architecture: ManyChat = state. App = thin classifier + dashboard.
- Replaced by v2 (bridge takes over state ownership).

---

## Naming convention for future entries

- One section per major release (`vN — YYYY-MM — "title"`).
- Sub-sections: **Added / Changed / Removed / Deprecated / Fixed / Migration notes / Lessons**.
- Day-to-day commits live in `git log` only; don't pollute changelog.
- Cross-link ADRs (`adr/000N-*.md`) and PRD/FEATURES/ARCHITECTURE updates.
