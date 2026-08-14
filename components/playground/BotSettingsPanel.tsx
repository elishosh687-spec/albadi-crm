"use client";

/**
 * Bot settings — every knob with an explanation of what it actually does.
 *
 * The controls are generated from BOT_SETTING_FIELDS, the same table the
 * runtime reads, so a description can't drift from the behaviour it describes.
 * Layout is one card per setting (label → explanation → control) rather than a
 * dense table: these need to be read, not scanned.
 */
import { useEffect, useMemo, useState } from "react";
import {
  BOT_SETTING_FIELDS,
  DEFAULT_BOT_SETTINGS,
  GROUPS,
  type BotSettingField,
  type BotSettings,
} from "@/lib/bot-settings/schema";

const C = {
  panel: "#1b1917",
  card: "rgba(255,255,255,0.025)",
  border: "rgba(255,255,255,0.08)",
  text: "#e8e4de",
  dim: "#9a938a",
  faint: "#6b645c",
  accent: "#c9a227",
  on: "#4ea172",
};

export default function BotSettingsPanel({ apiToken }: { apiToken: string }) {
  const [values, setValues] = useState<BotSettings>(DEFAULT_BOT_SETTINGS);
  const [saved, setSaved] = useState<BotSettings>(DEFAULT_BOT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string>(GROUPS[0]);

  const url = `/api/widget/bot-settings?widget_token=${encodeURIComponent(apiToken)}`;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(url);
        const json = await res.json();
        if (json.ok) {
          setValues(json.settings);
          setSaved(json.settings);
        } else {
          setNote(json.error ?? "טעינה נכשלה");
        }
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [url]);

  const dirtyKeys = useMemo(
    () =>
      BOT_SETTING_FIELDS.filter((f) => values[f.key] !== saved[f.key]).map((f) => f.key),
    [values, saved]
  );

  function set<K extends keyof BotSettings>(key: K, v: BotSettings[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "שמירה נכשלה");
      setValues(json.settings);
      setSaved(json.settings);
      setNote("נשמר — ההודעה הבאה כבר תשתמש בהגדרות החדשות");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div style={{ color: C.dim, fontSize: 13, padding: 12 }}>טוען הגדרות…</div>;
  }

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ===== group nav (sidenav, standard settings layout) ===== */}
      <nav
        style={{
          flex: "0 0 200px",
          position: "sticky",
          top: 90,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {GROUPS.map((g) => {
          const count = BOT_SETTING_FIELDS.filter((f) => f.group === g).length;
          const dirty = BOT_SETTING_FIELDS.some(
            (f) => f.group === g && values[f.key] !== saved[f.key]
          );
          const active = g === openGroup;
          return (
            <button
              key={g}
              onClick={() => setOpenGroup(g)}
              style={{
                textAlign: "start",
                background: active ? "rgba(201,162,39,0.10)" : "transparent",
                borderWidth: 0,
                borderInlineStart: `2px solid ${active ? C.accent : "transparent"}`,
                color: active ? C.text : C.dim,
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {g}
                {dirty && <span style={{ color: C.accent }}> •</span>}
              </span>
              <span style={{ fontSize: 11, color: C.faint }}>{count}</span>
            </button>
          );
        })}
      </nav>

      {/* ===== content ===== */}
      <div style={{ flex: "1 1 460px", minWidth: 300 }}>
        {/* save bar */}
        <div
          style={{
            position: "sticky",
            top: 90,
            zIndex: 3,
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "9px 12px",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{openGroup}</div>
          <div style={{ fontSize: 12, color: dirtyKeys.length ? "#e0c46a" : C.dim }}>
            {dirtyKeys.length > 0 ? `${dirtyKeys.length} שינויים לא שמורים` : "הכל שמור"}
          </div>
          <div style={{ flex: 1 }} />
          {dirtyKeys.length > 0 && (
            <button onClick={() => setValues(saved)} disabled={busy} style={btnGhost}>
              בטל שינויים
            </button>
          )}
          <button
            onClick={save}
            disabled={busy || dirtyKeys.length === 0}
            style={btnPrimary}
          >
            {busy ? "שומר…" : "שמור"}
          </button>
        </div>

        {note && (
          <div
            style={{
              background: "rgba(78,161,114,0.10)",
              border: "1px solid rgba(78,161,114,0.35)",
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 12,
              fontSize: 13,
              color: "#9fd3b4",
            }}
          >
            {note}
          </div>
        )}

        {BOT_SETTING_FIELDS.filter((f) => f.group === openGroup).map((f) => (
          <SettingCard
            key={f.key}
            field={f}
            value={values[f.key]}
            isDefault={values[f.key] === DEFAULT_BOT_SETTINGS[f.key]}
            dirty={values[f.key] !== saved[f.key]}
            onChange={(v) => set(f.key, v as never)}
            onReset={() => set(f.key, DEFAULT_BOT_SETTINGS[f.key] as never)}
          />
        ))}
      </div>
    </div>
  );
}

function SettingCard({
  field,
  value,
  isDefault,
  dirty,
  onChange,
  onReset,
}: {
  field: BotSettingField;
  value: string | number | boolean;
  isDefault: boolean;
  dirty: boolean;
  onChange: (v: string | number | boolean) => void;
  onReset: () => void;
}) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${dirty ? "rgba(201,162,39,0.35)" : C.border}`,
        borderRadius: 10,
        padding: 14,
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{field.label}</div>
        {field.type === "toggle" && (
          <span
            style={{
              fontSize: 11,
              color: value ? C.on : C.faint,
              border: `1px solid ${value ? "rgba(78,161,114,0.4)" : C.border}`,
              borderRadius: 999,
              padding: "1px 8px",
            }}
          >
            {value ? "דולק" : "כבוי"}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {!isDefault && (
          <button onClick={onReset} style={linkBtn} title="החזר לערך המקורי">
            אפס
          </button>
        )}
      </div>

      <p style={{ margin: "0 0 4px", fontSize: 12.5, color: C.dim, lineHeight: 1.65 }}>
        {field.description}
      </p>
      {field.where && (
        <p style={{ margin: "0 0 10px", fontSize: 11.5, color: C.faint }}>
          📍 {field.where}
        </p>
      )}

      <Control field={field} value={value} onChange={onChange} />
    </div>
  );
}

function Control({
  field,
  value,
  onChange,
}: {
  field: BotSettingField;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  if (field.type === "toggle") {
    const on = Boolean(value);
    return (
      <button
        onClick={() => onChange(!on)}
        role="switch"
        aria-checked={on}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
          color: C.text,
        }}
      >
        <span
          style={{
            width: 42,
            height: 24,
            borderRadius: 999,
            background: on ? "rgba(78,161,114,0.35)" : "rgba(255,255,255,0.07)",
            border: `1px solid ${on ? "rgba(78,161,114,0.6)" : C.border}`,
            position: "relative",
            transition: "background 120ms",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              // RTL: "on" sits at the right edge
              right: on ? 2 : 20,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: on ? C.on : "#7d766d",
              transition: "right 120ms",
            }}
          />
        </span>
        <span style={{ fontSize: 13 }}>{on ? "מופעל" : "מכובה"}</span>
      </button>
    );
  }

  if (field.type === "number") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="number"
          value={Number(value)}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ ...inputStyle, width: 130 }}
        />
        {field.unit && <span style={{ fontSize: 12.5, color: C.dim }}>{field.unit}</span>}
        {(field.min !== undefined || field.max !== undefined) && (
          <span style={{ fontSize: 11.5, color: C.faint }}>
            (טווח מותר: {field.min ?? "—"}–{field.max ?? "—"})
          </span>
        )}
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <select
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, width: "100%", maxWidth: 420 }}
      >
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value} style={{ background: C.panel }}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "longtext") {
    const text = String(value);
    return (
      <div>
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.min(10, Math.max(2, text.split("\n").length + 1))}
          style={{ ...inputStyle, width: "100%", resize: "vertical", lineHeight: 1.7 }}
        />
        <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>
          {text.length} תווים · שורה חדשה = שורה חדשה אצל הלקוח
        </div>
      </div>
    );
  }

  return (
    <input
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, width: "100%", maxWidth: 480 }}
    />
  );
}

const inputStyle: React.CSSProperties = {
  background: "#141312",
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: "9px 11px",
  color: C.text,
  fontSize: 13.5,
  fontFamily: "inherit",
};

const btnGhost: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${C.border}`,
  color: C.text,
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12.5,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  background: "rgba(201,162,39,0.16)",
  border: "1px solid rgba(201,162,39,0.45)",
  color: "#e0c46a",
  borderRadius: 8,
  padding: "7px 18px",
  fontSize: 13,
  cursor: "pointer",
};

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: C.faint,
  fontSize: 11.5,
  cursor: "pointer",
  textDecoration: "underline",
  padding: 0,
};
