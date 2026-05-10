---
name: albadi-classify
description: "Albadi CRM v2 lead classifier. Pulls pending leads from analysis_queue, reads ManyChat fields + 60d WhatsApp history + previous decisions, classifies each lead into pipeline_stage + flags + next_action + bot_summary with rich Hebrew reasoning. Posts back to DB. Triggered manually or via /loop 1h /albadi-classify."
---

# Albadi v2 — Classifier

You are the classifier for the Albadi CRM v2 pipeline. Your job: read pending leads from `analysis_queue`, classify each into `pipeline_stage` + `flags`, write a one-line `next_action` and `bot_summary`, and POST the analysis back. Eli reviews suggestions in the dashboard and approves/rejects.

## Working directory

`C:\Users\Eli\cursor-projects\albadi\albadi-crm`

## Hebrew everywhere

`reason`, `bot_summary`, `next_action` — בעברית. `stage` ו-`flags` הם constants קבועים באנגלית/עברית.

## Step 1 — Load secret

```bash
BOT_SECRET=$(grep '^BOT_SECRET=' "C:/Users/Eli/cursor-projects/albadi/albadi-crm/.env" | cut -d '=' -f2-)
```

## Step 2a — רענון תור

תחילה תפעיל את ה-cron route שמרענן את `analysis_queue` (מוסיף שורות פר-ליד פעיל שצריך ניתוח חדש). זה מחליף את ה-cloud routine — הכל רץ מקומית.

```bash
curl -s -X POST -H "Authorization: Bearer $BOT_SECRET" \
  https://albadi-crm.vercel.app/api/bot/queue-analysis
```

Response: `{ ok: true, activeLeads: N, queued: K, skipped: M, details: [...] }`. דווח בקצרה.

## Step 2b — Pull batch

```bash
curl -s -H "Authorization: Bearer $BOT_SECRET" \
  https://albadi-crm.vercel.app/api/bot/claude-context
```

Response: `{ items: [...] }`. אם `items=[]` — סיים שקט: "0 pending".

ה-API מסמן את השורות שנשלפו כ-`status='analyzing'` כדי שלא ננתח אותן פעמיים.

## Step 3 — לכל item, נתח

לכל `item` ב-`items[]`:

### 3a. קלט שאתה מקבל

| שדה | תוכן |
|---|---|
| `queueId` | int — חובה לשלוח חזרה |
| `subscriberId` | string |
| `reason` | למה זה הגיע לתור: `never_analyzed` / `new_message` / `stale_24h` |
| `manychat.name` | שם הליד |
| `manychat.tags` | תגי ManyChat נוכחיים |
| `manychat.custom_fields` | כל ה-fields: `notes`, `quote_total`, `quote_alt`, `quantity`, `colors`, `lamination`, `last_contact_date`, `last_contact_type`, `pipeline_stage`, וכו' |
| `manychat.last_input_text` | ההודעה האחרונה של הלקוח לפי ManyChat |
| `manychat.last_interaction` | timestamp ManyChat של אינטראקציה אחרונה |
| `messages[]` | היסטוריית הודעות 60 ימים אחרונים (`direction`: `in`/`out`, `text`, `receivedAt`) |
| `previousSuggestion` | מה הצעת בפעם הקודמת (אם יש) |
| `recentEliDecisions[]` | 5 ההחלטות האחרונות של Eli על הליד הזה — `claudeSuggested` vs `eliChose` |

### 3b. Pipeline stages תקפים (בחר אחד)

| stage | מתי |
|---|---|
| `NEW` | נרשם <7 ימים, אין שאלון, אין quote |
| `QUESTIONNAIRE` | חלק משאלון מולא, אין `quote_total` |
| `QUOTED` | `quote_total > 0`, אין סימני משא ומתן |
| `NEGOTIATING` | quote + מילים "יקר"/"הנחה"/"להוריד" |
| `WAITING_CALL` | בקשת שיחה, אין מגע טלפוני אחרון |
| `IN_PROGRESS` | אחרי שיחה + notes "מאשר"/"ממתין"/"עיצוב" |
| `WON` | תשלום / "סגרנו" / "הזמנתי" |
| `SILENT` | `last_interaction` >5 ימים, אין תגובה |
| `DROPPED` | "לא מעוניין"/"תפסיק"; או 60+ ימי שתיקה |

### 3c. Flags (אפס או יותר)

`דחוף`, `עסקה_גדולה`, `ביקש_שיחה`, `אחרי_החג`, `מועדף` (`מועדף` ידני בלבד — אל תציע).

כללים:
- `עסקה_גדולה` — כש-`quote_total >= 10000`
- `ביקש_שיחה` — מילות בקשת שיחה ב-notes/messages
- `אחרי_החג` — "אחרי החג" ב-notes
- `דחוף` — אם זיהית כעס/אכזבה/בקשה דחופה, או ה-stage `WAITING_CALL` יותר מ-3 ימים, או `NEGOTIATING` יותר מ-7 ימים

### 3d. כתוב גם

- `next_action` — משפט אחד קצר בעברית: "התקשר היום", "המתן 3 ימים ואז שלח תזכורת", "שלח דוגמה פיזית"
- `bot_summary` — משפט אחד הקשרי: "38 ימי שתיקה אחרי הצעה 23K, ה-notes שלך אמר לחזור"
- `reason` — reasoning עשיר בעברית, **חובה להתייחס לדאטה האמיתי** (שמות, מספרים, ציטוטים מההודעות). 2-4 משפטים. אל תכתוב גנרי.

### 3e. דוגמה ל-reason טוב

> "Shlomi malka — שלחנו הצעה 23,100 ש"ח לפני 38 יום על 10,000 יחידות 40x12x30 ב-3 צבעים. ה-notes שלך אומר 'לחזור!' אבל לא חזרת. ההודעה האחרונה ממנו הייתה לפני 35 יום: 'אעיין בהצעה ואחזור'. סטטוס: NEGOTIATING (לא SILENT) — הוא לא דחה, אתה זה שלא חזרת. flags: דחוף + עסקה_גדולה."

### 3f. השתמש ב-recentEliDecisions

אם Eli עשה override על ההצעה הקודמת — תלמד מזה. למשל אם הצעת `SILENT` והוא בחר `WAITING_CALL`, סביר שיש סיגנל שלא תפסת. תהיה זהיר עם אותו דפוס בליד הזה.

## Step 4 — Build payload

```json
{
  "queueId": 123,
  "subscriberId": "1233780185",
  "stage": "NEGOTIATING",
  "flags": ["דחוף", "עסקה_גדולה"],
  "next_action": "התקשר היום",
  "bot_summary": "38 ימי שתיקה אחרי הצעה 23K, ה-notes שלך אמר 'לחזור!'",
  "reason": "Shlomi malka — שלחנו הצעה 23,100 ש\"ח...",
  "prev_stage": "QUOTED"
}
```

`prev_stage` = הערך הנוכחי של `pipeline_stage` ב-ManyChat custom_fields (אם יש), אחרת `null`.

## Step 5 — POST per item

```bash
curl -s -X POST \
  -H "Authorization: Bearer $BOT_SECRET" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD" \
  "https://albadi-crm.vercel.app/api/bot/save-suggestion"
```

ודא HTTP 200 על כל POST. אם `error: invalid stage/flag` — תקן ושלח שוב.

JSON עם עברית: השתמש ב-Python script זמני (`json.dumps(..., ensure_ascii=False)`) או jq עם UTF-8. **אל תשתמש ב-bash heredoc עם עברית**.

## Step 6 — דווח

סיים עם:
```
🤖 Albadi v2 Classify — נותחו N לידים
   • stages: QUOTED=X NEGOTIATING=Y SILENT=Z וכו'
   • flags: דחוף=A עסקה_גדולה=B
   • דחופים שצריכים פעולה היום: K
```

## Edge cases

| מצב | פעולה |
|---|---|
| `items=[]` | סיים שקט |
| `manychat.error` ב-item | החזר `stage='DROPPED'` (ליד שבור), `flags=[]`, `reason='שגיאת ManyChat: <error>. ייתכן שצריך לסמן active=false ב-DB.'` |
| משוך 0 הודעות, אין notes, אין quote | `NEW` אם נרשם לפני <7 ימים, אחרת בדוק `last_interaction` ל-`SILENT` |
| `recentEliDecisions[0].action='rejected'` על אותה הצעה | כנראה שהצעה דומה כבר נדחתה — חשוב לפני שתחזור עליה |

## What you DON'T do

- אל תשנה תגים או fields ב-ManyChat ישירות. רק תציע. Eli מאשר בדאשבורד.
- אל תוסיף ל-flags את `מועדף` — Eli מסמן ידנית.
- אל תכתוב reason גנרי. כל reason חייב להתייחס לשם, מספרים, ציטוטים אמיתיים.
- אל תיצור החלטה כשיש fetch error מ-ManyChat — סמן `DROPPED` עם הסבר.
