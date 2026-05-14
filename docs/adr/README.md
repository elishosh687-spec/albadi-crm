# ADRs — Architecture Decision Records

> מקום אחד לכל החלטה ארכיטקטונית גדולה: למה בחרנו X על פני Y, מתי, מה הטרייד-אוף.

## Why ADRs

PRD אומר **what + why** מנקודת מבט של מוצר. ARCHITECTURE אומר **how** היום. ADR אומר **why we chose this how** — כדי שעוד שנה נזכור למה לא בחרנו את האלטרנטיבה.

## Format (one page max)

```markdown
# NNNN — <title>

**Status:** proposed | accepted | superseded by NNNN | deprecated
**Date:** YYYY-MM-DD

## Context
<מה היה המצב, מה הכאב, איזה אילוצים>

## Decision
<מה החלטנו>

## Alternatives considered
- A: <pros / cons>
- B: <pros / cons>

## Consequences
- Positive: <מה הרווחנו>
- Negative: <איזה debt לקחנו>
- Reversible? <כן/לא, ואיך>
```

## Status lifecycle

- **proposed** — בדיון. עוד לא מומש.
- **accepted** — מומש. תקף היום.
- **superseded by NNNN** — החלטה חדשה החליפה. הקובץ הזה היסטורי.
- **deprecated** — לא תקף יותר, אבל לא הוחלף ב-ADR ייעודי (פיצ'ר נמחק).

## Naming

`NNNN-kebab-case-title.md`. מספור רץ, לא לדלג. אם החלטה הוחלפה — הוסף `superseded by 00NN` ב-status, אל תמחק את הקובץ.

## Index

| # | Title | Status |
|---|---|---|
| _(ADRs רטרואקטיביים יתווספו בשלב 3 של תוכנית התיעוד)_ | | |

### Planned ADRs (לכתיבה)

- 0001 — Bridge over ManyChat (למה החלפנו spam vendor lock-in)
- 0002 — DB as source of truth (לא ManyChat custom fields, לא bridge state)
- 0003 — Retool over custom inbox (למה לא בנינו inbox פנימי)
- 0004 — JID as primary key for bridge leads (איך מאחדים identity)
- 0005 — USE_BRIDGE flag instead of hard cutover (rollback-ability)
- 0006 — Drafts only on money moments (לא לכל הודעה — overhead לאלי)
- 0007 — Dashboard v3 dark Kanban over v2 inbox (UX)
