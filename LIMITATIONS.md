# Albadi CRM — מגבלות מערכת

מסמך חי. מוסיף כל מגבלה שמתגלה בעבודה.

---

## 1. WhatsApp Message Templates — אי אפשר ליצור מקלוד

**מה מנסים:** ליצור template חדש (כמו "followup_quote_sent") מתוך הקוד / Claude, אוטומטית.

**למה אי אפשר:**
- WhatsApp Templates נשלטים על ידי **Meta** (חברת האם של WhatsApp), לא על ידי ManyChat.
- כל template חייב לעבור **אישור ידני של Meta** (1-3 ימי עבודה).
- ה-API של Meta תומך ביצירת templates דרך WhatsApp Business Manager API, אבל:
  - דורש WhatsApp Business Account (WABA) משלך — לא דרך ManyChat.
  - דורש System User Token עם הרשאות `whatsapp_business_management`.
  - אנחנו עובדים דרך ManyChat שמתווך — אין לנו גישה ישירה ל-WABA.
- ManyChat API עצמו לא חושף יצירת templates — רק שימוש ב-templates קיימים.
- Composio (Rube MCP) שעוטף את ManyChat — גם הוא לא יכול לעקוף את Meta.

**מה כן אפשר:**
- ליצור את הטקסט המוכן בקוד ולהוציא קובץ עם הפורמט המדויק לרישום.
- לבצע copy-paste ידני ל-ManyChat → WhatsApp → Templates → Create New.
- אחרי שמטא מאשרת — להשתמש בהם דרך API.

**workaround נוכחי:**
- `TEMPLATES-FOR-META.md` מכיל את כל ה-templates במבנה מוכן לרישום ידני.
- אלי מעלה אותם ל-ManyChat, ממתין לאישור מטא, ושומר את ה-IDs ב-`.env`.

---

## 2. שליחת טקסט חופשי אחרי 24 שעות — אסור

**הכלל:** אחרי 24 שעות מההודעה האחרונה של הלקוח, מטא חוסמת שליחת טקסט חופשי. רק templates מאושרים.

**השלכה על ארכיטקטורה:**
- הבוט יכול להגיב חופשי רק בחלון 24 שעות.
- כל follow-up אחרי שקט > 24 שעות = template חובה.
- ספריית templates צריכה לכסות את כל מקרי ה-follow-up המוקדם.

**מקור:** [Meta Business Messaging Policy](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages#sending-customer-care-window).

---

## 3. ManyChat API — היסטוריית הודעות מלאה לא חשופה

**מה מנסים:** למשוך טקסט מלא של שיחות עבר עם לקוח (לא רק metadata).

**למה אי אפשר:**
- ManyChat API חושף `last_input_text` (הודעה אחרונה של הלקוח) ושדות סטטוס בלבד.
- אין endpoint שמחזיר היסטוריה מלאה של thread.
- היסטוריה מלאה זמינה רק ב-UI (Contacts → לקוח → Conversation History).

**השלכה:**
- סקיל `pull-tone-samples.ts` שואב רק שדה `notes` (שאלי כתב על הליד), לא את התגובות שלו ללקוחות.
- אימון טון של הבוט יסתמך על דוגמאות שאלי יספק ידנית או על ה-notes (פחות מדויק).

**workaround:** Export ידני מ-ManyChat UI (Contacts → לקוח → Export Conversation) אם נצטרך טקסט מלא.

---

## 4. Vercel Hobby Tier — Cron רץ פעם ביום בלבד

**ההשלכה:** Vercel Cron ב-tier חינמי לא מתאים ל-polling שעתי.

**workaround נוכחי:** הארכיטקטורה אינה תלויה ב-Vercel Cron. הבוט רץ דרך Claude Code session מקומי + `/loop 1h /albadi-bot-run`.

---

## 5. Claude Code Session — תלוי בזמינות מחשב

**ההשלכה:** הבוט רץ רק כשהמחשב של אלי דולק וה-session פתוח. אם המחשב נכבה, הבוט עוצר.

**workaround:** להשאיר session פתוח. אם זה מתחיל להיות בעיה — לעבור לארכיטקטורה B (webhook proxy) או A (full replacement).

---

## 6. Google Drive Skills Sync — אינו זמין כרגע

**ההשלכה:** סקילים גלובליים שמסונכרנים מ-Google Drive לא נטענים אם ה-drive לא mounted.

**הסקיל הנוכחי שלנו** (`albadi-bot-run`) ב-project-level (`albadi-crm/.claude/skills/`) — לא תלוי ב-Drive.

**אם רוצים סקילים גלובליים** (`many-chat-automation` למשל) — צריך לוודא ש-Google Drive sync דולק.

---

## 7. רישום סבסקרייבר חדש ב-WhatsApp דרך API — לא אפשרי

**מה מנסים:** להוסיף מספר טלפון חדש כסבסקרייבר ב-ManyChat דרך API.

**למה אי אפשר:**
- חוק Meta: סבסקרייבר חייב לשלוח הודעה **ראשון** לעסק כדי להתווסף לרשימה.
- אי אפשר לרשום מספר "מבחוץ", גם לא דרך API.

**workaround:** הלקוח שולח הודעה ראשונית למספר העסקי. ManyChat קולט אוטומטית.

---

