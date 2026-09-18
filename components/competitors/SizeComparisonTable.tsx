"use client";

/**
 * "Pick a size, see every competitor for it" — the view Eli asked for after the
 * card-per-comparison layout turned out to be unreadable ("זה לא ברור בכלל").
 *
 * One row per competitor quote, our own price beside it at the SAME quantity,
 * and the gap. The margin control at the top re-prices our whole column live,
 * so "what if I take 45% instead of 60%" is one drag rather than a recalculation
 * somewhere else.
 *
 * Our number is never invented: each one is labelled with where it came from,
 * and where the estimator refuses (flat shapes — shipping can't be estimated
 * reliably) the cell says so instead of showing a figure.
 *
 * ⚠️ Alignment rule for this table. The page is RTL and every price is a Latin
 * string ("₪1.77"). Putting `direction:"ltr"` on the CELL pushes its content to
 * the left edge while the header stays on the right — that is exactly how the
 * first version came out crooked. So the cell always keeps the page direction
 * and only the number itself is isolated (`<Num>`), which keeps "₪" in front
 * without moving the column.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { gapVerdict, summarize } from "@/lib/competitors/compare";

export interface CompRow {
  id: number;
  product: string;
  competitor: string;
  size: string | null;
  quantity: number | null;
  origin: string | null;
  gsm: number | null;
  logoColors: number | null;
  lamination: string | null;
  shippingIncluded: boolean | null;
  leadTimeText: string | null;
  competitorLeadDays: number | null;
  competitorPrice: number | null;
  competitorPlateFee: number | null;
  competitorPlateFeeCurrency: string | null;
  /** "order" = one fee for the whole job, not per colour (פרינט טק). */
  competitorPlatePer: string | null;
  handles: string | null;
  notes: string | null;
}

interface OurRow {
  id: number;
  unitIls: number | null;
  /** Our plates for this row — ¥1,000 per colour, once. */
  moldsIls: number | null;
  /** unit × quantity + plates. */
  totalIls: number | null;
  leadDays: number | null;
  source: "calculator" | "estimator" | "proxy" | null;
  proxyLabel?: string;
  proxyAreaPct?: number;
  proxyVolPct?: number;
  refused?: string;
}

const SOURCE_SHORT: Record<string, string> = {
  calculator: "מדויק",
  estimator: "משוער",
  proxy: "לפי מידה דומה",
};

const nis = (n: number) => "₪" + n.toFixed(2);
const nisWhole = (n: number) => "₪" + Math.round(n).toLocaleString("he-IL");

/**
 * What the whole order costs THEM — unit × quantity, plus the plates when the
 * competitor charges them separately.
 *
 * Apples to apples has to include the plates, and the three quotes we hold
 * treat them three different ways: חביב folds the plate into the per-unit
 * price, גאלרי באג adds ₪500 per colour on top, and our own per-unit price
 * carries no plate at all. Comparing the unit prices alone compares three
 * different things (Eli, 02/09: "צריך להשוות תפוחים לתפוחים").
 */
function theirTotal(r: CompRow, withPlates: boolean): number | null {
  if (r.competitorPrice == null || !r.quantity) return null;
  const colors = r.logoColors ?? 1;
  // A USD plate is left out rather than converted at a rate we would be
  // inventing here — the cell still shows it, so nothing is hidden.
  // Most quote a plate per colour; פרינט טק charge ₪880 once for the whole
  // size. Multiplying that by the colour count invents ₪880 of cost.
  const perOrder = r.competitorPlatePer === "order";
  const plates =
    withPlates && r.competitorPlateFee != null && r.competitorPlateFeeCurrency !== "USD"
      ? r.competitorPlateFee * (perOrder ? 1 : colors)
      : 0;
  return r.competitorPrice * r.quantity + plates;
}

/**
 * Where the bag is made — and therefore how long the customer waits. Eli thinks
 * in exactly these two buckets: local is weeks, overseas is about three months.
 * Origin is the primary signal; the quoted lead time is the fallback for a row
 * logged without one.
 */
type OriginBucket = "IL" | "CN";

function bucketOf(row: CompRow): OriginBucket {
  const o = row.origin ?? "";
  if (o.includes("ישראל")) return "IL";
  if (o) return "CN"; // סין / any other overseas origin
  return (row.competitorLeadDays ?? 0) > 30 ? "CN" : "IL";
}

const ORIGIN_TABS: { id: "all" | OriginBucket; label: string; hint: string }[] = [
  { id: "all", label: "הכל", hint: "" },
  { id: "IL", label: "ייצור בארץ", hint: "עד חודש" },
  { id: "CN", label: "ייצור בחו״ל", hint: "כ-3 חודשים" },
];


/**
 * What makes this row different from the row above it.
 *
 * Colours and lamination move the price more than anything else a competitor
 * varies, and both were invisible in the table until quotes started arriving
 * as matrices (חביב sent ten rows for one bag). Handles appear only when they
 * are not the plain default, so the cell stays short.
 */
function specOf(r: CompRow): string {
  const parts: string[] = [];
  const colors = r.logoColors ?? 1;
  parts.push(colors === 1 ? "צבע אחד" : `${colors} צבעים`);
  const lam = (r.lamination ?? "").trim();
  parts.push(lam && !/^בלי|^ללא/.test(lam) ? `למינציה ${lam === "מבריקה" ? "" : lam}`.trim() : "ללא למינציה");
  const handles = (r.handles ?? "").trim();
  if (handles && handles !== "גופיה") parts.push(handles);
  return parts.join(" · ");
}

/** A Latin/number string inside an RTL cell — isolated so "₪" stays in front. */
function Num({ children, bold }: { children: React.ReactNode; bold?: boolean }) {
  return (
    <span
      style={{
        direction: "ltr",
        unicodeBidi: "isolate",
        display: "inline-block",
        fontVariantNumeric: "tabular-nums",
        fontWeight: bold ? 600 : undefined,
      }}
    >
      {children}
    </span>
  );
}

export default function SizeComparisonTable({
  rows,
  token,
  onDelete,
}: {
  rows: CompRow[];
  token: string;
  /** Delete one logged quote (the screen owns the undo window). */
  onDelete?: (id: number) => void;
}) {
  /** Which row is asking "are you sure?" — two taps to delete, never one. */
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [origin, setOrigin] = useState<"all" | OriginBucket>("all");
  /**
   * Which row's note is open.
   *
   * The notes carry what makes a row trustworthy or not — "80 גרם, אלי בירר
   * מולם", "לא נמסר: סוג הידית", "מע״מ לא צוין בהצעה" — and they were visible
   * only in the cards view, which is not the one anyone opens. A comparison
   * whose caveats live on another screen is a comparison that will be quoted
   * without them. Tap to open, because this is read on a phone.
   */
  const [openNote, setOpenNote] = useState<number | null>(null);
  /**
   * Whether the printing plates count in the totals. OFF by default.
   *
   * Our ¥1,000 per colour is negotiating room Eli gives back, not a cost he
   * defends (Eli 02/09: "זה רק מחיר מיקוח"), so counting it against a
   * competitor makes us look dearer than we will actually be at the close. The
   * toggle is here rather than a fixed rule because the plates ARE real money
   * on a small order, where they can be a tenth of the bill.
   */
  const [withPlates, setWithPlates] = useState(false);

  const originCounts = useMemo(() => {
    const c = { all: rows.length, IL: 0, CN: 0 };
    for (const r of rows) c[bucketOf(r)]++;
    return c;
  }, [rows]);

  const inOrigin = useMemo(
    () => (origin === "all" ? rows : rows.filter((r) => bucketOf(r) === origin)),
    [rows, origin],
  );

  const sizes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of inOrigin) {
      const s = (r.size ?? "").trim();
      if (s) seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [inOrigin]);

  const [size, setSize] = useState<string>("");
  // Filtering can remove the selected size entirely — fall back to the biggest
  // group that survived rather than rendering an empty table.
  useEffect(() => {
    if (!sizes.length) return;
    if (!sizes.some(([s]) => s === size)) setSize(sizes[0][0]);
  }, [sizes, size]);

  const [margin, setMargin] = useState<number | null>(null);
  const [defaultMargin, setDefaultMargin] = useState<number | null>(null);
  const [ours, setOurs] = useState<Map<number, OurRow>>(new Map());
  const [pricing, setPricing] = useState(true);
  const [priceErr, setPriceErr] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-price our column. Debounced — the margin control is a slider.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setPricing(true);
      setPriceErr(null);
      try {
        const qs = new URLSearchParams({ widget_token: token });
        if (margin != null) qs.set("margin", String(margin));
        const res = await fetch(`/api/widget/competitor-prices/our-side?${qs}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "pricing failed");
        setOurs(new Map<number, OurRow>(data.rows.map((r: OurRow) => [r.id, r])));
        if (defaultMargin == null) setDefaultMargin(data.defaultMargin);
        if (margin == null) setMargin(data.margin);
      } catch (e) {
        setPriceErr(e instanceof Error ? e.message : "pricing failed");
      } finally {
        setPricing(false);
      }
    }, margin == null ? 0 : 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // defaultMargin intentionally excluded — it is set once from the response.
  }, [margin, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(
    () =>
      inOrigin
        .filter((r) => (r.size ?? "").trim() === size)
        .sort((a, b) => (a.quantity ?? 0) - (b.quantity ?? 0)),
    [inOrigin, size],
  );

  const cheapest = useMemo(() => {
    const prices = visible.map((r) => r.competitorPrice).filter((p): p is number => p != null);
    return prices.length ? Math.min(...prices) : null;
  }, [visible]);

  const spec = visible[0];
  // Only what every row in this size actually shares. Colours, lamination and
  // handles vary row to row and are shown per row instead.
  const specLine = spec
    ? [
        (spec.size?.split(/[×x*]/).length ?? 0) > 2 ? "תלת־ממדי" : "שטוח",
        spec.gsm ? `${spec.gsm} גרם` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  /** Both order totals + the verdict for one row (plates per the toggle). */
  const compare = (r: CompRow) => {
    const mine = ours.get(r.id);
    const theirsTotal = theirTotal(r, withPlates);
    // `totalIls` from the API always carries our plates; without them the
    // order is simply unit × quantity.
    const ourTotal = withPlates
      ? mine?.totalIls ?? null
      : mine?.unitIls != null && r.quantity
        ? mine.unitIls * r.quantity
        : null;
    return { mine, theirsTotal, ourTotal, verdict: gapVerdict(theirsTotal, ourTotal) };
  };

  // Headline numbers — across everything logged (in the chosen origin), from
  // the LIVE price of our side.
  const overall = useMemo(() => summarize(inOrigin.map((r) => compare(r).verdict)), [inOrigin, ours, withPlates]); // eslint-disable-line react-hooks/exhaustive-deps
  const here = useMemo(() => summarize(visible.map((r) => compare(r).verdict)), [visible, ours, withPlates]); // eslint-disable-line react-hooks/exhaustive-deps
  const suppliers = new Set(rows.map((r) => r.competitor.trim())).size;
  const loadingOurs = pricing && ours.size === 0;

  // Group this size's quotes by supplier (חביב sent ten rows for one bag);
  // the name shows once per group.
  const grouped = useMemo(
    () =>
      [...visible].sort(
        (a, b) => a.competitor.localeCompare(b.competitor, "he") || (a.quantity ?? 0) - (b.quantity ?? 0),
      ),
    [visible],
  );

  return (
    <div>
      <div className="ux-kpis">
        <div className="ux-kpi">
          <div className="k">השוואות</div>
          <div className="v">{rows.length}</div>
          <div className="e">מ־<b>{suppliers}</b> ספקים</div>
        </div>
        <div className="ux-kpi">
          <div className="k">אנחנו זולים יותר</div>
          <div className="v">{loadingOurs ? "…" : overall.compared ? `${overall.cheaper} מתוך ${overall.compared}` : "—"}</div>
          <div className="e">{origin === "all" ? "בכל ההשוואות שיש לנו מחיר" : origin === "IL" ? "מול ייצור בארץ" : "מול ייצור בחו״ל"}</div>
        </div>
        <div className="ux-kpi">
          <div className="k">חיסכון ממוצע ללקוח</div>
          <div className="v">{loadingOurs || overall.avgSaving == null ? "—" : nisWhole(Math.abs(overall.avgSaving))}</div>
          <div className="e">{overall.avgSaving == null ? "אין עדיין מחיר שלנו" : overall.avgSaving >= 0 ? "להזמנה, לטובתנו" : "להזמנה — אנחנו יקרים יותר"}</div>
        </div>
        <div className="ux-kpi">
          <div className="k">אספקה</div>
          <div className="v" style={{ fontSize: 20 }}>{origin === "IL" ? "הם מהירים" : origin === "CN" ? "דומה" : "תלוי"}</div>
          <div className="e">בארץ: שבועות · חו״ל ואצלנו: כ־3 חודשים</div>
        </div>
      </div>

      <div className="competitor-bar">
        <div className="ux-chips" role="group" aria-label="איפה מייצרים">
          {ORIGIN_TABS.map((t) => {
            const n = originCounts[t.id];
            if (t.id !== "all" && n === 0) return null;
            return (
              <button key={t.id} type="button" className="ux-chip" aria-pressed={t.id === origin} onClick={() => setOrigin(t.id)}>
                {t.label} <span className="tnum">{n}</span>
              </button>
            );
          })}
        </div>
        <label className="ux-select">
          מידה
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            {sizes.map(([s, n]) => (
              <option key={s} value={s}>{s} · {n} הצעות</option>
            ))}
          </select>
        </label>
      </div>

      <details className="ux-panel ux-fold competitor-scenario" style={{ marginBottom: 18 }}>
        <summary style={{ color: "var(--lux-ink)" }}>
          <span>
            תרחיש: רווח <b className="tnum">{margin ?? "—"}%</b> · {withPlates ? "כולל גלופות" : "בלי גלופות"}
            <span className="ux-sr"> — לחץ לשינוי</span>
          </span>
          <span className="flex items-center gap-2" style={{ color: "var(--lux-muted)", fontSize: 13 }}>
            שנה <ChevronDown className="size-4 chev" aria-hidden />
          </span>
        </summary>
        <div style={{ paddingTop: 8 }}>
          <label htmlFor="comp-margin" style={{ fontSize: 14, color: "var(--lux-muted)" }}>
            אחוז הרווח שלנו — משנה רק את העמודה "אנחנו"
          </label>
          <input
            id="comp-margin"
            type="range"
            min={0}
            max={85}
            step={1}
            value={margin ?? 60}
            onChange={(e) => setMargin(Number(e.target.value))}
            className="lux-range competitor-range"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="competitor-check">
              <input type="checkbox" checked={withPlates} onChange={(e) => setWithPlates(e.target.checked)} />
              לכלול גלופות בסה״כ
            </label>
            {defaultMargin != null && margin !== defaultMargin && (
              <button type="button" className="ux-btn" onClick={() => setMargin(defaultMargin)}>
                חזרה ל־{defaultMargin}%
              </button>
            )}
          </div>
        </div>
      </details>

      {priceErr && (
        <p className="ux-note" style={{ color: "#f0c0c0", marginTop: 0 }} role="alert">
          לא הצלחתי לחשב את הצד שלנו ({priceErr}). המחירים שלהם נכונים; נסה לרענן.
        </p>
      )}

      <div className="ux-sechead">
        <h2>
          <span className="ltr">{size}</span>
          <span style={{ fontSize: 14, color: "var(--lux-muted)", fontWeight: 400, marginInlineStart: 10 }}>{specLine}</span>
        </h2>
        <span className="hint" aria-live="polite">
          {loadingOurs || pricing
            ? "מחשב את המחיר שלנו…"
            : here.compared
              ? `במידה הזו: זולים ב־${here.cheaper} מתוך ${here.compared}`
              : ""}
        </span>
      </div>

      <div className="competitor-table-wrap">
        <table className="competitor-table">
          <caption className="ux-sr">הצעות מתחרים במידה {size}, מול המחיר שלנו לאותה כמות ומפרט</caption>
          <thead>
            <tr>
              <th scope="col">ספק</th>
              <th scope="col">כמות · מפרט</th>
              <th scope="col">שלהם</th>
              <th scope="col" className="mine">אנחנו</th>
              <th scope="col">מי זול יותר</th>
              <th scope="col"><span className="ux-sr">פרטים</span></th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((r, i) => {
              const { mine, theirsTotal, ourTotal, verdict } = compare(r);
              const firstOfSupplier = i === 0 || grouped[i - 1].competitor !== r.competitor;
              const isCheapest = r.competitorPrice != null && cheapest != null && r.competitorPrice === cheapest;
              const open = openNote === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className={firstOfSupplier ? "group-start" : undefined}>
                    <td data-label="ספק" className="sup">
                      {/* the name repeats (dimmed) so a phone card still says who */}
                      <span className={firstOfSupplier ? undefined : "repeat"}>{r.competitor}</span>
                      <small>{r.origin ?? (bucketOf(r) === "IL" ? "ישראל" : "חו״ל")}{isCheapest ? " · הזול במידה הזו" : ""}</small>
                    </td>
                    <td data-label="כמות · מפרט">
                      <span className="tnum">{r.quantity?.toLocaleString("he-IL") ?? "—"} יח׳</span>
                      <small>{specOf(r)}</small>
                    </td>
                    <td data-label="שלהם">
                      <Num>{r.competitorPrice != null ? nis(r.competitorPrice) : "—"}</Num>
                      {theirsTotal != null && <small><Num>{nisWhole(theirsTotal)}</Num> להזמנה</small>}
                    </td>
                    <td data-label="אנחנו" className="mine">
                      {loadingOurs ? (
                        <span className="ux-skel-inline" aria-label="מחשב" />
                      ) : mine?.unitIls != null ? (
                        <>
                          <Num bold>{nis(mine.unitIls)}</Num>
                          <small>
                            {ourTotal != null && <><Num>{nisWhole(ourTotal)}</Num> להזמנה · </>}
                            {SOURCE_SHORT[mine.source ?? ""] ?? ""}
                          </small>
                          {mine.source === "proxy" && mine.proxyLabel && (
                            <small className="proxy">
                              לפי <Num>{mine.proxyLabel}</Num> (<Num>{`${(mine.proxyAreaPct ?? 0) > 0 ? "+" : ""}${mine.proxyAreaPct}%`}</Num> בד)
                            </small>
                          )}
                        </>
                      ) : (
                        <small title={mine?.refused ?? ""}>{mine?.refused ? "צריך מחיר מהמפעל" : "—"}</small>
                      )}
                    </td>
                    <td data-label="מי זול יותר">
                      {verdict ? (
                        <span className="ux-pill" data-tone={verdict.tone === "good" ? "good" : verdict.tone === "bad" ? "stop" : "idle"}>
                          {verdict.text}
                        </span>
                      ) : (
                        <small>{loadingOurs ? "" : "אין השוואה"}</small>
                      )}
                    </td>
                    <td className="more">
                      <button
                        type="button"
                        className="ux-btn"
                        aria-expanded={open}
                        aria-controls={`comp-more-${r.id}`}
                        onClick={() => setOpenNote(open ? null : r.id)}
                      >
                        {open ? "סגור" : "פרטים"}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="details" id={`comp-more-${r.id}`}>
                      <td colSpan={6}>
                        <dl>
                          <div><dt>גלופה</dt><dd><Num>{r.competitorPlateFee == null ? "לא נמסר" : (r.competitorPlateFeeCurrency === "USD" ? "$" : "₪") + Math.round(r.competitorPlateFee) + (r.competitorPlatePer === "order" ? " להזמנה" : " לצבע")}</Num></dd></div>
                          <div><dt>משלוח</dt><dd>{r.shippingIncluded === true ? "כולל" : r.shippingIncluded === false ? "לא כולל" : "לא נמסר"}</dd></div>
                          <div><dt>אספקה</dt><dd>{r.leadTimeText ?? "לא נמסר"}</dd></div>
                          {mine?.leadDays != null && <div><dt>אצלנו</dt><dd>כ־{mine.leadDays} ימים</dd></div>}
                        </dl>
                        {r.notes && <p><b>מה נמסר: </b>{r.notes}</p>}
                        {onDelete && (
                          <div className="competitor-delete">
                            {confirmId === r.id ? (
                              <>
                                <span>למחוק את ההצעה של {r.competitor} ({r.quantity?.toLocaleString("he-IL")} יח׳)?</span>
                                <button type="button" className="ux-btn danger" onClick={() => { setConfirmId(null); setOpenNote(null); onDelete(r.id); }}>
                                  <Trash2 className="size-4" aria-hidden /> כן, מחק
                                </button>
                                <button type="button" className="ux-btn" onClick={() => setConfirmId(null)}>ביטול</button>
                              </>
                            ) : (
                              <button type="button" className="ux-btn danger" onClick={() => setConfirmId(r.id)}>
                                <Trash2 className="size-4" aria-hidden /> מחק הצעה
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="ux-fold" style={{ marginTop: 14 }}>
        <summary>
          <span>איך מחשבים את ההשוואה</span>
          <ChevronDown className="size-4 chev" aria-hidden />
        </summary>
        <p className="competitor-method">
          הצד שלנו מחושב חי במחשבון, במשלוח ימי, לאותה כמות ולאותו מפרט. ההשוואה היא על <b>סה״כ ההזמנה</b> — מה שהלקוח משלם.
          {withPlates
            ? " הגלופות נספרות: אצלנו ¥1,000 לצבע, אצלם לפי מה שמסרו."
            : " הגלופות לא נספרות — הן מרווח מיקוח, לא מחיר שנעמוד עליו."}{" "}
          מי שכולל את הגלופה בתוך המחיר ליחידה (חביב) — היא בפנים בכל מקרה.
          «מדויק» = המידה בקטלוג. «משוער» = מודל האומדן. «לפי מידה דומה» = אין לנו מחיר למידה הזו, אז זה המחיר של המידה הקרובה, עם כמה בד יש בה יותר או פחות.
          «צריך מחיר מהמפעל» = לא ניתן לחשב, ולא נמציא מספר.
          {origin === "IL" && " מול ייצור בארץ ההשוואה היא מחיר מול זמן — הם מספקים בשבועות, אנחנו מסין בכ־3 חודשים."}
        </p>
      </details>
    </div>
  );
}
