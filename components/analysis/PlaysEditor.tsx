"use client";

import { useEffect, useState } from "react";
import { BLOCKER_KEYS, type BlockerKey, type StagePlay } from "@/lib/sales/stage-plays.he";

type PlaysMap = Record<BlockerKey, StagePlay>;

const BLOCKER_LABEL: Record<BlockerKey, string> = {
  product_mismatch: "מוצר לא מתאים",
  wrong_lead: "ליד לא רלוונטי",
  price: "מחיר",
  moq: "כמות מינימום",
  sample_trust: "דוגמה / אמון",
  payment_terms: "תנאי תשלום",
  spec_open: "מפרט פתוח",
  followup_drop: "נפילת מעקב",
  other: "אחר",
};

/**
 * Editor for the sales plays. Eli edits the title / lines / next-step per
 * blocker; saved to app_config so the נתח panel shows the edited version.
 * Backend-agnostic: parent passes load/save (widget = fetch, v3 = action).
 */
export default function PlaysEditor({
  load,
  save,
}: {
  load: () => Promise<PlaysMap>;
  save: (plays: PlaysMap) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [plays, setPlays] = useState<PlaysMap | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    load().then(setPlays).catch((e) => setMsg(String(e)));
  }, [load]);

  function update(k: BlockerKey, patch: Partial<StagePlay>) {
    setPlays((p) => (p ? { ...p, [k]: { ...p[k], ...patch } } : p));
  }

  async function onSave() {
    if (!plays) return;
    setSaving(true);
    setMsg(null);
    const r = await save(plays);
    setSaving(false);
    setMsg(r.ok ? "✓ נשמר" : `שגיאה: ${r.error ?? ""}`);
  }

  if (!plays) {
    return <div style={{ color: "#a1a1aa", fontSize: 13 }}>טוען פליז…</div>;
  }

  return (
    <div dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12, color: "#a1a1aa" }}>
        ערוך את התסריט לכל סוג חסם. השינוי יופיע מיד בכפתור "נתח" לכל ליד עם אותו חסם.
      </div>
      {BLOCKER_KEYS.map((k) => {
        const p = plays[k];
        return (
          <div
            key={k}
            style={{
              background: "#0d0f14",
              border: "1px solid #2a2d34",
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontSize: 11, color: "#6ee7b7", marginBottom: 6 }}>
              {BLOCKER_LABEL[k]}
            </div>
            <Field label="כותרת">
              <input value={p.title} onChange={(e) => update(k, { title: e.target.value })} style={inp} />
            </Field>
            <Field label="שלב">
              <input value={p.stage} onChange={(e) => update(k, { stage: e.target.value })} style={inp} />
            </Field>
            <Field label="משפטים (שורה לכל אחד)">
              <textarea
                value={p.lines.join("\n")}
                onChange={(e) => update(k, { lines: e.target.value.split("\n") })}
                rows={Math.max(2, p.lines.length)}
                style={{ ...inp, resize: "vertical", lineHeight: 1.5 }}
              />
            </Field>
            <Field label="שלב הבא">
              <input value={p.nextStep} onChange={(e) => update(k, { nextStep: e.target.value })} style={inp} />
            </Field>
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 10, position: "sticky", bottom: 0, paddingTop: 4 }}>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            padding: "9px 18px",
            borderRadius: 8,
            border: "1px solid #1f5132",
            background: "#10231a",
            color: "#6ee7b7",
            fontFamily: "inherit",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          {saving ? "שומר…" : "שמור פליז"}
        </button>
        {msg && <span style={{ fontSize: 13, color: msg.startsWith("✓") ? "#6ee7b7" : "#fecaca" }}>{msg}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "#71717a", marginBottom: 3 }}>{label}</div>
      {children}
    </label>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#17191f",
  border: "1px solid #2a2d34",
  borderRadius: 6,
  color: "#e4e4e7",
  padding: "6px 8px",
  fontFamily: "inherit",
  fontSize: 13,
};
