# Albadi CRM → GoHighLevel — תוכנית מעבר וסטטוס

> מסמך אמת לכל המעבר ל-GHL. מתעדכן בכל phase.
> כל שינוי כולל **"איך לבדוק ידנית"**.

עדכון אחרון (2026-05-21): Phase 0 + 1A + 1E הושלמו. 82 לידים מיובאים ל-GHL מלא — Contact, Opportunity, 4 סוגי Notes (Internal notes, WhatsApp history, Order summary, Bot decisions, Activity log), והודעות WhatsApp ב-Conversations Inbox. `ENABLE_GHL_SYNC=0` עדיין. הצעד הבא: A) להפעיל `ENABLE_GHL_SYNC=1` ב-Vercel, B) Phase 1F (Outbound chat).

---

## Workflow rule (חובה)

**כל שינוי שעובר ל-GHL (Custom Menu Link / Conversation Provider / Webhook / Custom Field / Pipeline / Workflow / OAuth installation / token refresh / re-import) חייב להישלח לאלי לבדיקה ידנית ב-GHL UI לפני שעוברים להמשך.**

הדפוס בכל פעם:
1. Claude מבצע את השינוי + deploy
2. Claude מציין במפורש מה לבדוק ב-GHL UI: איזה כרטיס לפתוח, איזה tab/menu, מה אמור להופיע
3. אלי בודק ומאשר / מציין בעיה
4. רק אז ממשיכים

---

## URL blocking rule — GHL חוסם המילה "ghl"

GHL UI דוחה כל URL שמכיל `ghl`/`highlevel`/`gohighlevel` בנתיב. תצלום מהמשתמש מאשר.

**Phase 1F-prep — rename בוצע 2026-05-21:**

| ישן | חדש |
|---|---|
| `/api/integrations/ghl/install` | `/api/integrations/install` |
| `/api/integrations/ghl/oauth/callback` | `/api/integrations/oauth/callback` |
| `/api/integrations/ghl/outbound` | `/api/integrations/outbound` |

ENV: `GHL_OAUTH_REDIRECT_URI=https://albadi-crm.vercel.app/api/integrations/oauth/callback`.

תיעוד פנימי + commits יכולים להכיל "ghl". URL פומבי — לא.

---

## Phase 1G — Per-lead widgets + Settings (תוכנית)

GHL native מטפל ב: stage, notes, tags, custom fields, opportunities, activity timeline. אין widget לזה.
Widget נדרש רק למה שאין native:

| # | Widget | מצב | פעולות |
|---|---|---|---|
| 1 | Order Summary | read-only | אין (read q_state, factory spec, quote, follow-up date, source) |
| 2 | Bot Decisions | read + 2 mutations | thumbs-up/down ל-intent + stage |
| 3 | Factory Quote per-lead | read + 1 mutation | "שלח לפבריקה" (Feishu) |
| 4 | Factory Quotes List (cross-lead) | read-only | link חזרה ל-GHL contact detail |
| 5 | Settings | read + write | currency rates, default margin, shipping, templates |

Activity log — בוטל. GHL native timeline מציג את ה-Notes מ-Phase 1E.

### Auth

- Page (server component): `verifyWidgetToken(token)` constant-time + lookup `leads` WHERE `ghl_contact_id`=X
- Mutations: REST endpoints חדשים תחת `/api/widget/*` (לא server actions). dual auth: cookie OR `widget_token` query/Bearer.
- `middleware.ts` כבר פותח `/widget/*` ו-`/api/widget/*` ללא cookie.

### Settings PUT risk

`widget_token` הוא 64-hex random. למי שמשיג token יש כתיבה ל-factory config. mitigation עתידי: Bearer דו-שלבי או IP allowlist.

### GHL Custom Menu Links

| שם | URL | Show On |
|---|---|---|
| 📋 סיכום הזמנה | `/widget/order-summary?contactId={{contact.id}}&widget_token=<T>` | Contact Detail |
| 🤖 החלטות בוט | `/widget/bot-decisions?contactId={{contact.id}}&widget_token=<T>` | Contact Detail |
| 🏭 הצעת מפעל | `/widget/factory-quote?contactId={{contact.id}}&widget_token=<T>` | Contact Detail |
| 🗂️ הצעות מפעל | `/widget/factory-quotes-list?widget_token=<T>` | Sub-Account sidebar |
| ⚙️ הגדרות | `/widget/settings?widget_token=<T>` | Sub-Account sidebar |

Per-lead → רק Contact Detail (GHL bug: `{{contact.id}}` שובר ב-Sidebar).

### Sequencing

1. ✅ Phase 1F-prep — rename endpoints (DONE 2026-05-21)
2. Phase 1G-1 — Order Summary (read-only, ~30 דק)
3. Phase 1G-2 — Bot Decisions (read + 2 mutations, ~שעה)
4. Phase 1G-3 — Factory Quote per-lead (read + 1 mutation, ~שעה)
5. Phase 1G-4 — Factory Quotes List (read-only, ~30 דק)
6. Phase 1D — Settings (read + write, ~שעה)

### Verification per widget

1. `npx tsc --noEmit` נקי
2. דפדפן ישיר: `https://albadi-crm.vercel.app/widget/<name>?contactId=<known>&widget_token=<T>` → נטען
3. Token שגוי → 401
4. F12 → Console נקי (CSP)
5. ב-GHL Custom Menu Link → iframe נטען עם המידע
6. **בדיקה ידנית של אלי ב-GHL UI לפני המשך** (workflow rule)

---

## 0. למשיכת עבודה בסשן אחר — קרא קודם

**כל הסטטוס פה. אין צורך בquestions.** מצב לפני המשך:

### ✅ עשינו
- [drizzle/schema.ts](../drizzle/schema.ts) — נוספו `leads.ghl_contact_id`, `leads.ghl_opportunity_id`. **migration רץ** ב-prod DB (Neon).
- `integrations/ghl/*` — config, client (REST V2), mapping, sync, bootstrap, widget-auth + README
- `app/widget/calculator/page.tsx` + `app/widget/layout.tsx` — iframe endpoint
- `app/api/widget/lead-context/route.ts` — GET lead by ghl_contact_id
- `middleware.ts` — allowlist widget routes + `widget_token` bypass ל-`/api/factory/*`
- `next.config.js` — CSP `frame-ancestors` ל-GHL/LeadConnector domains + BOM strip
- Bridge webhook + v2 actions wired עם `void syncLeadToGHL(sid)`
- `.env` מקומי מלא עם 19 env vars
- **Vercel envs production** — 19 vars (כולל `ENABLE_GHL_SYNC=0`)
- **Deploy ל-production** עבר — `https://albadi-crm.vercel.app/widget/calculator?widget_token=...` מחזיר 200 + CSP נקי
- GHL UI:
  - Pipeline "albadi" נוצר ידנית עם 8 stages
  - 5 custom fields נוצרו אוטומטית דרך bootstrap
  - Private Integration Token: `pit-80128d88-b443-4ece-aa66-2e1f6c65dbe8`

### ✅ עשינו גם (2026-05-21)
- **Phase 1E Backfill** — `integrations/ghl/backfill.ts` מלא:
  - 82 contacts + 80 opportunities (2 שגיאות duplicate נפתרו עם findOpportunityForContact fallback)
  - 74 Internal notes (`leads.notes`)
  - 45 WhatsApp history notes (combined per lead)
  - 68 Order summary notes (q_state + factory_spec_draft + quote_alt + follow_up_date)
  - 32 Bot decisions notes (mapped from `bot_decision_log`)
  - 1 Activity log note (`lead_events`)
  - chat-to-inbox: 825 הודעות עברו ל-GHL Conversations Inbox כ-SMS עם direction נכון
  - 4 args: `--dry-run`, `--resume`, `--extras-only`, `--chat-to-inbox`, `--sid`, `--limit`
  - 2 columns חדשים: `leads.ghl_backfilled_at`, `leads.ghl_chat_imported_at` (gating re-run)
- **GHL Custom Menu Link** — נוצר ב-sidebar (לא ב-contact detail בגלל GHL bug עם `{{contact.id}}`)

### ❌ נותר
- [ ] **`ENABLE_GHL_SYNC=1`** — sync עדיין dormant. עכשיו ה-backfill done → אפשר להפעיל.
- [ ] **Phase 1F (Outbound chat)** — לא התחיל. בלי זה אלי לא יכול לענות מתוך GHL.
- [ ] **Phase 1B (PDF flow)** — לא התחיל.
- [ ] **Phase 1C (Feishu loop)** — לא התחיל.
- [ ] **Phase 1D (Settings widget)** — לא התחיל.

### IDs קריטיים (כבר ב-`.env` וגם ב-Vercel)
```
GHL_API_KEY=pit-80128d88-b443-4ece-aa66-2e1f6c65dbe8
GHL_LOCATION_ID=zo0OlVmtNiXiDAbZj2YW
GHL_PIPELINE_ID=JG6rSzAxvlK4gROZ6Ot0  (name: "albadi")
GHL_WIDGET_TOKEN=50da21955d78a871e4d1ffdd3e44827e2aa4875a3719dce4f009ca569cbb6a7c

# Stages
NEW              = 980f1b2e-7c2c-427e-97ba-184ed64a138f
AWAITING_ESTIMATE= 83a109c2-9f23-436b-ae57-64356684f51a
AWAITING_LOGO    = 46b83cc8-3fab-4860-b5b7-f6268b585df8
WAITING_FACTORY  = e89642cb-c832-4417-9ceb-04bbe223c3e1
AWAITING_FINAL   = d829b841-51df-4f92-b76a-e7496b44ec0c
CALLBACK_LATER   = 78806c17-ba9f-4e5e-87cc-d9c98a8549b7
WON              = c0bccca4-fbde-4458-8970-db105022281c
DROPPED          = 6b716c7e-0a77-447d-9594-8163c83f5b90

# Custom fields (on Contact entity)
GHL_FIELD_MANYCHAT_SUB_ID=9YV9MzyTSQO6g1ND7gwm
GHL_FIELD_WA_JID         =alYsHnYu2YLahkp25IwW
GHL_FIELD_BOT_SUMMARY    =PajtRpfGVqagt5UNEw1H
GHL_FIELD_QUOTE_TOTAL    =Zb8xcXHyPretYFK2fxFA  (type=MONETORY, GHL typo)
GHL_FIELD_PIPELINE_FLAG  =RWIsVudSbh5WKZFEXl1y
```

### Git history (השאר אם רוצים git log)
- `67574e0` feat(ghl): integration foundation + calculator widget
- `95c81b7` fix(ghl): strip BOM from WIDGET_ALLOWED_FRAME_ANCESTORS env

### הצעד הבא הנכון (אחרי שאלי יוצר Custom Menu Link)
1. בודק שהiframe נטען ב-GHL contact card → screenshot/אישור
2. Phase 1E (Backfill) — `integrations/ghl/backfill.ts` חדש. סורק `leads` table, יוצר contact + opportunity לכל אחד, מעדכן `leads.ghl_contact_id`. dry-run mode + resume mode. (לא לפני שאלי מאשר שה-iframe עובד.)
3. אחרי backfill — set `ENABLE_GHL_SYNC=1` בVercel + redeploy → inbound חדשים יסונכרנו.
4. Phase 1B (PDF flow), 1C (Feishu loop), 1D (Settings widget), 1F (Outbound chat).

---

## תוכן עניינים

1. [Context וארכיטקטורה](#1-context)
2. [סטטוס phases](#2-status)
3. [Phase 0 — Foundation](#phase-0--foundation-)
4. [Phase 1A — Calculator widget](#phase-1a--calculator-widget-)
5. [Phase 1B — PDF flow](#phase-1b--pdf-flow-)
6. [Phase 1C — Feishu loop](#phase-1c--feishu-loop-)
7. [Phase 1D — Settings widget](#phase-1d--settings-widget-)
8. [Phase 1E — Backfill כל הלידים](#phase-1e--backfill-)
9. [Phase 1F — Outbound chat](#phase-1f--outbound-chat-)
10. [Phase 2 — אופציונלי](#phase-2-)
11. [Manual setup steps ל-GHL UI](#11-manual-setup-steps)
12. [Convention לעדכוני מסמך](#12-convention)

---

## 1. Context

**מטרה:** מעבר מ-dashboard v3 הקיים ל-GHL כ-UI יחיד. ה-backend הקיים נשאר.

**אילוצים:**
- משתמש יחיד (אלי)
- תקציב $300-700/חודש (בפועל ~$100)
- bridge נשאר — free-form WA 24/7
- בוט חיצוני — Supervisor / LLM / decision log רצים ב-backend
- בתוך GHL חייב: Calculator (כולל boss-mode), PDF, Kanban, chat, Settings (currency+margin)
- **כל הלידים** ב-GHL (גם DROPPED ישנים)
- Tags ישנים לא מעבירים — אלי יצור חדשים

**ארכיטקטורה:**
```
GHL UI  ←(REST + iframe)→  Albadi backend (Vercel)  ←(webhooks)→  bridge (Fly.io)  ←→  WhatsApp
                              ↕
                          DB (Neon)
```
GHL = display. DB = source of truth. Bridge = WA transport.

**תיקיית קוד:** כל ספק תחת `integrations/<vendor>/` — ראה [integrations/README.md](../integrations/README.md).

---

## 2. Status

| Phase | מה | סטטוס |
|---|---|---|
| 0 | Foundation — GHL client, sync, bootstrap, DB columns, webhook wiring | ✅ DONE |
| 1A | Calculator widget מוטמע ב-GHL contact card | ✅ DONE (Custom Menu Link ב-sidebar) |
| 1B | PDF flow — finalize → GHL Files → send ללקוח | ❌ Not started |
| 1C | Feishu loop — שלח לפבריקה + cron מחזיר מחיר | ❌ Not started |
| 1D | Settings widget — currency + margin בתוך GHL | ❌ Not started |
| 1E | Backfill — כל הלידים מ-DB → GHL | ✅ DONE (82 leads + chat-to-inbox) |
| 1F | Outbound chat — אלי כותב ב-GHL → bridge → WA | 🚧 IN PROGRESS — קוד מוכן, ממתין שאלי יצור Marketplace Private App |
| 2 | Bot decisions widget, drafts widget, GHL Workflow followup | ❌ Future |

---

## GHL Setup — מה קיים בחשבון GHL עכשיו

יצרתי בחשבון `zo0OlVmtNiXiDAbZj2YW` (דרך bootstrap script + ידנית):

### Pipeline
| שם | ID |
|---|---|
| **albadi** | `JG6rSzAxvlK4gROZ6Ot0` |

### Stages (כולם בתוך albadi pipeline)
| שם | ID |
|---|---|
| NEW | `980f1b2e-7c2c-427e-97ba-184ed64a138f` |
| AWAITING_ESTIMATE | `83a109c2-9f23-436b-ae57-64356684f51a` |
| AWAITING_LOGO | `46b83cc8-3fab-4860-b5b7-f6268b585df8` |
| WAITING_FACTORY | `e89642cb-c832-4417-9ceb-04bbe223c3e1` |
| AWAITING_FINAL | `d829b841-51df-4f92-b76a-e7496b44ec0c` |
| CALLBACK_LATER | `78806c17-ba9f-4e5e-87cc-d9c98a8549b7` |
| WON | `c0bccca4-fbde-4458-8970-db105022281c` |
| DROPPED | `6b716c7e-0a77-447d-9594-8163c83f5b90` |
| NEEDS_ELI | _(לא יוצר — נופל ל-NEW עד שניצור ידנית)_ |

### Custom Fields על Contact entity
| שם | ID | Type |
|---|---|---|
| ManyChat sub id / JID | `9YV9MzyTSQO6g1ND7gwm` | TEXT |
| WhatsApp JID | `alYsHnYu2YLahkp25IwW` | TEXT |
| Bot summary | `PajtRpfGVqagt5UNEw1H` | LARGE_TEXT |
| Quote total (ILS) | `Zb8xcXHyPretYFK2fxFA` | MONETORY (GHL typo) |
| Pipeline flag | `RWIsVudSbh5WKZFEXl1y` | TEXT |

### Token
- Private Integration Token = `pit-80128d88-...` (ב-`.env` כ-`GHL_API_KEY`)
- Scopes שעובדים: contacts CRUD, opportunities CRUD, customFields CRUD, conversations CRUD, medias CRUD
- Scopes חסרים: `pipelines.write` (GHL לא חושף ל-Private Integrations — pipeline יוצר רק ב-UI)

### `.env` מקומי
כל ה-ids כתובים. `ENABLE_GHL_SYNC=0` עדיין.

---

## בדיקות ידניות — GHL setup

### בדיקה 1: Pipeline + stages קיימים ב-GHL UI
1. פתח: `https://app.gohighlevel.com/v2/location/zo0OlVmtNiXiDAbZj2YW/opportunities/list`
2. תפריט dropdown של pipelines למעלה → לחץ
3. **מצופה:** רואה "albadi" כאופציה
4. בחר אותו → Kanban view נטען
5. **מצופה:** 8 columns בסדר: NEW → AWAITING_ESTIMATE → AWAITING_LOGO → WAITING_FACTORY → AWAITING_FINAL → CALLBACK_LATER → WON → DROPPED

### בדיקה 2: Custom Fields קיימים
1. Settings → Custom Fields → Contacts
2. **מצופה:** רואה 5 fields חדשים: ManyChat sub id / JID, WhatsApp JID, Bot summary, Quote total (ILS), Pipeline flag
3. לחץ על אחד — אמור להיות עם dataType נכון (TEXT / LARGE_TEXT / MONETORY)

### בדיקה 3: Token עובד (API call ישיר)
**מ-PowerShell:**
```powershell
$token = "pit-80128d88-b443-4ece-aa66-2e1f6c65dbe8"
Invoke-RestMethod -Uri "https://services.leadconnectorhq.com/opportunities/pipelines?locationId=zo0OlVmtNiXiDAbZj2YW" -Headers @{
  "Authorization" = "Bearer $token"
  "Version" = "2021-07-28"
  "Accept" = "application/json"
}
```
**מצופה:** JSON עם `pipelines` array שמכיל "albadi" + "Marketing Pipeline".

### בדיקה 4: ה-`.env` מלא נכון
```powershell
Select-String -Path .env -Pattern "^GHL_"
```
**מצופה:** ~16 שורות `GHL_*` עם ערכים (לא ריקים, חוץ מ-`GHL_ACCESS_TOKEN` ו-`GHL_STAGE_NEEDS_ELI`).

### בדיקה 5: Type-check עדיין נקי
```powershell
npx tsc --noEmit
```
**מצופה:** אין output.

---

## הצעד הבא — להפעיל sync

עכשיו צריך:
1. **Vercel envs** — להוסיף את כל ה-`GHL_*` מ-`.env` המקומי ל-Vercel production envs. אני יכול דרך CLI אם אתה מחובר ל-`vercel`, אחרת UI.
2. **`ENABLE_GHL_SYNC=1`** ב-Vercel
3. **Redeploy** (push main / manual redeploy)
4. **שלח הודעת WA test** → אמור להופיע contact + opportunity ב-GHL → ראה Phase 0 verification למטה

---

## Phase 0 — Foundation ✅

**מה זה:** השכבה הבסיסית — REST client ל-GHL, פונקציות sync, schema columns, חיווט לבtridge webhook.

**קבצים שנוצרו:**

| Path | מה זה עושה |
|---|---|
| [integrations/ghl/config.ts](../integrations/ghl/config.ts) | env vars + stage mapping + 5 custom field ids |
| [integrations/ghl/client.ts](../integrations/ghl/client.ts) | REST V2 wrapper ל-`services.leadconnectorhq.com` — contacts/opportunities/pipelines/fields/conversations/notes/files |
| [integrations/ghl/mapping.ts](../integrations/ghl/mapping.ts) | `pickStageId(lead)` (כולל NEEDS_ELI override) + `pickOpportunityStatus` + `buildCustomFieldsPayload` |
| [integrations/ghl/sync.ts](../integrations/ghl/sync.ts) | `upsertGHLContact`, `createOrUpdateGHLOpportunity`, `syncLeadToGHL`, `forwardMessage`, `forwardEvent` — fire-and-forget |
| [integrations/ghl/bootstrap.ts](../integrations/ghl/bootstrap.ts) | CLI: lists pipelines + creates missing custom fields + מדפיס env block |
| [integrations/ghl/README.md](../integrations/ghl/README.md) | מה זה התיקייה |

**קבצים שעודכנו:**

| Path | שינוי |
|---|---|
| [drizzle/schema.ts](../drizzle/schema.ts) | + `leads.ghlContactId`, `leads.ghlOpportunityId` columns |
| [app/api/bridge/webhook/route.ts](../app/api/bridge/webhook/route.ts) | + `void ghlForwardMessage()` על inbound + outbound, `void syncLeadToGHL(sid)` בסוף `handleMessageReceived` |
| [app/actions/v2.ts](../app/actions/v2.ts) | + `void syncLeadToGHL(cleanSid)` ב-`setFinalPriceAction`, `snoozeLead`, `setBotPaused` |
| [.env.example](../.env.example) | + `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_PIPELINE_ID`, `ENABLE_GHL_SYNC`, 9 stage ids, 5 field ids |

### איך לבדוק ידנית — Phase 0

**Step 1 — Type check (אפס סיכון):**
```bash
npx tsc --noEmit
# Expect: אין output (clean)
```

**Step 2 — GHL token + Location ID:**
1. `app.gohighlevel.com/v2/location/zo0OlVmtNiXiDAbZj2YW/launchpad`
2. Settings → Integrations → Private Integrations → Create
3. Scopes: `contacts.write/read`, `opportunities.write/read`, `locations/customFields.write/read`, `conversations.write/read`, `conversations/message.write`, `medias.write/read`
4. Copy token

**Step 3 — `.env` עדכון:**
```
GHL_API_KEY=<token from Step 2>
GHL_LOCATION_ID=zo0OlVmtNiXiDAbZj2YW
```

**Step 4 — DB migration:**
```bash
npx drizzle-kit push
# Expect: "Changes applied" + 2 new columns: ghl_contact_id, ghl_opportunity_id
```

**Step 5 — Pipeline ב-GHL UI:**
1. CRM → Opportunities → Pipelines → Create
2. שם: **Albadi**
3. 8 stages בסדר: NEW, AWAITING_ESTIMATE, AWAITING_LOGO, WAITING_FACTORY, AWAITING_FINAL, CALLBACK_LATER, WON, DROPPED
4. אופציונלי 9th: NEEDS_ELI

**Step 6 — Bootstrap:**
```bash
npx tsx integrations/ghl/bootstrap.ts
# Expect:
#   - מציג pipelines קיימים
#   - מוצא "Albadi" pipeline + מדפיס stage ids
#   - יוצר 5 custom fields (manychat_sub_id, wa_jid, bot_summary, quote_total, pipeline_flag)
#   - מדפיס env block בסוף
```

**Step 7 — הדבק env block לתוך `.env` + Vercel + redeploy.**

**Step 8 — הפעלה:**
```
ENABLE_GHL_SYNC=1
```
ב-Vercel envs → redeploy.

**Step 9 — End-to-end test:**
1. שלח הודעת WA אמיתית ממכשיר test ל-business number
2. בדוק logs ב-Vercel — לא אמור להיות error מ-`[ghl.sync]`
3. פתח GHL Contacts → אמור להופיע contact חדש עם השם/טלפון
4. פתח Opportunities → ה-Albadi pipeline → אמור להיות opportunity בstage NEW

**אם נכשל:** flip `ENABLE_GHL_SYNC=0` → bridge ממשיך לעבוד תקין. fail safe.

---

## Phase 1A — Calculator widget ✅

**מה זה:** Calculator הקיים (`/dashboard/v3/calculator`) מוטמע כ-iframe בתוך GHL contact card. אלי לוחץ "🧮 מחשבון" ב-GHL sidebar → המחשבון נטען בתוך GHL, מקבל `contactId` מ-GHL, טוען את הליד מ-DB, מציג שם + stage + כל הUI כולל boss-mode breakdown.

**קבצים שנוצרו:**

| Path | מה זה עושה |
|---|---|
| [integrations/ghl/widget-auth.ts](../integrations/ghl/widget-auth.ts) | `verifyWidgetToken()` constant-time compare + iframe CSP headers |
| [app/widget/layout.tsx](../app/widget/layout.tsx) | nested layout — אין dashboard auth, dark theme container |
| [app/widget/calculator/page.tsx](../app/widget/calculator/page.tsx) | server component — verify token, טען ליד דרך `ghl_contact_id`, render `CalculatorView` עם `apiToken` |
| [app/api/widget/lead-context/route.ts](../app/api/widget/lead-context/route.ts) | GET API — contactId → lead snapshot (לwidgets עתידיים) |

**קבצים שעודכנו:**

| Path | שינוי |
|---|---|
| [app/dashboard/v3/calculator/CalculatorView.tsx](../app/dashboard/v3/calculator/CalculatorView.tsx) | + `apiToken?: string` prop, מצורף ל-fetch כ-`&widget_token=` |
| [middleware.ts](../middleware.ts) | allowlist `/widget/*` + `/api/widget/*` + GET `/api/factory/*` עם `?widget_token=<value>` |
| [next.config.js](../next.config.js) | CSP `frame-ancestors` ל-`/widget/*` — מתיר embedding מ-GHL/LeadConnector |
| [.env.example](../.env.example) | + `GHL_WIDGET_TOKEN`, `WIDGET_ALLOWED_FRAME_ANCESTORS` |

### איך לבדוק ידנית — Phase 1A

**Step 1 — Type check:**
```bash
npx tsc --noEmit
# Expect: clean
```

**Step 2 — ייצור secret:**
PowerShell:
```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
# Expect: 64 hex chars, e.g. "a3f7d8e9c1b2..."
```

**Step 3 — `.env` עדכון:**
```
GHL_WIDGET_TOKEN=<64-hex from Step 2>
```

**Step 4 — Local dev test (standalone):**
```bash
npm run dev
```
פתח דפדפן:
```
http://localhost:3000/widget/calculator?widget_token=<TOKEN>
```
**מצופה:**
- נטען calculator
- Banner למעלה: "🧮 מחשבון מחיר · ⚠️ אין contactId — מצב standalone"
- כל ה-UI עובד: מוצר dropdown, כמות, שילוח, צבעים, slider רווח
- "פירוט מלא לבוס" נפתח עם FX rates + breakdown

**אם נכשל token:**
```
http://localhost:3000/widget/calculator?widget_token=wrong
```
**מצופה:** דף שגיאה "אין הרשאה".

**Step 5 — Local test עם contactId (אחרי backfill או מעדכון ידני):**
```bash
psql "$DATABASE_URL" -c "UPDATE leads SET ghl_contact_id='test123' WHERE manychat_sub_id='<some_sid>' LIMIT 1"
```
פתח:
```
http://localhost:3000/widget/calculator?contactId=test123&widget_token=<TOKEN>
```
**מצופה:** banner מציג שם הליד + stage בכחול.

**Step 6 — Production deploy:**
1. הוסף `GHL_WIDGET_TOKEN` ל-Vercel envs (production)
2. `git push main` → Vercel ידיפלוי אוטומטית
3. המתן ~30s לbuild

**Step 7 — GHL UI setup (חד-פעמי):**
1. `app.gohighlevel.com/v2/location/zo0OlVmtNiXiDAbZj2YW/...`
2. Settings → **Custom Menu Links** → **+ Add**
3. שם: `🧮 מחשבון`
4. Icon: calculator
5. URL:
   ```
   https://albadi-crm.vercel.app/widget/calculator?contactId={{contact.id}}&widget_token=<TOKEN>
   ```
6. Show On: **Contacts → Detail**
7. Open In: **Iframe** (לא tab חיצוני)
8. Save

**Step 8 — End-to-end test ב-GHL:**
1. CRM → Contacts → פתח contact כלשהו
2. בsidebar שמאל אמור להיות "🧮 מחשבון" — לחץ
3. המחשבון נטען בtoכן הראשי של GHL
4. Banner: שם הliad + stage
5. כל ה-UI עובד — שלב slider רווח, לחץ "פירוט מלא לבוס", רואה boss breakdown

**אם נכשל:** F12 → Console — חפש CSP errors / token rejection. בדוק `WIDGET_ALLOWED_FRAME_ANCESTORS` ב-Vercel envs.

---

## Phase 1B — PDF flow 🚧

**מה זה:** מ-widget — כפתורים "שמור preview", "סופי + PDF", "שלח ללקוח". PDF נוצר ב-backend, נשמר ב-GHL Files (מצורף לcontact), ונשלח דרך bridge.

**קבצים שייווצרו:**

| Path | מה זה יעשה |
|---|---|
| `app/api/widget/save-quote/route.ts` | POST — שומר margin/total ב-`leads` ועדכון `syncLeadToGHL` |
| `integrations/ghl/upload-file.ts` | helper — bytes → POST `/medias/upload-file` → attach to contact |
| `app/api/factory/finalize/[id]/route.ts` | קיים — להוסיף PDF upload ל-GHL בסוף |
| `app/api/widget/send-pdf/route.ts` | POST — bridge.sendMessage(jid, text, mediaPath=pdfUrl) + GHL note |
| עדכון `app/widget/calculator/page.tsx` | + 3 כפתורי action בתחתית הCalculator |

### איך לבדוק ידנית — Phase 1B (כשייבנה)

**Step 1 — Save quote:**
1. widget → שנה margin → "שמור preview"
2. `curl` ל-DB: `SELECT quote_total FROM leads WHERE manychat_sub_id=...`
3. GHL contact → custom field `quote_total` מעודכן

**Step 2 — PDF generate + upload:**
1. widget → "סופי + PDF"
2. בdialog: לראות PDF preview
3. GHL contact → Files tab → אמור להיות `quote-<id>.pdf`

**Step 3 — Send to customer:**
1. "שלח ללקוח"
2. בדוק WhatsApp של test phone — קיבל הודעה + PDF
3. GHL Activity → note "[PDF sent] quote #X to customer"

---

## Phase 1C — Feishu loop 🚧

**מה זה:** מ-widget — "שלח לפבריקה" יוצר שורה ב-Feishu sheet. Cron שעתי בודק אם המפעל מילא מחיר, ואז מעדכן את הliad + מסנכרן ל-GHL + מתריע לאלי.

**קבצים שייווצרו/יעודכנו:**

| Path | מה זה יעשה |
|---|---|
| `app/api/factory/send/route.ts` | קיים — להוסיף `feishu.appendRow()` + `syncLeadToGHL()` בסוף |
| `app/api/factory/poll-feishu/route.ts` | חדש — cron endpoint, מושך rows שיש להם מחיר, מעדכן DB |
| `vercel.json` | + cron entry ל-`poll-feishu` |
| `lib/feishu/client.ts` | קיים — אם חסר `appendRow()` / `listRowsWithFilter()` |

### איך לבדוק ידנית — Phase 1C (כשייבנה)

**Step 1 — Send to factory:**
1. widget → מילוי מפרט → "שלח לפבריקה"
2. בדוק Feishu sheet — אמורה להופיע שורה חדשה עם הליד + מפרט + מחיר ריק
3. GHL stage של הליד → "WAITING_FACTORY"
4. GHL Activity → note `[factory] sent to Feishu row 42`
5. WhatsApp שלך → DM מ-Eli notify bot

**Step 2 — Factory מחזיר מחיר:**
1. ב-Feishu sheet — מילוי עמודה E (`מחיר_מפעל`) במספר
2. המתן עד cycle של cron (או trigger ידני: `curl -H "Authorization: Bearer $BOT_SECRET" https://.../api/factory/poll-feishu`)
3. בדוק DB: `SELECT quote_total FROM leads WHERE...` — מעודכן
4. GHL contact → `quote_total` custom field מעודכן
5. GHL Activity → note `[factory] price received: 1,234 ILS`

---

## Phase 1D — Settings widget 🚧

**מה זה:** Port `/dashboard/v3/settings` כ-iframe. מאפשר עריכת currency rates + default margin + business thresholds מתוך GHL.

**קבצים שייווצרו:**

| Path | מה זה יעשה |
|---|---|
| `app/widget/settings/page.tsx` | iframe wrapper של SettingsView הקיים |
| עדכון `app/dashboard/v3/settings/*` | + `apiToken?: string` prop כמו ב-CalculatorView |

**GHL UI setup חד-פעמי:** Custom Menu Link "⚙️ הגדרות" → `https://.../widget/settings?widget_token=<TOKEN>` → Show On: Sub-Account → Open: Iframe.

### איך לבדוק ידנית — Phase 1D (כשייבנה)

1. GHL sidebar → "⚙️ הגדרות"
2. אמור להיטען SettingsView
3. שנה default margin → Save
4. בדוק DB: `SELECT * FROM app_config WHERE key='factory_config'` — מעודכן
5. פתח Calculator widget → ה-default margin החדש הוא ה-default

---

## Phase 1E — Backfill ✅

**מה זה:** סקריפט one-shot שמעלה את **כל** הלידים מה-DB ל-GHL (גם DROPPED ישנים), שומר `ghl_contact_id` + `ghl_opportunity_id` חזרה ב-DB, יוצר opportunities לפי stage, ומעביר notes + chat history + bot decisions + order summary + activity log + הודעות לConversations Inbox.

**מה נוצר:**

| Path | מה זה עושה |
|---|---|
| [integrations/ghl/backfill.ts](../../integrations/ghl/backfill.ts) | CLI — `--dry-run`, `--resume`, `--extras-only`, `--chat-to-inbox`, `--sid=<id>`, `--limit=<n>`. Rate-limit 120ms/req. |
| `leads.ghl_backfilled_at` column | gate: --resume מדלג על שורות שגנובל זה אצלן |
| `leads.ghl_chat_imported_at` column | gate: --resume מדלג על שורות שchat כבר עבר |

**ריצות בייצור:**
- Smoke 3 → full 82 → extras 78 → chat-to-inbox 44 leads (825 הודעות)
- שגיאות: 2 duplicate-opportunity (אותו טלפון לשני לידים) — נפתרו עם findOpportunityForContact fallback

### איך לבדוק ידנית — Phase 1E (כשייבנה)

**Step 1 — Dry run:**
```bash
npx tsx integrations/ghl/backfill.ts --dry-run
# Expect:
#   "Found 234 leads"
#   "Would create 198 contacts (36 already have ghl_contact_id)"
#   "Would create 198 opportunities"
```

**Step 2 — Real run:**
```bash
npx tsx integrations/ghl/backfill.ts
# Expect: progress bar, ~5min ל-2K leads
```

**Step 3 — בדוק GHL:**
1. CRM → Contacts → צריך להופיע כל הלידים מ-DB
2. Opportunities → Albadi pipeline → כולם פזורים לפי stage
3. בדוק שכמה לידים אקראיים יש להם custom fields ממולאים (bot_summary, quote_total)

**Step 4 — בדוק DB:**
```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM leads WHERE ghl_contact_id IS NOT NULL"
# Expect: == total leads count
```

**Resume mode:** אם crashed באמצע, רץ שוב — מדלג על לידים עם `ghl_contact_id` כבר מוגדר.

---

## Phase 1F — Outbound chat 🚧

**מה זה:** אלי כותב הודעה ב-GHL chat → GHL webhook → backend → bridge → WhatsApp ללקוח. הbridge.sendMessage מוסיף את ההודעה ל-`messages` table כ-`sender='eli'`. סנכרון חזרה ל-GHL מבטל double-display.

**קבצים שייווצרו:**

| Path | מה זה יעשה |
|---|---|
| `integrations/ghl/register-conversation-provider.ts` | one-shot CLI — רושם CUSTOM channel ב-GHL |
| `app/api/integrations/outbound/route.ts` | webhook receiver מ-GHL conversation provider (path בלי "ghl" כי GHL UI חוסם URL שמכיל ghl) |

### איך לבדוק ידנית — Phase 1F (כשייבנה)

1. GHL → Contact → Conversations tab → כתוב הודעה → Send
2. בדוק לוגים ב-Vercel: `[ghl.outbound] sending to bridge jid=...`
3. WhatsApp של test phone — קיבל את ההודעה
4. אחורה ב-GHL — הודעה מסומנת "delivered"
5. DB: `SELECT * FROM messages WHERE sender='eli' ORDER BY ingested_at DESC LIMIT 1` — קיים

---

## Phase 2 🚧

אופציונלי. לא לפני שכל Phase 1 יציב 2+ שבועות.

- Custom Menu Link "🤖 החלטות בוט" + widget עם 👍/👎 feedback
- Custom Menu Link "💰 טיוטות" + widget money-moments approval
- GHL Workflow מחליף Followup cron (visual automation)
- GHL native Meta Lead Ads (מחליף Apps Script)
- Media support ב-Conversations (תמונות/PDF inbound מהלקוח)

---

## 11. Manual setup steps ל-GHL UI

צעדים שאני **לא יכול** לעשות (דורש browser session ב-GHL):

| # | מה | מתי |
|---|---|---|
| A | Private Integration Token + scopes | לפני Phase 0 |
| B | Pipeline "Albadi" עם 8 stages | לפני Phase 0 |
| C | Custom Menu Link "🧮 מחשבון" | אחרי Phase 1A deploy |
| D | Custom Menu Link "⚙️ הגדרות" | אחרי Phase 1D |
| E | Custom Conversation Provider אישור | אחרי Phase 1F |
| F | Facebook Lead Ads native integration | Phase 2 |

פרטי URLs ו-scopes לכל אחד — ראה הphase המתאים למעלה.

---

## 12. Convention לעדכוני מסמך

**כל phase או שינוי משמעותי חייב לכלול ב-המסמך:**
1. **מה נוצר/שונה** — רשימה של paths + שורה אחת על תפקיד
2. **איך לבדוק ידנית** — step-by-step: command/click → expected output
3. **רגרסיה safety** — מה לעשות אם נשבר (kill switch, env flag, revert)

**עדכון סטטוס:**
- ❌ Not started
- 🚧 In progress (חצי בקוד, חצי בהפעלה)
- ✅ DONE
- 🔥 Blocked (סיבה)

ראה Phase 0 ו-Phase 1A כ-template.
