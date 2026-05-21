# Manual Tests — GHL Migration

> בדיקות ידניות per phase. תמיד תבדוק לפני advance.

---

## Phase 0 + 1A — Calculator widget ✅

### בדיקה 1 — Type check
```powershell
npx tsc --noEmit
```
**מצופה:** אין output.

### בדיקה 2 — Pipeline + stages ב-GHL UI
1. `https://app.gohighlevel.com/v2/location/zo0OlVmtNiXiDAbZj2YW/opportunities/list`
2. dropdown של pipelines → בחר **albadi**
3. **מצופה:** Kanban עם 8 columns (NEW → DROPPED)

### בדיקה 3 — Custom Fields
1. Settings → Custom Fields → Contacts
2. **מצופה:** 5 fields חדשים (ManyChat sub id / JID, WhatsApp JID, Bot summary, Quote total ILS, Pipeline flag)

### בדיקה 4 — Widget production endpoint
פתח בדפדפן:
```
https://albadi-crm.vercel.app/widget/calculator?widget_token=50da21955d78a871e4d1ffdd3e44827e2aa4875a3719dce4f009ca569cbb6a7c
```
**מצופה:**
- דף שחור (dark theme)
- Banner: `🧮 מחשבון מחיר · ⚠️ אין contactId — מצב standalone`
- מחשבון מלא: מוצר/כמות/שילוח/צבעים/slider רווח
- "פירוט מלא לבוס" → FX rates + CBM + alternatives

### בדיקה 5 — Token שגוי
```
https://albadi-crm.vercel.app/widget/calculator?widget_token=wrong
```
**מצופה:** "אין הרשאה".

### בדיקה 6 — Token עובד (PowerShell API call)
```powershell
$token = "pit-80128d88-b443-4ece-aa66-2e1f6c65dbe8"
Invoke-RestMethod -Uri "https://services.leadconnectorhq.com/opportunities/pipelines?locationId=zo0OlVmtNiXiDAbZj2YW" -Headers @{
  "Authorization" = "Bearer $token"
  "Version" = "2021-07-28"
  "Accept" = "application/json"
}
```
**מצופה:** JSON עם `pipelines` שמכיל "albadi".

### בדיקה 7 — Vercel envs (CLI)
```powershell
vercel env ls production | Select-String "GHL_|WIDGET_"
```
**מצופה:** 19 entries Encrypted.

### בדיקה 8 — End-to-end ב-GHL (אחרי Custom Menu Link)
1. Custom Menu Link "🧮 מחשבון" נוצר
2. GHL → Contacts → contact כלשהו
3. לחץ "🧮 מחשבון" בסיידבר
4. **מצופה:** iframe נטען עם המחשבון + banner עם שם הליד + stage

---

## Phase 1B — PDF flow (כשיבנה)

### בדיקה 1 — Save quote
1. widget → שנה margin → "שמור preview"
2. PostgreSQL: `SELECT quote_total FROM leads WHERE manychat_sub_id=...` — מעודכן
3. GHL contact → custom field `Quote total (ILS)` מעודכן

### בדיקה 2 — PDF generate + upload
1. widget → "סופי + PDF"
2. dialog: PDF preview נראה
3. GHL contact → Files tab → `quote-<id>.pdf` קיים

### בדיקה 3 — Send to customer
1. "שלח ללקוח"
2. WA test phone — קיבל text + PDF
3. GHL Activity → note "[PDF sent] quote #X"

---

## Phase 1C — Feishu loop (כשיבנה)

### בדיקה 1 — Send to factory
1. widget → "שלח לפבריקה"
2. Feishu sheet — שורה חדשה (lead + spec + price=empty)
3. GHL stage → `WAITING_FACTORY`
4. GHL Activity → note `[factory] sent to Feishu row N`
5. אלי בWA → DM "הצעה נשלחה לפבריקה"

### בדיקה 2 — Factory returns price
1. ב-Feishu — מלא עמודה E (מחיר_מפעל)
2. trigger cron: `curl -H "Authorization: Bearer $BOT_SECRET" https://albadi-crm.vercel.app/api/factory/poll-feishu`
3. DB: `quote_total` updated
4. GHL → custom field updated
5. GHL Activity → note `[factory] price received: X ILS`

---

## Phase 1D — Settings widget (כשיבנה)

1. GHL sidebar → "⚙️ הגדרות"
2. Settings page נטען בiframe
3. שנה default margin → Save
4. DB: `SELECT * FROM app_config WHERE key='factory_config'` — מעודכן
5. פתח Calculator widget → default margin חדש

---

## Phase 1E — Backfill (כשיבנה)

### בדיקה 1 — Dry run
```powershell
npx tsx integrations/ghl/backfill.ts --dry-run
```
**מצופה:**
- "Found N leads"
- "Would create M contacts, K opportunities"

### בדיקה 2 — Real run
```powershell
npx tsx integrations/ghl/backfill.ts
```
**מצופה:** progress bar, ~5min ל-2K leads.

### בדיקה 3 — GHL UI
1. CRM → Contacts → כל הלידים מ-DB מופיעים
2. Opportunities → albadi → פזורים לפי stage

### בדיקה 4 — DB mapping
```powershell
psql "$env:DATABASE_URL" -c "SELECT COUNT(*) FROM leads WHERE ghl_contact_id IS NOT NULL"
```
**מצופה:** == total leads count.

---

## Phase 1F — Outbound chat (כשיבנה)

1. GHL → Contact → Conversations → כתוב הודעה → Send
2. Vercel logs: `[ghl.outbound] sending to bridge jid=...`
3. WA test phone — קיבל ההודעה
4. GHL — הודעה מסומנת "delivered"
5. DB: `SELECT * FROM messages WHERE sender='eli' ORDER BY ingested_at DESC LIMIT 1` — קיים
