"use client";

/**
 * "צבעים" hub tab — the one place that answers "which colour can I promise?".
 *
 * Two views over the same measured data (lib/colors/factory-catalog.ts):
 *   • הקטלוג הכללי — the 14 colours all three factories can make, with the code
 *     to ask each one for. This is what goes in front of a customer.
 *   • לפי מפעל — each factory's full palette, with a note saying when that
 *     factory is the one you order from.
 *
 * Static data, imported directly. No fetch, no API route, no loading state.
 */

import { useState } from "react";
import { Info, Search } from "lucide-react";
import { syncHubUrl } from "@/lib/widget/hub-link";
import { LuxShell, LuxTitle, LuxAccent, LuxStat, Section } from "@/components/widget-ui/lux";
import {
  FACTORIES,
  FACTORY_COLORS,
  FACTORY_ORDER,
  SHARED_COLORS,
  colorsByCatalog,
  type FactoryId,
} from "@/lib/colors/factory-catalog";

const TOTAL = FACTORY_ORDER.reduce((n, id) => n + FACTORY_COLORS[id].length, 0);

/** Latin codes and hex values must not be reordered by the RTL page. */
const LTR = { direction: "ltr" as const, unicodeBidi: "isolate" as const };

type View = "shared" | "factories";

/** Search matches a Hebrew name, a hex, or a factory code ("y21" finds Y21). */
const norm = (v: string) => v.trim().toLowerCase().replace(/^#/, "");
const hit = (q: string, ...fields: string[]) => !q || fields.some((f) => norm(f).includes(q));

export default function ColorCatalogScreen({ initialView }: { initialView?: string }) {
  const [view, setView] = useState<View>(initialView === "factories" ? "factories" : "shared");
  const [query, setQuery] = useState("");
  const q = norm(query);
  const pick = (next: View) => {
    setView(next);
    syncHubUrl({ view: next === "shared" ? null : next });
  };

  return (
    <LuxShell className="ux ux-floor">
      <LuxTitle
        overline="— Colour catalogue"
        subtitle="הגוונים נמדדו מקטלוגי הבד של המפעלים. הקטלוג הכללי הוא מה שאפשר להבטיח ללקוח לפני שיודעים לאן ההזמנה הולכת."
      >
        קטלוג <LuxAccent>צבעים</LuxAccent>.
      </LuxTitle>

      <div
        className="lux-wrap-sm"
        style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}
      >
        <LuxStat value={SHARED_COLORS.length} label="גוונים לכל המפעלים" tone="champagne" />
        <LuxStat value={TOTAL} label="גוונים בסך הכול" />
        <LuxStat value={FACTORY_ORDER.length} label="מפעלים" />
      </div>

      <div role="tablist" aria-label="תצוגה" className="ux-tabs">
        <button type="button" role="tab" aria-selected={view === "shared"} onClick={() => pick("shared")}>
          הקטלוג הכללי
        </button>
        <button type="button" role="tab" aria-selected={view === "factories"} onClick={() => pick("factories")}>
          לפי מפעל
        </button>
      </div>

      <label className="ux-search">
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="ux-sr">חיפוש צבע</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם צבע או קוד מפעל (למשל Y21)"
        />
      </label>

      {view === "shared" ? <SharedView q={q} /> : <FactoriesView q={q} />}

      <p
        style={{
          marginTop: 22,
          fontSize: 13.5,
          lineHeight: 1.7,
          color: "var(--lux-muted)",
          maxWidth: "68ch",
        }}
      >
        הגוונים נמדדו מצילומים של קטלוגי הבד, לא ממכשיר מדידה. הם מדויקים מספיק
        כדי לבנות את הרשימה — אבל לפני התחייבות מול לקוח כדאי לבקש מהמפעל דוגמה
        פיזית של הגוון ולהשוות. לבנים וגוונים כהים מאוד הם המדידה הפחות אמינה.
      </p>
    </LuxShell>
  );
}

/* ------------------------------------------------------------------ shared */

function SharedView({ q }: { q: string }) {
  const shown = SHARED_COLORS.filter((c) => hit(q, c.nameHe, c.hex, ...Object.values(c.codes)));
  return (
    <Section
      numeral="I"
      eyebrow="זמין בכל המפעלים"
      title={`${SHARED_COLORS.length} גוונים שאפשר להבטיח`}
    >
      <p style={{ margin: "6px 0 16px", fontSize: 14, color: "var(--lux-muted)" }}>
        לכל גוון — הקוד שצריך לבקש מכל מפעל. אם לקוח דורש גוון אחר, יש עוד{" "}
        {TOTAL - SHARED_COLORS.length} גוונים בקטלוגים של המפעלים; מתאימים ידנית
        מול המפעל שיקבל את ההזמנה.
      </p>
      {shown.length === 0 && (
        <p style={{ fontSize: 14, color: "var(--lux-muted)" }}>
          אין גוון משותף שמתאים לחיפוש — נסה ״לפי מפעל״, שם יש את כל {TOTAL} הגוונים.
        </p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(228px, 1fr))",
          gap: 12,
        }}
      >
        {shown.map((c) => (
          <article
            key={c.hex}
            style={{
              display: "flex",
              flexDirection: "column",
              borderRadius: 7,
              overflow: "hidden",
              background: "var(--lux-card-raised)",
              boxShadow: "inset 0 0 0 1px var(--lux-line)",
            }}
          >
            <div
              style={{
                background: c.hex,
                height: 74,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.22)",
              }}
            />
            <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                className="lux-wrap-sm"
                style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}
              >
                <strong style={{ fontSize: 15 }}>{c.nameHe}</strong>
                <span style={{ ...LTR, fontSize: 13, color: "var(--lux-muted)" }}>{c.hex}</span>
                <span
                  title={`הפרש מרבי בין המפעלים: ΔE ${c.maxDeltaE}`}
                  style={{
                    marginInlineStart: "auto",
                    fontSize: 12,
                    padding: "1px 6px",
                    borderRadius: 3,
                    color: c.tier === "exact" ? "#1d1b1a" : "var(--lux-muted)",
                    background: c.tier === "exact" ? "var(--lux-champagne)" : "transparent",
                    boxShadow: c.tier === "exact" ? "none" : "inset 0 0 0 1px var(--lux-line)",
                  }}
                >
                  {c.tier === "exact" ? "מדויק" : "קרוב"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {FACTORY_ORDER.map((id) => (
                  <div
                    key={id}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "var(--lux-muted)", minWidth: 58, ...LTR, textAlign: "start" }}>
                      {FACTORIES[id].label}
                    </span>
                    <code
                      style={{
                        ...LTR,
                        fontSize: 13,
                        padding: "1px 6px",
                        borderRadius: 3,
                        background: "var(--lux-card)",
                        boxShadow: "inset 0 0 0 1px var(--lux-line)",
                      }}
                    >
                      {c.codes[id]}
                    </code>
                    {id === "MANDY" ? (
                      <span style={{ ...LTR, fontSize: 12, color: "var(--lux-muted)" }}>
                        {c.mandyCatalog.replace("MATERIAL COLOR ", "COLOR ")}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------- factories */

const NUMERALS = ["I", "II", "III"];

function FactoriesView({ q }: { q: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {FACTORY_ORDER.map((id, i) => (
        <FactoryBlock key={id} id={id} numeral={NUMERALS[i]} q={q} />
      ))}
    </div>
  );
}

function FactoryBlock({ id, numeral, q }: { id: FactoryId; numeral: string; q: string }) {
  const meta = FACTORIES[id];
  const groups = colorsByCatalog(id)
    .map((g) => ({ ...g, colors: g.colors.filter((c) => hit(q, c.code, c.hex)) }))
    .filter((g) => g.colors.length > 0);
  const total = FACTORY_COLORS[id].length;

  return (
    <Section
      numeral={numeral}
      eyebrow={meta.whenToUseShort}
      title={
        <span className="lux-wrap-sm" style={{ display: "inline-flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={LTR}>{meta.label}</span>
          <span style={{ fontSize: 13, color: "var(--lux-muted)" }}>{total} גוונים</span>
        </span>
      }
    >
      {/* <details> and not a hover tooltip — the widget is worked from a phone. */}
      <details style={{ margin: "4px 0 14px" }}>
        <summary
          className="lux-tap"
          style={{
            cursor: "pointer",
            listStyle: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 14,
            color: "var(--lux-champagne)",
          }}
        >
          <Info size={15} strokeWidth={2} />
          מתי מזמינים מכאן?
        </summary>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 14,
            lineHeight: 1.75,
            color: "var(--lux-ink)",
            maxWidth: "62ch",
            paddingInlineStart: 19,
          }}
        >
          {meta.whenToUse}
          {meta.chineseName ? (
            <span style={{ display: "block", marginTop: 5, color: "var(--lux-muted)", fontSize: 13 }}>
              בגיליון ההצעות: {meta.chineseName}
            </span>
          ) : null}
        </p>
      </details>

      {groups.length === 0 && (
        <p style={{ fontSize: 14, color: "var(--lux-muted)" }}>אין אצל המפעל הזה קוד שמתאים לחיפוש.</p>
      )}
      {groups.map((g) => (
        <div key={g.catalog} style={{ marginBottom: 14 }}>
          {groups.length > 1 ? (
            <div
              style={{
                ...LTR,
                fontSize: 12.5,
                letterSpacing: "0.06em",
                color: "var(--lux-muted)",
                marginBottom: 8,
                textAlign: "start",
              }}
            >
              {g.catalog} · {g.colors.length}
            </div>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
              gap: 9,
            }}
          >
            {g.colors.map((c) => (
              <figure key={`${g.catalog}-${c.code}`} style={{ margin: 0 }}>
                <span
                  style={{
                    display: "block",
                    background: c.hex,
                    aspectRatio: "1 / 0.8",
                    borderRadius: 4,
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.22)",
                  }}
                />
                <figcaption
                  style={{
                    ...LTR,
                    marginTop: 4,
                    fontSize: 13,
                    lineHeight: 1.35,
                    color: "var(--lux-ink)",
                    textAlign: "start",
                  }}
                >
                  {c.code}
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--lux-muted)" }}>
                    {c.hex}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}
