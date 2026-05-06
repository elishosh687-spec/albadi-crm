# Albadi CRM — Lead Bot

מערכת ניהול לידים אוטומטית עבור עסק האריזות אלבדי. בוט שעובד מעל ManyChat, מסווג לידים, עונה ללקוחות בשם הבעלים, ומסלים אליו רק כשצריך.

**מסמך עיקרי:** [PRD-lead-bot.md](./PRD-lead-bot.md)

## Stack

- Next.js 15 + TypeScript
- Drizzle ORM + Neon Postgres (project: `albadi-crm` / `fragrant-morning-71359670`)
- Anthropic SDK (Claude)
- ManyChat REST API
- GitHub Actions (cron שעתי) → Vercel endpoint

## מבנה

```
app/api/bot/poll      ← cron entry point
app/api/actions/...   ← tag / reply / escalate
app/api/kill-switch   ← הפעלה / כיבוי
app/dashboard/...     ← UI
lib/manychat          ← API client + config
lib/classifier        ← rules + AI fallback
lib/decision          ← decision engine
lib/replier           ← templates + send
drizzle/              ← schema + migrations
scripts/              ← Phase 0 utilities (tone samples, ...)
legacy/               ← daily_calls.py + תוכנית-סידור-ManyChat.md (reference)
.github/workflows/    ← cron
```

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
| `ANTHROPIC_API_KEY` | Claude API |
| `BOT_SECRET` | שיתוף סוד עם GitHub Actions cron |
| `ADMIN_SUBSCRIBER_ID` | ManyChat ID של אלי לקבלת התראות |
| `TEMPLATE_*` | IDs של 4 templates מאושרי מטא |

## מצב

Phase 0 — Foundation (פעיל).

ראה [PRD סעיף 6](./PRD-lead-bot.md) לתכנית phases.

## פיצ'ר ישן — `call-update` skill

הסקיל ב-`~/.claude/skills/call-update/SKILL.md` נשאר פעיל. הוא משלים את הבוט ב-edge cases של עדכון אחרי שיחת טלפון ידנית.
