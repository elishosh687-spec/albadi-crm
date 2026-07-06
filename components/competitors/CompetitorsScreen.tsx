"use client";

/**
 * "מחיר מתחרים" — competitor price + lead-time intelligence.
 *
 * Eli logs each competing quote he runs into: our price + our delivery time vs
 * the competitor's, for a product spec. The screen then shows exactly where
 * Albadi stands — on BOTH axes, because a customer will sometimes pay a little
 * more for a faster lead time (Eli's explicit ask). Data lives in
 * `competitor_prices`; all reads/writes go through /api/widget/competitor-prices.
 *
 * Presentation follows the Silent-Luxury lux-theme (warm dark). Self-contained
 * inputs are styled inline since there's no shared Lux input primitive yet.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2, Plus, TrendingDown, TrendingUp, Clock } from "lucide-react";
import { LuxShell, LuxTitle, LuxAccent, LuxCTA, LuxStat } from "@/components/widget-ui/lux";

interface Row {
  id: number;
  product: string;
  quantity: number | null;
  ourPrice: number | null;
  ourLeadDays: number | null;
  competitor: string;
  competitorPrice: number | null;
  competitorLeadDays: number | null;
  leadSid: string | null;
  notes: string | null;
  createdAt: string;
}

const nis = (n: number) =>
  "₪" + Math.round(n).toLocaleString("he-IL");

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
};
const labelStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--lux-muted)",
  marginBottom: 5,
  display: "block",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
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

/** One competitor comparison card. */
function ComparisonCard({
  row,
  onDelete,
}: {
  row: Row;
  onDelete: (id: number) => void;
}) {
  // Price delta — positive priceDiff means competitor is MORE expensive → we win.
  const priceKnown = row.ourPrice != null && row.competitorPrice != null;
  const priceDiff = priceKnown ? row.competitorPrice! - row.ourPrice! : null;
  const pricePct =
    priceKnown && row.ourPrice
      ? Math.round((Math.abs(priceDiff!) / row.ourPrice!) * 100)
      : null;
  const weCheaper = priceDiff != null ? priceDiff >= 0 : null;

  // Lead-time delta — positive leadDiff means competitor is SLOWER → we win.
  const leadKnown = row.ourLeadDays != null && row.competitorLeadDays != null;
  const leadDiff = leadKnown ? row.competitorLeadDays! - row.ourLeadDays! : null;
  const weFaster = leadDiff != null ? leadDiff >= 0 : null;

  // Overall verdict combining both axes (Eli's core insight lives in the mixed cases).
  let verdict: { tone: "good" | "bad" | "mixed"; text: string } | null = null;
  if (weCheaper != null && weFaster != null) {
    if (weCheaper && weFaster) verdict = { tone: "good", text: "מנצחים — זולים ומהירים יותר" };
    else if (!weCheaper && !weFaster) verdict = { tone: "bad", text: "מפסידים — יקרים ואיטיים יותר" };
    else if (!weCheaper && weFaster)
      verdict = { tone: "mixed", text: "יקרים יותר אך מהירים — הפרמיה מוצדקת" };
    else verdict = { tone: "mixed", text: "זולים יותר אך איטיים — שווה לבדוק אספקה" };
  } else if (weCheaper != null) {
    verdict = weCheaper
      ? { tone: "good", text: "זולים יותר" }
      : { tone: "bad", text: "יקרים יותר" };
  } else if (weFaster != null) {
    verdict = weFaster
      ? { tone: "good", text: "מהירים יותר" }
      : { tone: "bad", text: "איטיים יותר" };
  }

  const col = (
    who: string,
    price: number | null,
    days: number | null,
    accent: boolean
  ) => (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: "10px 12px",
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
        {price != null ? nis(price) : "—"}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--lux-muted)",
          marginTop: 4,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Clock size={12} strokeWidth={1.75} />
        {days != null ? `${days} ימים` : "אספקה לא ידועה"}
      </div>
    </div>
  );

  return (
    <div
      style={{
        background: "var(--lux-card)",
        borderRadius: 8,
        boxShadow: "inset 0 0 0 1px var(--lux-line)",
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--lux-ink)" }}>
          מול {row.competitor}
        </div>
        <button
          onClick={() => onDelete(row.id)}
          title="מחק"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--lux-muted)",
            cursor: "pointer",
            padding: 4,
            display: "flex",
          }}
        >
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {col("אנחנו — אלבדי", row.ourPrice, row.ourLeadDays, true)}
        {col(row.competitor, row.competitorPrice, row.competitorLeadDays, false)}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
        {verdict && <Badge tone={verdict.tone}>{verdict.text}</Badge>}
        {priceKnown && pricePct != null && (
          <Badge
            tone={weCheaper ? "good" : "bad"}
            icon={weCheaper ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
          >
            {weCheaper ? `זולים ב-${pricePct}%` : `יקרים ב-${pricePct}%`}
            {priceDiff != null ? ` (${nis(Math.abs(priceDiff))})` : ""}
          </Badge>
        )}
        {leadKnown && leadDiff != null && (
          <Badge tone={weFaster ? "good" : "bad"} icon={<Clock size={12} />}>
            {leadDiff === 0
              ? "אותה אספקה"
              : weFaster
                ? `מהירים ב-${Math.abs(leadDiff)} ימים`
                : `איטיים ב-${Math.abs(leadDiff)} ימים`}
          </Badge>
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
  quantity: "",
  ourPrice: "",
  ourLeadDays: "",
  competitor: "",
  competitorPrice: "",
  competitorLeadDays: "",
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

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
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
      void load(); // rollback via reload
    }
  };

  // Group rows by product (Eli organizes "by product / spec").
  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const key = r.product.trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries());
  }, [rows]);

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
        subtitle="כל פעם שאתה נתקל בהצעה מתחרה — תיעד אותה כאן ותדע בדיוק איפה אתה עומד, במחיר ובזמן אספקה."
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
            <Field label="מוצר / מפרט (למשל: 5000 שקיות 80 גרם 30×40, 4 צבעים)">
              <input style={inputStyle} value={form.product} onChange={set("product")} placeholder="תיאור המוצר" />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="כמות (אופציונלי)">
                <input style={inputStyle} value={form.quantity} onChange={set("quantity")} inputMode="numeric" placeholder="5000" />
              </Field>
              <Field label="שם המתחרה">
                <input style={inputStyle} value={form.competitor} onChange={set("competitor")} placeholder="שם הספק המתחרה" />
              </Field>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                padding: "14px",
                borderRadius: 8,
                background: "rgba(214,196,172,0.05)",
                boxShadow: "inset 0 0 0 1px rgba(214,196,172,0.14)",
              }}
            >
              <div style={{ gridColumn: "1 / -1", fontSize: 12, fontWeight: 600, color: "var(--lux-champagne)" }}>
                אנחנו — אלבדי
              </div>
              <Field label="המחיר שלנו (₪)">
                <input style={inputStyle} value={form.ourPrice} onChange={set("ourPrice")} inputMode="decimal" placeholder="0" />
              </Field>
              <Field label="זמן אספקה שלנו (ימים)">
                <input style={inputStyle} value={form.ourLeadDays} onChange={set("ourLeadDays")} inputMode="numeric" placeholder="0" />
              </Field>
            </div>

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
                המתחרה
              </div>
              <Field label="מחיר המתחרה (₪)">
                <input style={inputStyle} value={form.competitorPrice} onChange={set("competitorPrice")} inputMode="decimal" placeholder="0" />
              </Field>
              <Field label="זמן אספקה שלו (ימים)">
                <input style={inputStyle} value={form.competitorLeadDays} onChange={set("competitorLeadDays")} inputMode="numeric" placeholder="0" />
              </Field>
            </div>

            <Field label="הערות (אופציונלי)">
              <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontFamily: "inherit" }} value={form.notes} onChange={set("notes")} placeholder="איכות, תנאי תשלום, כל דבר רלוונטי…" />
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

      {error && (
        <div style={{ color: "#e8b4b4", fontSize: 13, marginBottom: 14 }}>{error}</div>
      )}

      {/* the "where I stand" list */}
      {loading ? (
        <div style={{ color: "var(--lux-muted)", fontSize: 13 }}>טוען…</div>
      ) : rows.length === 0 ? (
        <div
          style={{
            color: "var(--lux-muted)",
            fontSize: 13.5,
            textAlign: "center",
            padding: "40px 20px",
            lineHeight: 1.6,
          }}
        >
          עדיין אין השוואות.
          <br />
          לחץ על <b style={{ color: "var(--lux-champagne)" }}>"מחיר מתחרה חדש"</b> כדי לתעד את ההצעה הראשונה.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 22 }}>
          {groups.map(([product, groupRows]) => (
            <div key={product}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--lux-ink)",
                  marginBottom: 10,
                  paddingBottom: 8,
                  borderBottom: "1px solid var(--lux-line)",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                }}
              >
                {product}
                {groupRows[0]?.quantity ? (
                  <span style={{ fontSize: 12, color: "var(--lux-muted)", fontWeight: 500 }}>
                    · {groupRows[0].quantity!.toLocaleString("he-IL")} יח׳
                  </span>
                ) : null}
                <span style={{ fontSize: 12, color: "var(--lux-muted)", fontWeight: 500 }}>
                  · {groupRows.length} מתחרים
                </span>
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {groupRows.map((r) => (
                  <ComparisonCard key={r.id} row={r} onDelete={remove} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </LuxShell>
  );
}
