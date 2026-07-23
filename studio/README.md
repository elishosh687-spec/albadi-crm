# סטודיו אלבדי — Bag Studio (מקומי בלבד)

עמוד מקומי שרץ על ה-Mac של אלי: **צ'אט חי עם Claude** שמייצר **הדמיה** (mockup + וידאו)
ו**פריסה** (קובץ הפקה), עם כפתורי **שליחה ב-WhatsApp ללקוח** ו**העלאה לתיק העסקה**.

לא נפרס ל-Vercel — הוא צריך את הסקילים המקומיים והמפתחות (Gemini/Veo, Claude Code)
שקיימים רק על ה-Mac. `node_modules` מבודד (zod v4 של ה-Agent SDK לא נוגע ב-zod v3 של ה-CRM).

## דרישות חד-פעמיות

```bash
cd studio
npm install                                   # מתקין את @anthropic-ai/claude-agent-sdk (מבודד)

# לפריסה (dieline-print) צריך pymupdf/pillow/numpy:
pip3 install -r ~/.claude/skills/dieline-print/scripts/requirements.txt
# ffmpeg + ghostscript כבר מותקנים; Claude Code כבר מחובר.
```

הסקילים שהסטודיו מפעיל: `~/.claude/skills/bag-mockup-video` + `~/.claude/skills/dieline-print`
(+ `guy-aga-nano-banano-pro` למפתח Gemini).

## הרצה

```bash
cd studio
WIDGET_TOKEN=<GHL_WIDGET_TOKEN> npm start
# פותח: http://localhost:4747
```

`WIDGET_TOKEN` = הערך של `GHL_WIDGET_TOKEN` מ-Vercel env (נדרש לשליפה/העלאה/שליחה מול ה-CRM).
אופציונלי: `CRM_BASE` (ברירת מחדל prod), `PORT` (ברירת מחדל 4747).

## זרימת עבודה

1. **טען עסקה** (מזהה `fq_…` מטאב עסקאות) — מושך בריף (מידות/צבעים/ידיות) ומזהה את הליד.
   אפשר גם בלי — מצב "ליד חופשי": פשוט תאר את התיק בצ'אט.
2. **הדמיה** — בצ'אט: "תעשה הדמיה, רקע ירוק, עם הלוגו שאעלה". תיקונים בשיחה: "תגדיל את הלוגו",
   "תעשה וידאו 6 שנ׳". הקבצים מופיעים בפאנל **תוצאות**.
3. **פריסה** — גרור **לוגו** + **פריסת מפעל** לשני האזורים → "צור קובץ הפקה" → PDF הפקה.
4. לכל תוצאה: **שלח ללקוח** (WhatsApp, אם יש ליד) · **לתיק** (נכנס לציר תיק העסקה + שיקוף GHL,
   רק אם נטענה עסקה סגורה).

## מודל LEAD-FIRST

ההדמיה היא כלי מכירה **לפני** הסגירה → הסטודיו עובד על **ליד**, לא רק עסקה סגורה.
לקוח שלא הזמין → הכל נשאר על הליד (הדמיה + הודעת WhatsApp), כלום לא נכנס לעסקאות.
כפתור "לתיק" מופיע רק כשנטענה עסקה סגורה.

## קבצים

- `server.ts` — שרת HTTP מקומי + SSE + proxy ל-CRM (pull/push/whatsapp/upload/file).
- `agent.ts` — עוטף את `@anthropic-ai/claude-agent-sdk` (`query`) עם הסקילים + resume לרב-תור.
- `lib.ts` — קריאות ל-CRM (מראה את `scripts/deal-file.ts`, בלי לייבא קוד שרת).
- `public/index.html` + `public/app.js` — ה-UI (warm-dark, RTL).
- קבצי עבודה נשמרים תחת `~/albadi-studio/<lead|deal>/`.
