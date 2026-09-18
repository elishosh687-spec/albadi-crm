---
paths:
  - "lib/manychat/**"
  - "app/dashboard/**"
  - "app/api/bot/restart-send/**"
  - "app/api/bot/new-lead/**"
  - "app/api/drafts/**"
  - "app/actions/v2.ts"
  - "scripts/restart-send.ts"
  - "scripts/seed-leads.ts"
---

# Legacy ManyChat-era routes, flows, dashboard v3

- ManyChat is retired; `lib/manychat/*` and `/api/bot/restart-send`, `/api/bot/new-lead`, `scripts/restart-send.ts` are legacy. ManyChat templates went via `sendFlow`, never `sendContent`.
- Legacy bot routes require `Authorization: Bearer <BOT_SECRET>`.
- Known hardcoded values still to fix: `TAG_IDS`/`FIELD_IDS` in `lib/manychat/config.ts`, `FLOW_NS` in `app/api/bot/restart-send/route.ts`, thresholds in `cron/route.ts`. Never commit phone numbers from `legacy/daily_calls.py`.
- The draft queue is OFF for good since 18/09/2026 (`isDraftQueueEnabled()` → false; the אישורים tab was deleted, `bot_drafts` never had a row). Re-enabling needs an approval UI first.
- `messages.sender` is `'lead' | 'bot' | 'eli'`; `sendBridgeMessage` pre-inserts `'bot'`, `sendManualReply` passes `'eli'`; the webhook upserts text+sender so the late copy wins.
- New write surfaces: prefer server actions in `app/actions/v2.ts`; REST only for external tooling. Anything that sends WhatsApp goes through `sendBridgeMessage` for sender attribution.

Full detail: `docs/agent/legacy-manychat.md` — read it before non-trivial changes here.
