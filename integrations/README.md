# integrations/

All third-party CRM/messaging vendor code lives here, isolated from the core
app. Each subfolder is self-contained (config, client, sync, bootstrap).

## Folders

- **ghl/** — GoHighLevel CRM (active migration target).

## Files outside this folder that touch integrations

Next.js routing and shared schema force a few touchpoints to live elsewhere:

| Path | What it does |
|---|---|
| `drizzle/schema.ts` | Holds `leads.ghl_contact_id`, `leads.ghl_opportunity_id` columns (one shared schema file — can't split). |
| `app/api/bridge/webhook/route.ts` | Fires `void ghlForwardMessage()` + `void syncLeadToGHL()` after message insert. Imports from `@/integrations/ghl/...`. |
| `app/actions/v2.ts` | Server actions (`setFinalPrice`, `snoozeLead`, `setBotPaused`) call `void syncLeadToGHL(sid)`. Imports from `@/integrations/ghl/sync`. |
| `.env.example` | Vendor env vars under `# === GoHighLevel ===` section. |

## Rule

When adding a new vendor:
1. Create `integrations/<vendor>/` with `config.ts`, `client.ts`, `sync.ts`, `bootstrap.ts`.
2. Touchpoint files (webhook, actions, schema) get a one-line `void <vendor>Sync()` call wrapped in fire-and-forget.
3. Vendor code never throws into the bridge hot path — all errors caught + `console.error`'d.
4. Off by default behind `ENABLE_<VENDOR>_*` flag.
