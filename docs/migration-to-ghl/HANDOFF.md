# Session Handoff — GHL Migration

> קרא קודם אם התחלת סשן חדש. אין צורך בשאלות — הכל פה.

עדכון (2026-05-21 ערב): Phase 0 + 1A + 1E הושלמו **end-to-end**. Widget ב-GHL sidebar, 82 contacts + opportunities + 4 סוגי notes + Inbox messages ב-GHL. ממתין: A) `ENABLE_GHL_SYNC=1` ב-Vercel (live inbound flow), B) Phase 1F (Outbound chat — אלי מקליד ב-GHL→WA), C) 1B/1C/1D.

---

## מה עשינו

### Code ב-`albadi-crm/`
- `integrations/ghl/` — config, client (REST V2), mapping, sync, bootstrap, widget-auth + README
- `app/widget/calculator/page.tsx` + `app/widget/layout.tsx` — iframe endpoint
- `app/api/widget/lead-context/route.ts` — GET lead by ghl_contact_id
- `middleware.ts` — allowlist widget routes + `widget_token` bypass ל-`/api/factory/*`
- `next.config.js` — CSP `frame-ancestors` ל-GHL/LeadConnector + BOM strip
- `app/api/bridge/webhook/route.ts` — `void syncLeadToGHL(sid)` אחרי handlers
- `app/actions/v2.ts` — `void syncLeadToGHL` ב-setFinalPrice/snooze/setBotPaused
- `components/calculator/` — CalculatorView + DetailedBreakdown (משותפים widget + dashboard)
- `drizzle/schema.ts` — `leads.ghl_contact_id`, `leads.ghl_opportunity_id`

### DB (Neon)
- Migration רץ: `ghl_contact_id` + `ghl_opportunity_id` columns קיימים על leads

### Vercel
- 19 env vars production
- Deploy production עבר — `https://albadi-crm.vercel.app/widget/calculator?widget_token=...` → 200 + CSP נקי

### GHL account `zo0OlVmtNiXiDAbZj2YW`
- Private Integration Token: `pit-80128d88-b443-4ece-aa66-2e1f6c65dbe8`
- Pipeline `albadi` (id `JG6rSzAxvlK4gROZ6Ot0`) — 8 stages
- 5 Custom Fields on Contact

---

## מה נשאר

| # | מה | מי |
|---|---|---|
| ~~1~~ | ~~GHL Custom Menu Link "🧮 מחשבון"~~ | ✅ DONE (אלי, 2026-05-21) |
| ~~2~~ | ~~Backfill — 82 לידים מלאים ל-GHL~~ | ✅ DONE (Claude, 2026-05-21) |
| 3 | `ENABLE_GHL_SYNC=1` ב-Vercel + redeploy | Claude — **NEXT (A)** |
| 4 | Phase 1F — Outbound chat (Eli → GHL → WA) | Claude — **NEXT (B)** |
| 5 | Phase 1B — PDF flow | Claude |
| 6 | Phase 1C — Feishu loop | Claude |
| 7 | Phase 1D — Settings widget | Claude |
| 8 | Widget בתוך contact detail (לא sidebar) — חוקרים: Custom Fields HTML / Marketplace App / Custom Tab | Claude |
| 9 | מחיקת dashboard ישן | אחרי שPhase 1 יציב 2 שבועות. ראה DELETION-CHECKLIST.md |

## הצעד הראשון בסשן הבא

**A. live sync** — ✅ DONE 2026-05-21. ENABLE_GHL_SYNC=1 deployed.

**B. Phase 1F — Outbound chat — IN PROGRESS:**

קוד מוכן (commit 92xxxxx):
- `integrations/ghl/oauth.ts` — Marketplace OAuth exchange + refresh
- `integrations/ghl/client.ts` — `upsertConversationProvider(accessToken)` עם dual auth
- `integrations/ghl/register-conversation-provider.ts` — חד-פעמי CLI דרך OAuth token
- `app/api/integrations/install` — GET → redirect לMarketplace
- `app/api/integrations/oauth/callback` — מקבל code → tokens → DB
- `app/api/integrations/outbound` — Bearer-auth'd webhook → sendBridgeMessage(jid, text, "eli") → GreenAPI
- DB: `ghl_oauth_tokens(locationId PK, access_token, refresh_token, expires_at, scope, company_id, user_type, updated_at)`

ENV נדרשים:
- `GHL_OUTBOUND_WEBHOOK_SECRET` — ✅ set in Vercel (c72bc568...)
- `GHL_OAUTH_CLIENT_ID` — ⏳ אלי יוצר Marketplace Private App
- `GHL_OAUTH_CLIENT_SECRET` — ⏳ same
- `GHL_OAUTH_REDIRECT_URI=https://albadi-crm.vercel.app/api/integrations/oauth/callback`
- `GHL_CONVERSATION_PROVIDER_ID` — מקבלים מהScript אחרי register

צעדים פתוחים:
1. אלי יוצר Marketplace Private App עם scopes מ-`DEFAULT_SCOPES` (כולל `conversations/providers.write`)
2. אלי מוסר Client ID + Secret → Vercel envs + redeploy
3. אלי פותח `/api/integrations/install` → אישור → callback שומר tokens
4. `npx tsx integrations/ghl/register-conversation-provider.ts` → מקבלים providerId
5. `GHL_CONVERSATION_PROVIDER_ID` → Vercel + redeploy
6. עדכון sync.ts forwardMessage + backfill chat-to-inbox לשלוח type="Custom" + conversationProviderId
7. Re-import chat history כ-Custom (אופציונלי, או להשאיר SMS thread קיים)
8. Smoke: שולחים הודעה מ-GHL Inbox → אמורה להגיע ב-WhatsApp דרך GreenAPI

## הסטטוס של ה-Custom Menu Link

- **שם:** albadi calculator
- **URL:** `https://albadi-crm.vercel.app/widget/calculator?widget_token=50da21955d78a871e4d1ffdd3e44827e2aa4875a3719dce4f009ca569cbb6a7c`
- **Show On:** Sidebar (Agency + Sub-account)
- **When Clicked:** Same Tab / Iframe (verified working)
- **בעיה ידועה:** GHL has a bug — לא יכול לשים `{{contact.id}}` ב-URL כשShow On = Sidebar (GHL onClick handler crashes עם `Cannot read properties of undefined (reading '$uxMessage')`). Workaround: הסיר `{{contact.id}}` מה-URL כרגע. ה-widget רץ ב-standalone mode.
- **TODO Phase 1E+:** למצוא דרך לשים widget בתוך contact detail (לא sidebar) → אז `{{contact.id}}` יעבוד.

---

## IDs קריטיים

```env
GHL_API_KEY=pit-80128d88-b443-4ece-aa66-2e1f6c65dbe8
GHL_LOCATION_ID=zo0OlVmtNiXiDAbZj2YW
GHL_PIPELINE_ID=JG6rSzAxvlK4gROZ6Ot0
GHL_WIDGET_TOKEN=50da21955d78a871e4d1ffdd3e44827e2aa4875a3719dce4f009ca569cbb6a7c

GHL_STAGE_NEW=980f1b2e-7c2c-427e-97ba-184ed64a138f
GHL_STAGE_AWAITING_ESTIMATE=83a109c2-9f23-436b-ae57-64356684f51a
GHL_STAGE_AWAITING_LOGO=46b83cc8-3fab-4860-b5b7-f6268b585df8
GHL_STAGE_WAITING_FACTORY=e89642cb-c832-4417-9ceb-04bbe223c3e1
GHL_STAGE_AWAITING_FINAL=d829b841-51df-4f92-b76a-e7496b44ec0c
GHL_STAGE_CALLBACK_LATER=78806c17-ba9f-4e5e-87cc-d9c98a8549b7
GHL_STAGE_WON=c0bccca4-fbde-4458-8970-db105022281c
GHL_STAGE_DROPPED=6b716c7e-0a77-447d-9594-8163c83f5b90

GHL_FIELD_MANYCHAT_SUB_ID=9YV9MzyTSQO6g1ND7gwm
GHL_FIELD_WA_JID=alYsHnYu2YLahkp25IwW
GHL_FIELD_BOT_SUMMARY=PajtRpfGVqagt5UNEw1H
GHL_FIELD_QUOTE_TOTAL=Zb8xcXHyPretYFK2fxFA  # type=MONETORY (GHL typo)
GHL_FIELD_PIPELINE_FLAG=RWIsVudSbh5WKZFEXl1y
```

---

## Git commits

- `67574e0` feat(ghl): integration foundation + calculator widget
- `95c81b7` fix(ghl): strip BOM from WIDGET_ALLOWED_FRAME_ANCESTORS env
- `1c8602d` docs(ghl): add session handoff section + current state snapshot
- (next) chore(structure): move CalculatorView + split docs

---

## ה-Custom Menu Link — DONE ✅

נוצר ב-Agency view → Settings → Custom Menu Links.
- URL בלי `{{contact.id}}` בגלל GHL bug (ראה למעלה).
- Widget נטען ב-sidebar של sub-account "Eli".
- מחשבון + boss-mode breakdown עובדים.
- Standalone mode (אין lead match) — תקין לטסט.
