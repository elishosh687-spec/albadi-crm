# API Cheat-Sheet for Retool Queries

Base URL: `https://albadi-crm.vercel.app`
Auth: `Authorization: Bearer <BOT_SECRET>` on every call.

## Drafts

### `GET /api/drafts/pending`
List pending bot drafts enriched with lead snapshot + last inbound message.

Query params:
- `limit` (optional, 1–500, default 50)
- `lead` (optional, sub_id to filter to a single lead)

Response:
```json
{
  "ok": true,
  "drafts": [
    {
      "id": 17,
      "manychat_sub_id": "972…@s.whatsapp.net",
      "draft_text": "...",
      "edited_text": null,
      "status": "pending",
      "money_reason": "negotiation",
      "llm_confidence": null,
      "pipeline_stage_at_gen": "AWAITING_DECISION",
      "generated_at": "2026-05-13T19:42:11.000Z",
      "trigger_message_id": null,
      "lead": {
        "sid": "...",
        "name": "...",
        "phone": "...",
        "jid": "...",
        "pipelineStage": "...",
        "pipelineFlag": "NEEDS_ELI",
        "botSummary": "...",
        "notes": "...",
        "quoteTotal": "...",
        "botPaused": true,
        "updatedAt": "..."
      },
      "last_inbound": {
        "text": "...",
        "receivedAt": "..."
      }
    }
  ]
}
```

### `POST /api/drafts/:id/approve`
Send the draft (optionally edited) to the lead via the bridge. Marks draft `sent`.

Body (optional): `{ "edited_text": "modified text" }`

Response:
```json
{ "ok": true, "draftId": 17, "waMessageId": "3A1B…", "sentText": "..." }
```

### `POST /api/drafts/:id/reject`
Mark a draft rejected. Nothing sent.

Body (optional): `{ "reason": "off-topic" }`

Response: `{ "ok": true }`

## Lead override

### `POST /api/leads/:id/override`

`:id` is the `manychat_sub_id` (URL-encode it — JIDs contain `@`).

Body (any subset of):
```json
{
  "pipeline_stage": "NEGOTIATING",
  "flags": ["דחוף", "עסקה_גדולה"],
  "notes": "free text",
  "bot_paused": false,
  "pipeline_flag": "NEEDS_ELI"
}
```

`flags` replaces the full set of flag-name rows on `lead_tags` for this lead. Pass `[]` to clear all flags.

Response:
```json
{
  "ok": true,
  "applied": ["pipeline_stage", "notes"],
  "flag_diff": { "added": ["דחוף"], "removed": [] }
}
```

## Notes for Retool

- For Postgres queries, prefer direct `albadi_pg` resource — faster and avoids the BOT_SECRET round-trip for read-only data.
- For mutations (approve / reject / override), always go through `albadi_api` so the Next.js handler runs the bridge send + business logic.
- `manychat_sub_id` values may have trailing spaces (legacy data); all server-side filters trim, so just pass the raw value.
- Phone numbers stored as E.164 (`972…` no `+`). For `wa.me` links use the digits as-is.

## Common SQL snippets

### Pending drafts joined to lead (single query, alt to REST)
```sql
SELECT
  d.id, d.draft_text, d.money_reason, d.generated_at,
  l.name, l.phone_e164, l.pipeline_stage, l.bot_summary, l.bot_paused,
  (SELECT text FROM messages m
     WHERE trim(m.manychat_sub_id) = trim(d.manychat_sub_id)
       AND m.direction = 'in'
     ORDER BY m.received_at DESC LIMIT 1) AS last_inbound_text
FROM bot_drafts d
LEFT JOIN leads l ON trim(l.manychat_sub_id) = trim(d.manychat_sub_id)
WHERE d.status = 'pending'
ORDER BY d.generated_at DESC
LIMIT 50;
```

### Eli's reply rate today
```sql
SELECT
  count(*) FILTER (WHERE sender = 'eli') AS eli_msgs,
  count(*) FILTER (WHERE sender = 'bot') AS bot_msgs,
  count(*) FILTER (WHERE direction = 'in') AS lead_msgs
FROM messages
WHERE received_at::date = current_date;
```

### Draft approval rate (last 7d)
```sql
SELECT
  count(*) FILTER (WHERE status = 'sent') AS approved,
  count(*) FILTER (WHERE status = 'rejected') AS rejected,
  count(*) FILTER (WHERE status = 'failed') AS failed,
  round(
    100.0 * count(*) FILTER (WHERE status = 'sent') /
    NULLIF(count(*) FILTER (WHERE status IN ('sent','rejected')), 0),
    1
  ) AS approval_pct
FROM bot_drafts
WHERE generated_at > now() - interval '7 days';
```
