# Albadi CRM — סקירת מוצר מקיפה

**גרסה:** 2.0 (E3 + Manual Trigger)
**תאריך:** 2026-05-08
**בעלים:** אלי שושן
**רישיון:** פרטי

---

## 1. מהו המוצר

**Albadi CRM** הוא מערכת ניהול לידים אוטומטית עבור עסק האריזות בהתאמה אישית "אלבדי". המערכת בנויה כשכבת אוטומציה מעל ManyChat: היא קוראת את כל הלידים מהמערכת הקיימת, מסווגת אותם לפי כללים, מסלימה את אלה שצריכים אותך אישית, ומציגה תצוגה אחת מסודרת של מצב הצינור (pipeline).

**הבעיה שהיא פותרת:**
- ניהול ידני של 32+ לידים פעילים מציף בעל עסק יחיד
- תיוג ידני ב-ManyChat לא עקבי (שמות שונים, סטטוסים שזולגים)
- אין נראות כוללת — צריך להיכנס ל-ManyChat ידנית כדי לדעת מה קורה
- לידים נשכחים בין הכיסאות

**המטרה העיקרית של MVP:**
להוריד את עומס ההחלטה היומי של הבעלים ל-< 5 פעולות ביום, ולוודא שאף ליד לא נופל בלי טיפול.

---

## 2. ארכיטקטורה ברמה גבוהה

```
┌─────────────────────────────────────────────────────────────────┐
│                         לקוחות                                  │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ WhatsApp
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                      ManyChat (קיים)                            │
│  • שאלון → הצעת מחיר אוטומטית                                  │
│  • Tags + Custom Fields                                         │
│  • Templates מאושרי Meta                                        │
└─────────────────────────────────────────────────────────────────┘
                          ▲ ▲
                          │ │
                  קריאה   │ │  עדכון/שליחה
                          │ │
                          │ │
┌─────────────────────────────────────────────────────────────────┐
│              Albadi CRM (Vercel + Next.js)                      │
│                                                                 │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    │
│   │  Dashboard   │    │  /api/bot/   │    │  /api/auth/  │    │
│   │  (4 דפים)   │    │     cron     │    │   login      │    │
│   └──────┬───────┘    └──────┬───────┘    └──────────────┘    │
│          │                   │                                  │
│          ▼                   ▼                                  │
│   ┌─────────────────────────────────────┐                      │
│   │       Neon Postgres (audit log)      │                      │
│   │  bot_runs · decisions · escalations  │                      │
│   │      · replies_sent · anomalies      │                      │
│   └─────────────────────────────────────┘                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                          ▲
                          │ HTTP POST + Bearer token
                          │ ידני דרך הדאשבורד
                          │
┌─────────────────────────────────────────────────────────────────┐
│   "הרץ בוט עכשיו" — Server Action בדאשבורד                     │
│   POST → /api/bot/cron                                          │
│   Cloud Routine הוסר; אין auto-cron כרגע                       │
└─────────────────────────────────────────────────────────────────┘

                          ↓
                  הסלמות חדשות נוצרות
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│   Claude analysis — סקיל albadi-analyze                         │
│   "תנתח הסלמות albadi" בצ'אט / /loop                            │
│   מפיק summary + 2-3 אופציות + suggested_tag                   │
│   POST → /api/bot/escalation-analysis/{id}                      │
└─────────────────────────────────────────────────────────────────┘
```

**עקרונות עיצוב:**
- **ManyChat נשאר source of truth.** לא מחליפים אותו, מתממשקים אליו.
- **כללים בקוד תחילה, Claude לאופציות.** הבוט השעתי דטרמיניסטי. Claude נכנס רק לניתוח הסלמות.
- **אוטונומיה מבוקרת.** הבוט לא משנה תגים ב-ManyChat ולא שולח הודעות. רק יוצר הסלמות + הצעות תג ב-DB.
- **המשתמש מאשר.** כל פעולה ב-ManyChat (תג / שליחה) נעשית בלחיצת כפתור בדאשבורד.
- **Single source of decisions:** Neon DB מתעד כל החלטה.

---

## 3. רכיבים ולינקים

### 3.1 Dashboard בענן

**URL:** https://albadi-crm.vercel.app
**סיסמה:** `Eb688837`

| מסך | מה מציג |
|-----|---------|
| `/dashboard` | בית — הסלמות פתוחות + סטטיסטיקת בוט 24 שעות אחרונות |
| `/dashboard/escalations` | תור הסלמות מלא עם textarea לטיוטה + כפתורי אישור/דחייה |
| `/dashboard/pipeline` | תצוגת kanban — לידים מקובצים לפי תג |
| `/dashboard/runs` | היסטוריית כל ריצות הבוט עם סטטוס |

### 3.2 Repo בקוד פתוח (פרטי)

**GitHub:** https://github.com/elishosh687-spec/albadi-crm
**Branch:** `main`
**Auto-deploy:** כל push ל-main מפעיל deploy חדש ב-Vercel תוך ~2 דקות

### 3.3 Vercel Project

**Project name:** `albadi-crm`
**Team:** elishosh687-specs-projects
**Tier:** Hobby (חינמי)
**Environment variables (5 + 1):**
- `DATABASE_URL` (Neon connection)
- `MANYCHAT_TOKEN`
- `MANYCHAT_BASE`
- `ADMIN_SUBSCRIBER_ID`
- `ADMIN_PASSWORD` = `Eb688837`
- `BOT_SECRET` (סוד פנימי בין routine ל-Vercel)

### 3.4 Neon Database

**Project ID:** `fragrant-morning-71359670`
**Project name:** `albadi-crm`
**Region:** aws-us-west-2
**Tier:** Free (0.5GB)
**Tables:** 6
**ניהול:** https://console.neon.tech

### 3.5 הפעלת הבוט (ידני)

**מצב נוכחי:** Cloud Routine נמחק (08/05/2026). אין auto-cron.

**איך מפעילים:**
- כפתור "הרץ בוט עכשיו" בדאשבורד (`/dashboard`) → Server Action שולח POST ל-`/api/bot/cron`
- אופציה חלופית: `curl -X POST -H "Authorization: Bearer $BOT_SECRET" https://albadi-crm.vercel.app/api/bot/cron`

**אם תרצה לחזור לאוטומציה שעתית:**
- Cloud Routine באנתרופיק (חינם, דרש לתעדף)
- Vercel Cron (Pro plan, $20/חודש)
- cron-job.org (חינם, חיצוני)
- Windows Task Scheduler מקומי (דורש שהמחשב פעיל)

### 3.6 ManyChat (קיים מראש)

**Account:** fb4499581
**Subscribers פעילים:** 32 (אחרי סינון לקוח/לא_רלוונטי)
**Tags:** 8 — ליד_חדש, מעוניין, הצעה_בוט, הצעה_טלפון, בתהליך, לקוח, לא_ענה, לא_רלוונטי

### 3.7 קוד מקומי

**מיקום:** `C:\Users\Eli\cursor-projects\albadi\albadi-crm`
**Stack:** Next.js 16 + TypeScript + Drizzle ORM + Neon
**איך מריצים מקומית:** `npm run dev` → http://localhost:3000

---

## 4. סיסמאות וטוקנים (אזור רגיש)

> ⚠️ אסור לשתף את הקובץ הזה. מכיל מידע רגיש.

| מערכת | סוג | ערך / איפה |
|-------|-----|-----------|
| Dashboard | סיסמה | `Eb688837` |
| ManyChat | API token | `4499581:90eb21024a936e46cc2385143616de0e` |
| Neon | Connection string | ב-`.env` המקומי בלבד |
| BOT_SECRET | Bearer | `RHaNTz0OT8uV/cR/q4T80M1oVLEdB2XI` |

**שיטת אחסון:**
- **מקומית:** קובץ `.env` (ב-gitignore, לא נשלח לגיט)
- **ענן (Vercel):** הצפנה אוטומטית של env vars
- **בקוד:** אין hardcoded secrets

---

## 5. פיצ'רים שנבנו

### 5.1 Dashboard (4 מסכים)
- ✅ דף בית עם הסלמות פתוחות וסטטיסטיקת 24 שעות
- ✅ עמוד הסלמות עם textarea לטיוטת תגובה ו-3 כפתורים (אישור / דחייה / ידני)
- ✅ Pipeline view בסגנון Kanban — 8 עמודות לפי תג
- ✅ History view של כל ריצות הבוט
- ✅ עיצוב RTL בעברית
- ✅ Authentication עם middleware (cookie httpOnly + secure)

### 5.2 Bot — אוטומציה שעתית
- ✅ שולף 32 לידים מ-ManyChat דרך API
- ✅ מסווג לפי 7 כללים (`no_contact_5days`, `interested_no_quote_5days`, וכו')
- ✅ מסלים מקרים דו-משמעיים: בקשת מחיר/הנחה, בקשת שיחה, סבסקרייבר שבור, עסקה גדולה ארוכה
- ✅ שומר כל החלטה ל-DB עם audit מלא
- ✅ מצב read-only ב-MVP (לא מתייג בפועל ב-ManyChat — רק רושם הצעה)
- ✅ רץ אוטומטית כל שעה דרך Anthropic Cloud Routine

### 5.3 Templates ל-WhatsApp
- ✅ 6 templates ראשונים נרשמו ב-Meta וממתינים לאישור (1-3 ימים):
  1. `albadi_followup_quote_sent` — תזכורת אחרי הצעת מחיר
  2. `albadi_after_holiday` — חזרה אחרי החג
  3. `albadi_price_too_high` — תגובה ל"אמר יקר"
  4. `albadi_call_request_followup` — מענה לבקשת שיחה
  5. `albadi_questionnaire_incomplete` — השלמת שאלון
  6. `albadi_last_attempt` — ניסיון אחרון
- 📝 2 templates נוספים מוכנים לרישום ידני (ראה `TEMPLATES-FOR-META.md`):
  - `albadi_eli_alert` — התראה אישית לאלי
  - `albadi_eli_summary` — סיכום תקופתי

### 5.4 Cold-Start Recovery (Restart Mode)
- ✅ סקריפט `bot:restart` שמקבץ 32 לידים תקועים ל-9 קטגוריות
- ✅ כל קטגוריה מקבלת template מתאים מהאוסף
- ✅ סקריפט `bot:restart-send` עם dry-run (default), 5/min throttle, validation של templates

### 5.5 תיעוד
- ✅ `PRD-lead-bot.md` — מסמך דרישות מלא
- ✅ `LIMITATIONS.md` — מגבלות ידועות (חוק 24 שעות, אי יצירת templates דרך API, וכו')
- ✅ `TEMPLATES-FOR-META.md` — 8 templates במבנה מוכן לרישום
- ✅ `README.md` — מדריך פיתוח

### 5.6 כלים תפעוליים
- ✅ סקיל `albadi-analyze` ב-`.claude/skills/` (פרויקטי) — מנתח הסלמות עם Claude, מפיק summary + אופציות + suggested_tag
- ✅ Skill `albadi-restart-send` ב-`~/.claude/scheduled-tasks/` — שליחת batch של templates
- ✅ סקריפט `bot:pull-messages` — שליפת הודעות חדשות מ-ManyChat
- ✅ סקריפט `bot:restart-send` — batch send ל-WhatsApp templates
- ✅ סקריפט `pull-tone-samples` — שליפת notes מ-ManyChat לכיול טון

### 5.7 Pipeline ניתוח הסלמות (E3)
- ✅ הבוט מסמן `analyze_requested=true` אוטומטית בכל הסלמה חדשה
- ✅ Claude (אני בצ'אט / /loop) מפיק summary בעברית + 2-3 אופציות תגובה אסטרטגיות + (כשרלוונטי) suggested_tag
- ✅ דאשבורד מציג את הניתוח ועם כפתור "השתמש בזו" / "אשר תג" / "סגור הסלמה"
- ✅ "אשר תג" דוחף את התג ל-ManyChat (`/api/actions/apply-tag`) + מתעד notes
- ✅ chosen_option נשמר ל-DB + נוסף ל-ManyChat notes
- ✅ הסלמות עתידיות על אותו ליד מקבלות הקשר "ניסיון קודם"

---

## 6. זרימות תפעוליות

### 6.1 ריצת הבוט (ידני)

```
אתה לוחץ "הרץ בוט עכשיו" בדאשבורד
   ↓
Server Action → POST /api/bot/cron
   ↓ (Authorization: Bearer <BOT_SECRET>)
Vercel verifies token
   ↓
שולף לידים פעילים מ-ManyChat
   ↓
מסווג כל ליד לפי כללים → outcome:
   - tag_only (היה תג חדש; נשמר ב-DB אבל לא נדחף ל-ManyChat)
   - escalated (דורש אותך) → analyze_requested=true אוטו'
   - no_action (יציב)
   ↓
שומר ל-Neon: bot_runs + decisions + escalations
   ↓
מחזיר JSON summary
   ↓
דאשבורד מציג: "X לידים, Y החלטות, Z הסלמות"
```

**עלות לריצה:** $0 (Vercel free tier + ManyChat קיים)

### 6.1b ניתוח הסלמות

```
אתה כותב "תנתח הסלמות albadi" בצ'אט / מריץ /loop
   ↓
Claude מפעיל את הסקיל albadi-analyze
   ↓
GET /api/bot/pending-analyses (Bearer)
   ↓
לכל הסלמה: קורא context, חושב, מפיק:
   - summary בעברית
   - 2-3 אופציות תגובה (label, text, reasoning)
   - suggested_tag + suggested_tag_reason (אופציונלי)
   ↓
POST /api/bot/escalation-analysis/{id} per item
   ↓
לולאה עד pending=[]
   ↓
דאשבורד מתעדכן: הניתוחים מופיעים בכל הסלמה
```

### 6.2 פעולה ידנית של הבעלים

```
פותח https://albadi-crm.vercel.app/dashboard
   ↓
רואה הסלמות פתוחות עם summary + 3 אופציות + (לפעמים) הצעת תג
   ↓
לוחץ על הסלמה
   ↓
לוחץ "השתמש בזו" על אופציה רצויה → טקסט נכנס ל-textarea, chosen_option_index נשמר
   ↓
(אופציונלי) לוחץ "אשר תג" → התג מתחלף ב-ManyChat + נרשם ב-notes
   ↓
שולח את הטקסט ב-WhatsApp ידנית (דרך ManyChat / טלפון)
   ↓
לוחץ "סגור הסלמה" → resolution נשמר + notes מתעדכן ב-ManyChat
```

### 6.3 השעיית הבוט

```
תאמר לי "השעה את הבוט"
   ↓
RemoteTrigger update enabled=false
   ↓
הריצות נפסקות תוך שניות
   ↓
הדאשבורד עדיין עובד עם הדאטה הקיים
   ↓
"הפעל מחדש" → enabled=true
```

---

## 7. מגבלות ידועות

### 7.1 מגבלות מערכת (מתועד ב-`LIMITATIONS.md`)
1. **אי אפשר ליצור templates מקלוד** — Meta דורש רישום ידני דרך ManyChat / Meta Business Manager
2. **חוק 24 שעות של Meta** — אחרי שתיקה של 24 שעות, רק templates מאושרים מותרים (לא טקסט חופשי)
3. **ManyChat API לא חושף היסטוריית הודעות מלאה** — רק שדות סטטוס + last_input_text
4. **Vercel Hobby** — cron מובנה רץ פעם ביום בלבד (לכן השתמשנו ב-Anthropic Cloud Routine)
5. **רישום סבסקרייבר חדש** — חייב להגיע מהלקוח ראשון, לא ניתן להוסיף דרך API
6. **דאשבורד תלוי ב-Vercel free tier** — 100GB bandwidth/חודש, מספיק לשימוש פנימי

### 7.2 בחירות עיצוב שדורשות תשומת לב

**ההסלמות אינן real-time.** הבוט מגלה הסלמה רק בריצה הבאה (תוך שעה). אם לקוח שולח הודעת חירום ב-12:01, הבוט יזהה רק ב-13:00.

**אין notification אקטיבי לאלי.** לא נשלחת התראה כשיש הסלמה חדשה. תלוי בכך שאלי פותח את הדאשבורד.

**אין שליחת הודעות ב-MVP.** הבוט ב-Phase 1 read-only. הוא מציע תיוג ולא מבצע. גם אין שליחת תגובות ללקוחות.

**טיוטת התגובה בדאשבורד אינה אוטומטית.** אלי כותב את הטיוטה בעצמו ב-textarea. הבוט לא ממלא draft חכם.

### 7.3 חולשות אבטחה ידועות
- **טוקן ManyChat ב-`.env` המקומי וב-Vercel.** אם המחשב נגנב או ה-repo דולף, הטוקן חשוף. **המלצה:** rotation תקופתי (כל 6 חודשים).
- **סיסמה אחת משותפת לדאשבורד.** אין session per-user, אין 2FA.
- **אין rate limiting על endpoint ה-cron.** במידת הצורך אפשר להוסיף.

---

## 8. תוכנית שיפור (Roadmap)

### 8.1 Phase 2 — ביצוע פעולות אמיתיות (מצב read-only → write)
**מתי:** אחרי שאתה מאשר את ההחלטות שהבוט הציע על 32 הלידים הראשונים
**מה:** הבוט מתחיל לתייג בפועל ב-ManyChat (מסיר read-only)
**עבודה:** ~30 דקות + בדיקה זהירה של 5-10 לידים ראשונים

### 8.2 Phase 3 — שליחת templates אוטומטית
**מתי:** אחרי ש-Meta אישרה את 6 ה-templates (1-3 ימים)
**מה:**
- הבוט שולח את 32 templates ה-restart לכל הלידים התקועים (5/דקה)
- אחרי שלקוח מגיב, הבוט מסווג מחדש לפי התגובה
**עבודה:** הקוד כבר מוכן (`bot:restart-send`). רק להפעיל אחרי אישור Meta.

### 8.3 Phase 4 — התראות אקטיביות לאלי
**מה:**
- רישום templates 7 ו-8 (eli_alert, eli_summary) ב-Meta
- בכל הסלמה חדשה: שולח template מסוג `albadi_eli_alert` למספר של אלי
- אלי מקבל בוואצאפ: כפתורים `1`/`2`/`3` או לינק לדאשבורד
- 3 פעמים ביום סיכום אוטומטי (`albadi_eli_summary`)
**עבודה:** ~3 ימים (template approvals + parser ידי לתגובות 1/2/3 + cron לסיכומים)

### 8.4 Phase 5 — דרפט חכם
**מה:** במקום textarea ריק, הדאשבורד מציג טיוטה מוצעת שמיוצרת על ידי Claude לפי ההקשר
**עבודה:** ~2 ימים — צריך אינטגרציה של Anthropic SDK ב-Vercel + prompt engineering

### 8.5 Phase 6 — Webhook real-time
**מה:** במקום polling שעתי, ManyChat שולח webhook בכל הודעה חדשה. הסלמות מתגלות תוך שניות.
**עבודה:** ~3 ימים — צריך לבנות endpoint webhook + signed payload validation
**יתרון:** זמן תגובה משעה לפחות מ-5 דקות

### 8.6 Phase 7 — החלפת ManyChat (ארכיטקטורה A מהPRD)
**מתי:** אם ManyChat מגביל אותנו או מחיר עולה
**מה:** מחליפים ל-WABA ישיר ממטא + שאלון בקוד שלנו
**עבודה:** ~6 שבועות (פרויקט גדול)

### 8.7 שיפורים קטנים שווה מאמץ
- ❤ Auto-fill draft text per template selection in dashboard
- ❤ "תקדים אישי" — הצגת שיחות עבר עם הלקוח
- ❤ Lead scoring כמו ב-`daily_calls.py` (תרגום ל-TS)
- ❤ Magic link auth במקום סיסמה
- ❤ Mobile-first redesign של הדאשבורד
- ❤ Filter ב-pipeline לפי quote total / urgency
- ❤ Export ל-Excel של דוח שבועי
- ❤ ניתוח טון של הודעות לקוח (sentiment) לפני סיווג

---

## 9. עלות תפעולית

| רכיב | עלות חודשית |
|------|------------|
| Vercel Hobby | $0 |
| Neon Free | $0 |
| ManyChat (קיים) | $0 נוסף |
| Anthropic Cloud Routine | כלול במנוי |
| WhatsApp Business API דרך ManyChat | $0 (חלק מההסכם הקיים) |
| **סך הכל לעלות חודשית** | **$0** |

עליות אפשריות בעתיד:
- Vercel Pro: $20/חודש (אם נחרוג ב-bandwidth — לא צפוי בעסק יחיד)
- Neon Scale: $19/חודש (אם נחרוג ב-DB — לא צפוי באלפי לידים)
- WhatsApp templates: ל-Meta יש תמחור per-message — ראה https://developers.facebook.com/docs/whatsapp/pricing

---

## 10. מי אחראי על מה

**הבעלים (אלי):**
- ✅ רישום templates ידני ב-ManyChat / Meta
- ✅ אישור הסלמות בדאשבורד
- ✅ סגירת לידים שהבוט סימן כ"לא ענה" אחרי טיפול
- ✅ עדכון Custom Fields ב-ManyChat ידנית במקרים מיוחדים

**הבוט (אוטומטי):**
- ✅ שליפה שעתית של 32 לידים
- ✅ סיווג לפי כללים
- ✅ הסלמת מקרים דו-משמעיים
- 🔜 (Phase 2) תיוג בפועל ב-ManyChat
- 🔜 (Phase 3) שליחת templates ללקוחות
- 🔜 (Phase 4) שליחת התראות לאלי

**Anthropic Cloud:**
- ✅ הפעלת הבוט כל שעה
- ✅ אחסון מטא-דאטה של ה-routine

**Vercel:**
- ✅ אירוח הדאשבורד
- ✅ הרצת ה-API endpoints
- ✅ ניהול env vars מוצפנים
- ✅ Auto-deploy מ-GitHub

**Neon:**
- ✅ אחסון audit log של כל החלטה
- ✅ Backup אוטומטי

---

## 11. מסמכים נוספים בפרויקט

| מסמך | תיאור |
|------|-------|
| `PRD-lead-bot.md` | מסמך דרישות מלא — כל ההחלטות והתכנון |
| `LIMITATIONS.md` | מגבלות ידועות של המערכת |
| `TEMPLATES-FOR-META.md` | 8 templates במבנה מוכן לרישום ב-ManyChat |
| `README.md` | מדריך פיתוח טכני |
| `legacy/daily_calls.py` | סקריפט Python ישן (לא רץ יותר, נשמר ל-reference) |
| `legacy/תוכנית-סידור-ManyChat.md` | תוכנית סידור ידנית של תגים מהפרויקט הקודם |

---

## 12. סיכום מבחינה עסקית

**מה השגנו ביום עבודה אחד:**
- מערכת CRM פעילה בענן עם domain ייחודי
- בוט אוטונומי שרץ כל שעה בלי תלות במחשב המקומי
- 32 לידים תקועים סווגו אוטומטית
- 17 הסלמות זוהו ועומדות לטיפול ידני
- 6 templates ב-Meta בתהליך אישור
- מסמך מקיף של כל המגבלות והעתידיים
- $0 עלות חודשית

**מה זה משחרר לך:**
- אין צורך להיכנס ל-ManyChat ולסקור 32 לידים ידנית — הדאשבורד מציג הכל בעמוד אחד
- הבוט מזהה לידים דחופים אוטומטית — לא צריך לזכור מי ביקש שיחה
- היסטוריית כל החלטה מתועדת — אפשר לבדוק "מה קרה עם הליד הזה" בקליק
- תוך 1-3 ימים (אחרי Meta) — הבוט יוכל גם לשלוח תזכורות אוטומטית

**מה עדיין דורש אותך:**
- כניסה לדאשבורד 1-2 פעמים ביום לבדיקת הסלמות
- שיחות טלפון ללקוחות גדולים (12K+ ש"ח) — הבוט תמיד מסלים אלה
- שיקול דעת על תמחור / הנחות / מחירים — הבוט תמיד מסלים אלה
- רישום ידני של templates חדשים כשנוסיף

---

**גרסה הבאה (1.1) צפויה כאשר Phase 2 ו-3 נכנסים לאוויר. נכון לעכשיו, MVP פעיל ומוכן לשימוש.**
