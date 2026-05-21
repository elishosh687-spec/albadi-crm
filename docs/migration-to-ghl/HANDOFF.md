# Session Handoff — GHL Migration

> קרא קודם אם התחלת סשן חדש. אין צורך בשאלות — הכל פה.

עדכון: Phase 0 + 1A הושלמו. ממתין רק GHL Custom Menu Link ידני.

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
| 1 | GHL Custom Menu Link "🧮 מחשבון" | אלי (UI) |
| 2 | Backfill כל הלידים מ-DB → GHL (`integrations/ghl/backfill.ts`) | Claude |
| 3 | `ENABLE_GHL_SYNC=1` ב-Vercel + redeploy | Claude (אחרי backfill) |
| 4 | Phase 1B — PDF flow | Claude |
| 5 | Phase 1C — Feishu loop | Claude |
| 6 | Phase 1D — Settings widget | Claude |
| 7 | Phase 1F — Outbound chat | Claude |
| 8 | מחיקת dashboard ישן | אחרי שPhase 1 יציב 2 שבועות. ראה DELETION-CHECKLIST.md |

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

## ה-Custom Menu Link — מה אלי צריך לעשות

1. `https://app.gohighlevel.com/v2/location/zo0OlVmtNiXiDAbZj2YW/settings/custom-menu-links`
2. **+ Add Custom Menu Link**
3. Name: `🧮 מחשבון`
4. URL:
   ```
   https://albadi-crm.vercel.app/widget/calculator?contactId={{contact.id}}&widget_token=50da21955d78a871e4d1ffdd3e44827e2aa4875a3719dce4f009ca569cbb6a7c
   ```
5. Show On: **Contacts → Detail Page**
6. Open In: **Iframe** (קריטי)
7. Save
