# Albadi CRM — PRD (Product Requirements Document)

> נכתב 2026-05-13. גרסה: v3 (post-bridge, post-Retool console).
> Source of truth ל-**why**. השאלון, התסריט והשלבים בפועל = [CUSTOMER-FLOW.md](./CUSTOMER-FLOW.md).
> אינוונטר פיצ'רים = [FEATURES.md](./FEATURES.md). ארכיטקטורה = [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. Problem

אלבדי מוכר רצפות/ויטרינות/וילונות. רוב הלידים נכנסים ב-WhatsApp. אלי (Solo founder) מנהל את כולם ידנית: עונה לשאלות, שולח הצעות מחיר, רודף אחרי לידים תקועים, מאשר עסקאות.

כאבים:
- **זמן תגובה איטי** ללידים חדשים → איבוד עסקאות לתחרות.
- **שאלון חוזר** (10 שאלות לכל ליד) שוחק ולא מתועד.
- **אין מעקב** אחרי לידים שלא ענו לזמן רב → נופלים בין הכיסאות.
- **תמחור חוזר** לאותם מוצרים → טעויות + חוסר אחידות.
- **לא ניתן לדעת** מה המצב של כל הצינור בלי לדפדף בשיחות WhatsApp.

## 2. Users

| User | תפקיד | אינטראקציה |
|---|---|---|
| **אלי** | Owner / supervisor יחיד | דאשבורד פיקוח, מאשר drafts, override על מצב לידים, שולח מחיר סופי ידנית |
| **לקוח פוטנציאלי** | מקבל את הבוט ב-WhatsApp | עונה לשאלון, מקבל הצעת מחיר, מאשר/דוחה |

לא יוזרים: צוות חיצוני, נציגי שירות. הכל single-user.

## 3. Goals (outcomes)

1. **Time-to-first-response < 1 דקה** לכל ליד חדש (במקום שעות בקצב הידני של אלי).
2. **שאלון אוטומטי מלא ב-95%** מהמקרים — אלי מתערב רק ב-edge cases.
3. **0 לידים שנשכחים** — כל ליד שלא ענה X זמן מקבל follow-up אוטומטית.
4. **Visibility מלא** — אלי רואה במסך אחד מה המצב של כל הצינור (כמה NEW, כמה ממתינים לתגובה שלו, כמה WON החודש).
5. **תמחור אחיד** — calc engine מחזיר אותו מחיר לאותו מפרט.
6. **Human-in-the-loop על money moments** — בוט לא מוריד מחיר/מבטיח עסקה לבד. דורש אישור אלי.

### מדדים (success metrics)

| מדד | יעד | מקור |
|---|---|---|
| % לידים שעוברים שאלון בלי `NEEDS_ELI` | ≥ 70% | `analytics` (v3) |
| Median time-to-first-bot-reply | < 30s | `messages` table — diff `received_at` ↔ outbound `sent_at` |
| % לידים שמגיעים ל-`AWAITING_ESTIMATE` תוך 24h | ≥ 60% | pipeline funnel |
| Conversion `AWAITING_FINAL → WON` | ≥ 40% | analytics |
| Drafts approved without edit | ≥ 60% | `bot_drafts.edited_text IS NULL` |
| Drafts rejected | < 15% | `bot_drafts.status='rejected'` |

## 4. Scope

### In scope
- שאלון WhatsApp אוטומטי (9 שאלות) → calc → הצעת מחיר משוערת.
- ניהול state pipeline על כל ליד (NEW → ESTIMATE → LOGO → FACTORY → FINAL → WON/DROPPED).
- Follow-up cron אוטומטי (לידים שותקים → תזכורת, עד drop).
- Money-moment draft queue — אלי מאשר/דוחה כל הודעה ברגעי כסף.
- Supervisor dashboard (v3 = primary, v2 = fallback): פיקוח, override ידני, drafts, analytics.
- Manual reply path — אלי שולח ידנית מהדאשבורד.
- Inbound webhook מ-WhatsApp bridge → DB.

### Out of scope (לעת עתה)
- Multi-tenant (משתמש אחד = אלי).
- App ללקוח (הכל ב-WhatsApp).
- אינטגרציה לCRM חיצוני (Salesforce/HubSpot).
- שליחת חשבוניות / סליקה.
- ניהול מלאי / הזמנות מהמפעל.
- Multi-language (עברית בלבד).

## 5. Constraints

- **Stack:** Next.js (App Router) על Vercel Hobby plan. Neon PostgreSQL. Drizzle ORM.
- **Vercel Hobby:** cron יומי בלבד מובנה — לכן follow-ups רצים ב-cron יומי + cloud routine חיצוני (Claude routine).
- **WhatsApp:** דרך whatsapp-bridge-node tenant פרטי. אין מגבלת 24h של Cloud API. אין תמיכה ב-templates (לא נדרש כי אין מגבלה).
- **שפה:** עברית RTL. כל ה-copy + UI בעברית.
- **Auth:** סיסמה אחת לדאשבורד (אלי בלבד) + Bearer BOT_SECRET ל-API.
- **תקציב:** zero — Neon free tier, Vercel Hobby, bridge VPS קטן.

## 6. Non-goals

- לא בוט "חברותי" / small-talk. הבוט תועלתני — שאלון, מחיר, סגירה.
- לא לקוחות חוזרים / לויאליות. כל ליד = עסקה חד-פעמית.
- לא scaling ל-100 לידים ביום. נכון לעכשיו ~10-30 לידים פעילים בו-זמנית.

## 7. Key Decisions (לרפרור — ראה [adr/](./adr/))

- **bridge over ManyChat** — שליטה מלאה, אין vendor lock-in, אין מגבלת 24h.
- **DB as source of truth** — לא ManyChat custom fields, לא bridge state.
- **Retool console + v3 dashboard** — Retool ל-supervisor flows כבדים, v3 ל-day-to-day.
- **Drafts on money moments only** — בוט שולח לבד את השאר; אלי לא נדרש לאשר כל הודעה.
- **JID as primary key** (bridge leads) — מאחד identity על פני messages/leads/tags.

## 8. Open Questions / Risks

- ManyChat path עוד חי (USE_BRIDGE flag) — מתי מוחקים סופית?
- v2 dashboard עוד חי — מתי מוחקים?
- אין בדיקות אוטומטיות מלאות לכל ה-pipeline — סיכון רגרסיה.
- אין מנגנון rollback ל-classification שגויה של הבוט (תיקון ידני בלבד).
- אם bridge VPS נופל — אין WhatsApp. אין fallback.
