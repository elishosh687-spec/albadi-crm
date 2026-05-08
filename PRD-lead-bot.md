# PRD — Albadi Lead Bot

**גרסה:** 0.4
**תאריך עדכון:** 2026-05-08
**בעלים:** אלי
**סטטוס:** פעיל (deployed)

---

## 1. רקע

### 1.1 המצב הקיים
- עסק יחיד (אריזות בהתאמה אישית — Albadi).
- שני נכסים קיימים:
  - **`bag-quote-app`** — אתר + Flow ManyChat לשאלון הצעות מחיר ב-WhatsApp.
  - **`albadi-crm`** — סקריפט יומי `daily_calls.py` (ניקוד עדיפות + Excel) + סקיל Claude `call-update` (עדכון אחרי שיחות טלפון).
- ~40 לידים פעילים, ~7 חדשים ביום.
- ManyChat מנהל את כל ההתכתבויות ב-WhatsApp.

### 1.2 הכאב
1. **בלגן בתגים.** שמות לא עקביים, סיווג ידני מציף אותי.
2. **אני בנאדם אחד.** כל החלטה ידנית = bottleneck.
3. **בוט עונה רק ל-flow אוטומטי**, אין מי שמטפל בהמשך השיחה.
4. **אני לא שם לב כשמשהו נשבר** — מרגיש בלגן ואז עוצר.
5. **call-update מכסה רק שיחות טלפון.** שיחות WhatsApp נופלות בין הכיסאות.

### 1.3 המטרה
בוט שמטפל אוטומטית בלידים מקצה לקצה: קורא שיחות, מחליט תג, עונה ללקוח בשמי, ומסלים אליי **רק** במקרים מוגדרים. מטרה: להוריד עומס החלטה היומיומי שלי ל-< 5 פעולות.

---

## 2. החלטות עיצוב מרכזיות

| החלטה | בחירה | נימוק |
|-------|-------|-------|
| בסיס תקשורת | ManyChat נשאר | כבר עובד, 40 לידים מוגדרים, ה-UI סביר. החלפה לא פותרת את הבעיה האמיתית. |
| אדריכלות התחלתית | C+ Local Loop | Claude Code אצל אלי = מנוע ה-AI. אין Vercel, אין Anthropic API. $0/חודש. |
| מנוע AI | Claude Code עצמו (לא SDK) | אלי משאיר session פתוח עם /loop 1h. |
| אוטונומיית הבוט | תיוג בלבד ב-MVP | שליחת הודעות מצריכה Templates מאושרי מטא — דחוי ל-Phase 3. |
| כללים: קוד מול AI | קוד-first, Claude-judgment | רק כשאין כלל ברור. |
| הסלמה אליי | רב-טריגרית | confidence נמוך + מילולי + כספי + לא מוכר. |
| תצוגה לי | Dashboard "מי דורש אותי", לא "תגים" | התגים נשארים ב-state machine, לא בממשק. |

### 2.1 תגים — נשארים, אבל "כמו חיילים"
התגים לא נמחקים, נשארים כ-state machine פנימי. אני לא רואה ערמת תגים. אני רואה pipeline kanban-לייט: עמודה ל-status, פילטר לפי מה שדורש אותי.

```
ליד_חדש  →  מעוניין  →  הצעה_בוט  →  הצעה_טלפון  →  בתהליך  →  לקוח
                                                                      ↘
                                                  לא_ענה  ←  (כל שלב)
                                                                      ↘
                                                                לא_רלוונטי
```

---

## 3. אדריכלויות — מסלולי שדרוג

המסמך מכסה את כל המסלולים. מתחילים ב-C+. אם לא מספיק → B. אם עוד לא מספיק → A.

### 3.1 C+ (פעימה ראשית) — Claude Code Local Loop

**שונה ממה שתוכנן בהתחלה. ארכיטקטורה final אחרי החלטה לבטל Vercel + Anthropic API:**

```
┌─────────────────┐                ┌─────────────────┐
│  WhatsApp user  │ ─── הודעה ──► │    ManyChat     │
└─────────────────┘                └────────┬────────┘
                                            │ poll API
                                  ┌─────────▼─────────────────┐
                                  │   Claude Code Session     │
                                  │   (אצל אלי, פתוח 24/7)    │
                                  │   /loop 1h /albadi-bot-run│
                                  │   ────────────────────    │
                                  │   1. tsx scripts/         │
                                  │      list-leads-for-review│
                                  │   2. Claude מקבלת JSON,   │
                                  │      מסווגת לפי כללים     │
                                  │   3. דו-משמעי? Claude     │
                                  │      מחליטה               │
                                  │   4. tsx scripts/apply-tag│
                                  │   5. tsx scripts/         │
                                  │      save-decision        │
                                  │   6. tsx scripts/         │
                                  │      notify-eli           │
                                  └─────────┬─────────────────┘
                                            │
                          ┌─────────────────┼─────────────────┐
                          │                 │                 │
                  ┌───────▼───────┐ ┌──────▼──────┐ ┌────────▼────────┐
                  │   Neon DB     │ │  ManyChat   │ │  Local Next.js  │
                  │  (state +     │ │  API write  │ │  Dashboard      │
                  │   audit log)  │ │ (tag only)  │ │  (npm run dev)  │
                  └───────────────┘ └─────────────┘ └─────────────────┘
```

**תדירות:** `/loop 1h /albadi-bot-run` — כל שעה, כל עוד session פתוח.
**עלות:** $0/חודש (מנוי Claude Code שלך, Neon free tier).
**תלות יחידה:** המחשב של אלי דולק + Claude Code session פתוח.

**מה בוטל:**
- ❌ Vercel deploy (לא צריך)
- ❌ GitHub Actions cron (לא צריך)
- ❌ `@anthropic-ai/sdk` (Claude עצמו = הסוכן)
- ❌ AI fallback בקוד (Claude מחליטה ישירות)

**מה נשאר:**
- ✅ Next.js (רק לדאשבורד מקומי, `npm run dev` כשרוצה לראות)
- ✅ Drizzle + Neon (audit log + state)
- ✅ ManyChat client TypeScript
- ✅ Templates נדרשים אם בעתיד נוסיף outbound (Phase 3+)

### 3.2 B (פעימה שנייה — אם C+ לא מספיק) — Webhook Proxy

```
┌─────────────────┐                ┌─────────────────┐
│  WhatsApp user  │ ─── הודעה ──► │    ManyChat     │
└─────────────────┘                └────────┬────────┘
                                            │ External Request
                                  ┌─────────▼─────────┐
                                  │   Lead Bot        │
                                  │ (api endpoint)    │
                                  │  ─── בזמן אמת ──  │
                                  └─────────┬─────────┘
                                            │
                                  ┌─────────▼─────────┐
                                  │  ManyChat API +   │
                                  │  Neon + Dashboard │
                                  └───────────────────┘
```

**טריגר לעבור:** זמן תגובה של ManyChat → Bot → Customer ארוך מדי בעיני לקוחות.
**עבודה נוספת מ-C+:** הוספת webhook endpoint, החלפת cron בטריגר אירועים. ~שבוע.

### 3.3 A (פעימה שלישית — אם B עדיין לא מספיק) — Full Replacement

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐
│  WhatsApp user  │ ──►│  Meta WABA   │ ──►│   Lead Bot      │
└─────────────────┘    │ (cloud API)  │    │  + DB + Dash    │
                       └──────────────┘    └─────────────────┘
```

**ManyChat נמחק.** הבוט מחליף את ה-Flows + השאלון + הכל.
**טריגר לעבור:**
- מגבלות ManyChat API (rate limits, פיצ'רים חסרים).
- רוצה Flow לוגיקה שלא ניתן לבטא ב-ManyChat.
- ManyChat נהיה יקר/לא יציב.

**עבודה נוספת מ-B:**
- WABA רשמי ממטא או דרך Twilio/360dialog.
- שאלון מחדש בקוד.
- מיגרציית 40 לידים + שדות.
- ~6 שבועות.

### 3.4 חלופת חירום — החלפת הכלי הבסיסי
אם ManyChat נשבר/יקר/לא מספיק לפני שמגיעים ל-A:
- **Wati** ($49+/חודש) — Kanban-style, WhatsApp-only.
- **Chatwoot** (חינם self-hosted) — multi-channel, דורש שרת.
שני הכלים תומכים באותה אדריכלות proxy. הבוט לא משתנה — רק adapter.

---

## 4. פירוט C+ (MVP)

### 4.1 רכיבים

| רכיב | מה זה | היכן |
|------|-------|------|
| Cron scheduler | טריגר כל שעה | **GitHub Actions** (Vercel Hobby = פעם ביום בלבד) |
| Poller | מושך updates מ-ManyChat | `api/bot/poll.ts` |
| Classifier | קוד-first, AI-fallback | `lib/classifier.ts` |
| Decision engine | מה לעשות (תייג / לענות / להסלים) | `lib/decision.ts` |
| Outbound replier | שולח דרך ManyChat sendContent | `lib/replier.ts` |
| State store | DB מצב + audit | Neon (קיים) |
| Dashboard | תצוגה אחת — "מי דורש אותי" | `app/dashboard` |
| Alert pusher | התראת WhatsApp אליי על הסלמות | sendContent ל-מספר שלי |

### 4.2 לוגיקת סיווג — קוד-first

תגים שניתנים לקבע בקוד דטרמיניסטי:

| תג | טריגר קוד | בלי AI? |
|-----|----------|---------|
| `ליד_חדש` | חדש מ-Form, אין הודעות נכנסות | כן |
| `הצעה_בוט` | שאלון מולא + הצעה נשלחה (יש `quote_total`) | כן |
| `לא_ענה` | `last_contact_date` > 48 שעות + אין תגובה | כן |
| `לקוח` | אני מסמן ידנית / שדה payment | כן |
| `הצעה_טלפון` | `last_contact_type = phone` + יש quote | כן |
| `מעוניין` | קיבל הודעה והגיב, אין quote | חצי-כן (זיהוי תגובה = קוד) |
| `בתהליך` | מילות מפתח: "עיצוב", "מאשר", "ממתין", "אישור" | AI fallback אם כללים לא ברורים |
| `לא_רלוונטי` | "לא מעוניין" / "תפסיק" / blocked | AI fallback לזיהוי טון |

**Confidence threshold לכלל AI:** 0.85. מתחת — הסלמה.

### 4.3 הסלמה אליי — כל הטריגרים

| טריגר | מקור | פעולה |
|-------|------|------|
| AI confidence < 0.85 | classifier | התראה + הצעת תג + פעולה ידנית |
| מילים: "לדבר עם נציג", "תתקשר אליי", "תשלח לאלי" | regex | התראה מיידית |
| מילים: "הנחה", "יקר", "תוריד מחיר", "שינוי" בכמות/מוצר | regex | התראה (פיננסי) |
| תלונה: "לא מרוצה", "בעיה", "טעות" | regex + AI sentiment | התראה דחופה |
| מוצר/בקשה לא מוכרים | classifier failed | התראה |

### 4.4 הודעות יוצאות — הבוט עונה בשמי

**סוגי תגובות אוטומטיות (MVP):**
1. **אישור קבלה** — לקוח כתב משהו לא דחוף. בוט: "קיבלתי, אחזור אליך תוך X שעות".
2. **תזכורת follow-up** — חלף `follow_up_date`. בוט: "היי, חזרתי בקשר להצעה. עוד רלוונטי?"
3. **השלמת שאלון** — שאלון התחיל ולא הסתיים > 48 שעות. בוט: "רוצה להמשיך מאיפה שעצרנו?"
4. **תשובת FAQ** — שאלות מוכרות (זמן אספקה, מינימום הזמנה, תשלום).

**מה הבוט לא עונה לבד (כל אלה → הסלמה):**
- שיחה ראשונה אם השאלון לא התחיל (אלא אם זה rule מוכר).
- כל מה שכרוך במחיר חדש או שינוי תנאים.
- כל מה שלא תואם 4 התרחישים למעלה.

**טון:** זוקק calibration על דוגמת תגובות שלי הקיימות. open question — סעיף 8.

### 4.4.1 חוק 24-שעות של מטא — Templates חובה
**אושר:** מטא חוסמת טקסט חופשי לסבסקרייבר שלא דיבר 24 שעות. לכן:

- **כל תגובה אוטומטית מחוץ לחלון 24 שעות = template מאושר מראש.**
- מתן Templates ב-Meta Business Manager → אישור מטא 1-3 ימים.
- הבוט בוחר template לפי שיקול דעת (rules + AI).
- בתוך חלון 24 שעות → טקסט חופשי מותר (תגובה מהירה).

**ספריית Templates ל-MVP (4 חובה):**

| שם template | מתי | משתנים | דוגמה |
|------------|-----|--------|-------|
| `followup_quote_sent` | חלף `follow_up_date`, יש quote | `{{name}}`, `{{quote_total}}` | "היי {{name}}, חזרתי בקשר להצעה שלנו ({{quote_total}} ש\"ח). עוד רלוונטי?" |
| `questionnaire_incomplete` | שאלון התחיל ולא הסתיים 48שעות | `{{name}}` | "היי {{name}}, רוצה שנמשיך מאיפה שעצרנו עם הצעת המחיר?" |
| `silence_check` | 5+ ימים ללא תגובה | `{{name}}` | "היי {{name}}, מקווה שהכל בסדר. עוד יש עניין באריזות?" |
| `ack_received` | אישור קבלת הודעה (חלון 24 שעות מותר טקסט חופשי גם) | `{{name}}` | "קיבלתי {{name}}, אחזור אליך בקרוב" |

**Templates עתידיים (Phase 5+):**
- `discount_request_received` — לקוח ביקש הנחה, הבוט מאשר שאלי יחזור
- `meeting_confirmation` — אישור פגישה
- `delivery_update` — עדכון משלוח

**Workflow:**
1. אני (אלי) רושם 4 templates ב-Meta Business Manager לפני Phase 3.
2. אישור מטא — 1-3 ימים.
3. שמירת template IDs ב-`.env` / `manychat-config.ts`.
4. הבוט בוחר template לפי decision engine.

### 4.5 Dashboard ("המבט של הבוקר")

```
┌──────────────────────────────────────────────────┐
│  אלבדי — היום                                    │
├──────────────────────────────────────────────────┤
│  3 לקוחות מחכים לך                               │
│                                                  │
│  🔴 בסל מחמיד — ביקש הנחה  ─►  [טפל]            │
│  🟠 דני כהן  — שאלה שאני לא מכיר  ─►  [טפל]      │
│  🟠 רותם     — אמר "תפסיק"        ─►  [טפל]      │
│                                                  │
│  ────────────────────────────────                │
│  הבוט טיפל לבד היום:                             │
│   12 הודעות נשלחו                                │
│   5 לידים תויגו                                  │
│   2 follow-ups שלחו                              │
│                                                  │
│  ────────────────────────────────                │
│  Pipeline                                        │
│   ליד_חדש (4) │ מעוניין (8) │ הצעה (12) │ בתהליך (5)
└──────────────────────────────────────────────────┘
```

אין מסך "תגים". יש רק "מי דורש אותי" + "מה הבוט עשה" + pipeline view.

### 4.6 התרעות real-time
כשהסלמה קורית → push WhatsApp אליי דרך ManyChat sendContent למספר שלי.
הודעת התראה: "בסל מחמיד ביקש הנחה — בדוק dashboard / link".

---

## 4.7 רישום לידים אוטומטי

כל ליד חדש מתווסף ל-DB דרך webhook:
- **Endpoint:** `POST /api/bot/new-lead`
- **Auth:** `Bearer <BOT_SECRET>`
- **Body:** `{ "subscriber_id": "...", "name": "..." }`

**חיבור ב-ManyChat:** בכל Flow של כניסת ליד (WhatsApp trigger + Facebook form trigger) — הוסף שלב "External Request" עם הפרטים הנ"ל. ManyChat יקרא ל-endpoint אוטומטית כשליד נכנס.

הבוט (`/api/bot/cron`) שולף לידים פעילים מ-DB במקום מרשימה hardcoded.

---

## 5. נתונים — Schema (Neon)

```sql
-- Bot run history
CREATE TABLE bot_runs (
  id           SERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  leads_seen   INT DEFAULT 0,
  decisions    INT DEFAULT 0,
  replies_sent INT DEFAULT 0,
  escalations  INT DEFAULT 0,
  errors       INT DEFAULT 0,
  status       TEXT  -- 'running' | 'success' | 'partial' | 'failed'
);

-- Each decision the bot made
CREATE TABLE decisions (
  id              SERIAL PRIMARY KEY,
  run_id          INT REFERENCES bot_runs(id),
  manychat_sub_id TEXT NOT NULL,
  lead_name       TEXT,
  input_messages  JSONB,         -- snapshot of conversation chunk
  rule_matched    TEXT,          -- which code rule fired (or null)
  ai_used         BOOLEAN,
  ai_confidence   NUMERIC,
  classified_tag  TEXT,
  prev_tag        TEXT,
  action_taken    TEXT,          -- 'tag_only' | 'reply_sent' | 'escalated'
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Outbound replies
CREATE TABLE replies_sent (
  id              SERIAL PRIMARY KEY,
  decision_id     INT REFERENCES decisions(id),
  manychat_sub_id TEXT NOT NULL,
  template_used   TEXT,         -- 'ack' | 'followup' | 'questionnaire' | 'faq' | null
  text            TEXT NOT NULL,
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  manychat_msg_id TEXT
);

-- Escalations queue
CREATE TABLE escalations (
  id              SERIAL PRIMARY KEY,
  decision_id     INT REFERENCES decisions(id),
  manychat_sub_id TEXT NOT NULL,
  lead_name       TEXT,
  reason          TEXT NOT NULL,  -- 'low_confidence' | 'human_request' | 'pricing' | 'complaint' | 'unknown'
  trigger_text    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT
);

-- Anomaly detection (audits)
CREATE TABLE anomalies (
  id              SERIAL PRIMARY KEY,
  manychat_sub_id TEXT NOT NULL,
  type            TEXT,    -- 'stuck_in_tag' | 'tag_inconsistency' | 'no_followup_set'
  description     TEXT,
  detected_at     TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

-- Active leads (replaces hardcoded KNOWN_SUBSCRIBERS)
CREATE TABLE leads (
  manychat_sub_id TEXT PRIMARY KEY,
  name            TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  source          TEXT DEFAULT 'manual',  -- 'manual' | 'seed' | 'manychat_webhook'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. שלבי יישום (Phasing)

### Phase 0 — Foundation (3-5 ימים)
- [ ] העברת ManyChat token ל-`.env` (יש exposed ב-`daily_calls.py` ו-README).
- [ ] חידוש לכל שדות וטגי ID במקום אחד (`lib/manychat-config.ts`).
- [ ] formalization של כללי תיוג מ-`SKILL.md` לקוד.
- [ ] schema של DB (סעיף 5) ב-Neon.
- [ ] **רישום 4 Templates ב-Meta Business Manager** (ראה 4.4.1) — שליחה לאישור מטא במקביל לעבודה (אישור 1-3 ימים, לא חוסם Phase 1-2).
- [ ] **רישום מספר אלי כסבסקרייבר ב-ManyChat** (לקבלת התראות הסלמה).
- [ ] **סקריפט auto-pull להיסטוריית תגובות אלי** מ-ManyChat → קובץ JSON. ~30 דוגמאות לכיול טון.

### Phase 1 — Read-Only Bot (שבוע)
- [ ] cron + poller שמושך updates.
- [ ] classifier (rules first).
- [ ] רושם הכל ל-`decisions` בלי לפעול.
- [ ] dashboard בסיסי שמראה מה הבוט *היה* עושה.
- [ ] **שלב הוכחה — אני בודק שההחלטות שלו תואמות את שלי.**

### Phase 2 — Auto-Tag (3-4 ימים)
- [ ] בוט מתחיל לעדכן תגים ושדות ב-ManyChat.
- [ ] עדיין לא שולח הודעות יוצאות.
- [ ] dashboard מראה אחוזי דיוק.

### Phase 3 — Outbound Replies (שבוע)
- [ ] Templates (ack, followup, questionnaire, faq).
- [ ] שליחה דרך ManyChat sendContent.
- [ ] התראות הסלמה ב-WhatsApp אליי.
- [ ] safety: כפתור kill switch (לבטל את כל הבוט במכה אחת).

### Phase 4 — Anomaly detection (3 ימים)
- [ ] לידים תקועים בתג > 7 ימים.
- [ ] בוט לא מצליח להחליט > 3 פעמים על אותו ליד.
- [ ] שגיאות API חוזרות.

### Phase 5 — Refinement
- [ ] tone calibration על תגובות אמיתיות שלי.
- [ ] רחבת ה-FAQ.
- [ ] A/B על template texts.

### Phase 6+ — Upgrade Path
- אם C+ לא מספיק → **B** (webhook).
- אם B לא מספיק → **A** (full replacement).

**טריגר לשדרוג B:** ניתן יחס "זמן ממוצע מהודעת לקוח עד תגובת בוט" > 20 דקות > השפיע על rate המרה. או, באופן פיגי, אני מרגיש שהלקוחות מתלוננים על אי-זמינות.

**טריגר לשדרוג A:** אני נתקל ב-2+ פיצ'רים שמגבלות ManyChat חוסמות. או, ManyChat מעלה מחיר משמעותית.

---

## 7. תלות חיצוניות

| תלות | סטטוס | בעיה אפשרית |
|------|--------|------------|
| ManyChat API | פעיל | rate limits לא ידועים. צריך לבדוק. |
| ManyChat sendContent | אישור | לא בטוח שאפשר לשלוח טקסט חופשי לכל subscriber מחוץ ל-flow. **צריך POC.** |
| Neon DB | פעיל | אין |
| GitHub Actions cron | אישור | חינמי, כל 5 דק' מינימום. מפעיל endpoint ב-Vercel דרך curl. (Vercel Hobby cron = פעם ביום בלבד, לא מתאים.) |
| Anthropic API | פעיל | רץ על חשבון Claude של אלי — לא רלוונטי לעלות פרויקט. |
| Meta 24-hour rule | לא ידוע | אחרי 24 שעות מהודעת לקוח אחרונה, ManyChat/WhatsApp חוסמים טקסט חופשי. רק templates מאושרים. POC לפני Phase 3. |

---

## 8. שאלות פתוחות

1. ~~**תדירות polling**~~ — **נסגר: כל שעה.** ניתן לשנות בשלב מאוחר אם זמן תגובה לא מספיק.
2. ~~**Tone calibration**~~ — **נסגר: auto-pull מ-ManyChat history.** סקריפט בנפרד ב-Phase 0.
3. ~~**Meta 24-hour rule POC**~~ — **נסגר: אלי אישר. חוק קיים. Templates מאושרים חובה. ראה סעיף 4.4.1.**
4. ~~**המספר שלי לקבלת התראות**~~ — **נסגר: לא רשום ב-ManyChat. אלי ירשם ב-Phase 0.**
5. ~~**Kill switch**~~ — **נסגר: כפתור ב-Dashboard עם flag ב-DB. ניתן לעצור הכל בלי deploy.**
6. ~~**תקרה לעלות AI**~~ — **נסגר: ירוץ על חשבון Claude של אלי, אין תקרת עלות נדרשת.**

---

## 9. סיכוני מערכת

| סיכון | חומרה | מיטיגציה |
|-------|--------|---------|
| הבוט שולח תגובה לא נכונה ללקוח | גבוה | Phase 1+2 בלי outbound. Phase 3 רק templates. AI free-form רק אחרי calibration. |
| AI מסווג תג לא נכון | בינוני | rules-first. confidence threshold. dashboard למעקב. |
| ManyChat rate limit | בינוני | exponential backoff + alert. |
| Token דולף | קריטי | Phase 0 — `.env` + secret rotation. |
| WhatsApp policy violation מהודעות אוטומטיות | גבוה | רק תגובות לאחר שהלקוח כתב ראשון. אין broadcast. |
| Bot לא מבחין בלקוח חשוב שדורש דחיפות | גבוה | רב-טריגר הסלמה (סעיף 4.3). |

---

## 10. מטריקות הצלחה

| מטריקה | יעד MVP | יעד 3 חודשים |
|--------|---------|--------------|
| זמן יומי שלי על תיוג ידני | מ-30 דק' → 5 דק' | < 2 דק' |
| תגים עם state עקבי | 95% | 99% |
| לידים תקועים > 7 ימים בלי טיפול | מ-? → < 3 | 0 |
| מספר ההסלמות אליי ביום | < 5 | < 3 |
| זמן תגובה ממוצע ללקוח | מ-? → < 30 דק' | < 15 דק' |
| לידים שאיבדנו בגלל טיפול לקוי | 0 | 0 |

---

## 11. החלטות שלא נכנסו ל-MVP

- **Multi-channel** (FB / IG / Email) — דחוי.
- **Voice transcription מ-WhatsApp voice notes** — דחוי, פוטנציאל לשלב 2.
- **Auto-pricing** — שינויי מחיר תמיד אצלי.
- **CRM ויזואלי מלא** — dashboard בלבד.
- **Lead scoring מתקדם** — ניקוד הקיים מ-`daily_calls.py` נשאר.
- **Multi-user** — אני יחיד. אם נכנס מישהו → שדרוג עתידי.

---

## נספח A — מפת קוד

**ארכיטקטורה: `albadi-crm` הוא פרויקט עצמאי, נפרד לחלוטין מ-`bag-quote-app`. רץ מקומית, אין Vercel.**
- Stack: Next.js + TypeScript + Drizzle + Neon (DB נפרד מ-bag-quote-app).
- Trigger: Claude Code skill `albadi-bot-run` שמופעל מ-`/loop 1h`.
- מתקשר עם ManyChat דרך API. Claude Code = מנוע ה-AI.

```
albadi-crm/
  PRD-lead-bot.md                    ← זה
  README.md
  package.json
  next.config.js
  tsconfig.json
  drizzle.config.ts
  .env.example
  .env                               ← gitignored
  .claude/
    skills/
      albadi-bot-run/SKILL.md        ← הסקיל המרכזי שרץ ב-/loop 1h
  drizzle/
    schema.ts                        ← 6 טבלאות
    migrations/                      ← drizzle-kit
  app/
    layout.tsx
    page.tsx
    dashboard/
      page.tsx                       ← UI ראשי ("מי דורש אותי")
      pipeline/page.tsx              ← Kanban view (Phase 4)
      escalations/page.tsx           ← תור הסלמות (Phase 4)
      runs/page.tsx                  ← היסטוריית runs (Phase 4)
  lib/
    manychat/
      client.ts                      ← wrapper ל-ManyChat API
      config.ts                      ← Tag IDs, Field IDs
    db.ts                            ← Neon connection
  scripts/
    pull-tone-samples.ts             ← Phase 0
    pull-new-messages.ts             ← MVP — מושך מצב כל הלידים
    list-leads-for-review.ts         ← MVP — מסווג לפי כללים, מציג מי דורש Claude
    apply-tag.ts                     ← MVP — מחליף תג ב-ManyChat
    save-decision.ts                 ← MVP — audit log
    notify-eli.ts                    ← MVP — רשומת הסלמה ב-DB
  legacy/
    daily_calls.py                   ← לא רץ. לוגיקת ניקוד תורגם בעתיד.
    תוכנית-סידור-ManyChat.md         ← reference.
```

### המעבר של הקוד הקיים
- `daily_calls.py` → `legacy/daily_calls.py` (לא רץ יותר — לוגיקה תורגמה ל-TS).
- ניקוד עדיפות מתבצע ב-`lib/decision/scoring.ts`, נשמר ל-DB במקום ל-Excel.
- `~/.claude/skills/call-update/SKILL.md` — נשאר. הסקיל ימשיך לעבוד ל-edge cases ידניים (עדכון אחרי שיחת טלפון).

---

## נספח B — checklist מיגרציה אם נחליט לעבור Wati / Chatwoot

לא חלק מ-MVP. נשמר אם בעתיד נרצה.

- [ ] Export 40 לידים + custom fields מ-ManyChat (CSV).
- [ ] Map IDs ישנים → חדשים.
- [ ] בנה adapter ב-`lib/manychat-config.ts` שמשנה רק את ה-base URL ו-method names.
- [ ] רץ Phase 1 בקבוצת מבחן (5 לידים) במקביל לפני החלפה מלאה.
- [ ] cutover.

---

---

## 12. Backlog — שיפורים ידועים

### 🔴 אבטחה
- [ ] **`legacy/daily_calls.py`** — מספרי טלפון אישיים hardcoded בקוד מקור. להעביר ל-`.env` או למחוק.

### 🟠 דינמיות (hardcoded → DB/env)
- [ ] **`TAG_IDS` / `FIELD_IDS`** ב-`lib/manychat/config.ts` — כרגע hardcoded. לשלוף מ-ManyChat API או להעביר ל-`.env`.
- [ ] **`FLOW_NS`** ב-`app/api/bot/restart-send/route.ts` — flow namespace strings hardcoded. להעביר ל-`.env`.
- [ ] **ספי חוקים** — `10000` ש"ח (high-value), `5` ימים (no-contact), `7` ימים (stable tag) — מפוזרים בקוד. לרכז ב-`bot_config` table או `.env`.

### 🟡 אינטגרציה ManyChat
- [ ] **Webhook "ליד חדש"** — הגדר HTTP Request action בכל Flow כניסה (WhatsApp + Facebook form) לקרוא ל-`/api/bot/new-lead`. עד אז לידים חדשים לא נרשמים אוטומטית.

### 🟢 דאשבורד — פעולות
- [ ] לשונית "פעולות" עם כפתורים: שלח restart batch, הרץ בוט ידנית, הוסף ליד ידנית, רשימת flows פעילים.

**סוף PRD.**
