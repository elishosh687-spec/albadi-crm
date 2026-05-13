# Albadi Lead Flow & Follow-up Spec

Captured 2026-05-13. Single source of truth for the in-house bridge-based bot.

## 1. Lead journey

```
inbound (Meta ads → WhatsApp)
        ↓
    NEW (autoresponder eligible)
        ↓ first inbound (any text)
    QUESTIONNAIRE   ──┐
        ↓             │ 2 unmatched answers OR stop-word
        ↓             ↓
    WAITING_FACTORY  bailed / DROPPED-by-Eli
        │ Eli pastes factory price
        ↓
    QUOTED
        ↓ (haggle)     ↓ (asks call)
    NEGOTIATING ←→ WAITING_CALL
        ↓ Eli marks accepted
    IN_PROGRESS
        ↓ shipped
    WON
```

- Free-text-spec / keyword detect: **deferred**. Customer always goes through the questionnaire so we capture every field.
- Stage refactor (collapse WAITING_CALL into NEGOTIATING, drop QUESTIONNAIRE in favor of q_state, demote SILENT to a flag): **deferred**.

## 2. Autoresponder (already coded)

File: `lib/autoresponder/questionnaire.ts`.

- Runs only on leads with `pipeline_stage IN (NULL, 'NEW')` — Eli's in-flight chats are never hijacked.
- Trigger: ANY first inbound (no keyword required).
- 5 list questions (shipping, quantity, product, handles, colors).
- Off-topic mid-Q → re-ask current question. 2 unmatched → bail (set `q_state.bailed=true`, hand off to Eli).
- Calc API success → `pipeline_stage = QUOTED`, mark `q_state.doneAt`.

## 3. Follow-up engine (new)

Goal: **squeeze the lead until they buy or say "remove me"**. Eli decides final drop on a call, never the bot.

### 3.1 Cadence by stage

| Lead state                     | Sender   | Cadence              | Max sends | Notes |
| ------------------------------ | -------- | -------------------- | --------- | ----- |
| Mid-questionnaire abandoned    | customer | every **1 hour**     | 3         | "started Q, didn't finish" |
| QUOTED (WA-sent, no reply)     | customer | every **2 hours**    | 3         | "how does the offer look" |
| NEGOTIATING / WAITING_CALL     | customer | every **2 hours**    | 3         | "ready to move forward" |
| WAITING_FACTORY                | **Eli**  | once **daily**       | n/a       | "lead X has been waiting Y days — chase factory" — **no customer-side msg** while waiting |

### 3.2 Counter reset

Any inbound from the customer → `follow_up_count = 0`. Fresh 3-send budget.

### 3.3 Escalation

After 3 unanswered follow-ups in a row:
1. Set `pipeline_flag = NEEDS_ELI` (dashboard inbox shows red flag).
2. WhatsApp DM to `ELI_NOTIFY_JID`: `"ליד {name} ({phone}) קר אחרי 3 פולואפים בשלב {stage}. תתקשר איתו."`
3. Set `bot_paused = true` on lead.
4. Bot ignores this lead until either:
   - Eli flips `bot_paused = false` in dashboard, OR
   - Customer sends a new inbound → bot auto-resumes (reset counter to 0, un-pause).

### 3.4 Stop-word handler

If inbound text contains any of:
`stop`, `תפסיק`, `תפסיקו`, `לא מעוניין`, `remove me`, `הסר אותי`, `אל תשלחו`

→ Set `bot_paused = true`, `pipeline_flag = NEEDS_ELI`, send WA DM to Eli, **do not auto-DROP**. Eli closes on a call.

### 3.5 Quiet hours

- Timezone: `Asia/Jerusalem` (handles DST).
- No sends between **21:00 and 09:00** local.
- If cadence elapses inside quiet window, send fires at 09:00 sharp the next day.

### 3.6 No-send days

- **Friday** — full day, no sends.
- **Saturday** — full day, no sends.
- **Holiday eve** — full day before the holiday (e.g. if holiday falls Tuesday, no sends Monday).
- **Holiday day** — full day.

Source: [Hebcal API](https://www.hebcal.com/home/195/jewish-calendar-rest-api) (major holidays: Rosh Hashanah, Yom Kippur, Sukkot, Pesach, Shavuot, etc.). Cache day-of-year results locally.

### 3.7 Manual override

Boolean `bot_paused` on `leads`. Dashboard exposes a toggle button per lead. Bot checks before any send.

## 4. Win signal

No automatic detection. Eli flips `pipeline_stage = IN_PROGRESS` (or `WON` after shipping) in `/dashboard/v2`. Until then, the QUOTED follow-up loop keeps nudging "how does the offer look?" — the goal is to force a yes/no.

## 5. Templates needed (Hebrew, customer-facing)

All sent free-form via bridge (no 24h limit on the new bridge API → no WhatsApp business template approval needed).

1. **Mid-questionnaire abandoned** — *"ראיתי שהתחלנו אבל לא סיימנו 😊 רוצה שנמשיך? פשוט תכתוב את התשובה לשאלה האחרונה."*
2. **Quoted, no reply** — *"מה דעתך על ההצעה? יש משהו שתרצה לשנות?"*
3. **Negotiating / call pending** — *"רוצה שנקבע שיחה קצרה כדי לסגור פרטים?"*
4. **Factory-wait Eli reminder (Eli-only)** — *"⏰ ליד {name} מחכה X ימים לציטוט מהמפעל."*

Future: LLM-polish each template per-lead from conversation context. For now keep deterministic templates.

## 6. Infra needs

- **DB:**
  - `leads.follow_up_count INT DEFAULT 0`
  - `leads.last_follow_up_at TIMESTAMP`
  - `leads.bot_paused BOOLEAN DEFAULT false`
  - `leads.pipeline_flag TEXT` (`NEEDS_ELI` etc — multi-flag later)
- **Env:** `ELI_NOTIFY_JID` (E.164 → JID after lid resolve).
- **Cron:** new route `/api/bot/followups` — runs every 15 min, picks eligible leads, respects quiet-hours/Sabbath/Hebcal, fires `sendBridgeMessage` per stage template, increments counter, escalates on threshold.
- **Helpers:**
  - `lib/clock/quiet-hours.ts` — `isQuietNow()`, `nextWakeAt()`.
  - `lib/clock/hebcal.ts` — `isNoSendDay(date)` cached daily.
  - `lib/notify/eli.ts` — sends WA DM via bridge to `ELI_NOTIFY_JID`.
- **Dashboard:**
  - Per-lead `bot_paused` toggle.
  - `pipeline_flag = NEEDS_ELI` filter view.

## 7. Open / deferred

- Eli's WA number for `ELI_NOTIFY_JID` — pending from Eli.
- WAITING_FACTORY → QUOTED transition flow (Eli pastes price in dashboard → triggers customer-facing send + flips stage).
- Stage simplification pass (10 → 6 stages).
- LLM template-per-customer polish.
