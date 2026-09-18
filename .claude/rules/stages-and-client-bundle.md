---
paths:
  - "lib/manychat/stages.ts"
  - "docs/CUSTOMER-FLOW.md"
---

# Pipeline stages + client-bundle rule
- Source of truth: `V2_PIPELINE_STAGES` in `lib/manychat/stages.ts`; internal names match GHL exactly (no translation layer). Transitions: `docs/CUSTOMER-FLOW.md`.
- Keys: `NULL`, `INTAKE`, `DISCAVERY`, `FACTORY_WAIT`, `CONSIDERATION`, `WON`, `LOST` (requires `loss_reason`). Side stages `FUTURE_FOLLOW_UP`, `NO_RESPONSE_REENGAGE`: operator-dragged, bot never transitions.
- Rename/merge: ADD the old name to `LEGACY_STAGE_MAP` (never remove entries); run the `UPDATE leads SET pipeline_stage` backfill AFTER the code lands.
- UI labels from `V2_STAGE_LABELS` only (INTAKE קליטה, DISCAVERY אפיון, FACTORY_WAIT מחכה למפעל, CONSIDERATION שוקל / משא ומתן, LOST אבוד); keys unchanged.
- `NULL` and `INTAKE` both render as קליטה in the audit.
- `"use client"` code must never import server-only modules that throw on missing env — `lib/manychat/config.ts` throws without `MANYCHAT_TOKEN`; symptom: React tree unmounts in the browser while Vercel logs show 200.
- Client-safe constants (`V2_PIPELINE_STAGES`, `V2PipelineStage`, `V2_FLAG_TAG_IDS`, `V2FlagName`, `V2_FLAG_NAMES`) go in `stages.ts`, not `config.ts`.
- Blank/crashed page: read the DevTools console first (runtime logs cover SSR only).

Full detail: `docs/agent/stages-and-client-bundle.md` — read it before non-trivial changes here.
