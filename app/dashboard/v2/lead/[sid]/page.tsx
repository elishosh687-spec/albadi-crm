import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { leads, pipelineSuggestions, messages, eliDecisions } from "@/drizzle/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { colors, fontStack, leading, size, space, weight } from "@/lib/ui/tokens";
import { getSubscriber, getFieldValue } from "@/lib/manychat/client";
import { NotesEditor } from "../../NotesEditor";
import { LeadActions } from "./LeadActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const FLAG_TONES: Record<string, "danger" | "warning" | "info" | "accent" | "neutral"> = {
  "דחוף": "danger",
  "עסקה_גדולה": "accent",
  "ביקש_שיחה": "warning",
  "אחרי_החג": "info",
  "מועדף": "accent",
};

const KEY_FIELDS = [
  "notes",
  "quote_total",
  "quote_result",
  "quote_alt",
  "quantity",
  "colors",
  "lamination",
  "product",
  "handles",
  "shipping",
  "pipeline_stage",
  "last_contact_date",
  "last_contact_type",
  "next_action",
  "bot_summary",
];

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ sid: string }>;
}) {
  const { sid } = await params;
  const cleanSid = decodeURIComponent(sid).trim();

  const [leadRow] = await db
    .select()
    .from(leads)
    .where(eq(leads.manychatSubId, cleanSid))
    .limit(1);
  if (!leadRow) notFound();

  let mc: any = null;
  let mcError: string | null = null;
  try {
    mc = await getSubscriber(cleanSid);
  } catch (e: any) {
    mcError = e?.message ?? "fetch failed";
  }

  const currentNotes = mc ? (getFieldValue(mc.custom_fields, "notes") as string | null) : null;

  const [pending] = await db
    .select()
    .from(pipelineSuggestions)
    .where(
      and(
        eq(pipelineSuggestions.manychatSubId, cleanSid),
        eq(pipelineSuggestions.status, "pending_review")
      )
    )
    .orderBy(desc(pipelineSuggestions.createdAt))
    .limit(1);

  const recentDecisions = await db
    .select()
    .from(eliDecisions)
    .where(eq(eliDecisions.manychatSubId, cleanSid))
    .orderBy(desc(eliDecisions.decidedAt))
    .limit(5);

  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const recentMessages = await db
    .select({
      direction: messages.direction,
      text: messages.text,
      receivedAt: messages.receivedAt,
    })
    .from(messages)
    .where(
      and(eq(messages.manychatSubId, cleanSid), gte(messages.receivedAt, sixtyDaysAgo))
    )
    .orderBy(desc(messages.receivedAt))
    .limit(20);

  const displayName = mc?.name ?? leadRow.name ?? cleanSid;

  return (
    <div>
      <div style={{ marginBottom: space.md }}>
        <Link
          href="/dashboard/v2"
          style={{ fontFamily: fontStack.body, fontSize: size.sm, color: colors.accent }}
        >
          ← חזרה ל-Inbox
        </Link>
      </div>

      <Page
        title={displayName}
        description={`sub_id: ${cleanSid}`}
      />

      <div style={{ marginBottom: space.lg }}>
        <a
          href={`https://app.manychat.com/fb4499581/chat/${encodeURIComponent(cleanSid)}`}
          target="_blank"
          rel="noreferrer"
          style={{ fontFamily: fontStack.body, fontSize: size.sm, color: colors.accent }}
        >
          Live Chat ManyChat ↗
        </a>
      </div>

      {mcError && (
        <Card title="שגיאת ManyChat">
          <p style={{ fontFamily: fontStack.body, fontSize: size.sm, color: colors.danger, margin: 0 }}>
            {mcError}
          </p>
        </Card>
      )}

      <Card title="הערות (notes)">
        <NotesEditor manychatSubId={cleanSid} initialNotes={currentNotes} />
      </Card>

      {pending && (
        <Card title="הצעה ממתינה — Claude">
          <div
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: colors.inkMuted,
              marginBottom: space.sm,
            }}
          >
            <span style={{ fontWeight: weight.medium, color: colors.ink }}>
              {pending.prevStage ?? "—"}
            </span>{" → "}
            <span style={{ fontWeight: weight.semibold, color: colors.accent }}>
              {pending.suggestedStage}
            </span>
            {pending.suggestedFlags && (pending.suggestedFlags as string[]).length > 0 && (
              <span style={{ marginInlineStart: space.md, display: "inline-flex", gap: space.xs, flexWrap: "wrap" }}>
                {(pending.suggestedFlags as string[]).map((f) => (
                  <Badge key={f} tone={FLAG_TONES[f] ?? "neutral"}>
                    {f}
                  </Badge>
                ))}
              </span>
            )}
          </div>

          {pending.suggestedSummary && (
            <div
              style={{
                fontFamily: fontStack.body,
                fontSize: size.md,
                color: colors.ink,
                fontStyle: "italic",
                marginBottom: space.sm,
              }}
            >
              {pending.suggestedSummary}
            </div>
          )}

          <div
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: colors.inkMuted,
              lineHeight: leading.normal,
              marginBottom: space.md,
              whiteSpace: "pre-wrap",
            }}
          >
            {pending.reason}
          </div>

          {pending.suggestedNextAction && (
            <div
              style={{
                fontFamily: fontStack.body,
                fontSize: size.sm,
                color: colors.success,
                marginBottom: space.md,
              }}
            >
              <span style={{ fontWeight: weight.medium }}>Next:</span> {pending.suggestedNextAction}
            </div>
          )}

          <LeadActions suggestionId={pending.id} suggestedStage={pending.suggestedStage} />
        </Card>
      )}

      {mc && (
        <Card title="ManyChat — שדות מרכזיים">
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "max-content 1fr",
              gap: `${space.xs}px ${space.lg}px`,
              fontFamily: fontStack.body,
              fontSize: size.sm,
              margin: 0,
            }}
          >
            {KEY_FIELDS.map((name) => {
              const v = getFieldValue(mc.custom_fields, name as any);
              if (v == null || v === "") return null;
              return (
                <>
                  <dt key={`${name}-k`} style={{ color: colors.inkMuted, fontWeight: weight.medium }}>{name}</dt>
                  <dd key={`${name}-v`} style={{ margin: 0, color: colors.ink, whiteSpace: "pre-wrap" }}>
                    {String(v)}
                  </dd>
                </>
              );
            })}
          </dl>
        </Card>
      )}

      <Card title={`הודעות אחרונות (${recentMessages.length})`}>
        {recentMessages.length === 0 ? (
          <p style={{ fontFamily: fontStack.body, fontSize: size.sm, color: colors.inkMuted, margin: 0 }}>
            אין הודעות ב-60 הימים האחרונים.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: space.sm }}>
            {recentMessages.map((m, i) => (
              <li
                key={i}
                style={{
                  borderInlineStart: `3px solid ${m.direction === "in" ? colors.accent : colors.success}`,
                  paddingInlineStart: space.md,
                  fontFamily: fontStack.body,
                  fontSize: size.sm,
                  color: colors.ink,
                }}
              >
                <div style={{ color: colors.inkMuted, fontSize: size.xs, marginBottom: space.xs }}>
                  [{m.receivedAt.toISOString().slice(0, 16).replace("T", " ")}] {m.direction === "in" ? "מהלקוח" : "אלינו"}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.text ?? "—"}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`החלטות אחרונות (${recentDecisions.length})`}>
        {recentDecisions.length === 0 ? (
          <p style={{ fontFamily: fontStack.body, fontSize: size.sm, color: colors.inkMuted, margin: 0 }}>
            אין החלטות.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: space.sm }}>
            {recentDecisions.map((d) => (
              <li
                key={d.id}
                style={{
                  fontFamily: fontStack.body,
                  fontSize: size.sm,
                  color: colors.ink,
                  borderTop: `1px solid ${colors.ruleSoft}`,
                  paddingTop: space.sm,
                }}
              >
                <div style={{ color: colors.inkMuted, fontSize: size.xs, marginBottom: space.xs }}>
                  [{d.decidedAt.toISOString().slice(0, 16).replace("T", " ")}] {d.action}
                </div>
                <div>
                  Claude: {(d.claudeSuggested as any)?.stage ?? "—"} → אתה: {(d.eliChose as any)?.stage ?? "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
