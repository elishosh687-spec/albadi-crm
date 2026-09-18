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

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

## Bridge messaging (READ BEFORE TOUCHING MESSAGING)

**Active backend = GreenAPI (confirmed 2026-06-08).** WhatsApp send/receive
runs through GreenAPI, not the bridge tenant directly. ManyChat is fully
retired (only historical backfill scripts touch its API). The layering is two
nested flags:
- `USE_BRIDGE=1` routes `@/lib/messaging` → `lib/bridge/client.ts` (vs the dead
  ManyChat path).
- `USE_GREEN_API=1` then makes `sendBridgeMessage` delegate to
  `sendGreenMessage` (`lib/greenapi/client.ts`). Inbound arrives at
  [app/api/greenapi/webhook/route.ts](app/api/greenapi/webhook/route.ts).
The `whatsapp-bridge-node` tenant code still exists but is dormant while
`USE_GREEN_API=1`. Tags, custom fields, and pipeline state live in the DB.

**⚠️ Two JID namespaces — the #1 messaging footgun.** GreenAPI uses
`<phone>@c.us`; FB-import leads ([api/leads/facebook-import](app/api/leads/facebook-import/route.ts))
are stored under `<phone>@s.whatsapp.net`; the bridge also uses
`@s.whatsapp.net` + `@lid`. So a lead's `manychat_sub_id` (sid) and the Green
`chatId` for the SAME person often differ only by suffix. Any code that maps a
chatId back to a lead MUST canonicalise first — use
`resolveLeadSidForChatId` (green client) on the way in, and `loadLead`
(`integrations/ghl/sync.ts`) has a phone-digit fallback as the safety net.
Bug fixed 2026-06-08: the GHL outbound mirror passed the raw `@c.us` chatId →
`loadLead` missed → every bot/eli reply was dropped from the GHL Inbox
(`ghl_mirror.skip reason=no_lead`) while inbound (already canonicalised)
showed fine. Symptom: GHL thread shows only the customer side.

**Feature flag:** `USE_BRIDGE=1` is permanent. Setting it to `0` would route
through `lib/manychat/client.ts` which is deprecated and unmaintained.

**Import rule:** all server-side code MUST import messaging helpers from `@/lib/messaging`, NOT from `@/lib/manychat/client` or `@/lib/bridge/client` directly. The adapter at [lib/messaging/index.ts](lib/messaging/index.ts) re-exports the active backend.

**State ownership when USE_BRIDGE=1:**
- `leads` row holds name, phone (E.164), wa_jid, and every custom field (`pipeline_stage`, `next_action`, `bot_summary`, `notes`, `quote_total`, etc.). DB is authoritative.
- `lead_tags(manychat_sub_id, tag)` holds tag membership by NAME (Hebrew keys from `TAG_IDS` / `V2_FLAG_TAG_IDS`). Numeric ids only live in code maps for backward compat with the legacy `addTag(id, tagId)` signature.
- `bridge_events(evt_id UNIQUE)` audits every signed webhook envelope and dedupes retries.
- `messages.wa_message_id` carries the bridge-side id for dedupe on inbound webhook retries.

**Identity:** for bridge-origin leads we store the chat JID (e.g. `972…@s.whatsapp.net`) in `leads.manychat_sub_id`. ManyChat-origin leads keep their numeric subscriber id. The two namespaces never collide (JIDs contain `@`).

**Webhook endpoint:** [app/api/bridge/webhook/route.ts](app/api/bridge/webhook/route.ts) verifies HMAC-SHA256 over `t.rawBody` against `BRIDGE_WEBHOOK_SECRET`, rejects >5min replay window, logs to `bridge_events`, and routes `message.received`/`message.sent` through `lib/bridge/client.ts`. Other event types (`delivered`/`read`/`failed`/`tenant.*`) are audit-logged only.

**Templates are out.** The bridge only sends free-form text/media inside the
WA 24-hour customer-service window. Outside it, WhatsApp blocks the send.
There is currently no template fallback — `scripts/restart-send.ts` is
historical and not in use.

**Contact enrichment:** the bridge `message.received` event does NOT carry
name/phone for `@lid` JIDs. `upsertLeadFromBridgeEvent` calls
`GET /v1/contacts/<jid>` and merges via `COALESCE` so manual edits are
preserved. `scripts/backfill-contact-info.ts` re-enriches in bulk.

## Eli's own WhatsApp thread is a two-way console (built 2026-09-13)

Every system alert already goes to Eli by `sendEliDM`, and anything he writes
back to the business number lands in `messages` under his JID — so the thread
is a console that needed no new integration, only a CLI:

```bash
DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" \
  npx tsx scripts/eli-inbox.ts read            # new since the last read
#                             read --since 3h  # a window; leaves the cursor alone
#                             say "<text>"     # a real WhatsApp to Eli
```

The cursor lives in `.claude/eli-inbox-cursor` (gitignored, per-machine). The
interactive CLI advances it as before; the background assistant peeks with
`--no-advance` and commits it only after a successful reply or an explicit
`NO_REPLY`. Agent/auth/send failures therefore retry the same message instead
of consuming it. The cursor still advances to when the query STARTED, so a
message written mid-run is re-read rather than skipped.

**Provider switch (migrated 2026-09-15).** `scripts/assistant/check.mjs` supports
`ALBADI_ASSISTANT_PROVIDER=codex|claude`. The loaded LaunchAgent selects
`codex`; `claude` is the rollback path and keeps the same cursor/state. Codex
runs locally through `codex exec --ephemeral --ignore-user-config --sandbox
read-only` and reuses the
Mac's ChatGPT login — no API key. Both providers only return final text; the
deterministic wrapper calls `reply.mjs` after a successful exit, so the agent
itself has no send capability. `NO_REPLY` means commit the cursor and stay
silent.

**`say` goes through prod on purpose.** `ELI_NOTIFY_JID` and the GreenAPI
credentials are Production-scoped and `vercel env pull` masks them to `""`, so
a local `sendEliDM` can only ever return `no_jid`.
[/api/admin/eli-dm](app/api/admin/eli-dm/route.ts) is the bridge, and **the
recipient is deliberately NOT a parameter** — it always goes to
`ELI_NOTIFY_JID`, so even a leaked bearer can text Eli and nobody else. Do not
generalise it into send-to-anyone; customer sends have their own audited paths
(`sendBridgeMessage`, `sendTeamDM`) that attribute and record the message.

⚠️ His number carries a `leads` row ("Max Baby", `NO_RESPONSE_REENGAGE`,
paused `manual_toggle`). Leave it paused — it is the reason the bot has never
tried to sell him bags.

## ⚠️ A colleague's message is invisible to `messages` — and it cried wolf

The team-member skip (see below) means an inbound from Simon or the Eco
Brothers partner creates **no `messages` row at all**, by design. On 14/09 that
collided with the WhatsApp health check, which measured "is inbound alive?" by
the newest `messages` row: five webhooks landed between 01:19 and 02:00, all
handled correctly, and at 06:42 the check told Eli his inbound had *"probably
died again, just like 7.9"*.

`assessGreenHealth` ([health.ts](lib/greenapi/health.ts)) now takes liveness
from `bridge_events` type `green.incomingMessageReceived` — recorded for every
inbound regardless of sender — and reports `lastCustomerMessageAt` separately
for the human. Regression test in [health.test.ts](lib/greenapi/health.test.ts).

**The general rule: any "is X still alive?" check must watch the signal that
fires for EVERY case, not the one a deliberate exclusion filters.** And a false
alarm on this particular alert is the expensive kind — its entire worth is that
Eli believes it on the day the pipe really does go deaf.

(Test-env note: `lib/greenapi/client` reads its credentials into module
constants at import time, so a test must set them in `vi.hoisted`, before the
import. A `vi.stubEnv` in `beforeEach` lands too late and every assertion fails
with "GreenAPI לא מוגדר" instead of the rule under test.)

## Messaging a colleague — "שלח לסיימון הודעה" (built 2026-08-25)

When Eli says *send X a message* mid-session, X is usually a **colleague, not a
lead**. Use [lib/notify/team.ts](lib/notify/team.ts):

```ts
import { sendTeamDM, findMember, loadTeam } from "@/lib/notify/team";
await sendTeamDM("סיימון", "…");   // id / name / alias all match
```

CLI (no code needed):
```bash
DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/team.ts list
# … team.ts add <id> <name> <phone> <he|zh|en> "<role>" [aliases]
# … team.ts dm <id-or-name> "<text>"        ← sends a real WhatsApp
```

**⚠️ NEVER add a colleague to `leads`.** The bot would follow them up, they'd
sit in the pipeline, and they'd skew every analytics screen. The registry is
`app_config` key `crm.team` — same place and reasoning as `crm.quoteNotify`, so
**a phone number never lands in git** and re-pointing needs no redeploy.
Registered today: `simon` — 中文, buys from and talks to the Chinese factories.

**⚠️ Registering them is only half of it — the INBOUND webhook has to know too
(fixed 2026-08-30).** The registry protected sends; the Green webhook still saw
an unknown number. When Simon answered a question we had sent him, it made him
a lead, synced a GHL contact, and the bot opened the **Hebrew questionnaire** on
him and nudged him again hours later — he replied *"can you explain to me in
English?"* and Eli had to apologise for the bot. Both handlers in
[greenapi/webhook](app/api/greenapi/webhook/route.ts) now call
`findTeamMemberByPhone(chatId)` **before** `upsertLeadFromGreen` and return
early — no lead, no GHL contact, no bot, in either direction. Any NEW inbound
path must do the same; the registry alone will not save you.

Side note from that incident: **GHL rewrites a foreign number to the location's
country.** Simon's `+8615180009512` came back from `ContactCreate` as
`+9728615180009512`, and the resync mirrored that into `leads.phone_e164`. The
sid/JID stayed correct, so sending still worked — but don't trust `phone_e164`
for a non-Israeli contact.

Sends go out as `sender='eli'` through the normal `sendBridgeMessage` path, so
the message is recorded in `messages` like any other outbound. The GHL mirror
will log `ghl_mirror.skip reason=no_lead` — expected and harmless; a colleague
has no GHL contact.

**Always show Eli the text and the recipient before sending.** A DM to a real
person is not undoable, and Chinese-language messages he can't proof-read are
exactly where a mistake costs the most.

## Quote-sent notification is settings-driven (2026-08-10)

Itay used to be pinged on WhatsApp for every quote sent, hardwired to
`ITAY_NOTIFY_JID`. The recipient now lives in `app_config` key `crm.quoteNotify`
`{enabled, phone, name}` ([quote-notify-config.ts](lib/notify/quote-notify-config.ts)),
edited from the settings screen ("התראה על שליחת הצעה ללקוח"). **Currently
DISABLED.** The env var is only the legacy fallback; the JID cache is per-target
so re-pointing takes effect without a redeploy.
