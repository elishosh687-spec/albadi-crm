# GoHighLevel integration

Active CRM target. Sync is dormant behind `ENABLE_GHL_SYNC=0` until env vars
populated.

## Files

| File | What it does |
|---|---|
| `config.ts` | env vars + `GHL_STAGE_IDS` map + `GHL_FIELD_IDS` map + `GHL_FIELD_DEFINITIONS` (bootstrap source). |
| `client.ts` | REST V2 wrapper for `services.leadconnectorhq.com`. Contacts (upsert/find/get/update), Pipelines (list), Opportunities (create/update/find), Custom Fields (list/create), Conversations (inbound/outbound messages), Notes. |
| `mapping.ts` | `pickStageId(lead)` (handles `NEEDS_ELI` escalation override) + `pickOpportunityStatus(lead)` + `buildCustomFieldsPayload(lead)` + `buildLeadDisplayName(lead)`. |
| `sync.ts` | Orchestrator: `upsertGHLContact`, `createOrUpdateGHLOpportunity`, `syncLeadToGHL`, `forwardMessage`, `forwardEvent`. All fire-and-forget. |
| `bootstrap.ts` | One-shot CLI: lists pipelines/stages, creates missing custom fields, prints env block. |

## How to set up (first time)

1. Open `app.gohighlevel.com` → Sub-Account → Settings → Business Profile → copy **Location ID**.
2. Settings → Integrations → Private Integrations → Create. Scopes: `contacts.write`, `contacts.read`, `opportunities.write`, `opportunities.read`, `locations/customFields.write`, `locations/customFields.read`, `conversations.write`, `conversations.read`, `conversations/message.write`.
3. Copy the token.
4. In `.env`:
   ```
   GHL_API_KEY=<token>
   GHL_LOCATION_ID=<location_id>
   ```
5. Create a pipeline in the GHL UI named "Albadi" with 8 stages (NEW → DROPPED + NEEDS_ELI).
6. Run migration: `npx drizzle-kit push` (adds `leads.ghl_contact_id` + `leads.ghl_opportunity_id`).
7. Run bootstrap: `npx tsx integrations/ghl/bootstrap.ts`
8. Paste the printed env block into `.env` AND into Vercel envs.
9. Flip `ENABLE_GHL_SYNC=1` in `.env` + Vercel, redeploy.
10. Send a real WhatsApp message → check that a contact + opportunity appear in GHL.

## Where it hooks into the app

- **bridge webhook** (`app/api/bridge/webhook/route.ts`): mirrors every inbound/outbound message + calls `syncLeadToGHL(sid)` after handlers run.
- **dashboard actions** (`app/actions/v2.ts`): `setFinalPriceAction`, `snoozeLead`, `setBotPaused` call `syncLeadToGHL(sid)`.

## Failure mode

If GHL is down, all sync calls fail silently into `console.error`. The bridge
webhook keeps processing WhatsApp messages normally. DB is the source of truth;
GHL is a view layer.

## Next steps (not yet built)

- Calculator iframe embedded in GHL contact card via Custom Menu Link.
- Feishu polling cron → updates `factory_quote_requests` → `syncLeadToGHL` pushes new `quote_total`.
- PDF upload to GHL contact files on calculator "Send to customer".
