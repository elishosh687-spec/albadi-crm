# Retool Supervisor Console — Setup Guide

Hand-built setup at `https://elishosh.retool.com`. Hand-crafted JSON imports are brittle in Retool's free tier, so this guide walks you through the build manually. ~30–45 minutes total.

## 0. Prerequisites

Backend must be deployed first. The PR for this branch (`feat/bot-supervisor-console`) adds:

- `bot_drafts` table + `messages.sender` column (run `npx drizzle-kit push` after merge)
- `/api/drafts/pending`, `/api/drafts/:id/approve`, `/api/drafts/:id/reject`
- `/api/leads/:id/override`
- Money-moment hook in `lib/autoresponder/decision.ts` (gated by `ENABLE_DRAFT_QUEUE=1`)

Verify the env:
- `BOT_SECRET` (existing) — bearer for Retool → Next.js calls
- `ENABLE_DRAFT_QUEUE` = `1` to turn on draft generation (start `0`, flip after smoke test)
- `DATABASE_URL` (Neon Postgres) — Retool will connect directly for read-only views

## 1. Create Resources

Retool → Resources → Create new.

### Resource A — `albadi_pg` (PostgreSQL)

| Field | Value |
|---|---|
| Resource type | PostgreSQL |
| Name | `albadi_pg` |
| Host | from `DATABASE_URL` |
| Port | `5432` (or as in URL) |
| Database | from `DATABASE_URL` |
| Username | from `DATABASE_URL` |
| Password | from `DATABASE_URL` |
| Connect using SSL | ✓ required (Neon) |

Test connection → must say "Resource saved" with green check.

### Resource B — `albadi_api` (REST API)

| Field | Value |
|---|---|
| Resource type | REST API |
| Name | `albadi_api` |
| Base URL | `https://albadi-crm.vercel.app` |
| Headers | `Authorization: Bearer <BOT_SECRET>` |
| Headers | `Content-Type: application/json` |
| Authentication | None (header carries the bearer) |

Test → `GET /api/drafts/pending` should return `{"ok":true,"drafts":[]}`.

## 2. Create the App

Retool → Create new → App → name it `Supervisor Console`.

The app has 3 pages:
- `home` (default)
- `queue`
- `lead` (detail, opened by clicking a draft/lead anywhere)

For each page, follow the per-page checklist below.

---

## Page: `home`

### Queries

Create these queries (left panel → `+` → Query).

#### `q_pending_count` — Postgres / `albadi_pg`
```sql
SELECT count(*)::int AS n
FROM bot_drafts
WHERE status = 'pending';
```
Run on page load.

#### `q_today_pulse` — Postgres / `albadi_pg`
```sql
SELECT
  (SELECT count(*) FROM messages
     WHERE direction = 'out' AND sender = 'bot'
       AND received_at::date = current_date) AS bot_sent_today,
  (SELECT count(*) FROM messages
     WHERE direction = 'out' AND sender = 'eli'
       AND received_at::date = current_date) AS eli_sent_today,
  (SELECT count(DISTINCT manychat_sub_id) FROM messages
     WHERE direction = 'in' AND received_at::date = current_date) AS new_inbound_today,
  (SELECT count(*) FROM bot_drafts
     WHERE status = 'pending') AS pending_now,
  (SELECT count(*) FROM leads
     WHERE pipeline_stage IN ('QUOTED','NEGOTIATING','AWAITING_FINAL','WAITING_CALL')
       AND active = true) AS money_stage_leads;
```

#### `q_pipeline_counts` — Postgres / `albadi_pg`
```sql
SELECT pipeline_stage, count(*)::int AS n
FROM leads
WHERE active = true AND pipeline_stage IS NOT NULL
GROUP BY pipeline_stage
ORDER BY count(*) DESC;
```

### Components

Drag onto canvas, top to bottom:

1. **Container** (`hero`) — full width, color `bg-red-50`
   - **Text** large: `{{ q_pending_count.data[0].n || 0 }} ממתינים לאישור`
   - **Button** "פתח תור" → on click: `utils.openPage('queue')`

2. **Stat Group** (`pulse_stats`) — 5 stats horizontal
   | Label | Value source |
   |---|---|
   | בוט שלח היום | `q_today_pulse.data[0].bot_sent_today` |
   | אני שלחתי היום | `q_today_pulse.data[0].eli_sent_today` |
   | לידים נכנסו | `q_today_pulse.data[0].new_inbound_today` |
   | ממתינים | `q_today_pulse.data[0].pending_now` |
   | בכסף | `q_today_pulse.data[0].money_stage_leads` |

3. **Table** (`pipeline_table`) — data: `q_pipeline_counts.data`
   - Columns: `pipeline_stage`, `n`
   - Row click → navigate to `queue?stage={{currentRow.pipeline_stage}}`

---

## Page: `queue`

### Queries

#### `q_drafts_pending` — REST / `albadi_api`
- Method: `GET`
- URL: `/api/drafts/pending`
- Run automatically + on `interval` every 60 seconds (Retool: Advanced → Run query periodically).
- Transform: `formatDataAsArray(data.drafts)` if needed; otherwise raw.

#### `q_approve_draft` — REST / `albadi_api`
- Method: `POST`
- URL: `/api/drafts/{{ table_drafts.selectedRow.id }}/approve`
- Body type: JSON
- Body: `{ "edited_text": {{ ta_edit.value || null }} }`
- Run only when triggered.
- On success → `q_drafts_pending.trigger()` to refresh.

#### `q_reject_draft` — REST / `albadi_api`
- Method: `POST`
- URL: `/api/drafts/{{ table_drafts.selectedRow.id }}/reject`
- Body: `{ "reason": {{ ta_reject_reason.value || null }} }`
- On success → `q_drafts_pending.trigger()`.

#### `q_set_paused` — REST / `albadi_api`
- Method: `POST`
- URL: `/api/leads/{{ encodeURIComponent(table_drafts.selectedRow.manychat_sub_id) }}/override`
- Body: `{ "bot_paused": {{ switch_paused.value }} }`

### Components

1. **Table** (`table_drafts`) — data: `q_drafts_pending.data.drafts`
   - Columns: `lead.name`, `lead.pipelineStage`, `money_reason`, `generated_at`, `last_inbound.text` (truncate 80 chars)
   - Sort by `generated_at` DESC
   - Row click → updates selectedRow (drives the panel)

2. **Container** (`detail_panel`) — visible when `table_drafts.selectedRow`
   - **Header text**: `{{ table_drafts.selectedRow.lead.name || table_drafts.selectedRow.manychat_sub_id }} — {{ table_drafts.selectedRow.lead.pipelineStage }}`
   - **Plain-text block**: `{{ table_drafts.selectedRow.lead.botSummary }}`
   - **Conversation snippet** (Text): `הודעה אחרונה: {{ table_drafts.selectedRow.last_inbound.text }}`
   - **TextArea** (`ta_edit`) default value: `{{ table_drafts.selectedRow.draft_text }}` — rows 4
   - **Button** "אשר ושלח" — color green — on click: `q_approve_draft.trigger()`
   - **Button** "דחה" — color red — on click: opens `modal_reject`
   - **Link**: `https://wa.me/{{ table_drafts.selectedRow.lead.phone }}` — opens WA Business on that chat
   - **Switch** (`switch_paused`) bound to `table_drafts.selectedRow.lead.botPaused` — on change: `q_set_paused.trigger()`

3. **Modal** (`modal_reject`) — opens on Reject click
   - **TextArea** (`ta_reject_reason`)
   - **Button** "אשר דחייה" → `q_reject_draft.trigger()` → close modal

### Keyboard shortcuts

Retool → app settings → Keyboard shortcuts → add:
- `j` → `table_drafts.selectNextRow()`
- `k` → `table_drafts.selectPreviousRow()`
- `Enter` → `q_approve_draft.trigger()`
- `x` → `modal_reject.open()`

---

## Page: `lead` (lead detail)

Open from anywhere via `utils.openPage('lead', { id: subId })`.

### Queries

#### `q_lead` — Postgres / `albadi_pg`
```sql
SELECT *
FROM leads
WHERE trim(manychat_sub_id) = {{ urlparams.id }}::text
LIMIT 1;
```

#### `q_conversation` — Postgres / `albadi_pg`
```sql
SELECT id, direction, sender, text, received_at, wa_message_id
FROM messages
WHERE trim(manychat_sub_id) = {{ urlparams.id }}::text
ORDER BY received_at DESC
LIMIT 80;
```

#### `q_lead_drafts` — Postgres / `albadi_pg`
```sql
SELECT id, draft_text, status, money_reason, generated_at, decided_at, reject_reason, sent_at
FROM bot_drafts
WHERE trim(manychat_sub_id) = {{ urlparams.id }}::text
ORDER BY generated_at DESC
LIMIT 50;
```

#### `q_override` — REST / `albadi_api`
- POST `/api/leads/{{ encodeURIComponent(urlparams.id) }}/override`
- Body: `{ "pipeline_stage": {{ select_stage.value }}, "flags": {{ multiselect_flags.value }}, "notes": {{ ta_notes.value }}, "bot_paused": {{ switch_paused.value }} }`

### Components

- Header card: name, phone, stage chip, NEEDS_ELI flag if set
- Conversation thread (List or custom table) styled by `sender`:
  - `lead` → right-aligned, neutral
  - `bot` → left-aligned, blue tint
  - `eli` → left-aligned, green tint
- Override panel:
  - **Select** (`select_stage`) options: `NEW, WAITING_FACTORY, QUOTED, AWAITING_DECISION, AWAITING_LOGO, IN_PROGRESS, AWAITING_FINAL, NEGOTIATING, WAITING_CALL, WON, DROPPED`
  - **Multiselect** (`multiselect_flags`) options: `דחוף, עסקה_גדולה, ביקש_שיחה, אחרי_החג, מועדף`
  - **TextArea** (`ta_notes`)
  - **Switch** (`switch_paused`)
  - **Button** "שמור" → `q_override.trigger()`
- Bot draft history table from `q_lead_drafts`
- **Link** "פתח ב-WhatsApp" → `https://wa.me/{{ q_lead.data[0].phone_e164 }}`

---

## 3. Smoke Test

After resources + pages built:

1. **Verify pending count**: Retool home shows `0 ממתינים`.
2. **Inject a test draft** manually for end-to-end:
   ```sql
   INSERT INTO bot_drafts (manychat_sub_id, draft_text, money_reason, status, pipeline_stage_at_gen)
   VALUES ('<some active lead jid>', 'בדיקה: הצעת מחיר טסט', 'manual', 'pending', 'QUOTED');
   ```
3. Refresh Retool — home shows `1 ממתין`, queue page shows the row.
4. Hit "דחה" → row vanishes after refresh → DB row status='rejected'.
5. Insert another draft → hit "אשר ושלח" → row sends via bridge to the test lead, `bot_drafts.status='sent'`, `messages` row appears with `sender='bot'`.
6. Reply manually from WA Business on the bonded phone → DB shows new `messages` row with `sender='eli'`.

When all 6 pass → flip `ENABLE_DRAFT_QUEUE=1` in Vercel. Money-moment escalations from now on will auto-create drafts.

## 4. Retool Mobile (optional, free)

Retool → app settings → Mobile → enable. Set the queue page as default. Install Retool Mobile from app store, log in, the same app appears with mobile-optimized layout. Configure push (Retool Mobile → notifications → triggered by `q_drafts_pending.data.drafts.length` increasing).

## 5. Rollback

Anything broken? `ENABLE_DRAFT_QUEUE=0` in Vercel → redeploy → drafts no longer generated, bot returns to current behavior. `/dashboard/v2` stays as fallback UI. DB rows survive (status stays as-is).
