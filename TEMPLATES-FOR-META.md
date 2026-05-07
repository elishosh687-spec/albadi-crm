# WhatsApp Templates — מוכן לרישום ב-ManyChat

מסמך זה מכיל 6 templates במבנה שתואם ל-UI של ManyChat:
**Template Name → Category → Language → Header → Message → Footer → Buttons**.

## הוראות שימוש

לכל template:

1. ManyChat → Settings → WhatsApp → Message Templates → **Create Template**
2. **Template Name**: העתק מהמסמך (snake_case, English).
3. **Template Category**: Marketing (לכל ה-6).
4. **Languages**: לחץ "+ New Language" → בחר **Hebrew**. אם English מופיע ולא צריך — מחק.
5. **Header (Optional)**: העתק את ה-Header מהמסמך. אם יש משתנים — לחץ `{ }` והוסף `{{1}}`.
6. **Message**: העתק את ה-Message body.
7. **Footer (Optional)**: העתק (חתימה קצרה).
8. **Buttons (Optional)**: בחר Quick Reply, הוסף את הכפתורים מהמסמך.
9. **Send To Review** → ממתין לאישור Meta (כמה דקות עד 24 שעות).

## הערות כלליות

- **Header** מוגבל ל-60 תווים (בדוק מונה `{ } 40` שעלה בצד).
- **Message body** עד 1024 תווים.
- **Footer** עד 60 תווים.
- **Buttons**: עד 3 Quick Replies, או 1 URL button (לא שניהם).
- **Variable syntax**: `{{1}}`, `{{2}}`, `{{3}}` — בכל שדה שמוסיפים משתנה לוחצים על אייקון `{ }`.

---

## Template 1: `albadi_followup_quote_sent`

**מטרה:** תזכורת ללידים שקיבלו הצעת מחיר ולא חזרו.

| שדה | ערך |
|-----|-----|
| **Template Name** | `albadi_followup_quote_sent` |
| **Category** | Marketing |
| **Language** | Hebrew |

### Header
```
{{1}} ש"ח — המחיר עוד עומד 🎒
```
**משתנים בHeader:** `{{1}}` = quote_total

### Message
```
שלום {{2}}, אלי משקיות אלבדי.

עבר זמן מאז ששוחחנו — היו פה אצלנו ימים עמוסים, סליחה על האיחור.

ההצעה ששלחתי לך עדיין באותו מחיר, למרות שעלויות החומר עלו מאז. שמרתי לך אותה.

מתחיל לתכנן לוחות זמנים לחודש הבא — רוצה לסגור או צריך הצעה מעודכנת?
```
**משתנים ב-Message:** `{{2}}` = שם הליד

### Footer
```
אלי | שקיות אלבדי
```

### Buttons (Quick Reply)
1. `כן, נסגור`
2. `שלח הצעה מעודכנת`
3. `לא רלוונטי`

### Sample values for Meta approval
- `{{1}}` = `5000`
- `{{2}}` = `Basel`

**ENV var:** `TEMPLATE_FOLLOWUP_QUOTE_SENT=<template_id>`

---

## Template 2: `albadi_after_holiday`

**מטרה:** חזרה ללקוחות שאמרו "נדבר אחרי החג".

| שדה | ערך |
|-----|-----|
| **Template Name** | `albadi_after_holiday` |
| **Category** | Marketing |
| **Language** | Hebrew |

### Header
```
חזרה לפעילות אחרי החגים 🌿
```
**(אין משתנים ב-Header)**

### Message
```
שלום {{1}}, אלי משקיות אלבדי.

החגים נגמרו ואני יודע שלקח לי קצת — היו עומסים אצלנו, סליחה.

דיברנו לפני החגים על אריזות לעסק שלך ואמרת שנחזור אחרי. הזמן הגיע — רוצה לסגור את הנושא לכאן או לכאן?

אם הצרכים השתנו, גם זה בסדר — תגיד לי ואכין הצעה חדשה.
```

### Footer
```
אלי | שקיות אלבדי
```

### Buttons (Quick Reply)
1. `כן, נמשיך`
2. `הצעה חדשה`
3. `לא רלוונטי`

### Sample values
- `{{1}}` = `ציון`

**ENV var:** `TEMPLATE_AFTER_HOLIDAY=<template_id>`

---

## Template 3: `albadi_price_too_high`

**מטרה:** לקוחות שאמרו "יקר" — חזרה עם הצעה חדשה.

| שדה | ערך |
|-----|-----|
| **Template Name** | `albadi_price_too_high` |
| **Category** | Marketing |
| **Language** | Hebrew |

### Header
```
חזרתי עם מחיר אחר ✏️
```

### Message
```
שלום {{1}}, אלי משקיות אלבדי — שקיות מודפסות לעסק.

עבר זמן מאז ששוחחנו, היו אצלנו עומסים — סליחה על האיחור.

אמרת שהמחיר שלי היה גבוה. ישבתי לבדוק איך להגיע לתקציב שלך:

▸ הגדלת כמות מורידה ~30% ליחידה
▸ הורדת צבע אחד = ~15% הנחה
▸ חומר חלופי שעדיין נראה מעולה

תגיד לי את התקציב שעובד לך, ואני בונה הצעה מסביבו.
```

### Footer
```
אלי | שקיות אלבדי
```

### Buttons (Quick Reply)
1. `אגיד לך תקציב`
2. `נדבר בטלפון`
3. `לא רלוונטי`

### Sample values
- `{{1}}` = `רותם`

**ENV var:** `TEMPLATE_PRICE_TOO_HIGH=<template_id>`

---

## Template 4: `albadi_call_request_followup`

**מטרה:** לקוחות שביקשו שיחה ולא קיבלו.

| שדה | ערך |
|-----|-----|
| **Template Name** | `albadi_call_request_followup` |
| **Category** | Marketing |
| **Language** | Hebrew |

### Header
```
מוכן להתקשר אליך השבוע 📞
```

### Message
```
שלום {{1}}, אלי משקיות אלבדי.

ביקשת לתאם שיחה ולקח לי זמן לחזור — היו עומסים אצלנו, סליחה.

אני זמין השבוע. תכתוב לי איזה יום וזמן (בוקר/צהריים/ערב) ואני מתקשר.

10 דקות וסוגרים את הצרכים שלך.
```

### Footer
```
אלי | שקיות אלבדי
```

### Buttons (Quick Reply)
1. `בוקר`
2. `צהריים`
3. `ערב`

### Sample values
- `{{1}}` = `מאיר`

**ENV var:** `TEMPLATE_CALL_REQUEST_FOLLOWUP=<template_id>`

---

## Template 5: `albadi_questionnaire_incomplete`

**מטרה:** לקוחות שהתחילו שאלון הצעת מחיר ולא סיימו.

| שדה | ערך |
|-----|-----|
| **Template Name** | `albadi_questionnaire_incomplete` |
| **Category** | Marketing |
| **Language** | Hebrew |

### Header
```
דקה אחת חסרה לך להצעת מחיר 📝
```

### Message
```
שלום {{1}}, אלי משקיות אלבדי.

עבר זמן מאז שהתחלת — היו אצלנו עומסים ולא חזרנו אליך, סליחה.

התחלת תהליך לאריזות לעסק אבל לא סיימת. נשארה לך פחות מדקה — והצעת המחיר מגיעה אוטומטית לוואצאפ.

נמשיך מאיפה שעצרת?
```

### Footer
```
אלי | שקיות אלבדי
```

### Buttons (Quick Reply)
1. `כן, ממשיך`
2. `שלח לי לינק`
3. `לא רלוונטי`

### Sample values
- `{{1}}` = `ולד`

**ENV var:** `TEMPLATE_QUESTIONNAIRE_INCOMPLETE=<template_id>`

---

## Template 6: `albadi_last_attempt`

**מטרה:** ניסיון אחרון ללידים שכבר במצב "לא_ענה".

| שדה | ערך |
|-----|-----|
| **Template Name** | `albadi_last_attempt` |
| **Category** | Marketing |
| **Language** | Hebrew |

### Header
```
לפני שאני סוגר את התיק שלך 🎒
```

### Message
```
שלום {{1}}, אלי משקיות אלבדי.

עבר זמן מאז שניסינו ליצור קשר — היו אצלנו ימים עמוסים. אם עדיין יש עניין באריזות מותאמות לעסק, תכתוב לי "כן" ואחזור.

אם לא — אני מסיר אותך מהרשימה. בלי קשר, תודה שבדקת.
```

### Footer
```
אלי | שקיות אלבדי
```

### Buttons (Quick Reply)
1. `כן, יש עניין`
2. `הסר אותי`

### Sample values
- `{{1}}` = `יחיאל`

**ENV var:** `TEMPLATE_LAST_ATTEMPT=<template_id>`

---

## Quick Reference Table

| # | Template Name | Header | משתנים | ENV var |
|---|---------------|--------|--------|---------|
| 1 | `albadi_followup_quote_sent` | `{{1}} ש"ח — המחיר עוד עומד 🎒` | `{{1}}` quote, `{{2}}` name | `TEMPLATE_FOLLOWUP_QUOTE_SENT` |
| 2 | `albadi_after_holiday` | `חזרה לפעילות אחרי החגים 🌿` | `{{1}}` name | `TEMPLATE_AFTER_HOLIDAY` |
| 3 | `albadi_price_too_high` | `חזרתי עם מחיר אחר ✏️` | `{{1}}` name | `TEMPLATE_PRICE_TOO_HIGH` |
| 4 | `albadi_call_request_followup` | `מוכן להתקשר אליך השבוע 📞` | `{{1}}` name | `TEMPLATE_CALL_REQUEST_FOLLOWUP` |
| 5 | `albadi_questionnaire_incomplete` | `דקה אחת חסרה לך להצעת מחיר 📝` | `{{1}}` name | `TEMPLATE_QUESTIONNAIRE_INCOMPLETE` |
| 6 | `albadi_last_attempt` | `לפני שאני סוגר את התיק שלך 🎒` | `{{1}}` name | `TEMPLATE_LAST_ATTEMPT` |
| 7 | `albadi_eli_alert` | `🚨 התראה — Albadi` | `{{1}}` lead name | `TEMPLATE_ELI_ALERT` |
| 8 | `albadi_eli_summary` | `🤖 סיכום Albadi` | 3 משתנים | `TEMPLATE_ELI_SUMMARY` |

---

## Template 7: `albadi_eli_alert` (התראה אישית לאלי) — גרסה סופית

**מטרה:** התראה אישית לאלי. הבוט שולח לך את כל ההקשר + אופציות ממוספרות, ואתה יכול:
- (א) להגיב במספר (1/2/3) — אישור מהיר בוואצאפ
- (ב) ללחוץ על כפתור Dashboard — עריכת טיוטה לפני שליחה

**Category:** Utility

**הערה:** משתנה אחד גדול = פורמט שעובר Meta בקלות.

| שדה | ערך |
|-----|-----|
| **Template Name** | `albadi_eli_alert` |
| **Category** | Utility |
| **Language** | Hebrew |

### Header
```
🚨 Albadi
```
**(טקסט קבוע, אין משתנים)**

### Message
```
{{1}}

ענה במספר, או לחץ Dashboard לעריכה.
```
**משתנים:** `{{1}}` = כל גוף ההודעה (הבוט בונה אותו דינמית — שם הליד + סיבה + אופציות).

### Footer
```
Albadi Bot
```

### Buttons (URL — 1)
- **Type:** URL
- **Text:** `פתח Dashboard`
- **URL:** `https://albadi-crm.vercel.app/escalations`

### Sample for Meta approval
`{{1}}` =
```
בסל מחמיד מחכה לטיפול.
סיבה: ביקש הנחה.
טיוטה: שמעתי, אבדוק ואחזור.

אופציות:
1️⃣ שלח את הטיוטה
2️⃣ דחה
3️⃣ אטפל ידנית
```

### איך זה ייראה בוואצאפ אצלך
```
🚨 Albadi

בסל מחמיד מחכה לטיפול.
סיבה: ביקש הנחה.
טיוטה: שמעתי, אבדוק ואחזור.

אופציות:
1️⃣ שלח את הטיוטה
2️⃣ דחה
3️⃣ אטפל ידנית

ענה במספר, או לחץ Dashboard לעריכה.

Albadi Bot
[פתח Dashboard]
```

**ENV var:** `TEMPLATE_ELI_ALERT=<template_id>`

---

## Template 8: `albadi_eli_summary` (סיכום תקופתי לאלי)

**מטרה:** סיכום קצר 3-4 פעמים ביום — מה הבוט עשה, מה ממתין לטיפול. נשלח ל-`ADMIN_SUBSCRIBER_ID` בלבד.

**Category:** Utility

| שדה | ערך |
|-----|-----|
| **Template Name** | `albadi_eli_summary` |
| **Category** | Utility |
| **Language** | Hebrew |

### Header
```
🤖 סיכום Albadi
```
**(אין משתנה ב-Header)**

### Message
```
מאז הסיכום הקודם:

✓ {{1}} פעולות אוטומטיות
🟡 {{2}} הסלמות מחכות לך
⚠️ {{3}} שגיאות

לפרטים מלאים — פתח Dashboard.
```
**משתנים:**
- `{{1}}` = מספר פעולות אוטו (e.g. `5`)
- `{{2}}` = מספר הסלמות פתוחות (e.g. `2`)
- `{{3}}` = מספר שגיאות (e.g. `0`)

### Footer
```
Albadi Bot
```

### Buttons (URL Button — 1)
- **Type:** URL
- **Text:** `פתח Dashboard`
- **URL:** `https://albadi-crm.vercel.app`
*(אחרי שהדאשבורד יעלה לאוויר. לעת עתה אפשר לרשום עם URL מלא placeholder ולערוך אחרי deploy.)*

### Sample values
- `{{1}}` = `5`
- `{{2}}` = `2`
- `{{3}}` = `0`

**ENV var:** `TEMPLATE_ELI_SUMMARY=<template_id>`

---

---

## אחרי שכל ה-8 אושרו

עדכן את `.env`:
```bash
TEMPLATE_FOLLOWUP_QUOTE_SENT=<id_מ-Meta>
TEMPLATE_AFTER_HOLIDAY=<id_מ-Meta>
TEMPLATE_PRICE_TOO_HIGH=<id_מ-Meta>
TEMPLATE_CALL_REQUEST_FOLLOWUP=<id_מ-Meta>
TEMPLATE_QUESTIONNAIRE_INCOMPLETE=<id_מ-Meta>
TEMPLATE_LAST_ATTEMPT=<id_מ-Meta>
TEMPLATE_ELI_ALERT=<id_מ-Meta>
TEMPLATE_ELI_SUMMARY=<id_מ-Meta>
```

תגיד לי כשאישרו — Phase 3 (sender) ייכנס לפעולה.

---

## דחיות שלא ייכנסו ל-Meta כרגע

- **אימוג'ים** (🎒 🌿 ✏️ 📞 📝): Meta בדרך כלל מאשרת. אם דוחה אחת — נסיר ונגיש מחדש.
- **Reply-after-quote**: לקוח שכבר ענה אחרי הצעה (תוך 24 שעות) — לא צריך template, טקסט חופשי.
- **Multi-language**: אם ייכנסו לקוחות בערבית/אנגלית — נוסיף שפות לאותם templates.
- **Voice clip transcription**: לקוחות ששולחים voice notes. כרגע לא מטופל.
