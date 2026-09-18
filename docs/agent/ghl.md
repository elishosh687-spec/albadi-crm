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

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

## GHL is single source of truth (READ BEFORE TOUCHING ANY SHARED FIELD)

**Decision 2026-05-22:** every field that Eli edits in the GHL UI is owned by
GHL. DB just follows. No two-source-of-truth drift.

**Shared fields (GHL owns, DB mirrors via webhook):**
- `leads.name`, `leads.phone_e164`, `leads.email`
- `lead_tags.tag` (Contact.tags)
- `leads.bot_summary`, `leads.quote_total`, `leads.loss_reason`,
  `leads.bot_paused`, `leads.pipeline_flag` (Contact.customFields)
- `leads.albadi_lead_score` (Contact.customFields — see "Albadi Lead Score" below)
- `leads.notes` (Contact.notes, concat of all)
- `crm_tasks` rows (Contact.tasks, upserted by `ghl_task_id`)
- `leads.pipeline_stage` (Opportunity.pipelineStageId, mapped via `GHL_STAGE_IDS`)
- `opportunities.value_ils` (Opportunity.monetaryValue)
- `opportunities.won_at` / `lost_at` (Opportunity.status)

**DB-only fields (GHL never touches):**
- `leads.q_state` (questionnaire FSM), `leads.quote_alt`, `leads.factory_spec_draft`
- `messages`, `bot_quotes`, `bot_drafts`, `bot_decision_log`
- `bot_config`, `app_config`, `factory_quote_requests`, `bridge_events`
- `crm_sla_timers`, `lead_score_snapshots`, `source_touches`, `ghl_lead_tasks`

**Webhook map (GHL → DB):**
| Endpoint | Trigger | Scope |
|---|---|---|
| `/api/ghl/stage-changed` | Opportunity Stage Changed | `leads.pipeline_stage` only |
| `/api/integrations/inbound/ghl-tag` | Contact Tag Added/Removed | `lead_tags` delta |
| `/api/integrations/inbound/ghl-custom-field` | Custom Field Changed | `bot_paused`, `follow_up_date` only |
| `/api/ghl/resync` | Contact Changed + Opportunity Changed | **catch-all full pull** — name, phone, email, tags, customFields, notes, tasks, opps |

**resync now CREATES, not just updates (2026-07-29).** `resyncContact`
([lib/ghl/resync-helper.ts](lib/ghl/resync-helper.ts)) used to bail with
`no_lead_matched` when a GHL contact had no DB lead — which meant a contact
created **manually in the GHL UI** (`attributionSource` = CRM UI / manual),
the one ingestion path that never makes a DB row, stayed invisible to the bot
and every CRM screen forever. It now INSERTS the lead (synthetic sid:
`<phone>@s.whatsapp.net`, or `ghl:<contactId>` when phoneless) and fills the
rest as usual. The native `ContactCreate` app-webhook already fires, so manual
GHL leads now land in DB automatically — no screen, no cron. Only truly-empty
contacts (no phone AND no name) are still skipped. So the old "resync only
updates, never creates" assumption (still echoed in some scratch scripts /
memories) is **no longer true**.

**Rule:** if you add a new shared field or webhook, update the matrix in
[docs/ARCHITECTURE.md §3b](docs/ARCHITECTURE.md). If GHL doesn't have a
trigger for what you need, prefer extending the resync endpoint over
making another narrow webhook.

**Loop guard:** when the bot writes a shared field to DB, `syncLeadToGHL`
pushes to GHL. The resync webhook will then fire and re-read the same
value — but the merge is idempotent (`COALESCE` semantics for nullable
fields, stage equality check for pipeline_stage), so no infinite loop.

## GHL-gap audit (leads missing from GHL)

For "לידים שנופלים בין הכיסאות" — active leads with WhatsApp activity (msgs / jid / phone) and `ghl_contact_id IS NULL`. Two ways to run, both already in the repo:

- **HTTP** (recommended): `GET /api/admin/audit-ghl-gap` with `Authorization: Bearer $BOT_SECRET`. Query params: `?limit=N` (1..500, default 100), `?onlyBotTouched=1`. Returns `{summary, leads}`. Source: [app/api/admin/audit-ghl-gap/route.ts](app/api/admin/audit-ghl-gap/route.ts).
- **CLI**: [scripts/audit-ghl-gap.ts](scripts/audit-ghl-gap.ts). Run with the neonctl one-liner above.

## Deleting a lead end-to-end (test cleanup pattern)

Sixteen tables reference a lead by `manychat_sub_id` (or `lead_sid` in `bot_quotes` / `ghl_lead_tasks`). None have FK constraints, so deletes never cascade or block. For a clean test reset:

1. **Delete the GHL contact via UI first** — otherwise the next GHL resync recreates the DB row from GHL state.
2. Run a scoped script that deletes from each table where the sid matches. The full table list is in `scripts/_purge-eli-lead.ts` (scratch, underscore-prefixed). Order doesn't matter — no FKs.
3. Verify with a phone/sid lookup against `leads`.

The bot-side effect: after a fresh insert via the FB-import path, the new lead has `ghl_contact_id=NULL` until the first inbound triggers a GHL sync.

## Task ownership — auto-tasks follow the LEAD'S GHL owner (2026-08-02 rule)

The 2026-07-01 "every task → Itay" rule evolved twice:
- **2026-08-01:** the default owner became **settings-driven** — `crm.assignee`
  in `app_config` (settings screen → [components/settings/AssigneeSection.tsx]),
  read by `resolveAssigneeUserId()` in [lib/crm-tasks/assignee.ts], env
  `GHL_SALESPERSON_USER_ID` as the fallback. This sets who OWNS new leads
  (the opportunity/contact owner on first sync — [sync.ts] `createOpportunity`).
- **2026-08-03 — two assignment MODES.** `crm.assignee` now carries a `mode`:
  `single` (one person owns all new leads, back-compat with the bare `{userId}`)
  or `round_robin` (`{rotation:[{userId,name}…], cursor}` — lead #1 → member[0],
  #2 → member[1], wrapping). The cursor advances **exactly once per new lead**
  via `assignNextLeadOwner(sid)`, which is idempotent per lead: it stamps the
  picked owner on `leads.owner_id` (a previously-dead column, nothing else reads
  it) and reuses it, so the contact + opportunity of ONE lead get the SAME owner
  and the cursor doesn't double-advance. `resolveAssigneeUserId()` stays PASSIVE
  (never advances — it's the task-fallback resolver); only the two new-lead owner
  sites in [sync.ts] (`upsertGHLContact` first push + `createOpportunity` create)
  call `assignNextLeadOwner`. Atomic advance = one `jsonb_set` UPDATE with modulo
  (`cursor = (cursor+1) % len`). `setRoundRobin` resets cursor to -1 so the first
  lead after saving goes to `rotation[0]`. Existing leads are untouched (they
  already have a contact/opp id → neither owner site fires).
- **2026-08-02 (the important one):** an **auto-task now goes to the LEAD'S
  ACTUAL GHL owner**, not the settings default — a task on Itay's lead lands on
  Itay. `resolveTaskAssigneeForSid`/`ByContact` fetch the GHL contact's
  `assignedTo`; the settings default is only the fallback for a lead with no
  owner yet. `leads.ownerId` is NULL for everyone — ownership lives only in GHL,
  so we read it live from `getContact(id).assignedTo`. `syncTaskToGHL` mirrors
  the task's stored assignee (falling back to the contact owner).

  Bug it fixed: every auto-task was assigned to whoever sat in `crm.assignee`
  (Elazar), so tasks on Itay's leads landed on Elazar. Validated on live GHL:
  10/12 sampled leads are Itay's → their tasks now route to Itay.

| Path | Assignee source |
|---|---|
| Auto-task on stage entry ([auto-task.ts]) | lead's GHL owner ?? settings |
| Push to GHL create/update ([sync.ts] `syncTaskToGHL`) | task's stored assignee ?? contact owner ?? settings |
| New lead's opportunity owner ([sync.ts] `createOpportunity`) | settings default (unchanged) |
| Manual UI create ([app/actions/v2.ts]) | user-picked ?? settings default |
| Pull from GHL resync ([resync-helper.ts]) | GHL task's own assignee ?? settings |

The nightly cron sweep catches any row that slipped through.

## Albadi Lead Score — lives on the CONTACT (moved 2026-08-24)

HOT / WARM / COLD, set by hand by Eli on the GHL contact card. It describes the
**lead**, so it belongs to the Contact.

**It used to be an OPPORTUNITY field** (`opportunity.albadi_lead_score`, id
`gNojMCZVszE5m2k8jvXh`, created 2026-05-23, **deleted 2026-08-24**). That was
wrong here specifically:
a GHL contact in this account routinely holds **several** opportunities (the
whole reason `reconcileStagesFromGhl` has a newest-wins rule), so one lead could
carry several conflicting scores with no rule saying which one counted.

| | |
|---|---|
| Field | `contact.albadi_lead_score` |
| Id | `zneBwsG0dSB3ajj8lnjv` |
| Type | RADIO, `picklistOptions` HOT/WARM/COLD, `isAllowedCustomOption: false` |
| DB mirror | `leads.albadi_lead_score` |
| Code | [lib/ghl/albadi-lead-score.ts](lib/ghl/albadi-lead-score.ts) |

**GHL owns it, DB follows** — the standard shared-field rule. In: the native
`ContactUpdate` app-webhook → `resyncContact` → `normalizeAlbadiLeadScore` →
`leads.albadi_lead_score`. Out: `buildCustomFieldsPayload` pushes it, but
**only when non-null** — Eli sets this by hand, so pushing null on an unrelated
sync would wipe his choice. Write from code via `setAlbadiLeadScore(sid, band)`,
never by touching the column directly, or GHL and DB drift.

**⚠️ `leads.lead_score` is a DIFFERENT, unrelated column** — a legacy NUMERIC
band (0/5/20/30/40/45/55) from the ManyChat scoring engine, plus one stray
"HOT" row. Do not conflate them; do not "consolidate" them. Its GHL counterpart
(`GHL_FIELD_LEAD_SCORE`) was deleted from GHL on 2026-06-08, and the resync
branch still reading it was dead code that would have written "HOT" over a
number had the field ever come back — removed 2026-08-24 along with the stale
`lead_score` entry in `GHL_FIELD_IDS`.

**The field id is hardcoded as a fallback** in `GHL_FIELD_IDS.albadi_lead_score`
so no Vercel env write was needed; set `GHL_FIELD_ALBADI_LEAD_SCORE` to override.

**No GHL Workflow is involved** (all 5 in this account are Draft anyway) and no
Automation, filter or integration referenced the old opportunity field — grep
confirmed the codebase never read or wrote it at all. It was purely manual.

**The opportunity field is DELETED** (2026-08-24, at Eli's instruction, after
the 4 values were migrated and verified on the contact). The location now has
**zero** opportunity custom fields — so a `?model=opportunity` list coming back
empty is correct, not a broken token. Snapshot of what it held, if it is ever
needed: Netanel HOT · Lilach HOT · יוסי COLD · Dor Turgeman COLD.

**Two things that bit the deletion, both worth knowing:**
1. **Someone can still be USING a field you are about to delete.** A 4th value
   (Dor Turgeman COLD) appeared on the opportunity field ~1 minute before the
   delete — Eli set it by hand out of muscle memory while the old field was
   still on the card. The delete script refuses to run unless every opportunity
   value is already present on the contact, which is the only reason it wasn't
   destroyed. Keep that pre-flight check in any future field migration.
2. **GHL's custom-field list is stale right after a DELETE.** The list endpoint
   still returned the deleted field, so the verification read "delete FAILED"
   when it had actually succeeded. Confirm a deletion by `GET`ting the field id
   directly — a gone field answers `400 "The custom field id or field_key is
   invalid"` — not by re-listing.

Smart Lists are a Contacts-only feature and never could filter the Opportunity
field — which is why this move was a precondition for the list, not just tidier
modelling.

**Smart List:** `🔥 HOT Leads` (id `vUM1kYCevw0Lc3D4kV1S`), filter
`Albadi Lead Score Is HOT`. Eli wanted **only** the HOT list — deliberately not
one per band; WARM/COLD are noise he doesn't work from.

**⚠️ Smart Lists have no public API** — `/contacts/views` answers
*"We are not supporting OAUTH requests right now"*, every other candidate path
404s. This one was built by driving the GHL UI. Don't burn time hunting for an
endpoint; the flow is Contacts → Filters → field → Apply → "Unsaved changes" →
*Save as new smart list*. Note "New smart list" in the name box is a real
VALUE, not a placeholder — clear it or the name comes out concatenated.

## Pipeline audit — "יישור הלידים" (built 2026-07-01)

Two panels on the ניתוח tab (widget), both auto-load on mount. Deterministic
SQL + LLM verdict, no separate LLM for the audit itself.

**"נפלו בין הכיסאות"** — every lead in an ACTIVE stage (NULL / INTAKE /
DISCAVERY / FACTORY_WAIT / CONSIDERATION — anything except WON/LOST) with
zero open `crm_tasks`. Eli opens each in GHL, adds a task by hand.

**⚠️ Duplicate opportunities — newest wins (2026-07-28).** A GHL contact often
holds SEVERAL opps in the albadi pipeline. `reconcileStagesFromGhl`
([reconcile-stages.ts](lib/analysis/reconcile-stages.ts)) picks the contact's
**most-recently-updated** opp (linked `ghl_opportunity_id` is only the fallback).
The earlier "linked opp always wins" rule left a lead stuck ACTIVE whenever Eli
dragged a *different* card of that contact to "לא נסגר" — the stale linked
duplicate kept winning and the lead never left this panel. Also note GHL dragging
to the "לא נסגר" column does NOT set `status:'lost'` (status stays `open`), so
LOST detection depends on `GHL_STAGE_LOST` being mapped — it is, in prod.
Reconcile failures are now logged loudly (`ok:false` used to print nothing, so a
drifted DB looked freshly synced).

**"שלב לא תואם"** — leads whose `pipeline_stage` lags behind the [lead-analyzer]
verdict, gated on `commitment_scorecard.score_1_5`. Rules in
[lib/analysis/pipeline-audit.ts](lib/analysis/pipeline-audit.ts):
- **DISCAVERY**: call analyzed + commitment ≥ 2
- **FACTORY_WAIT**: `factory_quote_requests` row exists + not cold
- **CONSIDERATION**: `sent_to_customer_at` set + commitment ≥ 3 OR blocker
  ∈ {price, payment_terms, moq, spec_open}
- Cold verdict (insufficient_data / commitment ≤ 1) → no suggestion

Per-row ✓ אשר / ✗ דחה + a dropdown to override to any of the 6 canonical
stages (קליטה / אפיון / מחכה למפעל / שוקל / משא ומתן / נסגר / אבוד). Apply
goes through `setLeadStage` — DB + GHL + `ensureAutoTaskForStage`.

**Cron ([/api/cron/analyze-active-leads](app/api/cron/analyze-active-leads/route.ts))**:
daily 03:30 UTC (06:30 IL). Runs `analyzeLead` on every active lead with a
stale/missing verdict (cap 40/tick, concurrency 3), then a `sweepOrphanTasks`
pass that finds every open `crm_tasks` row without an assignedTo, sets it
to Itay in DB, and PATCHes GHL for rows that carry a `ghl_task_id`.
