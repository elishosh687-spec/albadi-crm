# תוכנית סידור ManyChat — אלבדי
## תאריך: 2026-04-02

---

## מה כבר בוצע (דרך API)

- [x] 7 תגים נקיים: ליד_חדש, מעוניין, הצעה_נשלחה, בתהליך, לא_ענה, לקוח, לא_רלוונטי
- [x] תגים ישנים נמחקו (13 ישנים + לטפח)
- [x] 5 שדות חדשים: notes, quote_total, quote_alt, lead_source, last_contact_date
- [x] 40 לידים מעודכנים עם תג נכון + הערות + follow_up_date + סכום עסקה

---

## מה נשאר לביצוע ידני ב-ManyChat

### 1. ניקוי קטן (2 דקות)

- [ ] מחק ידנית את השדות pipeline_stage ו-lead_score מ-Settings > Custom Fields
- [ ] (לא חובה, הם לא מפריעים — אבל עושה סדר)

---

### 2. עדכון Flow "ליד מטופס לידים" (5 דקות)

**בהתחלה, מיד אחרי הטריגר — הוסף Action:**

    Set Custom Field: lead_source = "fb_form"
    Add Tag: ליד_חדש

**בסוף, אחרי שההצעה נשלחת — הוסף Action:**

    Remove Tag: ליד_חדש
    Add Tag: הצעה_נשלחה
    Set Custom Field: follow_up_date = [היום + 2 ימים]

---

### 3. עדכון Flow "הצעת מחיר אלבד" — הוספת Upsell (10 דקות)

**בסוף ה-flow, אחרי שההצעה נשלחת, הוסף Condition:**

    If shipping = "ימי":
      הודעה: "אגב, במשלוח אקספרס (עד 30 יום במקום 90)
        המחיר: [חישוב] ש"ח/יח'. רוצה לשדרג?"
        כפתורים: [כן, אקספרס!] [לא, ימי מספיק]

    If shipping = "אקספרס":
      הודעה: "אגב, במשלוח ימי (90 יום)
        המחיר יורד ל-[חישוב] ש"ח/יח'. מעדיף לחסוך?"
        כפתורים: [כן, ימי!] [לא, אקספרס]

    אם לחץ כן: עדכן shipping + quote_result + שמור ב-quote_alt

---

### 4. בניית Flow חדש: "פולואפ אוטומטי" (15 דקות)

**צור flow חדש > Trigger: Rule > כש-follow_up_date = היום**

    Step 1 - Condition:
      If tag = לקוח OR לא_רלוונטי -> STOP
      Otherwise -> continue

    Step 2 - הודעת WhatsApp:
      "היי {{first_name}}!
       חזרתי אליך בקשר להצעה ששלחנו. עדיין רלוונטי?"

       [כן, בהחלט!]
       [עוד לא, תחזור בעוד כמה ימים]
       [לא רלוונטי]

    Step 3 - לפי כפתור:

      "כן, בהחלט!":
        Remove Tag: הצעה_נשלחה / לא_ענה
        Add Tag: מעוניין
        Set follow_up_date = היום + 1
        הודעה: "מעולה! אלי יחזור אליך היום. מה הזמן הכי נוח?"
        Notify admin (Live Chat)

      "עוד לא, תחזור":
        Set follow_up_date = היום + 3 ימים
        הודעה: "בסדר גמור! נחזור אליך בעוד כמה ימים."

      "לא רלוונטי":
        Remove all status tags
        Add Tag: לא_רלוונטי
        הודעה: "תודה על הזמן! אם תצטרך אריזות בעתיד אנחנו כאן."

    Step 4 - Smart Delay 24 שעות:
      If לא ענה:
        Remove all status tags
        Add Tag: לא_ענה
        Set follow_up_date = היום + 5 ימים

---

### 5. בניית Flow חדש: "השלמת שאלון" (10 דקות)

**Trigger:** tag = ליד_חדש + product field ריק + עברו 48 שעות

    הודעת WhatsApp:
      "היי {{first_name}}!
       ראינו שהתחלת לבדוק אריזות.
       רוצה שנשלים ביחד? לוקח דקה."

       [כן, בואו!] -> Redirect ל-flow "הצעת מחיר אלבד"
       [לא, תודה] -> Add Tag: לא_רלוונטי + הודעה: "בסדר! אם תצטרך בעתיד אנחנו כאן"

---

## סדר ביצוע מומלץ

| # | מה                                          | עדיפות   |
|---|---------------------------------------------|----------|
| 1 | עדכון flow ליד מטופס — הוספת tags + fields  | ראשון    |
| 2 | בניית flow פולואפ אוטומטי                   | שני      |
| 3 | בניית flow השלמת שאלון                      | שלישי    |
| 4 | הוספת upsell                                | אחרון    |

---

## טסט אחרי כל flow

1. שלח לעצמך הודעת טסט
2. בדוק שהתגים משתנים נכון
3. בדוק שה-custom fields מתעדכנים

---

## מבנה המערכת הסופי

### תגים (7)
    ליד_חדש -> מעוניין -> הצעה_נשלחה -> בתהליך -> לקוח
                                               \
                              לא_ענה <- (כל שלב)
                                               \
                                          לא_רלוונטי

### כלל: ליד אחד = תג אחד בלבד

### Custom Fields
    שאלון: product, quantity, colors, lamination, handles, shipping, quote_result
    ניהול: notes, quote_total, quote_alt, lead_source, last_contact_date, follow_up_date

### Naming Convention
    Tags:          עברית_עם_קו_תחתון  (ליד_חדש, הצעה_נשלחה)
    Custom Fields: english_snake_case  (follow_up_date, quote_total)
    Flows:         עברית עם רווחים     (ליד מטופס לידים)
