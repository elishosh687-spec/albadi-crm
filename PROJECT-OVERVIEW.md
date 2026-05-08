# Albadi CRM — סקירת מוצר מקיפה

**גרסה:** 1.5
**תאריך עדכון:** 2026-05-08
**בעלים:** אלי שושן
**רישיון:** פרטי

> **מה חדש ב-1.5:** רידיזיין מלא של ה-UI (Editorial Hebrew, Frank Ruhl Libre + Heebo, פלטת "Paper & Ink" עם accent טרקוטה), 3 כפתורי פעולה בדאשבורד, escalation context grid עם נתוני הליד המלאים, A+F (default → no_action + aging tiers — מוריד ~70% מההסלמות), E3 (Cloud Routine שמנתחת הסלמות ב-Claude ומציעה 2-3 אופציות תגובה), דף `/dashboard/instructions` חדש.

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
                          │ כל שעה
                          │
┌─────────────────────────────────────────────────────────────────┐
│         Anthropic Cloud Routine (טריגר שעתי)                   │
│  cron: 0 * * * * UTC                                           │
│  פעולה אחת: curl ל-/api/bot/cron                                │
└─────────────────────────────────────────────────────────────────┘
```

**עקרונות עיצוב:**
- **ManyChat נשאר source of truth.** לא מחליפים אותו, מתממשקים אליו.
- **כללים בקוד תחילה, AI כברירת מחדל.** רוב התיוג דטרמיניסטי. AI רק כשאין כלל ברור.
- **אוטונומיה מבוקרת.** הבוט מתייג לבד, אבל לא שולח הודעות בלי אישור.
- **Single source of decisions:** Neon DB מתעד כל החלטה לחתוך זמן.

---

## 3. רכיבים ולינקים

### 3.1 Dashboard בענן

**URL:** https://albadi-crm.vercel.app
**סיסמה:** `Eb688837`

**עיצוב:** Editorial Hebrew minimalism — Frank Ruhl Libre (display) + Heebo (body), פלטת "Paper & Ink" (paper `#faf8f4`, ink `#1c1815`, accent טרקוטה `#9c4221`). UI מבוסס `lib/ui/tokens.ts` + 5 פרימיטיבים (`Page`, `Card`, `Button`, `Stat`, `Badge`).

| מסך | מה מציג |
|-----|---------|
| `/` | landing — כותרת ענק "הבוט שמטפל בלידים שלך" + CTA לדאשבורד |
| `/login` | הזנת סיסמה |
| `/dashboard` | בית — 3 כפתורי פעולה (הרץ בוט / re-engagement / הוסף ליד) + הסלמות פתוחות (עם תג, ימים שקט, ₪quote inline) + סטטיסטיקת בוט 24 שעות |
| `/dashboard/escalations` | תור הסלמות עם **context grid** (4 שדות: ימים ללא מגע, הצעה ב-₪, ביטחון AI, כלל שזוהה) + Notes מלא מ-ManyChat + סיבה לספק + ניתוח Claude (אם נתבקש) + textarea לטיוטה + 3 כפתורי החלטה |
| `/dashboard/pipeline` | תצוגת kanban — 8 עמודות לפי תג, צבעי הפלטה |
| `/dashboard/runs` | היסטוריית כל ריצות הבוט עם סטטוס, tabular numerals |
| `/dashboard/instructions` | מדריך שימוש מלא בעברית — מה הבוט עושה, מתי להפעיל כל כפתור, איך לטפל בהסלמה |

**3 כפתורי פעולה ב-`/dashboard`** (דרך Server Actions שלא חושפות `BOT_SECRET` ל-client):
1. **הרץ בוט עכשיו** → POST `/api/bot/cron`, מציג תוצאה (לידים, החלטות, הסלמות)
2. **שלח Re-engagement** → POST `/api/bot/restart-send` עם confirm. fire-and-forget (route maxDuration=120s)
3. **הוסף ליד ידני** → טופס subscriber_id + שם → POST `/api/bot/new-lead`

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

### 3.5 Anthropic Cloud Routines (3 routines)

**1. `Albadi Bot — Hourly Run`** (קיים, כרגע disabled)
- **ID:** `trig_01VWAWDtdHXqMMProUCseKbj`
- **לו"ז:** `0 * * * *` (כל שעה עגולה UTC)
- **מטרה:** curl POST ל-`/api/bot/cron`. ניתן להפעיל ידנית מהדאשבורד (כפתור "הרץ בוט עכשיו").

**2. `Albadi Restart Send`** (one-time)
- **ID:** `trig_01YQr7ccHcm3eRyW7GiwgQhe`
- **לו"ז:** רץ פעם אחת ב-2026-05-10 08:00 UTC (יום ראשון 11:00 ישראל)
- **מטרה:** curl POST ל-`/api/bot/restart-send` — שולח template re-engagement לכל הלידים התקועים.

**3. `Albadi — Escalation Analysis`** (חדש, 1.5)
- **ID:** `trig_011ZchHAtDCNM2Hx4Pki1NQL`
- **לו"ז:** `0 * * * *` (כל שעה — מינימום cron של Anthropic Cloud Routines)
- **מטרה:** Polls `/api/bot/pending-analyses`. עבור כל הסלמה שאתה לחצת עליה "נתח עם Claude" בדאשבורד — Claude קורא את הקונטקסט המלא, מנסח summary בעברית, מציע 2–3 אופציות תגובה (label + text + reasoning), ושולח חזרה ל-`/api/bot/escalation-analysis/{id}`. אתה בוחר אופציה ב-UI.
- **מודל:** claude-sonnet-4-6
- **prompt template:** מתועד ב-[`docs/CLOUD-ROUTINE-ANALYSIS.md`](docs/CLOUD-ROUTINE-ANALYSIS.md)

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

### 5.1 Dashboard (7 מסכים)
- ✅ דף landing (`/`) — hero ענק "הבוט שמטפל בלידים שלך" + CTA
- ✅ דף login (`/login`) — focus ring accent
- ✅ דף בית (`/dashboard`) — 3 כפתורי פעולה ידנית + הסלמות פתוחות עם meta line + Stats 24 שעות
- ✅ עמוד הסלמות (`/dashboard/escalations`) — context grid מלא + Notes + ניתוח Claude + 2-3 אופציות תגובה ניתנות לבחירה + textarea + 3 כפתורי החלטה
- ✅ Pipeline view (`/dashboard/pipeline`) — 8 עמודות לפי תג בצבעי פלטה
- ✅ History view (`/dashboard/runs`) — tabular numerals
- ✅ מדריך (`/dashboard/instructions`) — תיעוד שימוש בעברית
- ✅ עיצוב RTL בעברית, Editorial Hebrew minimalism
- ✅ Authentication עם middleware (cookie httpOnly + secure)

### 5.2 Bot — אוטומציה
- ✅ שולף לידים פעילים מטבלת `leads` ומסווג לפי כללים
- ✅ **Aging tiers** (1.5): 0-3 ימים → no_action (תקופת חסד), 3-14 → כללים, 14+ → escalate "stuck"
- ✅ **Default → no_action** (1.5): לידים שלא תפסו כלל לא מסולמים יותר (פרט לאחרי 14 ימים)
- ✅ Escalation triggers: pricing keywords, human request, broken lead, big quote stuck, stuck 14+ days
- ✅ שומר כל החלטה ל-DB עם audit מלא
- ✅ Phase 1 read-only (לא מתייג בפועל ב-ManyChat — רק רושם הצעה)
- ✅ ניתן להפעיל ידנית מהדאשבורד (כפתור "הרץ בוט עכשיו") או דרך Cloud Routine

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
- ✅ סקיל `albadi-bot-run` ב-`~/.claude/skills/` (גלובלי, מסונכרן Google Drive)
- ✅ Skill ב-project-level (`.claude/skills/`) — backup
- ✅ סקריפט `bot:list-leads` — תצוגת לידים פתוחים עם הצעות פעולה
- ✅ סקריפט `bot:run-once` — ריצה ידנית מקומית
- ✅ סקריפט `pull-tone-samples` — שליפת notes מ-ManyChat לכיול טון

### 5.7 רידיזיין UI (1.5)
- ✅ Design tokens (`lib/ui/tokens.ts`) — Paper & Ink palette, מקור אמת יחיד
- ✅ 5 פרימיטיבים משותפים (`Page`, `Card`, `Button`, `Stat`, `Badge`) ב-`components/ui/`
- ✅ Frank Ruhl Libre + Heebo דרך `next/font/google` (hebrew + latin subsets)
- ✅ הסרת אימוג'ים מ-UI structural — צבעי dot + Badge במקום
- ✅ Hairline rules במקום צללים — היררכיה מ-typography ו-spacing

### 5.8 כפתורי פעולה (1.5)
- ✅ 3 Server Actions ב-`app/actions/bot.ts` — `BOT_SECRET` נשאר server-side, לא מודלף ל-client bundle
- ✅ "הרץ בוט עכשיו" עם pending state ותוצאה
- ✅ "שלח Re-engagement" עם confirm dialog ו-fire-and-forget
- ✅ "הוסף ליד ידני" עם form (subscriber_id חובה, שם אופציונלי)

### 5.9 Escalation context (1.5)
- ✅ JOIN של `escalations` עם `decisions` כדי להציג `input_messages` JSONB
- ✅ Context grid 4 שדות: ימים ללא מגע (אדום אם ≥7), הצעה ב-₪ (accent אם ≥10k), ביטחון AI %, כלל שזוהה
- ✅ Notes מלא מ-ManyChat (collapsible מ-220 תווים)
- ✅ דף בית מציג meta line inline לכל הסלמה: `tag · X ימים שקט · ₪quote`

### 5.10 Claude analysis pipeline (1.5)
- ✅ עמודות חדשות ב-`escalations`: `analyze_requested`, `analysis_summary`, `suggested_reply`, `suggested_replies` (jsonb), `analyzed_at`, `chosen_option_index`
- ✅ 3 endpoints חדשים: `analyze-escalation`, `pending-analyses`, `escalation-analysis/[id]` (Bearer `BOT_SECRET`)
- ✅ Server Action `requestAnalysis` ב-`app/actions/escalation-analysis.ts`
- ✅ UI: כפתור "נתח עם Claude" → polling כל 10 שניות → הצגת summary + 2-3 אופציות תגובה
- ✅ User-in-the-loop: Claude מציע, אתה בוחר. עתידי: `chosen_option_index` יאסוף נתונים לאוטונומיה הדרגתית

---

## 6. זרימות תפעוליות

### 6.1 ריצה אוטומטית (כל שעה)

```
T=0 (שעה עגולה UTC)
   ↓
Anthropic Cloud Routine מתעורר
   ↓
מריץ curl POST → albadi-crm.vercel.app/api/bot/cron
   ↓ (Authorization: Bearer <BOT_SECRET>)
Vercel verifies token
   ↓
שולף 32 לידים מ-ManyChat (rate-limited ~150ms/lead)
   ↓
מסווג כל ליד לפי כללים → outcome אחד מתוך:
   - tag_only (ידוע, ניתן לתייג)
   - escalated (דורש אותך)
   - no_action (יציב)
   ↓
שומר ל-Neon: bot_runs + decisions + escalations
   ↓
מחזיר JSON summary
   ↓
Anthropic Cloud Routine מסיים
   ↓
T=+5 שניות בערך — סוף ריצה
```

**עלות לריצה:** $0 (כלול במנוי Anthropic + Vercel free tier + ManyChat קיים)

### 6.2 פעולה ידנית של הבעלים

```
פותח https://albadi-crm.vercel.app/dashboard
   ↓
רואה הסלמות פתוחות
   ↓
לוחץ על הסלמה
   ↓
קורא את ההקשר + הטריגר
   ↓
כותב טיוטת תגובה ב-textarea
   ↓
לוחץ:
   - "✓ אשר ושלח" → (Phase 3) ישלח template ללקוח
   - "✗ דחה" → ההסלמה נסגרת בלי פעולה
   - "✏️ אטפל ידנית" → סימון שאתה מטפל מחוץ למערכת
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

### 8.4 Phase 5 — דרפט חכם ✅ (גרסה 1.5)
**מה נעשה:** במקום textarea ריק, הדאשבורד מציג ניתוח Claude עם 2-3 אופציות תגובה (label + text + reasoning). אתה בוחר, ה-textarea מתמלא. דרך Cloud Routine במנוי Claude שלך — ללא `ANTHROPIC_API_KEY` ו-$0/חודש.
**עבודה שנותרה (אופציונלי):** הוספת D — קריאת הודעות אמיתיות מ-ManyChat per lead. כרגע Claude מנתח מ-`notes` בלבד.

### 8.4b Phase 5b — אוטונומיה הדרגתית (עתידי)
**מתי:** אחרי איסוף 200+ הסלמות עם `chosen_option_index` ממולא
**מה:** "אם הסלמה דומה לאלה שתמיד נבחרה בה אופציה X (90%+) → הפעל אוטומטית במקום לסלם"
**עבודה:** ~3 ימים (similarity + threshold + override)

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
