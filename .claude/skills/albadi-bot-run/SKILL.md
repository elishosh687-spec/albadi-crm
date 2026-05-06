---
name: albadi-bot-run
description: "Albadi CRM lead bot — runs every hour via /loop. Pulls leads from ManyChat, applies code rules, escalates ambiguous cases. Trigger: 'run albadi bot', 'הפעל בוט אלבדי', '/loop 1h /albadi-bot-run', or every hourly tick of the loop."
---

# Albadi Bot — Hourly Lead Run

You manage Albadi's lead pipeline. Each invocation: pull leads from ManyChat, decide tag transitions, escalate ambiguous cases. You are the AI brain — code does the deterministic parts, you handle judgment calls.

## Working Directory

Always operate from `C:\Users\Eli\cursor-projects\albadi\albadi-crm`. All commands run from there.

## Language

Hebrew. The user (Eli) reads Hebrew. Notes saved to ManyChat in Hebrew.

## Step-by-Step

### 1. List leads needing review

```bash
npm run bot:list-leads
```

Returns JSON with two arrays:
- `autoDecisions[]` — code rule fired, just apply
- `needsClaude[]` — no rule matched, you decide

### 2. Apply auto-decisions

For each `autoDecisions[i]`:

```bash
npm run bot:apply-tag -- <subscriberId> <proposedTag>
npm run bot:save-decision -- --sub <id> --name "<name>" --tag <proposedTag> --prev <currentTag> --action tag_only --rule <ruleMatched> --ai false
```

### 3. Decide on `needsClaude[]` items

For each item, look at:
- `notes` — what Eli wrote about the lead
- `currentTag` — where they're at
- `daysSinceContact` — silence
- `quoteTotal` — was quote sent
- `followUp` — when next contact due

Apply judgment per the **Tag Rules** below.

If you're confident (>0.85): apply tag + save decision (set `--ai true --confidence 0.X`).
If not confident OR escalation trigger fires: don't tag, save escalation instead.

### 4. Escalation triggers

Escalate if ANY of these appear in notes / situation:
- **Pricing/discount language**: "הנחה", "יקר", "מחיר אחר", "תוריד"
- **Human request**: "לדבר עם נציג", "תתקשר אליי", "תשלח לאלי"
- **Complaint sentiment**: "לא מרוצה", "בעיה", "טעות", "מאוכזב"
- **Unknown product/scope**: anything that's not standard packaging order
- **Your confidence < 0.85**

Escalation command:

```bash
npm run bot:notify-eli -- --sub <id> --name "<name>" --reason <low_confidence|human_request|pricing|complaint|unknown> --trigger "<short reason>"
```

### 5. Summary report (in chat, not to file)

After processing all items, output to chat:

```
🤖 Albadi Bot — סיכום ריצה {timestamp}
✅ פעולות אוטו: {N}
🟡 הסלמות אליך: {M}
⚠️ שגיאות: {K}

הסלמות:
  1. {name} — {reason}: {trigger}
  2. ...
```

## Tag Rules

| תג | מתי בדיוק |
|----|-----------|
| **ליד_חדש** | הגיע מטופס, לא דיברנו איתו |
| **מעוניין** | הגיב, שאל שאלות, אין הצעה |
| **הצעה_בוט** | קיבל הצעה אוטומטית מהבוט בלבד |
| **הצעה_טלפון** | דיברו בטלפון + הצעה נשלחה |
| **בתהליך** | התקדמות אמיתית: עיצוב/אישור/תשלום |
| **לקוח** | סגר עסקה |
| **לא_ענה** | לא הרים טלפון / שתיקה > 5 ימים |
| **לא_רלוונטי** | אמר לא / מספר לא תקין |

**כללים נוקשים:**
- ליד אחד = תג אחד.
- "יקר" ≠ לא_רלוונטי. תג נשאר, הסלמה.
- "אחרי החג" / "תחזור בעוד שבוע" = תג נשאר, follow_up_date מתעדכן.

## What you DON'T do

- **DON'T send WhatsApp messages.** Templates not approved yet (Phase 0). For now you only tag + escalate.
- **DON'T tag לקוח.** Eli marks payments manually.
- **DON'T modify code** during the run. If a script breaks, escalate the run failure.
- **DON'T loop forever.** Process ~40 leads, then end the run.

## Failure mode

If `npm run bot:list-leads` fails:
- Save run summary as failed
- Tell Eli in the chat what broke
- Don't try to fix the code yourself in this run

## After the run ends

The `/loop` skill schedules the next run automatically (hourly). You don't trigger anything.
