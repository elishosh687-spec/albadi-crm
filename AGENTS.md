# Albadi CRM — agent instructions (Codex + Claude)

Canonical, shared by both agents. `CLAUDE.md` imports this file. Keep it SHORT:
it loads into every session. Detail lives in `docs/agent/<topic>.md` — read the
matching file BEFORE touching that area (Claude auto-loads it via
`.claude/rules/` path rules; Codex: open it yourself from the index below).

## Stack
- Next.js on Vercel (`https://albadi-crm.vercel.app`); push `main` → deploy.
  If `vercel ls` shows no new deploy: `~/.local/node/bin/vercel deploy --prod --yes`.
- Neon Postgres + Drizzle. `vercel env pull` masks secrets to `""`. Live DB:
  `DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/<x>.ts`
  — that is PRODUCTION; reads are free, writes are real.
- WhatsApp = GreenAPI (`USE_BRIDGE=1` + `USE_GREEN_API=1`). ManyChat is retired.
- GHL is the CRM UI; the GHL Hub widget (`/widget`) is Eli's only screen.

## Hard rules
1. **Widget first.** Build UI under `/widget`; `/dashboard/v3` is dead — an
   alias may only import the widget component.
2. **GHL owns shared fields** (name/phone/email/tags/stage/owner/tasks/lead
   score); the DB mirrors them and owns bot history + analytics.
3. **The bot never moves `pipeline_stage`.** Stages (`V2_PIPELINE_STAGES`,
   `lib/manychat/stages.ts`): NULL/INTAKE קליטה · DISCAVERY אפיון ·
   FACTORY_WAIT מחכה למפעל · CONSIDERATION שוקל / משא ומתן · WON · LOST אבוד.
   Renaming a stage → add the old name to `LEGACY_STAGE_MAP`, backfill after deploy.
4. **Client bundle:** a `"use client"` file never imports `lib/db` or
   `lib/manychat/config.ts` (throws without env). Client-safe constants live in
   `lib/manychat/stages.ts`. Blank page → read the browser console first.
5. **Messaging:** import from `@/lib/messaging` only. Canonicalise JIDs
   (`@c.us` vs `@s.whatsapp.net`) before mapping a chat to a lead.
6. **Logging:** every `app/api/**/route.ts` is wrapped in `withRequestLog`;
   use `logger(feature)` — a new `console.log` is a regression. Every cron uses
   `withJob` + an entry in `JOBS`; bearer jobs under `/api/factory/*` also need
   the `middleware.ts` allow-list.
7. **Money has one definition:** `customerTotalExVat`, `payment-terms.ts`
   (VAT 18%, bank), `molds.ts` (plates). Never re-hardcode. The bot's
   auto-quote never carries payment terms/bank details.
8. **LLM paths:** each has a fixed fallback; never put a concrete value in a
   prompt as an "example"; never let an LLM guess a fact the DB knows.
9. **Real people:** show Eli the exact text + recipient before any WhatsApp to
   a customer, colleague, or him. Colleagues are never rows in `leads`.
10. **Tests:** `npm test`, `npm run typecheck`. Unit tests never touch the DB.
    A fixed incident gets a regression test in the same commit.
11. **Write plans as plans.** Never describe an undone migration as done;
    verify live state (runs, rows) before saying something works.
12. **Talk to Eli in Hebrew**, using his vocabulary.
13. **Keep instructions small:** new knowledge goes into the matching
    `docs/agent/*.md` (create one + add a `.claude/rules/` symlink with
    `paths:` if none fits), not here. This file + `CLAUDE.md` stay under
    200 lines (enforced by `tests/unit/architecture/instructions-size.test.ts`).
    Shared rule → here; Claude-only → `CLAUDE.md`; skills in both
    `.claude/skills/` and `.agents/skills/`.

## Topic index — read before touching
| File (`docs/agent/`) | Area |
|---|---|
| `ops.md` | layout, scripts convention, logging/Axiom, deploy, Vercel/Neon CLI |
| `testing.md` | vitest setup, integration on Neon branch, route-gates, CI |
| `jobs.md` | crons, heartbeats, watchdog, GitHub throttling |
| `bot.md` | bot layer, setter, pauses, follow-ups, parked bucket, lead analyzer |
| `messaging.md` | GreenAPI/bridge, JIDs, Eli's console thread, colleagues |
| `ghl.md` | GHL sync/webhooks, tasks & owners, lead score, pipeline audit, deleting a lead |
| `calls.md` | GHL call recordings, ElevenLabs agent, callback flow |
| `feishu-factory.md` | ⚠️ Feishu sheet column-shift footgun, factory quote footguns |
| `pricing.md` | payment terms, plates, negotiation buffer |
| `deals-zoho.md` | עסקאות tab, combined deals, addons, Zoho Books, deliver hub |
| `meta-and-leads-intake.md` | Meta CAPI loop, ads tab, FB form sheets, website leads |
| `mobile-ui.md` | `.mfit` mobile layer, local data dev server |
| `colors.md` | factory colour catalogue |
| `stages-and-client-bundle.md` | full stage table, UI labels, client-bundle debug playbook |
| `legacy-manychat.md` | old ManyChat routes/flows, dashboard v3 |

## Provider notes
- The local WhatsApp watch assistant runs on Codex (`ALBADI_ASSISTANT_PROVIDER`,
  `claude` = rollback); the wrapper owns sending + cursor. See `messaging.md`.
- Bag Studio stays on the Claude Agent SDK; don't weaken the Codex sandbox to
  move it. See `deals-zoho.md`.
- Codex: treat Claude-specific tool names as intent; use `.agents/skills/`.
