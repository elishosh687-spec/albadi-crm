"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { approveDraftAction, rejectDraftAction } from "@/app/actions/v2";

export interface DraftRow {
  id: number;
  manychatSubId: string;
  draftText: string;
  moneyReason: string | null;
  pipelineStageAtGen: string | null;
  generatedAt: string;
  leadName: string | null;
  leadPhone: string | null;
  leadStage: string | null;
  leadFlag: string | null;
  leadBotSummary: string | null;
  leadBotPaused: boolean;
  lastInboundText: string | null;
  lastInboundAt: string | null;
}

export function DraftQueue({ drafts }: { drafts: DraftRow[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(
    drafts[0]?.id ?? null
  );
  const selected = drafts.find((d) => d.id === selectedId) ?? null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(300px, 1fr) minmax(0, 2fr)",
        gap: space.xl,
      }}
    >
      <Card title="תור">
        <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
          {drafts.map((d) => (
            <DraftRowItem
              key={d.id}
              draft={d}
              selected={d.id === selectedId}
              onSelect={() => setSelectedId(d.id)}
            />
          ))}
        </div>
      </Card>

      {selected ? (
        <DraftDetail draft={selected} key={selected.id} />
      ) : (
        <Card title="בחר טיוטה">
          <p style={{ fontFamily: fontStack.body, fontSize: size.sm, color: colors.inkMuted }}>
            בחר טיוטה מהרשימה כדי לערוך / לאשר / לדחות.
          </p>
        </Card>
      )}
    </div>
  );
}

function DraftRowItem({
  draft,
  selected,
  onSelect,
}: {
  draft: DraftRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const minutesAgo = Math.floor(
    (Date.now() - new Date(draft.generatedAt).getTime()) / 60000
  );
  const timeLabel =
    minutesAgo < 60
      ? `${minutesAgo} דק׳`
      : minutesAgo < 60 * 24
      ? `${Math.floor(minutesAgo / 60)} שעות`
      : `${Math.floor(minutesAgo / 60 / 24)} ימים`;

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: "right",
        background: selected ? colors.accent : "white",
        color: selected ? "white" : colors.ink,
        border: `1px solid ${selected ? colors.accent : colors.rule}`,
        borderRadius: 6,
        padding: `${space.sm}px ${space.md}px`,
        cursor: "pointer",
        fontFamily: fontStack.body,
        fontSize: size.sm,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: space.sm }}>
        <span style={{ fontWeight: weight.medium }}>
          {draft.leadName || draft.leadPhone || draft.manychatSubId}
        </span>
        <span
          style={{
            fontSize: size.xs,
            opacity: selected ? 0.85 : 0.55,
            whiteSpace: "nowrap",
          }}
        >
          {timeLabel}
        </span>
      </div>
      <div
        style={{
          fontSize: size.xs,
          opacity: selected ? 0.9 : 0.7,
        }}
      >
        {draft.leadStage ?? "—"}
        {draft.moneyReason ? ` · ${draft.moneyReason}` : ""}
      </div>
      <div
        style={{
          fontSize: size.xs,
          opacity: selected ? 0.85 : 0.6,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {draft.draftText}
      </div>
    </button>
  );
}

function DraftDetail({ draft }: { draft: DraftRow }) {
  const [text, setText] = useState(draft.draftText);
  const [reason, setReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const approve = () => {
    setMsg(null);
    const edited = text.trim() === draft.draftText.trim() ? undefined : text;
    startTransition(async () => {
      const r = await approveDraftAction(draft.id, edited);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נשלח" : r.error ?? "כשל" });
    });
  };

  const reject = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await rejectDraftAction(draft.id, reason.trim() || undefined);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נדחה" : r.error ?? "כשל" });
      if (r.ok) setShowReject(false);
    });
  };

  const waLink = draft.leadPhone
    ? `https://wa.me/${draft.leadPhone.replace(/[^0-9]/g, "")}`
    : null;

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: space.md }}>
        <div>
          <div
            style={{
              fontFamily: fontStack.display,
              fontSize: size.xl,
              fontWeight: weight.medium,
              color: colors.ink,
            }}
          >
            {draft.leadName || "(ללא שם)"}
          </div>
          <div
            style={{
              fontFamily: fontStack.body,
              fontSize: size.xs,
              color: colors.inkMuted,
              marginTop: 4,
              display: "flex",
              gap: space.sm,
              flexWrap: "wrap",
            }}
          >
            <span>{draft.leadPhone || draft.manychatSubId}</span>
            <span>· שלב {draft.leadStage ?? "—"}</span>
            {draft.leadFlag && <span>· {draft.leadFlag}</span>}
            {draft.moneyReason && <span>· {draft.moneyReason}</span>}
            {draft.leadBotPaused && <span>· bot paused</span>}
          </div>
        </div>

        {draft.leadBotSummary && (
          <div
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: colors.inkMuted,
              background: "#fafafa",
              border: `1px solid ${colors.rule}`,
              borderRadius: 6,
              padding: `${space.sm}px ${space.md}px`,
            }}
          >
            <div style={{ fontSize: size.xs, color: colors.inkMuted, marginBottom: 4 }}>
              סיכום הבוט
            </div>
            {draft.leadBotSummary}
          </div>
        )}

        {draft.lastInboundText && (
          <div
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: colors.ink,
              background: "#f0f7ff",
              border: `1px solid ${colors.rule}`,
              borderRadius: 6,
              padding: `${space.sm}px ${space.md}px`,
            }}
          >
            <div style={{ fontSize: size.xs, color: colors.inkMuted, marginBottom: 4 }}>
              הודעה אחרונה מהלקוח
            </div>
            {draft.lastInboundText}
          </div>
        )}

        <div>
          <label
            style={{
              display: "block",
              fontFamily: fontStack.body,
              fontSize: size.xs,
              color: colors.inkMuted,
              marginBottom: space.xs,
            }}
          >
            טיוטה לאישור (אפשר לערוך)
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontFamily: fontStack.body,
              fontSize: size.md,
              padding: `${space.sm}px ${space.md}px`,
              borderRadius: 6,
              border: `1px solid ${colors.rule}`,
              resize: "vertical",
              direction: "rtl",
            }}
            disabled={isPending}
          />
        </div>

        <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={approve}
            disabled={isPending || !text.trim()}
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              fontWeight: weight.medium,
              padding: `${space.sm}px ${space.lg}px`,
              borderRadius: 6,
              border: `1px solid ${colors.accent}`,
              background: colors.accent,
              color: "white",
              cursor: isPending ? "wait" : "pointer",
              opacity: isPending || !text.trim() ? 0.6 : 1,
            }}
          >
            {isPending ? "שולח…" : "אשר ושלח"}
          </button>
          <button
            type="button"
            onClick={() => setShowReject((v) => !v)}
            disabled={isPending}
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              fontWeight: weight.medium,
              padding: `${space.sm}px ${space.lg}px`,
              borderRadius: 6,
              border: `1px solid ${colors.rule}`,
              background: "white",
              color: colors.ink,
              cursor: "pointer",
            }}
          >
            דחה
          </button>
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: fontStack.body,
                fontSize: size.sm,
                fontWeight: weight.medium,
                padding: `${space.sm}px ${space.lg}px`,
                borderRadius: 6,
                border: `1px solid ${colors.rule}`,
                background: "white",
                color: colors.ink,
                textDecoration: "none",
              }}
            >
              פתח ב-WhatsApp ↗
            </a>
          )}
        </div>

        {showReject && (
          <div
            style={{
              display: "flex",
              gap: space.sm,
              alignItems: "center",
              paddingTop: space.sm,
              borderTop: `1px dashed ${colors.rule}`,
            }}
          >
            <input
              type="text"
              placeholder="סיבה (אופציונלי)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              style={{
                flex: 1,
                fontFamily: fontStack.body,
                fontSize: size.sm,
                padding: `${space.xs}px ${space.sm}px`,
                borderRadius: 4,
                border: `1px solid ${colors.rule}`,
                direction: "rtl",
              }}
            />
            <button
              type="button"
              onClick={reject}
              disabled={isPending}
              style={{
                fontFamily: fontStack.body,
                fontSize: size.sm,
                padding: `${space.xs}px ${space.md}px`,
                borderRadius: 4,
                border: `1px solid #c62828`,
                background: "#c62828",
                color: "white",
                cursor: isPending ? "wait" : "pointer",
              }}
            >
              אישור דחייה
            </button>
          </div>
        )}

        {msg && (
          <div
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: msg.ok ? "#2e7d32" : "#c62828",
            }}
          >
            {msg.text}
          </div>
        )}
      </div>
    </Card>
  );
}
