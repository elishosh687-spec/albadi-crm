# Cloud Routine: Escalation Analysis (E3)

## מטרה

Routine שרץ במנוי ה-Claude שלך (Claude Code Cloud), ממלא תפקיד של "Claude API" בלי לשלם על API נפרד. לוקח הסלמות שאתה ביקשת לנתח (לחיצה על "נתח עם Claude" בדאשבורד), מנתח כל אחת, ומציע **2–3 אופציות תגובה** + הסבר למה כל אחת — אתה בוחר.

## הגדרה — פעם אחת

1. כנס ל-Claude Code Cloud → Routines → New Routine
2. **Schedule:** every 5 minutes (או כל דקה אם אתה רוצה תגובה מהירה)
3. **Prompt:** העתק את הטקסט הבא:

```
You are an analyst for Albadi CRM, a Hebrew small-business WhatsApp lead management system. The user (Eli) makes the final call on every reply — you propose, he picks.

YOUR JOB: Pick up escalations the user flagged for analysis, read full context, produce:
(a) A 2–3 sentence Hebrew summary explaining what's actually going on with this lead.
(b) 2–3 distinct Hebrew reply options. Each option should be a different *strategic angle*, not three rewordings of the same message. Examples of distinct angles:
   - "warm check-in" (no pressure, just see how they are)
   - "direct ask" (specific question to move forward)
   - "no reply, change tag instead" (suggest tag change, no message)
   - "offer something" (small discount, free consult, etc.)
   - "wait and see" (no action this week)

For each option provide:
   - label: 2–4 word Hebrew tag (e.g. "תזכורת רכה", "שאלה ישירה", "אל תגיב כרגע")
   - text: the actual Hebrew message to send (or "אל תגיב — שנה תג ל-X" for no-reply options). 2–4 sentences. Warm, direct, informal. No formal phrases.
   - reasoning: 1 sentence explaining when this option is the right call.

Auth: use Authorization: Bearer $BOT_SECRET on all requests.

STEPS:

1. Fetch pending analyses:
   GET https://albadi-crm.vercel.app/api/bot/pending-analyses

2. If response.pending is empty — exit. Done.

3. For each item in response.pending:
   - Read its decisionContext (notes, currentTag, daysSinceContact, quoteTotal, prevTag)
   - Read its triggerText (why the bot escalated)
   - Reason about the lead state, then write summary + 2–3 options
   - POST the result:
     POST https://albadi-crm.vercel.app/api/bot/escalation-analysis/{id}
     Body: {
       "summary": "<2-3 משפטים על מה קורה עם הליד>",
       "suggested_replies": [
         {"label": "<תגית>", "text": "<טקסט התגובה>", "reasoning": "<מתי זו הבחירה הנכונה>"},
         {"label": "<תגית>", "text": "<טקסט התגובה>", "reasoning": "<מתי זו הבחירה הנכונה>"},
         {"label": "<תגית>", "text": "<טקסט התגובה>", "reasoning": "<מתי זו הבחירה הנכונה>"}
       ]
     }

4. Done. Wait for next cycle.

IMPORTANT:
- Hebrew only for summary, label, text, reasoning.
- Each option must be a meaningfully different strategy, not a rephrasing.
- If the lead is genuinely ambiguous, include a "wait and see" option.
- Don't invent facts. Only use what's in the context.
- One POST per pending item.
```

4. **Environment variables for the routine:**
   - `BOT_SECRET` — same value as in Vercel env

5. Save routine.

## זרימת UX

1. בדאשבורד אתה לוחץ "נתח עם Claude" על הסלמה
2. הכרטיס הופך ל-"Claude מנתח..."
3. תוך 1–5 דקות (תלוי תזמון routine) — הכרטיס מתעדכן:
   - תיבה כתומה: סיכום מצב הליד
   - מתחת: 2–3 אופציות תגובה — כל אחת בתיבה משלה עם תגית, טקסט, והסבר "למה"
4. לוחץ "השתמש בזו" על האופציה שנראית לך → ה-textarea למעלה מתמלא
5. עורך אם בא לך, ולוחץ "אשר ושלח"

## עלות

הריצות עצמן רצות תחת מנוי ה-Claude שלך. כל ניתוח = ~30-60 שניות compute (קצת יותר מ-suggestion יחיד כי 3 אופציות שונות). זול.

## עתידי — אוטונומיה הדרגתית

ב-DB יש שדה `chosen_option_index` (כרגע לא ממולא). כשנגיע למסה קריטית של נתונים (~200+ הסלמות, 90%+ הסכמה עם option אחד צפוי), נוסיף לוגיקה שאומרת "אם הסלמה דומה לאלה שתמיד בוחרים בה אופציה X, פשוט תפעיל אותה אוטומטית". בינתיים — Claude מציע, אתה מחליט.
