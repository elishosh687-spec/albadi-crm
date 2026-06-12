# Albadi CRM — Calculator (How pricing works)

> נכתב 2026-06-10. תיעוד מקיף של מנגנון תמחור ההצעות במערכת.
> מסביר את ה-**how** — איך מחיר ללקוח מחושב, איפה הרווח, איך השילוח נכנס, ומה ההבדל בין שני המחשבונים שקיימים.

---

## TL;DR

יש **שני מחשבונים נפרדים** במערכת — ומאז 2026-06-12 **שניהם משתמשים באותה קונבנציית רווח: margin-on-price**. 40% פירושו 40% מהמחיר בשני המסכים, ואותו 40% נותן אותו מחיר.

| מסך | מנוע | קונבנציית רווח | מתי משתמשים |
|---|---|---|---|
| **Calculator** (Dashboard + Widget) — `/dashboard/v3/calculator` + `/widget/calculator` | `lib/factory/calculator/engine.ts::calculateQuote` | **Margin-on-price** (רווח ÷ מחיר המוצר) | חישוב מקדים — לפני שיש Quote רשמי מהמפעל |
| **FinalizeModal** ("חישוב הצעה סופית") | `lib/factory/pricing.ts::priceFactoryQuote` | **Margin-on-price** (רווח ÷ מחיר המוצר) | חישוב סופי — כשמתקבל מחיר מהמפעל ולפני שולחים PDF ללקוח |

> ⚠️ **margin-on-price** נמדד מול **מחיר המוצר ללא שילוח** (השילוח pass-through).
> Margin 40% על עלות ₪6: מחיר מוצר = 6 ÷ (1−0.4) = ₪10, רווח ₪4 (=40% מ-₪10), ועוד שילוח בנפרד.
> שורת "רווח כ-% מסך ההזמנה" בפירוט מציגה את הרווח כאחוז מהמחיר **כולל** שילוח — מספר נמוך יותר, אינפורמטיבי בלבד.

בשני המנועים, **השילוח הוא pass-through — לא חל עליו רווח**.

> 📜 **היסטוריה:** עד 2026-06-12 ה-FinalizeModal עבד ב-**markup-on-cost** (רווח ÷ עלות), ולכן הסליידר הציג מספרים כמו 175%. הוא אוחד ל-margin-on-price כדי שכל המערכת תדבר באותו אחוז. הסליידר עכשיו 0–99%.

---

## 1. שני המסלולים — מתי כל אחד נכנס לפעולה

```
                            ┌─────────────────────────────────┐
                            │ לקוח שואל ב-WhatsApp / אלי מקבל │
                            │ הצעה מהמפעל ב-WeChat            │
                            └─────────────┬───────────────────┘
                                          │
                  ┌───────────────────────┴─────────────────────┐
                  │                                              │
       ┌──────────▼──────────┐                       ┌──────────▼──────────┐
       │ Calculator          │                       │ FactoryQuoteRequest │
       │ (תחזית / מה אם)     │                       │ (זרימת מפעל מלאה)   │
       │                     │                       │                     │
       │ engine.ts           │                       │ pricing.ts          │
       │ calculateQuote()    │                       │ priceFactoryQuote() │
       │                     │                       │                     │
       │ ← margin-on-price   │                       │ ← markup-on-cost    │
       └─────────────────────┘                       └──────────┬──────────┘
                                                                │
                                                     ┌──────────▼──────────┐
                                                     │ FinalizeModal       │
                                                     │ "חישוב הצעה סופית"  │
                                                     │  → PDF ללקוח        │
                                                     └─────────────────────┘
```

**Calculator** = משחק חופשי. בוחר מוצר/כמות/שילוח/% רווח ורואה כמה לקחת.
**FinalizeModal** = שלב סופי. הצעת מפעל הגיעה (`factoryResponse`), קובעים margin סופי + שילוח, מפיקים PDF, שומרים ל-DB.

---

## 2. מחשבון Calculator (`calculateQuote`) — Margin-on-Price

מיקום: [`lib/factory/calculator/engine.ts`](../lib/factory/calculator/engine.ts)
UI: [`components/calculator/CalculatorView.tsx`](../components/calculator/CalculatorView.tsx) (משותף ל-Dashboard ו-Widget)
API: [`app/api/factory/quote-preview/route.ts`](../app/api/factory/quote-preview/route.ts)

### 2.1 רכיבי העלות (CNY)

```
unitProductionCny =
    effectiveBaseCny           ← בסיס שקית (תלוי כמות, ידיות, למינציה)
  + colorAddonCny              ← תוספת צבעי לוגו (אם לא למינציה)
  + laminationColorCostCny     ← plate fee × צבעים ÷ כמות (אם למינציה)
  + moldsPerUnitCny            ← מולדים (1-time CNY) ÷ quantity
```

### 2.2 המרת מטבע

```
unitProductionUsd = unitProductionCny ÷ usdToCny
shippingPerUnitUsd = computed from carton spec + shipping rate
finalUnitCostUsd = unitProductionUsd + shippingPerUnitUsd

finalUnitCostIls = finalUnitCostUsd × usdToIls
```

> שערי ההמרה (`usdToIls`, `usdToCny`) חיים ב-`factory_config` ב-DB, נקראים ב-mount של המחשבון, fresh=true כדי שאלי יראה את השער העדכני (לא cache).

### 2.3 הנוסחה (margin-on-price)

```
marginableBaseIls    = totalCostPerUnitIls − shippingPerUnitIls       ← רק production
marginFrac           = clamp(marginPct, 0, 99.9) / 100
sellingPricePerUnit  = marginableBaseIls / (1 − marginFrac) + shippingPerUnit
profitPerUnit        = sellingPricePerUnit − totalCostPerUnit
```

**מה זה אומר בעברית:** ה-margin שאלי בוחר הוא **אחוז הרווח מתוך מחיר המכירה**, לא מתוך העלות. כשהוא רואה 40% במחשבון — זה אומר ש-40% מהמחיר שהלקוח משלם זה רווח.

**דוגמה:** עלות יחידה ₪6, margin 40%:
- selling = 6 / (1 − 0.4) = ₪10
- profit = 10 − 6 = ₪4
- = 40% מ-₪10 ✓

### 2.4 שילוח — pass-through

```
selling = marginableBase / (1 − margin) + shipping   ← שילוח נוסף ב-end, ללא רווח
```

זה אומר שאם השילוח של אווירי יקר ב-₪2 ליחידה, המחיר ללקוח עולה ב-₪2 בדיוק — לא ב-₪3.33. הרווח על ההזמנה נשאר זהה.

### 2.5 Snap-down של margin matrix לפי כמות

ב-`factory_config.profitMarginByQuantity` יש מפה: `{"1000": 50, "3000": 45, "5000": 40, "10000": 35}`. אם הלקוח בחר כמות 2500 — המנוע **snaps down** ל-1000 (הטיר התחתון הקרוב), כך שהוא לא יקבל מרג'ין של 1000 על כמות גדולה. אותה לוגיקה גם על המחיר עצמו.

### 2.6 "תמחור לפי יעד" (reverse)

UI מאפשר להזין רווח רצוי (₪500 לעסקה / סכום עסקה / מחיר ליחידה) ולקבל את ה-margin המובלע. הנוסחה ב-`CalculatorView.tsx::reverseResult`:

```
productPrice  = perUnit − shippingPerUnit                       ← מחיר ללא שילוח
marginPct     = ((productPrice − base) / productPrice) × 100    ← margin-on-price
```

---

## 3. FinalizeModal (`priceFactoryQuote`) — Margin-on-Price

מיקום: [`lib/factory/pricing.ts`](../lib/factory/pricing.ts)
UI (Dashboard): [`app/dashboard/v3/_components/factory/FinalizeModal.tsx`](../app/dashboard/v3/_components/factory/FinalizeModal.tsx)
UI (Widget): [`components/factory-flow/FinalizeModal.widget.tsx`](../components/factory-flow/FinalizeModal.widget.tsx)
Server: [`lib/factory/server/finalize.ts`](../lib/factory/server/finalize.ts)
API (dashboard): `POST /api/factory/finalize/[id]`
API (widget): `POST /api/widget/factory/[id]/finalize?widget_token=...`

### 3.1 רכיבי העלות

```
unitProductionCny = factoryUnitCostCny + moldsPerUnitCny
unitCostUsd       = unitProductionCny × (1 / usdToCny)
unitCost (ILS)    = unitCostUsd × usdToIls          ← זה שאלי רואה "עלות יחידה (CNY→₪)"

unitShippingUsd   = computeShippingPerUnitUsd(...)
unitShipping (ILS)= unitShippingUsd × usdToIls
```

לא נכנסים פה לוגו/ידיות/למינציה — כי בשלב הזה אלי כבר מקבל **מחיר יחידה אחד מהמפעל** שמשקלל את הכל פנימה. המולדים נוספים בנפרד כי לא תמיד נכללים בציטוט.

### 3.2 הנוסחה (margin-on-price)

```
productPrice     = unitCost / (1 − marginPct / 100)        ← מחיר ללא שילוח
unitSellingPrice = productPrice + unitShipping
unitProfit       = productPrice − unitCost
```

**מה זה אומר:** ה-margin פה זה **אחוז הרווח מתוך מחיר המוצר** (ללא שילוח) — בדיוק כמו במחשבון. כשאלי גורר את הסליידר ל-40% — זה אומר ש-40% ממחיר המוצר זה רווח. (marginPct נחתך מתחת ל-100%.)

**דוגמה:** עלות יחידה ₪6, margin 40%:
- productPrice = 6 / (1 − 0.4) = ₪10
- selling = 10 + shipping
- profit = 10 − 6 = ₪4 = 40% מ-₪10 ✓

### 3.3 שילוח — גם כאן pass-through

```
selling = cost / (1 − margin) + shipping            ← זהה לקונבנציה של המחשבון
profit  = cost / (1 − margin) − cost                 ← אין רווח על שילוח
```

הפנל "תוצאת חישוב חיה" מציג בנפרד:
- מחיר ליחידה, סה״כ הזמנה (with shipping)
- עלות יחידה (production only)
- שילוח / יחידה
- רווח / יחידה, סה״כ רווח

### 3.4 "תמחור לפי יעד" (reverse) — בשליטה על הסליידר

ה-`ReverseTargetPanel` ב-FinalizeModal מקבל רווח/סה״כ/ליחידה רצוי ומחזיר את ה-margin הנדרש כדי להגיע אליו. הנוסחה (`ReverseTargetPanel`):

```
productPrice = perUnit − unitShipping
marginPct    = ((productPrice − unitCost) / productPrice) × 100   ← margin-on-price
```

ולחיצה על "החל על סליידר" מעדכנת את ה-state של המרג'ין.

### 3.5 מולדים (חדש, 2026-06-10)

`moldsCostCny` הוא **סכום חד-פעמי** ב-CNY (תבניות, plates, מולדי הזרקה). המנוע מתחלק על הכמות ומכניס לעלות היצור ליחידה לפני המרג'ין:

```
moldsPerUnitCny = moldsCostCny / quantity
unitProductionCny += moldsPerUnitCny
```

הקלט נשמר ב-DB ב-`finalPricing.moldsTotalCny`, כך שאם פותחים שוב הצעה לעריכה — הערך נטען חזרה.

---

## 4. שילוח — לעומק

מימוש: `computeShippingPerUnitUsd` ב-`pricing.ts` ו-Step 5 ב-`engine.ts`.

### 4.1 ימי (sea)

```
shippingPerUnitUsd = max(totalCbm, 1) × seaRate ÷ quantity
```

- `seaRate` = $/CBM (מוגדר ב-factory_config, ברירת מחדל ~$200)
- **רצפת 1 CBM** — אם ההזמנה קטנה (totalCbm < 1), עדיין משלמים על CBM שלם. זה מוצג בפירוט המלא עם 🟠 "הופעלה רצפת 1 CBM" ואזהרה על ניצול נמוך.

### 4.2 אווירי (air)

```
rate              = totalWeightKg ≤ threshold ? rateBelow : rateAbove
shippingPerUnitUsd = totalWeightKg × rate ÷ quantity
```

- `airRates.thresholdKg` (ברירת מחדל 100) — מתחת לסף, תעריף יקר יותר; מעל, זול יותר.

### 4.3 חישובי לוגיסטיקה (משותף)

```
totalCartons   = ceil(quantity / cartonQty)
totalWeightKg  = totalCartons × cartonWeight
cbmPerCarton   = (length × width × height) / 1_000_000   ← cm → m³
totalCbm       = totalCartons × cbmPerCarton
```

ה-PDF ללקוח כולל את שלושת המספרים הללו — קרטונים, ק״ג, CBM.

### 4.4 השוואת ימי vs אווירי

ה-API `/api/factory/quote-preview` מחשב גם את ה-**alt shipping** (האופציה ההפוכה) ומחזיר אותה. ה-UI מציג השוואת מחיר בלוק "השוואת שיטות שילוח".

---

## 5. PDF Generation — מה הלקוח רואה

מימוש: `lib/factory/pdf.tsx`, מופעל מתוך `lib/factory/server/finalize.ts`.

ה-PDF מציג:
- פרטי מוצר + כמות
- מחיר ליחידה (ILS) — `pricing.unitSellingPrice`
- סה״כ הזמנה (ILS) — `pricing.totalSellingPrice`
- שיטת שילוח + לוגיסטיקה (קרטונים, ק״ג, CBM)
- תקפות 14 יום

**לא מוצג ללקוח:** עלות, margin %, מולדים, פירוק CNY/USD. זה רק לאלי בפנל הפנימי.

ה-PDF נשמר ב-Vercel Blob (`factory-quotes/{id}.pdf`, public URL) או נרנדר on-demand אם BLOB_READ_WRITE_TOKEN חסר.

---

## 6. פירוט לאלי — `DetailedBreakdown`

מימוש: [`components/calculator/DetailedBreakdown.tsx`](../components/calculator/DetailedBreakdown.tsx) + [`lib/factory/breakdown.ts`](../lib/factory/breakdown.ts).

זה ה-collapsible "פירוט מלא לבוס" — מציג:
- שערי המרה (¥/$/₪)
- עלות מפעל: ¥ → $ → ₪ ליחידה
- פירוק רכיבי הייצור (¥): בסיס + ידיות + למינציה + plate fee + צבעי הדפסה + **מולדים** (אם יש)
- שילוח: CBM גולמי vs effective (אם הופעלה רצפה), תעריף, חישוב מלא
- רווח: % + נוסחה + רווח/יחידה + סה״כ + % מהכנסה (vs % מעלות)
- השוואת ימי vs אווירי
- לוגיסטיקה

הקומפוננטה משותפת ל-3 מסכים: FinalizeModal, FactoryQuotePanel, CalculatorView.

---

## 7. Config — איפה מוגדרים השערים והמרג'ינים

DB: טבלת `factory_config` (JSONB row יחיד, sigleton).
Schema: [`drizzle/schema.ts`](../drizzle/schema.ts).
Loader: [`lib/factory/config.ts`](../lib/factory/config.ts) — `getFactoryConfig({ fresh: true })`.

```jsonc
{
  "usdToIls": 3.7,
  "usdToCny": 7.2,
  "ilsToCny": 1.94,                    // manual, לא נגזר אוטומטית
  "defaultProfitMargin": 40,
  "profitMarginByQuantity": {
    "1000": 50, "3000": 45, "5000": 40, "10000": 35
  },
  "shippingOptions": [
    { "id": "s1", "name": "אקספרס אווירי", "type": "air", "enabled": true,
      "airRates": { "thresholdKg": 100, "rateBelowThreshold": 6, "rateAboveThreshold": 4 } },
    { "id": "s2", "name": "סטנדרט (ים)", "type": "sea", "enabled": true,
      "seaRate": 200 }
  ]
}
```

עריכה דרך `/dashboard/v3/factory/config` או API: `POST /api/factory/config`.

---

## 8. Persistence — מה נשמר ב-DB

טבלה: `factory_quote_requests` ([schema](../drizzle/schema.ts)).

עמודות רלוונטיות (JSONB):
- `productSpec` — `FactoryProductSpec` — מה הלקוח ביקש (מידות, כמות, חומר, etc.)
- `factoryResponse` — `FactoryResponse` — מה המפעל החזיר (`unitCostCny`, קרטון, ספק)
- `finalPricing` — `FactoryPricingResult` — מחיר מלא + margin + מולדים, כפי שנשמר ב-FinalizeModal
- `pdfUrl` — לינק ל-PDF הלקוח
- `factoryStatus` — `draft`/`pending`/`received`/`finalized`

**שדה חדש ב-finalPricing:** `moldsTotalCny` + `moldsPerUnitCny`. הצעות ישנות (לפני 2026-06-10) יקבלו `undefined` שם — ה-UI עושה guard.

---

## 9. דוגמה מלאה מקצה לקצה

**תרחיש:** הצעה ל-5,000 שקיות בד עם 80g non-woven, 35×20×40 ס״מ, מפעל Mandy ב-Zhejiang, מחיר ¥1.1/יח׳.

**Step 1 — מקבלים את המחיר ב-WeChat ויוצרים `FactoryQuoteRequest` (status=received).**

**Step 2 — פותחים FinalizeModal, מזינים:**
- שילוח: ים (sea, s2)
- מרג'ין: 60%
- מולדים: ¥2,000

**Step 3 — `priceFactoryQuote` רץ:**
```
moldsPerUnitCny       = 2000 / 5000 = 0.400 ¥/יח׳
unitProductionCny     = 1.1 + 0.4 = 1.5 ¥/יח׳
unitCostUsd           = 1.5 / 7.2 = 0.2083 $/יח׳
unitCost (ILS)        = 0.2083 × 3.7 = ₪0.77/יח׳

totalCartons          = ceil(5000 / 200) = 25
totalWeightKg         = 25 × 14 = 350
totalCbm              = 25 × (50×40×30/1M) = 1.5 m³
shippingPerUnitUsd    = max(1.5, 1) × 200 / 5000 = $0.06/יח׳
unitShipping (ILS)    = 0.06 × 3.7 = ₪0.22/יח׳

unitSellingPrice      = 0.77 × 1.6 + 0.22 = ₪1.46/יח׳
unitProfit            = 0.77 × 0.6 = ₪0.46/יח׳

totalSellingPrice     = ₪7,300
totalCost             = ₪3,850
totalShipping         = ₪1,100
totalProfit           = ₪2,313
```

**Step 4 — לחיצה על "חשב + שמור + הפק PDF":**
- `finalizeQuote()` מריץ את החישוב שוב server-side (truth source)
- מרנדר PDF — הלקוח רואה ₪1.46/יח׳ × 5,000 = ₪7,300
- עדכון `factoryStatus = "finalized"`, `finalPricing = {...}`, `pdfUrl = "..."`
- שולח reconcile של GHL tasks

**Step 5 — הלקוח מקבל לינק ל-PDF ב-WhatsApp.**

---

## 10. Sources of truth — מי הקובץ הסמכותי לכל דבר

| נושא | קובץ |
|---|---|
| נוסחת margin-on-price | `lib/factory/calculator/engine.ts` |
| נוסחת markup-on-cost | `lib/factory/pricing.ts` |
| חישוב שילוח (sea/air) | `lib/factory/pricing.ts::computeShippingPerUnitUsd` + `engine.ts` Step 5 |
| Snap-down של margin matrix | `engine.ts::findClosestPrice` |
| Config schema + defaults | `lib/factory/calculator/constants.ts::DEFAULT_CONFIG` + `drizzle/schema.ts` |
| Live preview API (calculator) | `app/api/factory/quote-preview/route.ts` |
| Finalize API (dashboard) | `app/api/factory/finalize/[id]/route.ts` |
| Finalize API (widget) | `app/api/widget/factory/[id]/finalize/route.ts` |
| Shared finalize logic | `lib/factory/server/finalize.ts` |
| PDF render | `lib/factory/pdf.tsx` |
| Boss-view breakdown | `components/calculator/DetailedBreakdown.tsx` + `lib/factory/breakdown.ts` |

---

## 11. עריכת פרטי המוצר + תמונה ב-FinalizeModal (חדש, 2026-06-12)

מיקום: [`FinalizeModal.tsx`](../app/dashboard/v3/_components/factory/FinalizeModal.tsx) + [`FinalizeModal.widget.tsx`](../components/factory-flow/FinalizeModal.widget.tsx).

כל מה שמופיע ב-PDF ניתן לעריכה בחלון לפני ההפקה:
- שם מוצר (`spec.productName`, ברירת מחדל "שקית אלבדי" — כותרת ה-PDF), מידות (W/H/D), כמות, חומר, הדפסה, גימור, הערות ללקוח (`spec.customerNotes`).
- **כמות היא קלט תמחור** — שינוי שלה מריץ מחדש את `priceFactoryQuote` (משפיע על שילוח/קרטונים).
- העריכות נשלחות כ-`specOverride` ל-finalize, ממוזגות מעל ה-spec, ונשמרות חזרה ל-`productSpec`. מספר ההצעה מוצג בכותרת החלון.

**תמונה (`lib/feishu/media.ts`):**
- מקור: התמונות **מוטמעות** בעמודה D בגיליון Feishu (אובייקט עם `fileToken` + לינק auth-gated). לא קישור ישיר.
- `feishuImageToBlobUrl(fileToken)` מוריד את הקובץ ב-tenant token (`/open-apis/drive/v1/medias/{token}/download`) ומעלה ל-Vercel Blob ציבורי.
- בחלון: משיכה **אוטומטית** בפתיחה אם אין `picUrl` (`POST /api/factory/[id]/pull-image`) + כפתורי "משוך מ-Feishu" / "העלה תמונה" (`POST /api/factory/upload-image`). ה-URL נשמר ב-`spec.picUrl`.
- ב-PDF: `fetchImageDataUri` (ב-`pdf.tsx`) מושך את ה-URL ל-data-URI ומטמיע `<Image>`. כשל במשיכה → מושמט בחן (לא שובר PDF). ה-PDF הסופי נשמר ב-Blob עם `addRandomSuffix` כדי שעדכון תמונה לא יוגש מ-cache ישן.

---

## 12. חישוב משולב — משלוח אחד (חדש, 2026-06-12)

מיקום: [`lib/factory/combined.ts`](../lib/factory/combined.ts) — משותף ל-FinalizeModal ול-`app/api/factory/combine/pdf`.

**הרעיון:** כמה מוצרים שנשלחים יחד = משלוח אחד. השילוח pass-through (אין עליו רווח), ומשלוח אחד **זול** ממשלוחים נפרדים — רצפת 1-CBM נספרת פעם אחת, מדרגות משקל אווירי על המשקל המאוחד. את החיסכון מעבירים ללקוח (הרווח לא משתנה — רק השילוח יורד).

```
combinedShippingIls(totalCbm, totalWeightKg, opt, usdToIls)   ← שילוח כולל לשורה אחת
computeCombined(items, opt, usdToIls) → {
  combinedShipping, separateShipping, shippingSaving,
  totalProduction, totalProfit,           // profit unchanged
  grandTotal = production + profit + combinedShipping,
  overallMarginPct = profit / (production+profit)
}
priceQuoteForCombine(q, config, shipId, marginOverride?)      ← finalPricing אם סופית,
   אחרת מתמחר את factoryResponse לפי margin (matrix snap או override מהסליידר)
```

**הפצת השילוח חזרה למחיר:** ב-`/api/factory/combine/pdf` השילוח המאוחד מתחלק בין המוצרים לפי חלק-נפח (CBM share) ומקופל למחיר ליחידה — כך ה-PDF המשולב מציג מחיר נמוך יותר, **בלי שורת שילוח נפרדת** (כמו ה-PDF הבודד).

**UI:** פאנל "חישוב משולב" ב-FinalizeModal — צ'ק-בוקס לכל הצעה אחרת של הלקוח (כולל `received`), סליידר מרווח לכל מוצר מסומן + סליידר "קבע לכולן", וסיכום משולב חי. ההצעה הנוכחית נכנסת לפי הסליידר הראשי.

> ⚠️ הכוונון בפאנל הוא לתצוגה/חישוב. כדי לשלוח ללקוח את ה-PDF המשולב הזול, ההצעות צריכות להיות **סופיות** (היסטוריה → "אחד ל-PDF אחד" / שליחת WhatsApp). "סיים ושלח משולב" — TODO.

---

## 13. ייבוא מ-Feishu (חדש, 2026-06-12)

מיקום: [`lib/factory/server/import-from-feishu.ts`](../lib/factory/server/import-from-feishu.ts).

מחיקת הצעה = מחיקה מלאה מה-DB, אבל שורת ה-Feishu נשארת. כפתור **"ייבא מ-Feishu"** (ב-`QuotesHistoryView`) סורק את הגיליון (`readAllRows`) ויוצר מחדש כל הצעה שמספר ההצעה שלה (עמודה B) **לא קיים** ב-DB:
- שומר את **אותו מספר הצעה** (לא חדש), `productSpec` (A..J), תשובת המפעל (K..R), והתמונה המוטמעת.
- מספרי הצעה כוללים סיומת revision "-A" — `baseQuoteNo` משווה/שומר לפי הבסיס (`EVLGTP1G-A` → `EVLGTP1G`). זה גם תיקן את התאמת השורה ב-`findRowByQuotationNo` (רענון).
- ליד מותאם לפי **שם מנורמל** (`normName` — חסין גרש ׳/'/׳, רווחים, סימני RTL). שורות שלא הותאמו → **בורר ליד ידני** (`POST /api/factory/import-feishu/assign`).

---

## 14. Open questions / TODO

- [x] **לאחד את הקונבנציות.** ✅ בוצע 2026-06-12 — ה-FinalizeModal עבר ל-margin-on-price כמו המחשבון. עכשיו 40% = 40% מהמחיר בשני המקומות, ואותו אחוז נותן אותו מחיר. ערכי ה-config (`profitMarginByQuantity`) נשארו 40 ומתפרשים כעת כ-margin-on-price בשני המנועים.
- [ ] **מולדים בצד הקטלוג** — קיים גם ב-CalculatorView (margin-on-price), אבל אין שם persistence — הוא רק לתחזית. אם בעתיד נרצה לשמור גם אותם, ה-quote-preview API צריך לשמור את ה-input בנפרד.
- [ ] **VAT** — הציטוט אומר "_לא כולל מע״מ_". כיום אלי מוסיף ידנית בחשבונית. אופציה: להוסיף toggle "כולל מע״מ" בפנל.
- [ ] **שערי החלפה חיים** — היום השער ב-DB ידני. שווה לחבר ל-API שערי בנק ישראל ולעדכן יומית.
