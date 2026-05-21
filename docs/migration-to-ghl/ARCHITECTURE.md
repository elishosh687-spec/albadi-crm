# Architecture — איך הקוד יחיה אחרי שdashboard נמחק

> מצב יעד: `albadi-crm` הופך לשירות backend של GHL. אין יותר dashboard ישן.

---

## 3 שכבות

```
┌─────────────────────────────────────────────────┐
│  GHL UI                                         │
│  • Inbox + Kanban + Tags + Activity            │
│  • Custom Menu Links → iframe widgets          │
│  • Workflows + Salesbot                        │
└──────────────────┬──────────────────────────────┘
                   │ REST API + iframe embeds
┌──────────────────▼──────────────────────────────┐
│  albadi-crm (Vercel — backend service)          │
│  • Bridge webhook receiver                     │
│  • Bot Supervisor + LLM stack                  │
│  • Questionnaire FSM                           │
│  • Calculator engine + PDF render              │
│  • Feishu sync                                 │
│  • Followup cron                               │
│  • iframe widget pages (app/widget/*)          │
│  • DB (Neon)                                   │
└──────────────────┬──────────────────────────────┘
                   │ webhooks + sendMessage
┌──────────────────▼──────────────────────────────┐
│  whatsapp-bridge (Fly.io)                       │
│  • Free-form WA 24/7                            │
└─────────────────────────────────────────────────┘
```

---

## תיקיות

```
albadi-crm/
├── lib/                       ← לוגיקה core, ניטרלי ל-UI
│   ├── db.ts
│   ├── bridge/
│   ├── messaging/
│   ├── supervisor/
│   ├── autoresponder/
│   ├── drafts/
│   ├── factory/               ← calculator + PDF render
│   ├── feishu/
│   └── notify/
│
├── components/                ← React components משותפים
│   ├── ui/                    ← Button, Badge, Card, ...
│   └── calculator/            ← CalculatorView + DetailedBreakdown (משותפים widget + dashboard בעבר)
│
├── integrations/              ← spoke לספקים חיצוניים
│   └── ghl/
│       ├── config.ts
│       ├── client.ts          ← REST V2 wrapper
│       ├── mapping.ts         ← local stage → GHL stage_id
│       ├── sync.ts            ← upsertContact, createOrUpdate Opportunity
│       ├── widget-auth.ts     ← HMAC token verify
│       └── bootstrap.ts       ← CLI setup
│
├── drizzle/                   ← DB schema (source of truth)
│
├── app/
│   ├── api/
│   │   ├── bridge/webhook/    ← WA inbound (entry point)
│   │   ├── bot/               ← followup cron + new-lead webhook
│   │   ├── factory/           ← quote-preview, finalize, PDF
│   │   ├── widget/            ← APIs לwidgets (lead-context, save-quote, send-pdf)
│   │   └── integrations/
│   │       └── ghl/           ← webhooks מ-GHL (outbound chat — Phase 1F)
│   │
│   └── widget/                ← iframe pages
│       ├── calculator/        ← Phase 1A ✅
│       ├── settings/          ← Phase 1D
│       ├── decisions/         ← Phase 2 (אופציונלי)
│       └── drafts/            ← Phase 2 (אופציונלי)
│
├── scripts/                   ← CLI ops (audits, backfills, debugs)
├── middleware.ts              ← פושט אחרי — רק widget allowlist
├── next.config.js             ← CSP frame-ancestors
└── vercel.json                ← cron jobs
```

---

## Data flow — הודעה נכנסת

```
1. לקוח שולח WA
   ↓
2. whatsapp-bridge (Fly.io) → POST /api/bridge/webhook
   ↓
3. webhook:
   a. verify HMAC
   b. insert בridge_events
   c. upsert leads
   d. insert messages (sender=lead)
   e. routeThroughSupervisor → LLM gate
      └→ handleInbound / handleDecisionInbound
   f. void ghlForwardMessage()  → POST /conversations/messages/inbound to GHL
   g. void syncLeadToGHL(sid)   → upsert contact + opportunity in GHL
   ↓
4. אלי רואה ב-GHL:
   • הודעה ב-Conversations tab
   • opportunity ב-Kanban (stage updated)
   • bot_summary custom field updated
```

---

## Data flow — חישוב מחיר ושליחת PDF (Phase 1B)

```
1. אלי ב-GHL contact card → לחץ "🧮 מחשבון"
   ↓
2. iframe נטען: /widget/calculator?contactId=X&widget_token=Y
   ↓
3. widget page (server component):
   a. verify token
   b. GET leads WHERE ghl_contact_id = X
   c. render CalculatorView עם q_state + quote_total
   ↓
4. אלי משחק עם margin → fetch /api/factory/quote-preview?widget_token=Y
   ↓
5. אלי לוחץ "סופי + PDF"
   ↓ POST /api/widget/finalize-quote
6. backend:
   a. render PDF (lib/factory/pdf/render.tsx)
   b. POST /medias/upload-file ל-GHL → uuid
   c. POST /contacts/{id}/upload-files
   d. אם בחר "שלח ללקוח": bridge.sendMessage(jid, text, mediaPath=pdfUrl)
   e. syncLeadToGHL → opportunity.monetaryValue updated
```

---

## Auth model אחרי המעבר

| Surface | Auth |
|---|---|
| `/api/bridge/webhook` | HMAC על body (BRIDGE_WEBHOOK_SECRET) |
| `/api/bot/*`, `/api/factory/*` mutations | Bearer BOT_SECRET |
| `/api/widget/*` | widget_token query (GHL_WIDGET_TOKEN HMAC) |
| `/widget/*` (iframe pages) | widget_token query |
| `/api/integrations/*` (webhooks מ-GHL) | GHL signing secret (Phase 1F) — path בלי "ghl" כי GHL UI חוסם URL שמכיל ghl/highlevel/gohighlevel |
| `/api/factory/quote-preview` GET | widget_token OR Bearer (dual auth — widget + scripts) |

**אין יותר** `albadi_auth` cookie. אין dashboard auth. אלי נכנס דרך GHL login.

---

## Deploy

- Push ל-main → Vercel auto-deploy
- `albadi-crm.vercel.app` ממשיך — לא דומיין נפרד
- Cron: Vercel jobs בvercel.json + cloud routine fallback
- Env vars מנוהלים ב-Vercel UI

---

## Scripts לdebug + ops

נשארים תחת `scripts/`. דוגמאות:
- `integrations/ghl/bootstrap.ts` — חד-פעמי setup
- `integrations/ghl/backfill.ts` (Phase 1E) — ייבוא לידים קיימים
- `scripts/_diag-*.ts` — debug
- `scripts/_audit-*.ts` — health checks

כל סקריפט רץ דרך `npx tsx scripts/<name>.ts` או `npx tsx integrations/ghl/<name>.ts`.
