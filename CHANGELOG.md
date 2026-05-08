# Changelog — Albadi CRM

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
