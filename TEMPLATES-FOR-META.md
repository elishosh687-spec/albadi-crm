# WhatsApp Templates — מוכן לרישום ב-Meta / ManyChat

מסמך זה מכיל 6 templates ב-format שתואם את המסך **ManyChat → Settings → WhatsApp → Message Templates → Create Template** (או Meta Business Manager → WhatsApp → Templates → Create).

**הוראות שימוש:**
1. עבור על כל template למטה.
2. ב-ManyChat (או Meta Business Manager) — לחץ "Create Template".
3. הקלד את השדות בדיוק כמו שמופיעים פה.
4. שמור → שלח לאישור Meta.
5. אישור לוקח 1-3 ימי עסקים.
6. אחרי שאושר — Meta נותנת `template_id`. תעתיק אותו ל-`.env` תחת המשתנה המתאים.

**הערות לכל ה-templates:**
- שפה: **Hebrew** (he)
- קטגוריה: **Marketing** (כל ה-6 templates למטה הם re-engagement של לידים — Marketing).
- שם: באנגלית snake_case (חוק Meta).
- משתנים: Meta דורשת `{{1}}`, `{{2}}` וכו' — בדוגמאות למטה כתבתי בדיוק כך.

---

## Template 1: `albadi_followup_quote_sent`

**מטרה:** תזכורת ללידים שקיבלו הצעת מחיר ולא חזרו.
**משתנים:** `{{1}}` = quote_total (מספר), `{{2}}` = שם הליד.

**Body:**
```
{{2}} ש"ח — המחיר עוד עומד 🎒

שלום {{1}}, אלי משקיות אלבדי.

עבר זמן מאז ששוחחנו — היו פה אצלנו ימים עמוסים, סליחה על האיחור.

ההצעה ששלחתי לך עדיין באותו מחיר, למרות שעלויות החומר עלו מאז. שמרתי לך אותה.

מתחיל לתכנן לוחות זמנים לחודש הבא — רוצה לסגור או צריך הצעה מעודכנת?
```

**Sample values for Meta approval:**
- `{{1}}` = `Basel Mahamid`
- `{{2}}` = `5000`

**ENV var after approval:** `TEMPLATE_FOLLOWUP_QUOTE_SENT=<template_id>`

---

## Template 2: `albadi_after_holiday`

**מטרה:** חזרה ללקוחות שאמרו "נדבר אחרי החג".
**משתנים:** `{{1}}` = שם הליד.

**Body:**
```
חזרה לפעילות אחרי החגים 🌿

שלום {{1}}, אלי משקיות אלבדי.

החגים נגמרו ואני יודע שלקח לי קצת — היו עומסים אצלנו, סליחה.

דיברנו לפני החגים על אריזות לעסק שלך ואמרת שנחזור אחרי. הזמן הגיע — רוצה לסגור את הנושא לכאן או לכאן?

אם הצרכים השתנו, גם זה בסדר — תגיד לי ואכין הצעה חדשה.
```

**Sample values:**
- `{{1}}` = `ציון טהור`

**ENV var:** `TEMPLATE_AFTER_HOLIDAY=<template_id>`

---

## Template 3: `albadi_price_too_high`

**מטרה:** לקוחות שאמרו "יקר" — חזרה עם הצעה חדשה.
**משתנים:** `{{1}}` = שם הליד.

**Body:**
```
חזרתי עם מחיר אחר ✏️

שלום {{1}}, אלי משקיות אלבדי — שקיות מודפסות לעסק.

עבר זמן מאז ששוחחנו, היו אצלנו עומסים — סליחה על האיחור.

אמרת שהמחיר שלי היה גבוה. ישבתי לבדוק איך להגיע לתקציב שלך:

▸ הגדלת כמות מורידה ~30% ליחידה
▸ הורדת צבע אחד = ~15% הנחה
▸ חומר חלופי שעדיין נראה מעולה

תגיד לי את התקציב שעובד לך, ואני בונה הצעה מסביבו.
```

**Sample values:**
- `{{1}}` = `רותם`

**ENV var:** `TEMPLATE_PRICE_TOO_HIGH=<template_id>`

---

## Template 4: `albadi_call_request_followup`

**מטרה:** לקוחות שביקשו שיחה ולא קיבלו.
**משתנים:** `{{1}}` = שם הליד.

**Body:**
```
מוכן להתקשר אליך השבוע 📞

שלום {{1}}, אלי משקיות אלבדי.

ביקשת לתאם שיחה ולקח לי זמן לחזור — היו עומסים אצלנו, סליחה.

אני זמין השבוע. תכתוב לי איזה יום וזמן (בוקר/צהריים/ערב) ואני מתקשר.

10 דקות וסוגרים את הצרכים שלך.
```

**Sample values:**
- `{{1}}` = `מאיר סיסו`

**ENV var:** `TEMPLATE_CALL_REQUEST_FOLLOWUP=<template_id>`

---

## Template 5: `albadi_questionnaire_incomplete`

**מטרה:** לקוחות שהתחילו שאלון הצעת מחיר ולא סיימו.
**משתנים:** `{{1}}` = שם הליד.

**Body:**
```
דקה אחת חסרה לך להצעת מחיר 📝

שלום {{1}}, אלי משקיות אלבדי.

עבר זמן מאז שהתחלת — היו אצלנו עומסים ולא חזרנו אליך, סליחה.

התחלת תהליך לאריזות לעסק אבל לא סיימת. נשארה לך פחות מדקה — והצעת המחיר מגיעה אוטומטית לוואצאפ.

נמשיך מאיפה שעצרת?
```

**Sample values:**
- `{{1}}` = `ולד קודייב`

**ENV var:** `TEMPLATE_QUESTIONNAIRE_INCOMPLETE=<template_id>`

---

## Template 6: `albadi_last_attempt`

**מטרה:** ניסיון אחרון ללידים שכבר במצב "לא_ענה".
**משתנים:** `{{1}}` = שם הליד.

**Body:**
```
לפני שאני סוגר את התיק שלך 🎒

שלום {{1}}, אלי משקיות אלבדי.

עבר זמן מאז שניסינו ליצור קשר — היו אצלנו ימים עמוסים. אם עדיין יש עניין באריזות מותאמות לעסק, תכתוב לי "כן" ואחזור.

אם לא — אני מסיר אותך מהרשימה. בלי קשר, תודה שבדקת.
```

**Sample values:**
- `{{1}}` = `יחיאל דהן`

**ENV var:** `TEMPLATE_LAST_ATTEMPT=<template_id>`

---

## Quick Reference Table

| # | Template Name | קטגוריה | מטרה | ENV var |
|---|---------------|---------|------|---------|
| 1 | `albadi_followup_quote_sent` | Marketing | תזכורת הצעה | `TEMPLATE_FOLLOWUP_QUOTE_SENT` |
| 2 | `albadi_after_holiday` | Marketing | אחרי החג | `TEMPLATE_AFTER_HOLIDAY` |
| 3 | `albadi_price_too_high` | Marketing | "אמר יקר" | `TEMPLATE_PRICE_TOO_HIGH` |
| 4 | `albadi_call_request_followup` | Marketing | ביקש שיחה | `TEMPLATE_CALL_REQUEST_FOLLOWUP` |
| 5 | `albadi_questionnaire_incomplete` | Marketing | שאלון לא הושלם | `TEMPLATE_QUESTIONNAIRE_INCOMPLETE` |
| 6 | `albadi_last_attempt` | Marketing | ניסיון אחרון | `TEMPLATE_LAST_ATTEMPT` |

---

## אחרי שכל ה-6 אושרו

עדכן את `.env`:
```bash
TEMPLATE_FOLLOWUP_QUOTE_SENT=<id_מ-Meta>
TEMPLATE_AFTER_HOLIDAY=<id_מ-Meta>
TEMPLATE_PRICE_TOO_HIGH=<id_מ-Meta>
TEMPLATE_CALL_REQUEST_FOLLOWUP=<id_מ-Meta>
TEMPLATE_QUESTIONNAIRE_INCOMPLETE=<id_מ-Meta>
TEMPLATE_LAST_ATTEMPT=<id_מ-Meta>
```

ואז Phase 3 (שליחה אוטומטית) פתוח.

---

## דחיות שלא ייכנסו ל-Meta כרגע

האימוג'ים (🎒 🌿 ✏️ 📞 📝) — Meta בדרך כלל מאשרת אותם, אבל לפעמים דוחה. אם דוחה template ספציפי בגלל אימוג'י:
1. הסר את האימוג'י
2. הגש מחדש
3. תעד פה איזה אימוג'י Meta דחתה

---

## מקרי קצה שלא כיסו עדיין

- **Reply-after-quote** — לקוח שכבר ענה אחרי הצעה, אנחנו עדיין עוטפים אותו ב-template? (תוך חלון 24 שעות → לא צריך template)
- **Multi-language** — אם נכנסים לקוחות בערבית/אנגלית, צריך גרסאות מקבילות.
- **Voice clip transcription** — לקוחות ששולחים voice notes. כרגע לא מטופל.
