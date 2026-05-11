"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { updateLeadNotes } from "@/app/actions/v2";

interface Props {
  manychatSubId: string;
  initialNotes: string | null;
}

export function NotesEditor({ manychatSubId, initialNotes }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initialNotes ?? "");
  const [saved, setSaved] = useState(initialNotes ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = value !== saved;

  function onSave() {
    setMsg(null);
    start(async () => {
      const r = await updateLeadNotes(manychatSubId, value);
      if (r.ok) {
        setSaved(value);
        setMsg("נשמר");
        setTimeout(() => setMsg(null), 2000);
        router.refresh();
      } else {
        setMsg(r.error ?? "כשל");
      }
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: space.xs,
        marginTop: space.sm,
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
        הערות (notes — נשמר ל-ManyChat custom field)
      </label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="כתוב הערות כאן…"
        rows={3}
        dir="rtl"
        style={{
          width: "100%",
          fontFamily: fontStack.body,
          fontSize: size.sm,
          color: colors.ink,
          background: colors.surface,
          border: `1px solid ${dirty ? colors.accent : colors.rule}`,
          borderRadius: 6,
          padding: `${space.sm}px ${space.md}px`,
          resize: "vertical",
          lineHeight: 1.5,
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
        <Button
          size="sm"
          variant="secondary"
          onClick={onSave}
          disabled={!dirty || pending}
          pending={pending}
          pendingText="שומר…"
        >
          שמור הערות
        </Button>
        {msg && (
          <span
            style={{
              fontFamily: fontStack.body,
              fontSize: size.xs,
              color: msg === "נשמר" ? colors.success : colors.danger,
            }}
          >
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
