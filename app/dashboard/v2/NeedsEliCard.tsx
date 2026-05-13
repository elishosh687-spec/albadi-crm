"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { sendFinalPrice, setBotPaused } from "@/app/actions/v2";
import { Card } from "@/components/ui/Card";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";

export interface NeedsEliLead {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  flag: string | null;
  botPaused: boolean;
  followUpCount: number;
}

export function NeedsEliCard({ leads }: { leads: NeedsEliLead[] }) {
  if (leads.length === 0) return null;
  return (
    <Card title={`צריך אותך — ${leads.length}`}>
      <div style={{ fontFamily: fontStack.body, fontSize: size.sm }}>
        <p style={{ color: colors.inkMuted, marginBottom: space.md }}>
          לידים שעברו 3 פולואפים ללא תגובה, סטופ-וורד, או שהבוט הושהה ידנית.
          לידים ב-IN_PROGRESS — הלקוח שלח לוגו, צריך לשלוח לו מחיר סופי.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
          {leads.map((l) => (
            <NeedsEliRow key={l.sid} lead={l} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function NeedsEliRow({ lead }: { lead: NeedsEliLead }) {
  const [paused, setPaused] = useState(lead.botPaused);
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const toggle = () => {
    setErr(null);
    const next = !paused;
    startTransition(async () => {
      const res = await setBotPaused(lead.sid, next);
      if (res.ok) setPaused(next);
      else setErr(res.error ?? "failed");
    });
  };

  const showFinalPriceForm = (lead.stage ?? "").toUpperCase() === "IN_PROGRESS";

  return (
    <div
      style={{
        border: `1px solid ${colors.rule}`,
        borderRadius: 6,
        padding: `${space.sm}px ${space.md}px`,
        display: "flex",
        flexDirection: "column",
        gap: space.sm,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.md,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: weight.medium, color: colors.ink }}>
            {lead.name || "(ללא שם)"}
          </div>
          <div style={{ color: colors.inkMuted, fontSize: size.xs }}>
            {lead.phone || lead.sid} · שלב {lead.stage || "NEW"} · {lead.followUpCount}/3 פולואפים
            {lead.flag ? ` · ${lead.flag}` : ""}
          </div>
        </div>
        <Link
          href={`/dashboard/v2/lead/${encodeURIComponent(lead.sid)}`}
          style={{
            fontFamily: fontStack.body,
            fontSize: size.sm,
            fontWeight: weight.medium,
            color: colors.accent,
            textDecoration: "none",
            padding: `${space.xs}px ${space.md}px`,
            borderRadius: 4,
            border: `1px solid ${colors.accent}`,
          }}
        >
          פתח שיחה →
        </Link>
        <button
          type="button"
          onClick={toggle}
          disabled={isPending}
          style={{
            fontFamily: fontStack.body,
            fontSize: size.sm,
            fontWeight: weight.medium,
            padding: `${space.xs}px ${space.md}px`,
            borderRadius: 4,
            border: `1px solid ${paused ? colors.accent : colors.rule}`,
            background: paused ? colors.accent : "white",
            color: paused ? "white" : colors.ink,
            cursor: isPending ? "wait" : "pointer",
            opacity: isPending ? 0.6 : 1,
          }}
        >
          {paused ? "המשך בוט" : "השהה בוט"}
        </button>
        {err && (
          <span style={{ color: "red", fontSize: size.xs }}>{err}</span>
        )}
      </div>
      {showFinalPriceForm && <FinalPriceForm sid={lead.sid} />}
    </div>
  );
}

function FinalPriceForm({ sid }: { sid: string }) {
  const [price, setPrice] = useState("");
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const submit = () => {
    setErr(null);
    setOk(null);
    const trimmed = price.trim();
    if (!trimmed) {
      setErr("חסר מחיר");
      return;
    }
    startTransition(async () => {
      const res = await sendFinalPrice(sid, trimmed);
      if (res.ok) {
        setOk(res.message ?? "נשלח");
        setPrice("");
      } else {
        setErr(res.error ?? "failed");
      }
    });
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: space.sm,
        paddingTop: space.sm,
        borderTop: `1px dashed ${colors.rule}`,
      }}
    >
      <label
        style={{
          fontSize: size.xs,
          color: colors.inkMuted,
          whiteSpace: "nowrap",
        }}
      >
        מחיר סופי:
      </label>
      <input
        type="text"
        inputMode="numeric"
        placeholder="לדוגמה: 850"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        disabled={isPending}
        style={{
          fontFamily: fontStack.body,
          fontSize: size.sm,
          padding: `${space.xs}px ${space.sm}px`,
          borderRadius: 4,
          border: `1px solid ${colors.rule}`,
          width: 120,
        }}
      />
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        style={{
          fontFamily: fontStack.body,
          fontSize: size.sm,
          fontWeight: weight.medium,
          padding: `${space.xs}px ${space.md}px`,
          borderRadius: 4,
          border: `1px solid ${colors.accent}`,
          background: colors.accent,
          color: "white",
          cursor: isPending ? "wait" : "pointer",
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? "שולח…" : "שלח מחיר סופי"}
      </button>
      {ok && (
        <span style={{ color: "green", fontSize: size.xs }}>{ok}</span>
      )}
      {err && (
        <span style={{ color: "red", fontSize: size.xs }}>{err}</span>
      )}
    </div>
  );
}
