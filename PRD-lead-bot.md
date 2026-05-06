# PRD — Albadi Lead Bot

**גרסה:** 0.1 (טיוטה)
**תאריך:** 2026-05-06
**בעלים:** אלי
**סטטוס:** לאישור

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
| אדריכלות התחלתית | C+ (polling proxy) | מהיר להקמה, לא דורש WABA חדש, מחזיק את כל הקיים. |
| אוטונומיית הבוט | בוט שולח בשמי | אלי אישר. לא מאשרים כל הודעה. |
| כללים: קוד מול AI | קוד-first, AI-fallback | יציבות. AI רק כשאין כלל. |
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

### 3.1 C+ (פעימה ראשית) — Polling Proxy

```
┌─────────────────┐                ┌─────────────────┐
│  WhatsApp user  │ ─── הודעה ──► │    ManyChat     │
└─────────────────┘                └────────┬────────┘
                                            │ poll API
                                  ┌─────────▼─────────┐
                                  │   Lead Bot        │
                                  │  (Vercel cron)    │
                                  │   ────────────    │
                                  │   1. Pull updates │
                                  │   2. Classify     │
                                  │   3. Decide       │
                                  │   4. Send/Tag     │
                                  └─────────┬─────────┘
                                            │
                          ┌─────────────────┼─────────────────┐
                          │                 │                 │
                  ┌───────▼───────┐ ┌──────▼──────┐ ┌────────▼────────┐
                  │   Neon DB     │ │  ManyChat   │ │  Dashboard +    │
                  │  (state +     │ │  API write  │ │  אזעקה אליי     │
                  │   audit log)  │ │ (tag/reply) │ │  (WhatsApp)     │
                  └───────────────┘ └─────────────┘ └─────────────────┘
```

**תדירות:** כל שעה (קבוע MVP). ניתן להוריד ל-30/15 דק' אם זמן תגובה לא מספיק.
**תקציב הקמה:** 2-3 שבועות.

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

**ארכיטקטורה: `albadi-crm` הוא פרויקט עצמאי, נפרד לחלוטין מ-`bag-quote-app`.**
- Stack: Next.js + TypeScript + Drizzle + Neon (DB נפרד מ-bag-quote-app).
- Vercel project עצמאי משלו.
- מתקשר עם ManyChat דרך API (כמו bag-quote-app — שניהם עצמאיים, ManyChat = source of truth משותף).

```
albadi-crm/
  PRD-lead-bot.md                    ← זה
  README.md                          ← מתעדכן בסוף Phase 0
  package.json                       ← חדש
  next.config.js                     ← חדש
  tsconfig.json                      ← חדש
  vercel.json                        ← חדש
  drizzle.config.ts                  ← חדש
  .env.example                       ← חדש
  .env                               ← gitignored
  drizzle/
    schema.ts                        ← 5 טבלאות (סעיף 5)
    migrations/                      ← drizzle-kit migrate
  app/
    api/
      bot/
        poll/route.ts                ← endpoint שמופעל מ-GitHub Actions
        webhook/route.ts             ← (Phase 4 — B, לא ב-MVP)
      actions/
        tag/route.ts
        reply/route.ts
        escalate/route.ts
      kill-switch/route.ts           ← הפעלה/כיבוי בוט
    dashboard/
      page.tsx                       ← UI ראשי ("מי דורש אותי")
      pipeline/page.tsx              ← Kanban view
      escalations/page.tsx           ← תור הסלמות
      runs/page.tsx                  ← היסטוריית runs
  lib/
    manychat/
      client.ts                      ← wrapper ל-ManyChat API
      config.ts                      ← Tag IDs, Field IDs, מ-.env
    classifier/
      rules.ts                       ← code rules (קוד-first)
      ai-fallback.ts                 ← Claude classifier
      index.ts                       ← orchestrator
    decision/
      engine.ts                      ← what action to take
      escalation.ts                  ← rules to escalate
      scoring.ts                     ← תרגום של daily_calls.py priority logic
    replier/
      templates.ts                   ← 4 templates + IDs מ-Meta
      sender.ts                      ← שליחה דרך ManyChat
    db.ts                            ← Neon connection
  scripts/
    pull-tone-samples.ts             ← Phase 0 — auto-pull תגובות אלי
  legacy/
    daily_calls.py                   ← מועבר. לא רץ יותר. לוגיקה תורגמה ל-lib/decision/scoring.ts.
    תוכנית-סידור-ManyChat.md         ← מועבר. ל-reference.
.github/
  workflows/
    bot-poll.yml                     ← cron שעתי. curl ל-/api/bot/poll
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

**סוף PRD.**
