---
paths:
  - "lib/ghl/**"
  - "integrations/ghl/**"
  - "app/api/ghl/**"
  - "app/api/integrations/**"
  - "lib/crm-tasks/**"
  - "lib/analysis/reconcile-stages.ts"
  - "lib/analysis/pipeline-audit.ts"
---

# GHL — source of truth, tasks, lead score, audits

- GHL owns every field Eli edits in its UI; DB mirrors via webhook: name/phone/email, `lead_tags`, custom fields (`bot_summary`, `quote_total`, `loss_reason`, `bot_paused`, `pipeline_flag`, `albadi_lead_score`), `leads.notes`, `crm_tasks` (by `ghl_task_id`), `leads.pipeline_stage` (via `GHL_STAGE_IDS`), `opportunities.value_ils`/`won_at`/`lost_at`.
- DB-only (GHL never touches): `q_state`, `quote_alt`, `factory_spec_draft`, `messages`, `bot_*` tables, `app_config`, `factory_quote_requests`, `bridge_events`, `source_touches`, `ghl_lead_tasks` (full list in doc).
- New shared field or webhook → update the matrix in `docs/ARCHITECTURE.md` §3b. No GHL trigger for it → extend `/api/ghl/resync` rather than adding a narrow webhook.
- `resyncContact` (`lib/ghl/resync-helper.ts`) CREATES a missing lead (sid `<phone>@s.whatsapp.net` or `ghl:<contactId>`); "resync only updates" is no longer true.
- Loop guard: `syncLeadToGHL` → resync re-read is safe only because merges are idempotent (`COALESCE`, stage equality check).
- Deleting a test lead: delete the GHL contact FIRST or resync recreates it; tables in `scripts/_purge-eli-lead.ts`.
- Auto-tasks go to the lead's live GHL owner (`resolveTaskAssigneeForSid`/`ByContact` → `assignedTo`); `crm.assignee` is only the fallback. `leads.ownerId` is NULL for everyone — never read ownership from it.
- `crm.assignee` modes `single` / `round_robin`; only `upsertGHLContact` (first push) and `createOpportunity` call `assignNextLeadOwner(sid)` (idempotent per lead via `leads.owner_id`). `resolveAssigneeUserId()` must stay passive (never advances the cursor).
- Albadi Lead Score lives on the CONTACT (`contact.albadi_lead_score`, id `zneBwsG0dSB3ajj8lnjv`, `lib/ghl/albadi-lead-score.ts`). Write only via `setAlbadiLeadScore(sid, band)`; `buildCustomFieldsPayload` pushes it only when non-null (null would wipe Eli's manual choice). Zero opportunity custom fields is correct.
- `leads.lead_score` is an unrelated legacy numeric band — never conflate or consolidate with `albadi_lead_score`.
- Field migrations: verify every old value exists on the new field before deleting; confirm deletion by `GET` on the id (400 = gone), not by re-listing.
- Smart Lists have no public API — build them in the GHL UI.
- Duplicate opportunities: `reconcileStagesFromGhl` picks the most-recently-updated opp (linked `ghl_opportunity_id` only as fallback). Dragging to "לא נסגר" keeps `status:'open'`, so LOST depends on `GHL_STAGE_LOST` mapping.
- Pipeline-audit stage suggestions live in `lib/analysis/pipeline-audit.ts`; applying goes through `setLeadStage` (DB + GHL + `ensureAutoTaskForStage`).

Full detail: `docs/agent/ghl.md` — read it before non-trivial changes here.
