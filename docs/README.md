# Albadi CRM — docs index

> כל התיעוד של הפרוייקט. כל קובץ עונה על שאלה אחת.

## איזה מסמך לקרוא מתי

| שאלה | מסמך |
|---|---|
| למה הפרוייקט קיים? איזה כאב הוא פותר? | [PRD.md](./PRD.md) |
| איזה פיצ'רים יש? מה shipped/beta/deprecated? | [FEATURES.md](./FEATURES.md) |
| איך זה בנוי בקוד? איפה נמצא מה? | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| איך לקוח עובר במערכת? כל שלב + use case + ההחלטה של אלי? | [CUSTOMER-FLOW.md](./CUSTOMER-FLOW.md) |
| מה הבוט אומר ללקוח בכל שלב? | [BOT-COPY.md](./BOT-COPY.md) |
| מה השתנה בכל גרסה? (pivots בלבד) | [CHANGELOG.md](./CHANGELOG.md) |
| למה בחרנו X על פני Y? | [adr/](./adr/) |
| מה לעשות כש-X נשבר? | [runbooks/](./runbooks/) |
| תיעוד היסטורי לפני pivots | [archive/](./archive/) |

## מבנה התיקייה

```
docs/
├── README.md            ← אתה כאן
├── PRD.md               ← why + outcomes + מדדים
├── FEATURES.md          ← feature inventory (bot + dashboard)
├── ARCHITECTURE.md      ← state of the code היום
├── CUSTOMER-FLOW.md     ← customer journey + use cases
├── BOT-COPY.md          ← נוסחי הבוט
├── CHANGELOG.md         ← v0 → v1 → v2 → v3 (pivots)
├── adr/                 ← architecture decision records
│   └── README.md
├── runbooks/            ← incident playbooks
│   └── README.md
└── archive/             ← מסמכים לפני pivot (לקריאה בלבד)
    ├── FOLLOWUP-SPEC.md
    └── plans/
```

## חוקי עדכון

- **PRD** משתנה רק כשמטרה/scope משתנים. לא לכל פיצ'ר חדש.
- **FEATURES** משתנה בכל מיזוג PR שמוסיף/מסיר/משנה status של פיצ'ר.
- **ARCHITECTURE** משתנה כשמשהו ארכיטקטוני זז (חדש endpoint, חדש table, חדש dependency).
- **CUSTOMER-FLOW** משתנה כשאלי קובע מה הבוט עושה בשלב X (החלטה עסקית). לא קוד.
- **BOT-COPY** משתנה כשאלי כותב מחדש copy.
- **CHANGELOG** משתנה רק ב-major release (pivot). לא לכל commit.
- **ADR** נוצר בכל החלטה ארכיטקטונית גדולה. לא מוחקים — `superseded by NNNN`.
- **runbook** נוצר אחרי תקלה אמיתית. לא מראש.
- **archive** = read-only. לא לעדכן.
