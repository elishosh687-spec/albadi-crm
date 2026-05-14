# Runbooks — "מה לעשות כש-X נשבר"

> כל playbook = 1 דף, שלב-שלב, copy-paste פקודות.
> נכתב כשמשהו נשבר, לא מראש.

## Planned

- `bridge-down.md` — VPS לא עונה / webhook לא מגיע.
- `webhook-replay-fail.md` — `5min replay window` rejects everything (clock skew).
- `cutover-rollback.md` — `USE_BRIDGE=0`, מה לבדוק.
- `drafts-stuck-pending.md` — Retool/dashboard לא מעלים drafts.
- `cron-missed.md` — follow-ups לא רצו 24h+.
- `db-migration-fail.md` — `drizzle-kit push` נופל בייצור.

הוסף runbook חדש רק כשתקלה אמיתית קרתה. אל תכתוב מראש "ליתר ביטחון".
