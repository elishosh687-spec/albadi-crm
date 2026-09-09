# Albadi CRM

CRM + WhatsApp sales bot for Albadi (custom non-woven bags). Next.js on Vercel,
Neon Postgres via Drizzle, GreenAPI for WhatsApp, GHL as the operator UI, Feishu
sheets for the Chinese factories, Zoho Books for the money.

**The operating manual is [CLAUDE.md](CLAUDE.md)** — architecture, every
integration, every footgun, deploy and CLI recipes. Start there.
`AGENTS.md` is a symlink to it (for Codex), so the two can never drift.

## Layout

| Path | What lives there |
|---|---|
| `app/widget/*` | the ONLY live UI — the GHL widget hub (11 tabs), used from a phone too |
| `app/api/*` | 156 route handlers: `widget/` (UI data), `factory/`, `bot/`, `cron/`, webhooks (`greenapi/`, `ghl/`, `bridge/`), `admin/` |
| `app/dashboard/v3` | dead (2026-07-01). Don't build here. |
| `lib/` | all domain code, one folder per feature (`setter/`, `autoresponder/`, `factory/`, `zoho/`, `meta/`, `ghl/`…) |
| `lib/observability/log.ts` | **the one logger** — every feature logs through it (→ Axiom) |
| `integrations/ghl/` | GHL OAuth client, sync, audit |
| `components/` | widget UI; `widget-ui/lux/` are the shared primitives |
| `drizzle/schema.ts` | DB schema (some tables were created by direct DDL — see CLAUDE.md) |
| `scripts/` | maintenance CLIs. Convention in [scripts/README.md](scripts/README.md) |
| `docs/` | ARCHITECTURE, CUSTOMER-FLOW, SALES-PLAYBOOK, runbooks; `archive/` holds history |
| `bot design/` | the bot's design notes + `09-bot-map.md` |
| `studio/` | local-only Bag Studio (runs on Eli's Mac, not deployed) |
| `.github/workflows/` | the sub-daily crons — Vercel's plan only fires crons once a day |

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

`vercel env pull` masks every secret to an empty string — for a screen that
needs real data use the `albadi-crm-data-dev` launch config (neonctl resolves
`DATABASE_URL` at launch time; see CLAUDE.md "How to check a DATA screen locally").

## Deploy

Push to `main` → Vercel. The GitHub→Vercel hook sometimes silently doesn't fire;
check `vercel ls` and if the top deployment is older than your commit:

```bash
vercel deploy --prod --yes
```
