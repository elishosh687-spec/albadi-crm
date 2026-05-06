# Albadi CRM — Lead Bot

מערכת ניהול לידים אוטומטית עבור עסק האריזות אלבדי. בוט שעובד מעל ManyChat, מסווג לידים, עונה ללקוחות בשם הבעלים, ומסלים אליו רק כשצריך.

**מסמך עיקרי:** [PRD-lead-bot.md](./PRD-lead-bot.md)

## Stack

- Next.js 16 + TypeScript (Dashboard מקומי בלבד)
- Drizzle ORM + Neon Postgres (project: `albadi-crm` / `fragrant-morning-71359670`)
- ManyChat REST API
- **Claude Code session + `/loop 1h /albadi-bot-run`** — מנוע ה-AI. אין Anthropic SDK, אין Vercel deploy, אין GitHub Actions.

## מבנה

```
.claude/skills/albadi-bot-run/   ← הסקיל שרץ ב-/loop 1h
app/dashboard/                   ← UI ראשי
lib/manychat/                    ← API client + config
lib/db.ts                        ← Neon connection
drizzle/                         ← schema + migrations
scripts/                         ← bot:pull-messages / list-leads / apply-tag / save-decision / notify-eli
legacy/                          ← daily_calls.py + תוכנית-סידור-ManyChat.md
```

## הפעלת הבוט

תוך session פתוח של Claude Code:
```
/loop 1h /albadi-bot-run
```

הסקיל:
1. מושך מצב לידים מ-ManyChat (`npm run bot:list-leads`)
2. כללים אוטומטיים → מתייג + audit
3. דו-משמעי → Claude מחליטה
4. הסלמה → רשומה ב-DB, Eli רואה ב-dashboard

לראות את ה-dashboard:
```
npm run dev
```
פותח http://localhost:3000/dashboard

## פיתוח

```bash
npm install
cp .env.example .env       # מלא את הערכים
npm run db:generate
npm run db:migrate
npm run dev
```

## ENV vars

| key | מטרה |
|-----|------|
| `DATABASE_URL` | Neon connection string |
| `MANYCHAT_TOKEN` | ManyChat API token |
| `MANYCHAT_BASE` | (default `https://api.manychat.com/fb`) |
| `ADMIN_SUBSCRIBER_ID` | ManyChat ID של אלי לקבלת התראות |
| `TEMPLATE_*` | IDs של templates מאושרי מטא (Phase 3+, לא בשימוש ב-MVP) |

## מצב

Phase 0 — Foundation (פעיל).

ראה [PRD סעיף 6](./PRD-lead-bot.md) לתכנית phases.

## פיצ'ר ישן — `call-update` skill

הסקיל ב-`~/.claude/skills/call-update/SKILL.md` נשאר פעיל. הוא משלים את הבוט ב-edge cases של עדכון אחרי שיחת טלפון ידנית.
