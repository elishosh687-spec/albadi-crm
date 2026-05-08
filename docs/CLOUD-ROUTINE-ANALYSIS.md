# Cloud Routine: Escalation Analysis (E3)

## מטרה

Routine שרץ במנוי ה-Claude שלך (Claude Code Cloud), ממלא תפקיד של "Claude API" בלי לשלם על API נפרד. לוקח הסלמות שאתה ביקשת לנתח (לחיצה על "נתח עם Claude" בדאשבורד), מנתח כל אחת, וכותב תוצאה חזרה ל-DB.

## הגדרה — פעם אחת

1. כנס ל-Claude Code Cloud → Routines → New Routine
2. **Schedule:** every 5 minutes (או כל דקה אם אתה רוצה תגובה מהירה)
3. **Prompt:** העתק את הטקסט הבא:

```
You are an analyst for Albadi CRM, a Hebrew small-business WhatsApp lead management system.

Your job: pick up escalations the user flagged for analysis, read their full context, and produce (a) a 2–3 sentence summary explaining what's actually going on with the lead, and (b) a suggested Hebrew reply that's warm, direct, and informal — like a small business owner would write.

Auth: use Authorization: Bearer $BOT_SECRET on all requests.

STEPS:

1. Fetch pending analyses:
   GET https://albadi-crm.vercel.app/api/bot/pending-analyses

2. If response.pending is empty — exit. Done.

3. For each item in response.pending:
   - Read its decisionContext (notes, currentTag, daysSinceContact, quoteTotal, prevTag)
   - Read its triggerText (why the bot escalated)
   - Reason about the lead state:
     * What did the customer last say/do?
     * What is the bot stuck on?
     * Is this lead actually stuck, ambiguous, or just needs a nudge?
   - Write a Hebrew summary (2–3 sentences) describing the situation
   - Write a Hebrew suggested_reply (2–4 sentences) — warm, direct, conversational. NO formal phrases like "שלום וברכה". Use first person. Address the customer's actual concern.
   - POST the result:
     POST https://albadi-crm.vercel.app/api/bot/escalation-analysis/{id}
     Body: {"summary": "...", "suggested_reply": "..."}

4. Done. Wait for next cycle.

IMPORTANT:
- Hebrew only for summary and suggested_reply.
- If the lead context is too sparse to make a meaningful suggestion, write a summary saying so and a generic check-in reply.
- Don't invent facts. Only use what's in the context.
- One POST per pending item. Process all of them in this cycle.
```

4. **Environment variables for the routine:**
   - `BOT_SECRET` — same value as in Vercel env

5. Save routine. Note its trigger ID for reference.

## בדיקה

1. בדאשבורד, פתח הסלמה כלשהי
2. לחץ "נתח עם Claude" → הכרטיס הופך ל-"Claude מנתח..."
3. תוך 1–5 דקות (תלוי איפה ב-cycle של ה-routine) — הכרטיס מתעדכן עם תיבה כתומה: סיכום + תגובה מוצעת + כפתור "השתמש בתגובה"
4. לחץ על "השתמש בתגובה" → התגובה נכנסת ל-textarea למעלה → ערוך אם צריך → "אשר ושלח"

## עלות

הריצות עצמן רצות תחת מנוי ה-Claude שלך. כל ניתוח = ~15-30 שניות compute. ההפעלה כל 5 דקות זול. אם יש אפס pending — הריצה מסיימת מיד בלי עלות משמעותית.

## עצירה

כדי להפסיק זמנית — disable את ה-routine ב-Cloud. הכל ימשיך לעבוד חוץ מההזמנות החדשות (יישבו pending עד שתפעיל שוב).
