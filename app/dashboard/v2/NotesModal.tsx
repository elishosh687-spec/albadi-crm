"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { updateLeadNotes } from "@/app/actions/v2";

export interface NotesModalTarget {
  manychatSubId: string;
  leadName: string | null;
  initialNotes: string | null;
}

export function NotesModal({
  target,
  onClose,
}: {
  target: NotesModalTarget | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when the modal target changes (opening for a new lead).
  useEffect(() => {
    if (target) {
      const v = target.initialNotes ?? "";
      setValue(v);
      setSaved(v);
      setMsg(null);
    }
  }, [target]);

  // Cleanup any pending msg-clear timer on unmount.
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

  function onSave() {
    if (!target) return;
    setMsg(null);
    start(async () => {
      const r = await updateLeadNotes(target.manychatSubId, value);
      if (r.ok) {
        setSaved(value);
        setMsg("נשמר");
        if (msgTimer.current) clearTimeout(msgTimer.current);
        msgTimer.current = setTimeout(() => setMsg(null), 2000);
        router.refresh();
      } else {
        setMsg(r.error ?? "כשל");
      }
    });
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
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          gap: space.md,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3
            style={{
              margin: 0,
              fontFamily: fontStack.display,
              fontSize: size.lg,
              fontWeight: weight.medium,
              color: colors.ink,
            }}
          >
            הערות — {target.leadName ?? target.manychatSubId}
          </h3>
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

        <div
          style={{
            fontFamily: fontStack.body,
            fontSize: size.xs,
            color: colors.inkMuted,
          }}
        >
          נשמר ל-ManyChat custom field <code>notes</code>. הסקיל קוראת אותו בריצה הבאה.
        </div>

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="כתוב הערות כאן…"
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
            minHeight: 160,
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
          <Button
            size="md"
            variant="primary"
            onClick={onSave}
            disabled={!dirty || pending}
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
                color: msg === "נשמר" ? colors.success : colors.danger,
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
