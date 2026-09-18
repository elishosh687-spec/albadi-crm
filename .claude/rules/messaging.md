---
paths:
  - "lib/greenapi/**"
  - "lib/bridge/**"
  - "lib/messaging/**"
  - "lib/notify/**"
  - "app/api/greenapi/**"
  - "app/api/bridge/**"
  - "app/api/admin/eli-dm/**"
  - "scripts/eli-inbox.ts"
  - "scripts/team.ts"
  - "scripts/assistant/**"
---

# Messaging — GreenAPI/bridge, Eli console, colleagues, notifications

- Active backend is GreenAPI: `USE_BRIDGE=1` (permanent — `0` routes to dead ManyChat) → `lib/bridge/client.ts`; `USE_GREEN_API=1` makes `sendBridgeMessage` delegate to `sendGreenMessage`. Inbound: `app/api/greenapi/webhook/route.ts`.
- Server code MUST import messaging helpers from `@/lib/messaging`, never `@/lib/manychat/client` or `@/lib/bridge/client` directly.
- #1 footgun — two JID namespaces: Green `<phone>@c.us` vs stored `<phone>@s.whatsapp.net` (+ `@lid`). Canonicalise any chatId before mapping to a lead (`resolveLeadSidForChatId`; `loadLead` has a phone-digit fallback). Symptom: GHL thread shows only the customer side (`ghl_mirror.skip reason=no_lead`).
- DB is authoritative for lead fields; `lead_tags` stores tags by NAME. `bridge_events(evt_id UNIQUE)` and `messages.wa_message_id` dedupe webhook retries.
- Bridge webhook verifies HMAC-SHA256 over `t.rawBody` with `BRIDGE_WEBHOOK_SECRET`, 5min replay window.
- No templates: free-form only inside the WhatsApp 24h window; no fallback exists.
- `/api/admin/eli-dm` always sends to `ELI_NOTIFY_JID` — the recipient is deliberately NOT a parameter; never generalise it into send-to-anyone. Customer sends use `sendBridgeMessage` / `sendTeamDM`.
- Eli's own `leads` row must stay paused.
- `scripts/eli-inbox.ts` cursor (`.claude/eli-inbox-cursor`): the background assistant peeks with `--no-advance` and commits only after a successful reply or `NO_REPLY`; the cursor advances to query START. The agent (`scripts/assistant/check.mjs`, `ALBADI_ASSISTANT_PROVIDER=codex|claude`) has no send capability — the wrapper calls `reply.mjs`.
- NEVER add a colleague to `leads`. Registry is `app_config` `crm.team` (phones never in git); send via `sendTeamDM` from `lib/notify/team.ts`. Every inbound path must call `findTeamMemberByPhone(chatId)` BEFORE `upsertLeadFromGreen` and return early — otherwise a colleague becomes a lead and gets the Hebrew questionnaire.
- Always show Eli the text and recipient before any team DM.
- Colleague inbound creates no `messages` row, so liveness checks must use `bridge_events` type `green.incomingMessageReceived` (`assessGreenHealth`, `lib/greenapi/health.ts`) — watching `messages` raised a false "inbound died" alarm.
- GHL rewrites foreign numbers to +972 — don't trust `phone_e164` for non-Israeli contacts.
- Tests: `lib/greenapi/client` reads credentials at import — set them in `vi.hoisted`, not `vi.stubEnv` in `beforeEach`.
- Quote-sent notification recipient is `app_config` `crm.quoteNotify`, currently disabled; `ITAY_NOTIFY_JID` is only a legacy fallback.

Full detail: `docs/agent/messaging.md` — read it before non-trivial changes here.
