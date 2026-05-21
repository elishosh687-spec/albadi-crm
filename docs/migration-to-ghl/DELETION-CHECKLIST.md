# Deletion Checklist — מה למחוק אחרי שGHL יציב

> **אסור למחוק כלום עד ש-Phase 1 (A→F) יציב לפחות שבועיים** ואלי מאשר שהוא לא צריך את הdashboard.
>
> כל מחיקה דורשת בנפרד type-check + deploy + smoke test ב-GHL.

---

## 🔴 קוד למחיקה (כשמוכנים)

### Dashboard UI (לב המחיקה)
- [ ] `app/dashboard/v2/` — entire folder (deprecated מזמן)
- [ ] `app/dashboard/v3/` — entire folder *EXCEPT* `_components/factory/` (משמש PDF Generator?) — לבדוק
- [ ] `app/dashboard/` (root layout) — אחרי שתוכן ריק

### Auth
- [ ] `app/login/` — GHL auth מחליף
- [ ] `app/api/auth/` — login/logout/etc
- [ ] middleware `albadi_auth` cookie check

### Dashboard server actions (חלק מהדאשבורד)
- [ ] `app/actions/v2.ts` — לבדוק: יש שורה אחת `void syncLeadToGHL` שצריך לשמור! או להזיז ל-`integrations/ghl/wire.ts` קודם.
- [ ] `app/api/actions/` — אם קיים

### Dashboard-only API routes
- [ ] `app/api/leads/[sid]/decisions/route.ts` (BotDecisionsTab)
- [ ] `app/api/leads/[sid]/override/route.ts` (Retool override)
- [ ] `app/api/drafts/pending/route.ts` (לdashboard drafts queue UI) — להחליף ב-widget API
- [ ] `app/api/drafts/[id]/approve/route.ts` (אם widget Phase 2 יחליף)
- [ ] `app/api/drafts/[id]/reject/route.ts`

### Components של dashboard
- [ ] `app/dashboard/v3/_components/BotDecisionsTab.tsx`
- [ ] `app/dashboard/v3/_components/LeadsBoard.tsx`
- [ ] `app/dashboard/v3/_components/ExpandedLead.tsx`
- [ ] `app/dashboard/v3/_components/factory/FactoryQuotePanel.tsx`
- [ ] `app/dashboard/v3/_components/factory/FinalizeModal.tsx`
- [ ] `app/dashboard/v3/_components/factory/QuoteHtmlPreview.tsx`
- [ ] `app/dashboard/v3/conversations/*`
- [ ] `app/dashboard/v3/leads/*`
- [ ] `app/dashboard/v3/pipeline/*`
- [ ] `app/dashboard/v3/analytics/*`
- [ ] `app/dashboard/v3/drafts/*`
- [ ] `app/dashboard/v3/settings/*` — אחרי שPhase 1D widget מחליף
- [ ] `app/dashboard/v3/calculator/page.tsx` — widget מחליף, רק page נמחק. CalculatorView כבר ב-`components/calculator/`
- [ ] `app/dashboard/v3/factory/*`
- [ ] `app/dashboard/v3/followups/*`

### Meta Lead Ads (אחרי Phase 2)
- [ ] `app/api/leads/facebook-import/route.ts` — GHL native מחליף
- [ ] `lib/sheets/lead-gaps.ts` — gap detection לא רלוונטי כשGHL מטפל

### Retool
- [ ] `retool/` folder אם קיים

### Middleware — לפשט
- [ ] להוריד `albadi_auth` cookie check
- [ ] להוריד `/dashboard/:path*` matcher
- [ ] להוריד `/api/actions/:path*` matcher
- [ ] להשאיר רק: `/widget/*`, `/api/widget/*`, `/api/factory/*`, `/api/bridge/*`, `/api/bot/*`

### Env vars לניקוי
- [ ] `ADMIN_PASSWORD` — אין יותר login
- [ ] `MANYCHAT_TOKEN` — bridge מחליף מזמן
- [ ] `MANYCHAT_BASE`
- [ ] `MANYCHAT_WEBHOOK_SECRET`
- [ ] template vars (`TEMPLATE_*`) אם לא בשימוש

---

## 🟢 חייב להישאר

```
albadi-crm/
├── lib/
│   ├── db.ts
│   ├── bridge/
│   ├── messaging/
│   ├── supervisor/
│   ├── autoresponder/
│   ├── drafts/
│   ├── factory/
│   ├── feishu/
│   ├── notify/
│   └── ...
├── components/
│   ├── ui/
│   └── calculator/      ← CalculatorView + DetailedBreakdown
├── drizzle/             ← schema
├── integrations/
│   └── ghl/             ← GHL sync layer
├── app/
│   ├── api/
│   │   ├── bridge/webhook/      ← WA inbound
│   │   ├── bot/                 ← followup cron + new-lead
│   │   ├── factory/             ← quote-preview + finalize + PDF
│   │   ├── widget/              ← widget APIs
│   │   └── integrations/ghl/    ← GHL → backend webhooks
│   └── widget/                  ← iframe pages
├── scripts/
├── middleware.ts                ← פושטים
├── next.config.js
└── vercel.json
```

---

## תהליך המחיקה (כשמוכנים)

1. ודא Phase 1A/1B/1C/1D/1F יציב בייצור 2 שבועות
2. אלי מאשר שעובד רק ב-GHL, לא חוזר לdashboard
3. `git checkout -b cleanup/delete-dashboard`
4. מחיקה הדרגתית — push כל commit נפרד
5. אחרי כל push — Vercel deploy + smoke test
6. אם נשבר — `git revert`
7. סוף — merge cleanup branch ל-main
8. drop env vars ישנים מ-Vercel
9. (אופציונלי) drop unused DB columns (אחרי גיבוי): legacy bot_drafts לא בשימוש, וכו'
