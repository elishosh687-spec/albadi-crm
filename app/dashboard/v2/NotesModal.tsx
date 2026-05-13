"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import {
  setLeadStage,
  updateLeadNotes,
} from "@/app/actions/v2";
import {
  V2_FLAG_NAMES,
  V2_PIPELINE_STAGES,
  type V2FlagName,
  type V2PipelineStage,
} from "@/lib/manychat/stages";

export interface NotesModalTarget {
  manychatSubId: string;
  leadName: string | null;
  initialNotes: string | null;
  phone?: string | null;
  quoteResult?: string | null;
  // Stage-detail mode — the lead is already in a stage and we edit it directly.
  currentStage?: string | null;
  currentFlags?: string[] | null;
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NotesModal({
  target,
  onClose,
  onNotesSaved,
}: {
  target: NotesModalTarget | null;
  onClose: () => void;
  onNotesSaved?: (manychatSubId: string, notes: string) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [directStage, setDirectStage] = useState<string>("");
  const [directFlags, setDirectFlags] = useState<Set<V2FlagName>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state on target change.
  useEffect(() => {
    if (target) {
      const v = target.initialNotes ?? "";
      setValue(v);
      setSaved(v);
      setDirectStage(target.currentStage ?? "");
      setDirectFlags(new Set((target.currentFlags ?? []) as V2FlagName[]));
      setMsg(null);
    }
  }, [target]);

  // Cleanup pending msg-clear timer on unmount.
  useEffect(() => {
    return () => {
      if (msgTimer.current) clearTimeout(msgTimer.current);
    };
  }, []);

  // Esc closes the modal.
  useEffect(() => {
    if (!target) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  if (!target) return null;

  const dirty = value !== saved;

  function flashMsg(text: string, isOk: boolean) {
    setMsg(text);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMsg(null), 2500);
    if (!isOk) console.warn("Notes modal error:", text);
  }

  function onInsertStamp() {
    const stamp = `[${nowStamp()}] `;
    const next = value.length === 0 ? stamp : `${stamp}\n${value}`;
    setValue(next);
    // Focus textarea + put cursor right after stamp so Eli can type immediately.
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const pos = stamp.length;
        ta.setSelectionRange(pos, pos);
      }
    }, 0);
  }

  function toggleFlag(name: V2FlagName) {
    setDirectFlags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function onSaveAll() {
    if (!target) return;
    const notesDirty = value !== saved;
    const directChanged =
      target.currentStage !== undefined &&
      directStage !== "" &&
      (directStage !== (target.currentStage ?? "") ||
        flagsChanged(directFlags, target.currentFlags ?? []));
    if (!notesDirty && !directChanged) {
      flashMsg("אין שינויים לשמור", false);
      return;
    }

    start(async () => {
      let notesOk = true;
      let stageOk = true;
      const msgParts: string[] = [];
      let lastError: string | null = null;

      if (notesDirty) {
        const r = await updateLeadNotes(target.manychatSubId, value);
        if (r.ok) {
          setSaved(value);
          if (onNotesSaved) onNotesSaved(target.manychatSubId.trim(), value);
          msgParts.push("הערות");
        } else {
          notesOk = false;
          lastError = r.error ?? "כשל בשמירת הערות";
        }
      }

      if (notesOk && directChanged) {
        const r = await setLeadStage({
          manychatSubId: target.manychatSubId,
          stage: directStage as V2PipelineStage,
          flags: Array.from(directFlags),
          reason: `Manual edit from stage detail (${target.currentStage ?? "none"} → ${directStage})`,
        });
        if (r.ok) {
          msgParts.push(`stage→${directStage}`);
        } else {
          stageOk = false;
          lastError = r.error ?? "כשל בשמירת stage";
        }
      }

      if (notesOk && stageOk) {
        flashMsg(`נשמר: ${msgParts.join(" + ")}`, true);
        router.refresh();
        if (directChanged) onClose();
      } else {
        flashMsg(lastError ?? "כשל", false);
      }
    });
  }

  function flagsChanged(next: Set<V2FlagName>, prev: string[]): boolean {
    const prevSet = new Set(prev);
    if (next.size !== prevSet.size) return true;
    for (const f of next) if (!prevSet.has(f)) return true;
    return false;
  }

  function onBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      onMouseDown={onBackdrop}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(28,24,21,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: space.lg,
      }}
    >
      <div
        style={{
          background: colors.surface,
          borderRadius: 8,
          padding: space.xl,
          width: "100%",
          maxWidth: 640,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          gap: space.md,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
            <h3
              style={{
                margin: 0,
                fontFamily: fontStack.display,
                fontSize: size.lg,
                fontWeight: weight.medium,
                color: colors.ink,
              }}
            >
              {target.leadName ?? target.manychatSubId}
            </h3>
            <div style={{ display: "flex", gap: space.md, alignItems: "baseline", flexWrap: "wrap" }}>
              <span
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: size.xs,
                  color: colors.inkSubtle,
                }}
              >
                {target.manychatSubId.trim()}
              </span>
              {target.phone && (
                <a
                  href={`tel:${target.phone}`}
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: size.sm,
                    color: colors.accent,
                    textDecoration: "none",
                    direction: "ltr",
                  }}
                >
                  📞 {target.phone}
                </a>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            style={{
              background: "transparent",
              border: "none",
              fontSize: size.lg,
              color: colors.inkMuted,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Quote summary block — only when a quote was generated in WhatsApp */}
        {target.quoteResult && (
          <details
            style={{
              border: `1px solid ${colors.rule}`,
              borderRadius: 6,
              padding: `${space.sm}px ${space.md}px`,
              background: colors.surfaceMuted,
            }}
          >
            <summary
              style={{
                fontFamily: fontStack.body,
                fontSize: size.xs,
                color: colors.inkMuted,
                fontWeight: weight.medium,
                cursor: "pointer",
              }}
            >
              סיכום הצעה שנשלחה ב-WhatsApp
            </summary>
            <pre
              style={{
                marginTop: space.sm,
                marginBottom: 0,
                fontFamily: fontStack.body,
                fontSize: size.sm,
                color: colors.ink,
                whiteSpace: "pre-wrap",
                lineHeight: 1.4,
                maxHeight: 240,
                overflowY: "auto",
                direction: "rtl",
              }}
            >
              {target.quoteResult}
            </pre>
          </details>
        )}

        {/* Notes section */}
        <section style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <label
              style={{
                fontFamily: fontStack.body,
                fontSize: size.xs,
                color: colors.inkMuted,
                fontWeight: weight.medium,
              }}
            >
              הערות (custom field <code>notes</code> ב-ManyChat)
            </label>
            <button
              type="button"
              onClick={onInsertStamp}
              disabled={pending}
              style={{
                fontFamily: fontStack.body,
                fontSize: size.xs,
                color: colors.accent,
                background: "transparent",
                border: "none",
                cursor: pending ? "not-allowed" : "pointer",
                padding: 0,
              }}
            >
              ＋ הוסף תאריך עכשיו
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`כתוב הערות כאן… (לחץ "הוסף תאריך" לפתוח שורה חדשה עם [${nowStamp()}])`}
            rows={8}
            dir="rtl"
            autoFocus
            style={{
              width: "100%",
              fontFamily: fontStack.body,
              fontSize: size.md,
              color: colors.ink,
              background: colors.surface,
              border: `1px solid ${dirty ? colors.accent : colors.rule}`,
              borderRadius: 6,
              padding: `${space.sm}px ${space.md}px`,
              resize: "vertical",
              lineHeight: 1.5,
              boxSizing: "border-box",
              minHeight: 180,
            }}
          />
        </section>

        {/* Direct stage edit — used by stage-detail page */}
        {target.currentStage !== undefined && (
          <section
            style={{
              borderTop: `1px solid ${colors.ruleSoft}`,
              paddingTop: space.md,
              display: "flex",
              flexDirection: "column",
              gap: space.sm,
            }}
          >
            <label
              style={{
                fontFamily: fontStack.body,
                fontSize: size.xs,
                color: colors.inkMuted,
                fontWeight: weight.medium,
              }}
            >
              שינוי stage נוכחי
              {target.currentStage ? (
                <>
                  {" "}(עכשיו: <strong>{target.currentStage}</strong>)
                </>
              ) : (
                <> (ללא stage)</>
              )}
            </label>
            <div style={{ display: "flex", gap: space.sm, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={directStage}
                onChange={(e) => setDirectStage(e.target.value)}
                disabled={pending}
                style={{
                  fontFamily: fontStack.body,
                  fontSize: size.sm,
                  padding: `${space.sm}px ${space.md}px`,
                  border: `1px solid ${colors.rule}`,
                  borderRadius: 6,
                  background: colors.surface,
                  color: colors.ink,
                }}
              >
                <option value="">— בחר stage —</option>
                {V2_PIPELINE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: space.md, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: fontStack.body, fontSize: size.xs, color: colors.inkMuted, fontWeight: weight.medium }}>
                flags:
              </span>
              {V2_FLAG_NAMES.map((f) => (
                <label
                  key={f}
                  style={{
                    fontFamily: fontStack.body,
                    fontSize: size.sm,
                    color: colors.ink,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: space.xs,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={directFlags.has(f)}
                    onChange={() => toggleFlag(f)}
                    disabled={pending}
                  />
                  {f}
                </label>
              ))}
            </div>
          </section>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: space.sm,
            marginTop: space.sm,
            paddingTop: space.md,
            borderTop: `1px solid ${colors.ruleSoft}`,
          }}
        >
          <Button
            size="md"
            variant="primary"
            onClick={onSaveAll}
            pending={pending}
            pendingText="שומר…"
          >
            שמור
          </Button>
          <Button size="md" variant="ghost" onClick={onClose} disabled={pending}>
            סגור
          </Button>
          {msg && (
            <span
              style={{
                fontFamily: fontStack.body,
                fontSize: size.sm,
                color: msg.startsWith("נשמר") ? colors.success : colors.danger,
                marginInlineStart: space.sm,
              }}
            >
              {msg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
