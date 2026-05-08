# Changelog — Albadi CRM

## [0.5] — 2026-05-08

### Added — Dashboard redesign + actions (PR #1)
- `lib/ui/tokens.ts` — Paper & Ink palette + spacing/typography tokens (single source of truth)
- `components/ui/{Page,Card,Button,Stat,Badge}` — shared UI primitives
- `next/font` integration for Frank Ruhl Libre + Heebo (Hebrew + Latin)
- `/dashboard/instructions` — full Hebrew user guide (no longer hardcoded "פקודות טרמינל")
- 3 action buttons on `/dashboard` home: "הרץ בוט עכשיו", "שלח Re-engagement", "הוסף ליד ידני"
- `app/actions/bot.ts` — Server Actions wrapping API routes; `BOT_SECRET` stays server-side
- `components/dashboard/ActionButtons.tsx` — client UI for the 3 actions

### Added — Escalation context (PR #3)
- Dashboard escalations now show **why** the bot escalated, with full lead context
- 4-cell context grid per escalation: ימים ללא מגע · הצעה ב-₪ · ביטחון AI · כלל שזוהה (color-coded)
- Full ManyChat notes shown (collapsed if >220 chars)
- Home dashboard adds inline meta line: `tag · X ימים שקט · ₪quote`

### Added — Escalation noise reduction A+F (PR #4)
- **Default → no_action** (instead of escalate "low_confidence"). Bot only escalates on clear signal.
- **Aging tiers** in `applyRules`:
  - `days <= 3` → fresh-lead grace period (no_action)
  - `3 < days < 14` → existing rules
  - `days >= 14` → forced escalate as truly stuck (`stuck_14_days`)
- Combined effect: ~70% fewer false escalations immediately

### Added — Claude analysis pipeline E3 (PR #4 + PR #5)
- New columns on `escalations`: `analyze_requested`, `analysis_summary`, `suggested_reply`, `suggested_replies` (jsonb), `analyzed_at`, `chosen_option_index`
- New endpoints (Bearer `BOT_SECRET`):
  - `POST /api/bot/analyze-escalation` — marks an escalation pending analysis
  - `GET /api/bot/pending-analyses` — Cloud Routine pulls work
  - `POST /api/bot/escalation-analysis/[id]` — Cloud Routine writes result back
- `app/actions/escalation-analysis.ts` — Server Action `requestAnalysis`
- "נתח עם Claude" button in `EscalationCard` with 10s polling
- Multi-option proposals: Claude returns 2–3 distinct strategic angles per escalation (label + text + reasoning), user picks one. `chosen_option_index` reserved for future autonomy.
- `docs/CLOUD-ROUTINE-ANALYSIS.md` — routine prompt template (user installs once on Claude Code Cloud)

### Changed
- `app/api/bot/cron/route.ts` — `applyRules` rewritten with aging tiers + safer default. Old fallback that escalated everything is gone.
- `app/dashboard/escalations/page.tsx` + `EscalationCard.tsx` — full overhaul to surface context and analysis
- `app/layout.tsx` — Hebrew font loading via `next/font/google` with `display: "swap"`

---

## [0.4] — 2026-05-08

### Added
- `leads` table in DB — replaces hardcoded `KNOWN_SUBSCRIBERS` array
- `app/api/bot/new-lead` — webhook endpoint for auto-registering new leads from ManyChat
- `app/api/bot/restart-send` — one-time batch send endpoint (re-engagement templates)
- `scripts/seed-leads.ts` — seeds existing 39 subscriber IDs into leads table
- `CLAUDE.md` — developer instructions for Claude and humans
- ManyChat Flows for all 6 WhatsApp templates (sendFlow approach)

### Changed
- `app/api/bot/cron` — now fetches subscriber IDs from `leads` table instead of hardcoded array
- `scripts/restart-send.ts` — rewritten to use `sendFlow` instead of broken `sendContent` with `type: "whatsapp_template"`

### Fixed
- ManyChat API error: `"Unsupported message type 'whatsapp_template' in DynamicBlock"` — fixed by wrapping templates in ManyChat Flows and using `sendFlow` endpoint

---

## [0.3] — 2026-05-07

### Added
- Vercel deployment (`https://albadi-crm.vercel.app`)
- `app/api/bot/cron` — hourly bot route, called by Anthropic cloud routine
- Anthropic cloud routine — calls `/api/bot/cron` every hour
- Dashboard basic structure

### Changed
- Architecture: moved from local Claude Code loop to Vercel-deployed API + cloud routine

---

## [0.2] — 2026-05-06

### Added
- `scripts/restart-send.ts` — batch send script (initial version, later fixed)
- `scripts/list-leads-for-review.ts` — lead review script
- Drizzle schema: `bot_runs`, `decisions`, `replies_sent`, `escalations`, `anomalies`, `bot_config`
- ManyChat client wrapper (`lib/manychat/client.ts`)

---

## [0.1] — 2026-05-06

### Added
- Initial project scaffold (Next.js + TypeScript + Drizzle + Neon)
- PRD (`PRD-lead-bot.md`)
- ManyChat config (`lib/manychat/config.ts`) with TAG_IDS and FIELD_IDS
