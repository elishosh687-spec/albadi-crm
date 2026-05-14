# Albadi Lead Flow & Bot Spec — **v1 (ARCHIVED 2026-05-13)**

> 🗄️ **מסמך מארכב.** הוחלף על ידי [../ARCHITECTURE.md](../ARCHITECTURE.md) (state-of-code) + [../CUSTOMER-FLOW.md](../CUSTOMER-FLOW.md) (customer journey).
> נשמר כ-snapshot היסטורי של גרסה ראשונה (bridge cutover). אל תעדכן.

Captured 2026-05-13. Single source of truth for the in-house bridge-based bot.
**The bot owns the entire pipeline.** No standalone classifier — LLM intent
classification happens inline in the webhook.

## 1. Pipeline stages

`V2_PIPELINE_STAGES` (lib/manychat/stages.ts):

```
NEW (autoresponder runs questionnaire while pipeline_stage stays NEW)
  ↓ questionnaire done, standard spec → calc API → quote sent → AWAITING_DECISION
  ↓ questionnaire done, custom spec → WAITING_FACTORY (Eli quotes manually)
  ↓ 2 unmatched answers → NEEDS_ELI flag (lead stays in NEW; Eli takes over)

AWAITING_DECISION (bot asks "המחיר מתאים?", waits for yes/no/other)
  ↓ accept                            → AWAITING_LOGO
  ↓ samples_request                   → bot sends catalog link, stays here
  ↓ reject/negotiating/custom_size/question → NEEDS_ELI + bot_paused
  ↓ no answer                         → follow-up cron (2h × 3) → NEEDS_ELI

AWAITING_LOGO (bot asked customer to send logo)
  ↓ any media inbound                 → IN_PROGRESS + NEEDS_ELI (Eli calls)
  ↓ text-only re-asks                 → up to 3, then NEEDS_ELI

WAITING_FACTORY (Eli is fetching factory price)
  ↓ Eli sets pipeline_stage = QUOTED  (factory price ready)

QUOTED (Eli manually moved here after a factory quote)
  → routes through the same intent classifier as AWAITING_DECISION

NEGOTIATING / WAITING_CALL (Eli manually placed)
  → routes through the same intent classifier

IN_PROGRESS (Eli marked deal accepted)
  ↓ Eli marks shipped → WON

WON
DROPPED (Eli-only after a call — bot NEVER sets this)
```

Orthogonal flags on `leads`:
- `pipeline_flag = 'NEEDS_ELI'` — lead needs human attention.
- `bot_paused = true` — bot skips this lead entirely.

Removed in this refactor: `QUESTIONNAIRE` and `SILENT` stages. SILENT was
timer-derived (now expressed as `pipeline_flag`); QUESTIONNAIRE state lives
in `leads.q_state` JSONB while `pipeline_stage` stays `NEW`.

## 2. Questionnaire (lib/autoresponder/questionnaire.ts)

Runs ONLY when `pipeline_stage IN (NULL, 'NEW')`. Trigger: any first inbound.

Questions:
1. Shipping (express / standard)
2. Quantity (1k / 3k / 5k / 10k / **אחר** — free-text capture)
3. Product size (6 fixed sizes / **אחר** — free-text capture)
4. Handles (with / without)
5. Colors (1 / 2 / 3)

When the customer picks "אחר" on Q2 or Q3 the bot:
1. Sets `q_state.pendingCustomField`, asks "כמה?" / "מה המידות?".
2. Captures the next inbound as `q_state.quantityCustom` / `productCustom`.
3. Continues to the next question normally.

End of questionnaire:
- **No custom fields** → POST to bag-quote-app calc API → `pipeline_stage = QUOTED` → send quote → send "המחיר מתאים?" → flip to `AWAITING_DECISION`.
- **Any custom field** → skip calc API → `pipeline_stage = WAITING_FACTORY`, `pipeline_flag = NEEDS_ELI`, customer gets hold message, Eli gets DM with the full spec.

2 unmatched answers in a row → bail: `q_state.bailed = true`, flag NEEDS_ELI, Eli DM. Lead stays in NEW until Eli takes over.

## 3. Decision sub-flow (lib/autoresponder/decision.ts)

Triggered when `pipeline_stage` is `AWAITING_DECISION`, `AWAITING_LOGO`,
`QUOTED`, `NEGOTIATING`, or `WAITING_CALL`. Calls `lib/autoresponder/intent.ts`
(OpenAI `gpt-4o-mini`, JSON mode) to classify the inbound text into one of:

| Intent | Bot action |
| --- | --- |
| `accept` | move to `AWAITING_LOGO`, ask for logo |
| `samples_request` | send catalog URL, stay in current stage |
| `reject` | escalate: NEEDS_ELI + pause + DM "הלקוח דחה את ההצעה" |
| `negotiating` | escalate: NEEDS_ELI + pause + DM "הלקוח רוצה הנחה" |
| `custom_size` | escalate: NEEDS_ELI + pause + DM "ביקש מידה לא סטנדרטית" |
| `question` | escalate: NEEDS_ELI + pause + DM "שאל שאלה שהבוט לא יכול לענות" |
| `other` | no-op — follow-up cron keeps nudging |

LLM soft-fails to `other` on any error (missing env, timeout, parse error).

`AWAITING_LOGO` is media-driven, not LLM-driven:
- Inbound contains media (image/file detected via `data.media_path` / `type !== "text"`) → `IN_PROGRESS` + NEEDS_ELI + DM "התקבל לוגו, צריך להתקשר".
- Text-only inbound → re-ask via `LOGO_REASK` up to 3 attempts (uses `follow_up_count` as the budget). 4th attempt = escalate.

Catalog URL: `https://bag-quote-app.vercel.app/catalog`.

## 4. Follow-up engine (app/api/bot/followups/route.ts)

Vercel cron, every 15 minutes. Gates: quiet hours (21:00-09:00 Asia/Jerusalem),
no-send days (Fri / Sat / holiday-eve / holiday via Hebcal API, 6h cache).

Cadence by stage:

| Stage | Sender | Cadence | Max sends |
| --- | --- | --- | --- |
| NEW (mid-questionnaire abandoned) | customer | every **1 hour** | 3 |
| AWAITING_DECISION | customer | every **2 hours** | 3 |
| AWAITING_LOGO | customer | every **2 hours** | 3 |
| QUOTED | customer | every **2 hours** | 3 |
| NEGOTIATING / WAITING_CALL | customer | every **2 hours** | 3 |
| WAITING_FACTORY | **Eli** | once **daily** | n/a |

After 3 unanswered customer follow-ups → escalate: `pipeline_flag = NEEDS_ELI`,
`bot_paused = true`, Eli WA DM. Bot ignores the lead until either Eli flips
`bot_paused = false` from the dashboard OR the customer sends a new inbound
(auto-resume: clear flag + paused, reset counter).

## 5. Webhook routing (app/api/bridge/webhook/route.ts)

Per inbound `message.received`:
1. Skip `@broadcast`, `@g.us`, own echoes.
2. Insert message + upsert lead.
3. Stop-word check (`isStopWord`) — escalate + pause + return.
4. Reset counter + `last_follow_up_at = now` + clear `bot_paused` + clear `pipeline_flag`.
5. Route by current `pipeline_stage`:
   - `NULL / NEW` → questionnaire autoresponder.
   - `AWAITING_DECISION / AWAITING_LOGO` → decision sub-flow.
   - `QUOTED / NEGOTIATING / WAITING_CALL` → decision sub-flow (same LLM router).
   - `WAITING_FACTORY / IN_PROGRESS / WON / DROPPED` → bot silent (Eli handles).

Stop-word patterns: `stop`, `תפסיק`, `תפסיקו`, `לא מעוניין`, `הסר אותי`,
`אל תשלחו`, `remove me`, `unsubscribe`.

## 6. Dashboard surface

- **`/dashboard`** — overview card: count of NEEDS_ELI leads, active leads, msgs today.
- **`/dashboard/v2`** — `NeedsEliCard` (each row has a pause/resume toggle) + per-stage counters linking to stage detail pages.
- **`/dashboard/v2/stage/[stage]`** — leads in a single stage; click "✎ הערות / שנה stage" to open `NotesModal` for direct edit.
- **No Inbox** — no pending suggestions, no approval queue. The bot writes directly.

## 7. Env vars

| Var | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Intent classifier (Chat Completions). |
| `OPENAI_MODEL` | Defaults to `gpt-4o-mini`. |
| `ELI_NOTIFY_JID` | WA phone E.164 — bot DMs Eli here on escalation. |
| `BRIDGE_BASE` / `BRIDGE_TENANT_TOKEN` / `BRIDGE_WEBHOOK_SECRET` | bridge auth. |
| `BOT_SECRET` / `CRON_SECRET` | accepted by `/api/bot/followups`. |
| `USE_BRIDGE` | `1` while the bridge is the source of WhatsApp send/receive. |

## 8. What this refactor deleted

- `app/api/bot/queue-analysis/` (classifier queue producer).
- `app/api/bot/cron/` (classifier scheduler).
- `app/api/bot/claude-context/`, `app/api/bot/save-suggestion/` (classifier I/O).
- `app/dashboard/v2/InboxList.tsx`, `InboxRow.tsx` (approval UI).
- `analysis_queue`, `pipeline_suggestions`, `eli_decisions` DB tables.
- `scripts/enqueue-factory-leads.ts`.
- `V2_PIPELINE_STAGES`: removed `QUESTIONNAIRE` and `SILENT`; added `AWAITING_DECISION` and `AWAITING_LOGO`.
- `app/actions/v2.ts`: removed `approveSuggestion`, `rejectSuggestion`, `bulkApprove`. Kept `setLeadStage`, `updateLeadNotes`, `setBotPaused` (all write directly).

## 9. Open / deferred

- LLM template-per-customer polish (today templates are deterministic strings).
- Win signal automation (Eli still manually moves IN_PROGRESS → WON).
- Re-design `/dashboard/v2` from scratch — current layout is the old classifier-era UI minus the Inbox. A clean rewrite is planned but separate.
