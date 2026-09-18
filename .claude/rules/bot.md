---
paths:
  - "lib/autoresponder/**"
  - "lib/setter/**"
  - "lib/bot-settings/**"
  - "lib/analysis/**"
  - "lib/sales/**"
  - "app/api/bot/**"
  - "bot design/**"
---

# Bot layer, setter, lead analyzer
- Code owns the questionnaire, price maths, when/whom/how often, and whether a transition happens; the setter (`lib/setter/`) only supplies words (`phraseStateReply`, with `mustMention` keeping the operative ask).
- Every LLM send path needs a fixed fallback. Failures are silent: `setter_decisions.draft_text IS NULL` = LLM dead.
- Never put a concrete value in a prompt as an "example" (the model sent "היום ב-17:00" verbatim, after 17:00). Hours come from `proposeCallSlots` (`lib/setter/slots.ts`); `validateMessage` rejects any hour AND day not offered.
- Skill text has an editable twin in `app_config` → `bot.settings` that shadows `skills.ts`; editing the constant alone changes nothing.
- Setter must never name a superseded amount: `findNewerCustomerQuote` nulls `quote.totalIls`, then the money guard rejects any ₪.
- Media at the decision stage routes to `handleLogoStage`; a caption is never a spec change (caused a wrong requote → LOST lead).
- New `bot.settings` field: schema → FIELD entry → wire it (unwired = lie). Analyst BRIEF is editable; the JSON SCHEMA is appended in code, never editable.
- Always pause via `pauseFields(reason)`; resume must reset `followUpCount` and clear `botPauseSticky`. Only `human_reply`/`escalation`/`logo_received`/`reengagement_reply` expire; `opt_out`/`human_handoff` never expire and are irrevocable from GHL (`ghlPauseChange`/`applyGhlPause`).
- Sub-daily jobs run on GitHub Actions, not `vercel.json`. `followups` run-lock is an `app_config` row claim, never a pg advisory lock (Neon HTTP drops it). Followups `maxDuration` 120 must stay below workflow `curl --max-time` 150; update comments with it.
- `FUTURE_FOLLOW_UP` loop: rule in `STAGE_RULE_SHAPES`, gate in `lib/autoresponder/future-followup.ts`, ships OFF (`futureFollowupEnabled`), manual entry, `enterFutureFollowUp` resets the count, daily cap `claimFutureDailySlot` is mandatory (dry run counts it in memory only).
- Revival stages and `callbackFlow='awaiting_reply'` must stay exempt from the `isNewConversation` 7-day restart in BOTH webhooks.
- `leads.last_response_at` has no writers — compute silence from `messages`.
- Bot never advances `pipeline_stage` (its sites write `INTAKE`; `qState.subFlow` tracks next step). Every stage-write site calls `ensureAutoTaskForStage`.
- Lead analyzer: `analyzeLead` caches on `input_hash`; `isGrounded()` drops ungrounded quotes deterministically; never let the LLM guess a fact the DB knows. `lead_analyses` DDL is direct, not `drizzle-kit push`.

Full detail: `docs/agent/bot.md` — read it before non-trivial changes here.
