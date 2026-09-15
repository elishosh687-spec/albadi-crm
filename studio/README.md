# סטודיו אלבדי — Bag Studio (מקומי בלבד)

עמוד מקומי שרץ על ה-Mac של אלי: **צ'אט חי עם Claude או Codex** שמייצר **הדמיה** (mockup + וידאו)
ו**פריסה** (קובץ הפקה), עם כפתורי **שליחה ב-WhatsApp ללקוח** ו**העלאה לתיק העסקה**.

לא נפרס ל-Vercel — הוא צריך את הסקילים והמפתחות המקומיים (Gemini/Veo והסוכן הנבחר)
שקיימים רק על ה-Mac. `node_modules` מבודד (zod v4 של ה-Agent SDK לא נוגע ב-zod v3 של ה-CRM).

## דרישות חד-פעמיות

```bash
cd studio
npm install                                   # מתקין את @anthropic-ai/claude-agent-sdk (מבודד)

# לפריסה (dieline-print) צריך pymupdf/pillow/numpy:
pip3 install -r ~/.claude/skills/dieline-print/scripts/requirements.txt
# ffmpeg + ghostscript כבר מותקנים; Claude Code כבר מחובר.
```

הסקילים שהסטודיו מפעיל: `bag-mockup-video` + `dieline-print`, מהספרייה של הסוכן הנבחר
(+ `guy-aga-nano-banano-pro` למפתח Gemini).

## הרצה

```bash
cd studio
npm start
# פותח: http://localhost:4747
```

ברירת המחדל נשארת Claude לצורך rollback. להפעלת Codex עם מנוי ChatGPT המקומי:

```bash
ALBADI_STUDIO_PROVIDER=codex npm start
```

Codex משתמש בכניסה המקומית הקיימת, ללא API key וללא העתקת `auth.json`. הוא רץ עם
אישור אוטומטי מבוקר ב-sandbox של workspace, ו-hooks כלליים כבויים עבור תהליך הסטודיו.
חזרה מיידית: `ALBADI_STUDIO_PROVIDER=claude npm start`.

**הטוקן מגיע אוטומטית מהתפריט.** לחיצה על **סטודיו** בתפריט ה-hub פותחת
`localhost:4747/?token=<GHL_WIDGET_TOKEN>&sid=<לקוח נוכחי>` — אין צורך ב-env,
והלקוח הנוכחי כבר טעון לשליחה ב-WhatsApp.

לפתיחה **ישירה** (לא מהתפריט) קבע את הטוקן ב-env:
`WIDGET_TOKEN=<GHL_WIDGET_TOKEN> npm start`.
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
- `agent.ts` — שכבת provider כפולה: Claude Agent SDK או Codex CLI, עם resume לרב-תור.
- `lib.ts` — קריאות ל-CRM (מראה את `scripts/deal-file.ts`, בלי לייבא קוד שרת).
- `public/index.html` + `public/app.js` — ה-UI (warm-dark, RTL).
- קבצי עבודה נשמרים תחת `~/albadi-studio/<lead|deal>/`.
