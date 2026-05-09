# Local Scheduled Task: Escalation Analysis

## למה מקומי ולא ענן?

ניסינו Cloud Routine באנתרופיק (`trig_011ZchHAtDCNM2Hx4Pki1NQL`) — נחסם על-ידי Bash sandbox network allowlist. ה-routine הקלאודי לא יכול לפנות ל-`albadi-crm.vercel.app` (וגם לא ל-domains אחרים שאינם ב-allowlist), ואין דרך להוסיף hosts מראש דרך ה-API. ה-Cloud Routine מושבת.

המעבר ל-task מקומי ב-Claude Code נותן:
- **גישה מלאה לרשת** (אין sandbox לוקלי)
- **אפס עלות** (רץ במנוי ה-claude.ai שלך)
- **אין צורך ב-`ANTHROPIC_API_KEY`**
- **trigger ידני בכל זמן** מ-Claude Code

המגבלה היחידה: **המחשב צריך להיות דולק** כשרוצים שהמשימה תרוץ.

## Task ID

```
albadi-escalation-analysis
```

קובץ ה-skill: `C:\Users\Eli\.claude\scheduled-tasks\albadi-escalation-analysis\SKILL.md`

## איך מפעילים

### Manual run (מ-Claude Code)

הדרך המומלצת — אתה שולט מתי הוא רץ:

1. פתח Claude Code על המחשב שלך
2. בסיידבר → "Scheduled" → `albadi-escalation-analysis` → "Run now"

או דרך הצ'אט:
```
תפעיל את ה-task albadi-escalation-analysis
```

או דרך MCP:
```
mcp__scheduled-tasks__list_scheduled_tasks → run
```

### זרימה מלאה

```
[1] בדאשבורד אתה לוחץ "נתח עם Claude" על הסלמה
        ↓
[2] DB מסומן: analyze_requested=true (בלי analyzed_at)
        ↓
[3] אתה פותח Claude Code → "Run now" על albadi-escalation-analysis
        ↓
[4] Claude Code (מקומית) פותח session חדש
        - קורא BOT_SECRET מ-.env של הפרויקט
        - curl GET /api/bot/pending-analyses
        - לכל הסלמה: קורא context, חושב, מנסח summary + 2-3 אופציות בעברית
        - curl POST /api/bot/escalation-analysis/{id}
        ↓
[5] DB מתעדכן: analysis_summary, suggested_replies, analyzed_at
        ↓
[6] בדאשבורד (polling כל 10 שניות) — הכרטיס מתעדכן עם הניתוח
        ↓
[7] אתה בוחר אופציה → לוחץ "השתמש בזו" → textarea מתמלא → "אשר ושלח"
```

### זמן ריצה צפוי

- **5-30 שניות** לכל הסלמה (תלוי בכמה context יש)
- **2-3 דקות** ל-10 הסלמות בבת אחת
- אם 0 pending → יוצא תוך שנייה

## Schedule מומלץ — אפשרות עתידית

כרגע ה-task מוגדר **manual only** (לא רץ אוטומטית). אם תרצה לתזמן:

```
*/15 9-19 * * 0-4
```

= כל 15 דק׳ בין 9:00 ל-19:00, ימים א-ה (שעון ישראל).

לעדכן ל-schedule אוטומטי:
```
mcp__scheduled-tasks__update_scheduled_task("albadi-escalation-analysis", cronExpression="*/15 9-19 * * 0-4")
```

הערה: scheduled task דורש את ה-Claude Code פתוח/פעיל בזמן הריצה. אם המחשב כבוי — יחזור לנסות בריצה הבאה.

## אבטחה

- `BOT_SECRET` נקרא מקומית מ-`.env` של הפרויקט. לא חשוף ב-skill עצמו.
- ה-skill נמצא רק ב-`~/.claude/scheduled-tasks/` שלך — לא ב-git.
- ה-API endpoints (`/api/bot/*`) דורשים `Authorization: Bearer <BOT_SECRET>`.

## עדכון ה-skill

לעריכת ה-prompt:
```
C:\Users\Eli\.claude\scheduled-tasks\albadi-escalation-analysis\SKILL.md
```

לאחר עריכה — לא צריך restart. הריצה הבאה תקרא את הגרסה החדשה.

## Cloud Routine (תיעוד היסטורי)

ה-Cloud Routine `trig_011ZchHAtDCNM2Hx4Pki1NQL` (מוגדר disabled) נשאר ב-claude.ai/code/routines רק לתיעוד. לא משתמשים בו יותר.
