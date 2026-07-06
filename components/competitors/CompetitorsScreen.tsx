"use client";

/**
 * "מחיר מתחרים" — competitor price + lead-time intelligence.
 *
 * Eli logs each competing quote he runs into with the SAME spec features we
 * price by (size / handles / logo colours / lamination / plate fee), so the
 * comparison against our own offer is apples-to-apples. The plate fee is a
 * one-time-but-real cost, so it's folded into a "total incl. plates" line.
 *
 * Long lists stay tidy: rows group by product family into collapsible cards
 * (▸/▾). Data lives in `competitor_prices`; all I/O goes through
 * /api/widget/competitor-prices. Presentation follows the Silent-Luxury theme.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Trash2,
  Plus,
  TrendingDown,
  TrendingUp,
  Clock,
  ChevronDown,
  ChevronLeft,
} from "lucide-react";
import { LuxShell, LuxTitle, LuxAccent, LuxCTA, LuxStat } from "@/components/widget-ui/lux";

interface Row {
  id: number;
  product: string;
  quantity: number | null;
  size: string | null;
  handles: string | null;
  logoColors: number | null;
  lamination: string | null;
  ourPrice: number | null;
  ourLeadDays: number | null;
  ourPlateFee: number | null;
  competitor: string;
  competitorPrice: number | null;
  competitorLeadDays: number | null;
  competitorPlateFee: number | null;
  leadSid: string | null;
  notes: string | null;
  createdAt: string;
}

// Unit prices are decimals (₪1.60); totals are big and rounded (₪16,000).
const nisUnit = (n: number) => "₪" + n.toFixed(2);
const nisTotal = (n: number) => "₪" + Math.round(n).toLocaleString("he-IL");

// plate fee is per colour → one-time cost = fee × colours (colours default 1).
const plateTotal = (fee: number | null, colors: number | null): number | null =>
  fee == null ? null : fee * (colors && colors > 0 ? colors : 1);
// full order cost incl. one-time plates.
const orderTotal = (
  price: number | null,
  qty: number | null,
  plates: number | null
): number | null => (price == null || qty == null ? null : price * qty + (plates ?? 0));

const HANDLE_OPTIONS = ["", "בלי", "חיצונית", "פנימית", "חיצונית + פנימית"];
const LAMINATION_OPTIONS = ["", "בלי", "מבריקה", "מט"];

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--lux-line)",
  borderRadius: 7,
  color: "var(--lux-ink)",
  fontSize: 13.5,
  padding: "9px 11px",
  outline: "none",
  fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--lux-muted)",
  marginBottom: 5,
  display: "block",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

/** Small spec chip (size / handles / colours / lamination). */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        color: "var(--lux-muted)",
        padding: "2px 8px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.03)",
        boxShadow: "inset 0 0 0 1px var(--lux-line)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function specChips(row: Row): string[] {
  const out: string[] = [];
  if (row.size) out.push(`מידה ${row.size}`);
  if (row.handles) out.push(`ידית ${row.handles}`);
  if (row.logoColors != null) out.push(`${row.logoColors} צבע${row.logoColors === 1 ? "" : "ים"} בלוגו`);
  if (row.lamination) out.push(`למינציה ${row.lamination}`);
  return out;
}

/** Small coloured pill for a delta verdict. */
function Badge({
  tone,
  icon,
  children,
}: {
  tone: "good" | "bad" | "mixed";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const palette = {
    good: { fg: "#a8c0a0", ring: "rgba(168,192,160,0.28)", bg: "rgba(168,192,160,0.10)" },
    bad: { fg: "#e8b4b4", ring: "rgba(232,180,180,0.28)", bg: "rgba(232,180,180,0.10)" },
    mixed: { fg: "#d6c4ac", ring: "rgba(214,196,172,0.28)", bg: "rgba(214,196,172,0.10)" },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 999,
        color: palette.fg,
        background: palette.bg,
        boxShadow: `inset 0 0 0 1px ${palette.ring}`,
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {children}
    </span>
  );
}

/** One side of the head-to-head (us / competitor) — price, plates, total, lead. */
function SideColumn({
  who,
  accent,
  price,
  days,
  plateFee,
  colors,
  qty,
}: {
  who: string;
  accent: boolean;
  price: number | null;
  days: number | null;
  plateFee: number | null;
  colors: number | null;
  qty: number | null;
}) {
  const plates = plateTotal(plateFee, colors);
  const total = orderTotal(price, qty, plates);
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: "11px 13px",
        borderRadius: 7,
        background: accent ? "rgba(214,196,172,0.06)" : "rgba(255,255,255,0.02)",
        boxShadow: `inset 0 0 0 1px ${accent ? "rgba(214,196,172,0.16)" : "var(--lux-line)"}`,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: accent ? "var(--lux-champagne)" : "var(--lux-muted)",
          fontWeight: 600,
          marginBottom: 6,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {who}
      </div>
      <div style={{ fontSize: 19, fontWeight: 600, color: "var(--lux-ink)" }}>
        {price != null ? nisUnit(price) : "—"}
        {price != null && <span style={{ fontSize: 11, color: "var(--lux-muted)", fontWeight: 400 }}> / יח׳</span>}
      </div>

      {/* plate fee — highlighted as a real, if one-time, cost */}
      <div style={{ fontSize: 11.5, color: "var(--lux-muted)", marginTop: 6, lineHeight: 1.5 }}>
        {plateFee != null ? (
          <>
            גלופות {nisTotal(plateFee)}/צבע
            {plates != null && colors ? ` · ${nisTotal(plates)} חד-פעמי` : " · חד-פעמי"}
          </>
        ) : (
          <span style={{ opacity: 0.6 }}>גלופות —</span>
        )}
      </div>

      {/* total incl. plates when we know unit price + qty */}
      {total != null && (
        <div style={{ fontSize: 12.5, color: "var(--lux-ink)", marginTop: 4, fontWeight: 600 }}>
          סה״כ {nisTotal(total)}
          <span style={{ fontSize: 10.5, color: "var(--lux-muted)", fontWeight: 400 }}> (כולל גלופות)</span>
        </div>
      )}

      <div
        style={{
          fontSize: 12,
          color: "var(--lux-muted)",
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Clock size={12} strokeWidth={1.75} />
        {days != null ? `${days} ימי אספקה` : "אספקה לא ידועה"}
      </div>
    </div>
  );
}

/** One competitor comparison card. */
function ComparisonCard({ row, onDelete }: { row: Row; onDelete: (id: number) => void }) {
  // positive priceDiff → competitor pricier → we win.
  const priceKnown = row.ourPrice != null && row.competitorPrice != null;
  const priceDiff = priceKnown ? row.competitorPrice! - row.ourPrice! : null;
  const pricePct =
    priceKnown && row.ourPrice ? Math.round((Math.abs(priceDiff!) / row.ourPrice!) * 100) : null;
  const weCheaper = priceDiff != null ? priceDiff >= 0 : null;

  const leadKnown = row.ourLeadDays != null && row.competitorLeadDays != null;
  const leadDiff = leadKnown ? row.competitorLeadDays! - row.ourLeadDays! : null;
  const weFaster = leadDiff != null ? leadDiff >= 0 : null;

  let verdict: { tone: "good" | "bad" | "mixed"; text: string } | null = null;
  if (weCheaper != null && weFaster != null) {
    if (weCheaper && weFaster) verdict = { tone: "good", text: "מנצחים — זולים ומהירים יותר" };
    else if (!weCheaper && !weFaster) verdict = { tone: "bad", text: "מפסידים — יקרים ואיטיים יותר" };
    else if (!weCheaper && weFaster) verdict = { tone: "mixed", text: "יקרים אך מהירים — הפרמיה מוצדקת" };
    else verdict = { tone: "mixed", text: "זולים אך איטיים — שווה לבדוק אספקה" };
  } else if (weCheaper != null) {
    verdict = weCheaper ? { tone: "good", text: "זולים יותר" } : { tone: "bad", text: "יקרים יותר" };
  } else if (weFaster != null) {
    verdict = weFaster ? { tone: "good", text: "מהירים יותר" } : { tone: "bad", text: "איטיים יותר" };
  }

  const chips = specChips(row);

  return (
    <div
      style={{
        background: "var(--lux-card)",
        borderRadius: 8,
        boxShadow: "inset 0 0 0 1px var(--lux-line)",
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: chips.length ? 8 : 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--lux-ink)" }}>
          מול {row.competitor}
        </div>
        <button
          onClick={() => onDelete(row.id)}
          title="מחק"
          style={{ background: "transparent", border: "none", color: "var(--lux-muted)", cursor: "pointer", padding: 4, display: "flex" }}
        >
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      </div>

      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {chips.map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <SideColumn
          who="אנחנו — אלבדי"
          accent
          price={row.ourPrice}
          days={row.ourLeadDays}
          plateFee={row.ourPlateFee}
          colors={row.logoColors}
          qty={row.quantity}
        />
        <SideColumn
          who={row.competitor}
          accent={false}
          price={row.competitorPrice}
          days={row.competitorLeadDays}
          plateFee={row.competitorPlateFee}
          colors={row.logoColors}
          qty={row.quantity}
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
        {verdict && <Badge tone={verdict.tone}>{verdict.text}</Badge>}
        {priceKnown && pricePct != null && (
          <Badge tone={weCheaper ? "good" : "bad"} icon={weCheaper ? <TrendingDown size={13} /> : <TrendingUp size={13} />}>
            {weCheaper ? `זולים ב-${pricePct}%` : `יקרים ב-${pricePct}%`}
          </Badge>
        )}
        {leadKnown && leadDiff != null && (
          <Badge tone={weFaster ? "good" : "bad"} icon={<Clock size={12} />}>
            {leadDiff === 0 ? "אותה אספקה" : weFaster ? `מהירים ב-${Math.abs(leadDiff)} ימים` : `איטיים ב-${Math.abs(leadDiff)} ימים`}
          </Badge>
        )}
        {!priceKnown && (
          <span style={{ fontSize: 11.5, color: "var(--lux-muted)", fontStyle: "italic" }}>
            הזן את המחיר שלנו כדי לראות השוואה מלאה
          </span>
        )}
      </div>

      {row.notes && (
        <div style={{ fontSize: 12.5, color: "var(--lux-muted)", marginTop: 10, lineHeight: 1.5 }}>
          {row.notes}
        </div>
      )}
    </div>
  );
}

const EMPTY_FORM = {
  product: "",
  size: "",
  handles: "",
  logoColors: "",
  lamination: "",
  quantity: "",
  competitor: "",
  competitorPrice: "",
  competitorLeadDays: "",
  competitorPlateFee: "",
  ourPrice: "",
  ourLeadDays: "",
  ourPlateFee: "",
  notes: "",
};

export default function CompetitorsScreen({
  token,
  leadSid,
}: {
  token: string;
  leadSid: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [showForm, setShowForm] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const qs = `widget_token=${encodeURIComponent(token)}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/widget/competitor-prices?${qs}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "load failed");
      setRows(data.rows as Row[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    void load();
  }, [load]);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.product.trim() || !form.competitor.trim()) {
      setError("צריך למלא לפחות מוצר ושם מתחרה");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/widget/competitor-prices?${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, leadSid: leadSid || null }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "save failed");
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    setRows((r) => r.filter((x) => x.id !== id)); // optimistic
    try {
      await fetch(`/api/widget/competitor-prices/${id}?${qs}`, { method: "DELETE" });
    } catch {
      void load();
    }
  };

  // Group rows by product family (Eli organizes "by product / spec").
  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const key = r.product.trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries());
  }, [rows]);

  const toggle = (k: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // Headline stats: on how many head-to-heads are we cheaper / faster.
  const stats = useMemo(() => {
    let priceN = 0, cheaper = 0, leadN = 0, faster = 0;
    for (const r of rows) {
      if (r.ourPrice != null && r.competitorPrice != null) {
        priceN++;
        if (r.ourPrice <= r.competitorPrice) cheaper++;
      }
      if (r.ourLeadDays != null && r.competitorLeadDays != null) {
        leadN++;
        if (r.ourLeadDays <= r.competitorLeadDays) faster++;
      }
    }
    return {
      total: rows.length,
      cheaperPct: priceN ? Math.round((cheaper / priceN) * 100) : null,
      fasterPct: leadN ? Math.round((faster / leadN) * 100) : null,
    };
  }, [rows]);

  return (
    <LuxShell>
      <LuxTitle
        overline="— Competitor intel"
        subtitle="כל פעם שאתה נתקל בהצעה מתחרה — תעד אותה כאן עם אותם מאפיינים שאנחנו מתמחרים, ותדע בדיוק איפה אתה עומד: מחיר, גלופות וזמן אספקה."
        aside={
          <LuxCTA variant="champagne" onClick={() => setShowForm((v) => !v)}>
            <Plus size={15} strokeWidth={2} style={{ marginInlineEnd: 5, verticalAlign: "-2px" }} />
            {showForm ? "סגור" : "מחיר מתחרה חדש"}
          </LuxCTA>
        }
      >
        מחיר <LuxAccent>מתחרים</LuxAccent>.
      </LuxTitle>

      {/* headline stats */}
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <LuxStat value={stats.total} label="השוואות" />
        <LuxStat
          value={stats.cheaperPct != null ? `${stats.cheaperPct}%` : "—"}
          label="זולים יותר"
          tone={stats.cheaperPct != null && stats.cheaperPct >= 50 ? "success" : "default"}
        />
        <LuxStat
          value={stats.fasterPct != null ? `${stats.fasterPct}%` : "—"}
          label="מהירים יותר"
          tone={stats.fasterPct != null && stats.fasterPct >= 50 ? "success" : "default"}
        />
      </div>

      {/* add form */}
      {showForm && (
        <div
          style={{
            background: "var(--lux-card)",
            borderRadius: 8,
            boxShadow: "inset 0 0 0 1px var(--lux-line)",
            padding: "18px 20px",
            marginBottom: 20,
          }}
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
              <Field label="מוצר (משפחה — למשל: תיק אל-בד שחור)">
                <input style={inputStyle} value={form.product} onChange={set("product")} placeholder="שם המוצר" />
              </Field>
              <Field label="שם המתחרה">
                <input style={inputStyle} value={form.competitor} onChange={set("competitor")} placeholder="למשל: יורם אריזות" />
              </Field>
            </div>

            {/* structured spec — same features we price by */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                padding: "14px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.02)",
                boxShadow: "inset 0 0 0 1px var(--lux-line)",
              }}
            >
              <div style={{ gridColumn: "1 / -1", fontSize: 12, fontWeight: 600, color: "var(--lux-muted)" }}>
                מפרט
              </div>
              <Field label="מידה (רוחב×גובה×עומק)">
                <input style={inputStyle} value={form.size} onChange={set("size")} placeholder="31×37×17" />
              </Field>
              <Field label="כמות">
                <input style={inputStyle} value={form.quantity} onChange={set("quantity")} inputMode="numeric" placeholder="10000" />
              </Field>
              <Field label="ידית">
                <select style={inputStyle} value={form.handles} onChange={set("handles")}>
                  {HANDLE_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o || "— בחר —"}</option>
                  ))}
                </select>
              </Field>
              <Field label="צבעים בלוגו">
                <input style={inputStyle} value={form.logoColors} onChange={set("logoColors")} inputMode="numeric" placeholder="1" />
              </Field>
              <Field label="למינציה">
                <select style={inputStyle} value={form.lamination} onChange={set("lamination")}>
                  {LAMINATION_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o || "— בחר —"}</option>
                  ))}
                </select>
              </Field>
            </div>

            {/* our side */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
                padding: "14px",
                borderRadius: 8,
                background: "rgba(214,196,172,0.05)",
                boxShadow: "inset 0 0 0 1px rgba(214,196,172,0.14)",
              }}
            >
              <div style={{ gridColumn: "1 / -1", fontSize: 12, fontWeight: 600, color: "var(--lux-champagne)" }}>
                אנחנו — אלבדי (אפשר להשלים אחר כך)
              </div>
              <Field label="מחיר ליח' (₪)">
                <input style={inputStyle} value={form.ourPrice} onChange={set("ourPrice")} inputMode="decimal" placeholder="0" />
              </Field>
              <Field label="גלופה לצבע (₪)">
                <input style={inputStyle} value={form.ourPlateFee} onChange={set("ourPlateFee")} inputMode="decimal" placeholder="0" />
              </Field>
              <Field label="אספקה (ימים)">
                <input style={inputStyle} value={form.ourLeadDays} onChange={set("ourLeadDays")} inputMode="numeric" placeholder="90" />
              </Field>
            </div>

            {/* competitor side */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
                padding: "14px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.02)",
                boxShadow: "inset 0 0 0 1px var(--lux-line)",
              }}
            >
              <div style={{ gridColumn: "1 / -1", fontSize: 12, fontWeight: 600, color: "var(--lux-muted)" }}>
                המתחרה
              </div>
              <Field label="מחיר ליח' (₪)">
                <input style={inputStyle} value={form.competitorPrice} onChange={set("competitorPrice")} inputMode="decimal" placeholder="0" />
              </Field>
              <Field label="גלופה לצבע (₪)">
                <input style={inputStyle} value={form.competitorPlateFee} onChange={set("competitorPlateFee")} inputMode="decimal" placeholder="0" />
              </Field>
              <Field label="אספקה (ימים)">
                <input style={inputStyle} value={form.competitorLeadDays} onChange={set("competitorLeadDays")} inputMode="numeric" placeholder="30" />
              </Field>
            </div>

            <Field label="הערות (אופציונלי)">
              <textarea
                style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
                value={form.notes}
                onChange={set("notes")}
                placeholder="חומר, צבע, תנאי תשלום, כל דבר רלוונטי…"
              />
            </Field>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-start" }}>
              <LuxCTA variant="champagne" onClick={save} disabled={saving}>
                {saving ? "שומר…" : "שמור השוואה"}
              </LuxCTA>
              <LuxCTA variant="ghost" onClick={() => { setShowForm(false); setForm({ ...EMPTY_FORM }); }}>
                ביטול
              </LuxCTA>
            </div>
          </div>
        </div>
      )}

      {error && <div style={{ color: "#e8b4b4", fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {/* the "where I stand" list — collapsible product groups */}
      {loading ? (
        <div style={{ color: "var(--lux-muted)", fontSize: 13 }}>טוען…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "var(--lux-muted)", fontSize: 13.5, textAlign: "center", padding: "40px 20px", lineHeight: 1.6 }}>
          עדיין אין השוואות.
          <br />
          לחץ על <b style={{ color: "var(--lux-champagne)" }}>"מחיר מתחרה חדש"</b> כדי לתעד את ההצעה הראשונה.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {groups.map(([product, groupRows]) => {
            const isCollapsed = collapsed.has(product);
            const prices = groupRows.map((r) => r.competitorPrice).filter((p): p is number => p != null);
            const minP = prices.length ? Math.min(...prices) : null;
            return (
              <div
                key={product}
                style={{
                  background: "var(--lux-card)",
                  borderRadius: 8,
                  boxShadow: "inset 0 0 0 1px var(--lux-line)",
                  overflow: "hidden",
                }}
              >
                {/* group header — click to collapse/expand */}
                <div
                  onClick={() => toggle(product)}
                  role="button"
                  tabIndex={0}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "13px 16px",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <span style={{ color: "var(--lux-muted)", display: "flex", flexShrink: 0 }}>
                    {isCollapsed ? <ChevronLeft size={16} /> : <ChevronDown size={16} />}
                  </span>
                  <span className="lux-serif" style={{ fontSize: 15, color: "var(--lux-ink)", flex: "1 1 auto", minWidth: 0 }}>
                    {product}
                  </span>
                  {minP != null && (
                    <span style={{ fontSize: 11.5, color: "var(--lux-muted)", whiteSpace: "nowrap" }}>
                      מתחרה מ־{nisUnit(minP)}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      color: "var(--lux-champagne)",
                      background: "rgba(214,196,172,0.12)",
                      boxShadow: "inset 0 0 0 1px rgba(214,196,172,0.30)",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {groupRows.length} השוואות
                  </span>
                </div>

                {!isCollapsed && (
                  <div style={{ display: "grid", gap: 12, padding: "0 12px 12px" }}>
                    {groupRows.map((r) => (
                      <ComparisonCard key={r.id} row={r} onDelete={remove} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </LuxShell>
  );
}
