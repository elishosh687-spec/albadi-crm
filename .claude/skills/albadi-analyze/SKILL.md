---
name: albadi-analyze
description: "Albadi CRM escalation analyzer — fetches all pending escalations, produces Hebrew summary + 2-3 reply options + optional tag suggestion per item, posts back to DB. Trigger: 'תנתח הסלמות albadi', 'analyze albadi', 'run albadi-analyze', or any phrasing about analyzing pending escalations."
---

# Albadi — Escalation Analyzer

עיבוד הסלמות שמחכות לניתוח של Claude. כל הסלמה מקבלת summary בעברית, 2-3 אופציות תגובה, ולעיתים הצעת שינוי תג. התוצאות נשמרות ל-DB ומופיעות בדאשבורד.

## Working Directory

`C:\Users\Eli\cursor-projects\albadi\albadi-crm`

## שפה

עברית בלבד ל-summary, label, text, reasoning, suggested_tag_reason. תגיות עצמן הן constants.

## Step 1 — Load secret

```bash
BOT_SECRET=$(grep '^BOT_SECRET=' "C:/Users/Eli/cursor-projects/albadi/albadi-crm/.env" | cut -d '=' -f2-)
```

## Step 2 — Fetch pending

```bash
curl -s -H "Authorization: Bearer $BOT_SECRET" \
  https://albadi-crm.vercel.app/api/bot/pending-analyses
```

Response: `{ pending: [...] }`. אם ריק — סיים שקט: "0 pending".

API מחזיר עד 20 בכל קריאה. תחזור על Step 2 בלולאה (max 10 cycles) עד שהמערך ריק.

## Step 3 — Per item, read context + reason

לכל פריט ב-`pending[]` קרא:
- `leadName` — שם
- `decisionContext.notes` — מה Eli כתב על הליד
- `decisionContext.currentTag` — תג נוכחי
- `decisionContext.daysSinceContact` — שתיקה
- `decisionContext.quoteTotal` — הצעת מחיר
- `triggerText` — מה טריגר את ההסלמה (כולל "ניסיון קודם" אם קיים)
- `reason` — סיבת ההסלמה (low_confidence / human_request / pricing / complaint / unknown)
- `prevTag` — תג קודם
- `ruleMatched` — חוק שירה

חשוב בעברית. Albadi עסק קטן של אריזות מותאמות בישראל.

## Step 4 — Produce analysis

3 שדות חובה + 2 אופציונליים:

### 4a. summary (חובה)

2-3 משפטים בעברית. **להתייחס לדאטה האמיתי**: שם הליד, מה אמר ב-notes, כמה ימי שתיקה, סכום הצעה. לא גנרי.

דוגמה טובה:
> "Shlomi malka — TOP PRIORITY: 23,100 ₪ על 10,000 יחידות 40x12x30 ב-3 צבעים. ה-notes שלנו אמר 'לחזור!' ולא חזרנו 35 יום."

דוגמה רעה (גנרי):
> "ליד תקוע 35 יום, צריך התערבות."

### 4b. suggested_replies (חובה)

מערך של 2-3 אופציות **מובחנות אסטרטגית** (לא ניסוחים שונים לאותו דבר). לכל אחת:
- `label` — 2-4 מילים בעברית
- `text` — 2-4 משפטים, חם וישיר, גוף ראשון. **בלי "שלום וברכה"**, בלי פורמליות מיותרת.
- `reasoning` — משפט אחד בעברית מתי זה הצעד הנכון

**אסטרטגיות זמינות (בחר 2-3 שונות):**

| אסטרטגיה | מתי |
|---|---|
| תזכורת רכה | check-in רגוע, בלי לחץ |
| שאלה ישירה | שאלה ספציפית שמקדמת (מחיר? כמות? תאריך?) |
| תיאום שיחה | להציע שיחה לסגירה |
| הצע משהו | הנחה / דוגמה פיזית / value-add |
| תן לזה לנשום | אל תגיב, חכה שבוע |
| WhatsApp במקום שיחה | קיצור מסלול אם ביקש שיחה |

### 4c. suggested_tag (אופציונלי)

אם מצב הליד מצדיק שינוי תג ברור — הוסף. אחרת `null`.

**מצבים שמצדיקים:**
- ליד מת / חודש+ שתיקה אחרי כל המאמצים → `לא_רלוונטי`
- אישור עסקה / תשלום → `לקוח` (אבל רק אם Eli אישר)
- שתיקה 5+ ימים על ליד פעיל → `לא_ענה`

**תגים תקפים** (כל אחר → null):
```
ליד_חדש, מעוניין, הצעה_בוט, הצעה_טלפון, בתהליך, לקוח, לא_ענה, לא_רלוונטי
```

### 4d. suggested_tag_reason (אופציונלי)

משפט אחד בעברית. **חובה רק אם** `suggested_tag` ≠ null.

## Step 5 — Build payload

```json
{
  "summary": "...",
  "suggested_replies": [
    { "label": "...", "text": "...", "reasoning": "..." },
    { "label": "...", "text": "...", "reasoning": "..." }
  ],
  "suggested_tag": "לא_רלוונטי",
  "suggested_tag_reason": "..."
}
```

אם אין הצעת תג — השמט `suggested_tag` ו-`suggested_tag_reason` (או שלח null).

## Step 6 — POST per item

```bash
curl -s -X POST \
  -H "Authorization: Bearer $BOT_SECRET" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD" \
  "https://albadi-crm.vercel.app/api/bot/escalation-analysis/{id}"
```

`{id}` = `pending[i].id`. וודא HTTP 200 על כל POST.

JSON building: `jq -n` או `printf` עם escaping. **אל תשתמש ב-heredoc bash עם תווים בעברית בתוך JSON** — סיכון לתקלות encoding. עדיף Python script זמני אם הניתוחים ארוכים.

## Step 7 — Loop & report

חזור Step 2 → Step 6 עד `pending=[]`. מקסימום 10 cycles בטיחות.

סיים עם:
```
🤖 Albadi Analyze — נותחו N הסלמות ב-M cycles
   • הצעות תגים: K
   • הסלמות גדולות (>10K): L
```

## Edge cases

| מצב | פעולה |
|---|---|
| `pending=[]` בקריאה ראשונה | "0 pending", סיים |
| context דל (אין notes, אין tag) | summary מציין שאין מספיק info, 2 אופציות גנריות (תן לזה לנשום + תזכורת רכה) |
| ליד שבור (`reason=unknown`) | summary מציין שזה ליד שבור, אופציה אחת: `suggested_tag=לא_רלוונטי` |
| כפילות (notes זהה לליד אחר) | summary מציין כפילות, אופציה למזג ב-DB ידנית |
| triggerText כולל "ניסיון קודם: X" | התחשב בזה — אל תציע אותה אסטרטגיה שכבר נכשלה |

## What you DON'T do

- אל תשלח הודעות ל-WhatsApp. המשתמש בוחר אופציה ידנית בדאשבורד ושולח.
- אל תדחוף תגים ל-ManyChat. הצעת התג נשמרת ב-DB; המשתמש לוחץ "אשר תג" ידנית.
- אל תמציא דאטה. רק ה-context שב-API.
- אל תוסיף "שלום וברכה" / "תודה" / פתיחות פורמליות. גוף ראשון, חם, ישיר.
- אל תייצר 2 אופציות שהן ניסוח שונה לאותה אסטרטגיה. צריך מובחן.

## Tools

bash + curl. JSON building: `jq` או Python אד-הוק. **אסור** web browsing, לא דרוש.
