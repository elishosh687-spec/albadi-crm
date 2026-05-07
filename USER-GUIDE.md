# Albadi CRM — מדריך משתמש מהיר

> שימוש יומיומי. למסמך הטכני המלא ראה [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md). למסמך הדרישות ראה [PRD-lead-bot.md](./PRD-lead-bot.md).

---

## מה זה

מערכת שעוקבת אחרי 32 הלידים שלך ב-ManyChat, מציפה רק את אלה שדורשים אותך, ומציעה פעולות.

## פיצ'רים

| # | פיצ'ר | סטטוס |
|---|-------|------|
| 1 | סקירה שעתית של 32 לידים | ✅ פעיל |
| 2 | סיווג אוטו לפי 7 כללים | ✅ פעיל |
| 3 | תור הסלמות עם טיוטה + אישור | ✅ פעיל |
| 4 | Pipeline kanban (8 תגים) | ✅ פעיל |
| 5 | היסטוריית ריצות | ✅ פעיל |
| 6 | תיוג בפועל ב-ManyChat | ⏳ Phase 2 |
| 7 | שליחת templates ללקוחות | ⏳ Phase 3 (ממתין אישור Meta) |
| 8 | התראות WhatsApp לאלי | ⏳ Phase 4 |

## איך מפעילים

**המערכת כבר פועלת. אין מה להפעיל.**

הroutine בענן Anthropic רץ אוטומטית כל שעה. הדאשבורד תמיד נגיש בענן Vercel.

---

## יום-יום (2 דקות בבוקר)

1. פותח https://albadi-crm.vercel.app
2. סיסמה: `Eb688837`
3. רואה כמה הסלמות פתוחות
4. עבור כל הסלמה:
   - קורא את הסיבה והטריגר
   - כותב טיוטה ב-textarea (או לוחץ "אטפל ידנית" ועובר ל-ManyChat ישירות)
   - לוחץ "✓ אשר ושלח" / "✗ דחה"

---

## לינקים מהירים

| מה | URL |
|----|-----|
| Dashboard | https://albadi-crm.vercel.app/dashboard |
| Routine cloud | https://claude.ai/code/routines/trig_01VWAWDtdHXqMMProUCseKbj |
| GitHub repo | https://github.com/elishosh687-spec/albadi-crm |
| Vercel project | https://vercel.com/elishosh687-specs-projects/albadi-crm |
| Neon DB | https://console.neon.tech (project: `albadi-crm`) |

---

## פקודות לקלוד (אומר בצ'אט)

| מה | פקודה |
|----|-------|
| השעיית הבוט | "השעה את הבוט" |
| הפעלה מחדש | "הפעל את הבוט" |
| ריצה ידנית עכשיו | "תריץ את הבוט עכשיו" |
| הוספת template חדש | "תוסיף template ל-X" |
| שינוי סיסמת dashboard | "תחליף סיסמת dashboard ל-Y" |

---

## פתרון בעיות

| בעיה | פתרון |
|------|-------|
| Dashboard לא נטען | בדוק https://vercel.com/elishosh687-specs-projects/albadi-crm/deployments — אולי deploy אחרון נכשל |
| הסלמות לא מתעדכנות | בדוק את הroutine: https://claude.ai/code/routines/trig_01VWAWDtdHXqMMProUCseKbj — האם enabled? |
| קיבלתי 401 ב-API | `BOT_SECRET` לא תואם בין Vercel ל-routine. בדוק `vercel env ls production` |
| שכחתי סיסמה לdashboard | `Eb688837` (כתוב גם ב-PROJECT-OVERVIEW.md סעיף 4) |
| הבוט לא רץ כבר שעה+ | בדוק `vercel ls` — האם יש deploys כושלים |

---

## איך מתחילים פיתוח מקומי

```bash
cd C:\Users\Eli\cursor-projects\albadi\albadi-crm
npm run dev
```

פותח ב-http://localhost:3000

**Scripts זמינים:**

| פקודה | מה עושה |
|-------|---------|
| `npm run dev` | dashboard מקומי |
| `npm run build` | בדיקת build לפני push |
| `npm run db:studio` | UI לעיון ב-Neon DB |
| `npm run bot:list-leads` | תצוגת 32 לידים עם סיווג אוטו |
| `npm run bot:run-once` | ריצה ידנית של הבוט (Phase 1 read-only) |
| `npm run bot:restart` | תצוגת קבוצות ל-restart mode (32 לידים תקועים) |
| `npm run bot:restart-send` | dry-run של batch לכל 32 הלידים |
| `npm run bot:restart-send -- --confirm` | שליחה אמיתית (אחרי אישור Meta) |

---

## סטטוס ענני

המערכת רצה ב-3 ענני שונים שעובדים יחד:

```
Anthropic Cloud Routine (כל שעה)
        │
        │ HTTP POST + Bearer
        ↓
Vercel (Next.js + API)
        │
        │ ManyChat API + Drizzle
        ↓
Neon Postgres ← ManyChat (קיים)
```

---

## עלות חודשית

**$0.** הכל ב-tier חינמי או כלול במנוי קיים.

---

## שאלות נפוצות

**Q: האם הבוט שולח הודעות ללקוחות עכשיו?**
לא. ב-MVP הוא במצב read-only. רק מציע תיוג ושומר ל-DB. אחרי שMeta תאשר את 6 ה-templates (1-3 ימים) — Phase 3 ייכנס לפעולה.

**Q: מה קורה אם ManyChat נפל?**
הבוט יקבל errors בריצה הבאה ויתעד אותם ב-`bot_runs.errors`. הריצה שאחריה תנסה שוב.

**Q: אם אני מחליף תג ב-ManyChat ידנית?**
הבוט יראה את התג החדש בריצה הבאה. אם הוא חשב שצריך לתייג אותו אחרת, ירשום החלטה חדשה ב-DB.

**Q: כמה זמן הבוט רץ בכל ריצה?**
כ-5-10 שניות ל-32 לידים (rate-limited 100ms/לקוח).

**Q: איך אני מוסיף ליד חדש?**
אתה לא — הלקוח שולח הודעה ל-WhatsApp העסקי. ManyChat קולט אוטומטית. הבוט יראה אותו בריצה הבאה.

---

**גרסה:** 1.0 — 2026-05-07
