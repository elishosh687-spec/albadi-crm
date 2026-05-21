# Session Handoff — GHL Migration

> קרא קודם אם התחלת סשן חדש. אין צורך בשאלות — הכל פה.

עדכון: Phase 0 + 1A הושלמו **end-to-end**. Widget נראה ב-GHL sidebar, נטען בקליק, מציג Calculator + boss-mode breakdown. ממתין Phase 1E (backfill) + 1B (PDF) + 1C (Feishu) + 1F (outbound chat).

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
| 2 | Backfill כל הלידים מ-DB → GHL (`integrations/ghl/backfill.ts`) | Claude — **NEXT** |
| 3 | Widget בתוך contact detail (לא sidebar) — חוקרים: Custom Fields HTML / Marketplace App / Custom Tab | Claude |
| 4 | `ENABLE_GHL_SYNC=1` ב-Vercel + redeploy | Claude (אחרי backfill) |
| 5 | Phase 1B — PDF flow | Claude |
| 6 | Phase 1C — Feishu loop | Claude |
| 7 | Phase 1D — Settings widget | Claude |
| 8 | Phase 1F — Outbound chat | Claude |
| 9 | מחיקת dashboard ישן | אחרי שPhase 1 יציב 2 שבועות. ראה DELETION-CHECKLIST.md |

## הצעד הראשון בסשן הבא

**A. Backfill (Phase 1E)** — סקריפט one-shot:
- קורא כל `leads` מ-DB
- לכל ליד: `upsertGHLContact` + `createOrUpdateGHLOpportunity`
- שומר `ghl_contact_id`, `ghl_opportunity_id` חזרה ב-DB
- supports `--dry-run` + `--resume`
- rate-limit handling (GHL 10 req/sec)
- run: `npx tsx integrations/ghl/backfill.ts`

קוד יצרר ב-`integrations/ghl/backfill.ts`.

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
