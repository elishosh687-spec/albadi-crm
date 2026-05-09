# Changelog — Albadi CRM

## [0.6] — 2026-05-08

### Added
- `albadi-analyze` project skill (`.claude/skills/albadi-analyze/SKILL.md`) — Claude analyzes pending escalations: summary + 2-3 strategic reply options + optional `suggested_tag`
- `escalations.suggested_tag` / `suggested_tag_reason` / `tag_applied_at` columns
- `/api/actions/apply-tag` — pushes suggested tag to ManyChat (removes conflicting status tags + adds new one) + stamps notes
- "אשר תג" button in dashboard EscalationCard — manual approval flow; escalation stays open
- "ניסיון קודם" context: when an escalation re-fires for a lead with prior chosen option, the new triggerText includes the previous label + reasoning
- `chosen_option_index` persisted in DB on resolve + appended to ManyChat notes ("[date] בחר אופציה: X")

### Changed
- cron auto-marks every new escalation `analyze_requested=true` — removes the manual "analyze all" click
- ActionButtons / "הרץ בוט עכשיו" replaces the deleted Cloud Routine; bot is now manually triggered
- Server Actions read base URL from `VERCEL_PROJECT_PRODUCTION_URL` (not `VERCEL_URL`) to bypass Vercel Authentication on deploy-specific URLs

### Removed
- `albadi-bot-run` project skill (described an architecture using npm `bot:list-leads` / `bot:apply-tag` etc. that doesn't match the current cron route)
- `scripts/list-leads-for-review.ts`, `apply-tag.ts`, `save-decision.ts`, `notify-eli.ts`, `run-bot-once.ts` (dead code)
- npm scripts: `bot:list-leads`, `bot:apply-tag`, `bot:save-decision`, `bot:notify-eli`, `bot:run-once`
- Cloud Routines (`trig_01VWAWDtdHXqMMProUCseKbj` and 2 others) — deleted from Anthropic cloud by user

### Migration
- `npx drizzle-kit push` to add the 3 new escalation columns
- SKILL.md at `~/.claude/scheduled-tasks/albadi-escalation-analysis/SKILL.md` needs manual update for `suggested_tag` instructions (project-local skill at `.claude/skills/albadi-analyze/SKILL.md` already has them)

---

## [0.5] — 2026-05-08

### Added
- E3 escalation analysis pipeline — schema columns, Bearer-auth API endpoints (`pending-analyses`, `escalation-analysis/[id]`, `analyze-all-escalations`), Server Actions, polling EscalationCard with multi-option UI
- A+F noise reduction in cron rules: 0–3 day grace period + 14-day stuck escalation = 70% fewer escalations
- `BulkAnalyzeButton` — "נתח את כל הפתוחות" marks all open escalations as pending analysis

### Changed
- EscalationCard now surfaces full lead context: notes (with show-more for long), currentTag, daysSinceContact, quoteTotal, prevTag, ruleMatched
- Dashboard escalations page joins decisions for full input visibility

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
