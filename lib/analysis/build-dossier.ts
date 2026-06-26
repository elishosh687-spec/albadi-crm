/**
 * Per-lead dossier builder — assembles EVERYTHING about one lead into a single
 * structured object + a Hebrew text render for the LLM judge.
 *
 * This is the foundation of the bottom-up lead analysis: the judge only ever
 * sees one lead's own data, so every quote it produces is grounded in this
 * lead's calls/messages (verified later in analyze-lead.ts).
 *
 * Join strategy (mirrors scripts/_build-research-dataset.ts):
 *   - GHL-native calls   → join on leads.ghl_contact_id
 *   - ElevenLabs calls   → join on phone digits
 *   - WhatsApp timeline  → messages by manychat_sub_id
 *   - Quote history      → bot_quotes by lead_sid
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";

export interface DossierCall {
  source: "ghl" | "elevenlabs";
  startedAt: string | null;
  durationSec: number | null;
  sentiment: string | null;
  summary: string | null;
  transcript: string | null;
}

export interface DossierMessage {
  dir: string | null;
  sender: string | null;
  text: string | null;
  at: string | null;
}

export interface DossierQuote {
  source: string;
  totalIls: number | null;
  altTotalIls: number | null;
  text: string | null;
  sentAt: string | null;
}

export interface LeadDossier {
  sid: string;
  name: string | null;
  phone: string | null;
  ghlContactId: string | null;
  stage: string | null;
  lossReason: string | null;
  notes: string | null;
  quoteTotal: string | null;
  quoteAlt: string | null;
  createdAt: string | null;
  quotes: DossierQuote[];
  calls: DossierCall[];
  messages: DossierMessage[];
  stats: { callCount: number; messageCount: number; quoteCount: number };
}

// Keep the LLM payload bounded — both to control cost and to fit the OpenAI
// account's tokens-per-minute tier (30K TPM as of 2026-06). A single garrulous
// lead can have 30k-char transcripts; we trim each and cap the whole render so
// one analysis stays well under the per-minute budget (and several can run per
// minute). Raising the OpenAI tier later lets these caps grow for richer
// grounding.
const MAX_TRANSCRIPT_CHARS = 3000;
const MAX_RENDER_CHARS = 14000;

export async function buildLeadDossier(sid: string): Promise<LeadDossier | null> {
  const clean = sid.trim();

  const leadRes = await db.execute(sql`
    SELECT manychat_sub_id, name, phone_e164, ghl_contact_id, pipeline_stage,
           loss_reason, notes, quote_total, quote_alt, created_at
    FROM leads
    WHERE trim(manychat_sub_id) = ${clean}
    LIMIT 1
  `);
  if (!leadRes.rows.length) return null;
  const l = leadRes.rows[0] as Record<string, unknown>;
  const ghlContactId = (l.ghl_contact_id as string) ?? null;
  const phone = (l.phone_e164 as string) ?? null;

  const quotesRes = await db.execute(sql`
    SELECT source, quote_total_ils, quote_alt_total_ils, quote_text, sent_at
    FROM bot_quotes
    WHERE lead_sid = ${clean}
    ORDER BY sent_at ASC
  `);

  const ghlCallsRes = ghlContactId
    ? await db.execute(sql`
        SELECT call_started_at, call_duration_sec, analysis, transcript
        FROM call_recording_imports
        WHERE ghl_contact_id = ${ghlContactId} AND transcript IS NOT NULL
        ORDER BY call_started_at ASC NULLS LAST
      `)
    : { rows: [] as Record<string, unknown>[] };

  const elevenCallsRes = phone
    ? await db.execute(sql`
        SELECT call_started_at, call_duration_sec, analysis, transcript, eleven_summary
        FROM elevenlabs_call_imports
        WHERE transcript IS NOT NULL
          AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') <> ''
          AND ${phone.replace(/[^0-9]/g, "")} LIKE '%' || regexp_replace(phone,'[^0-9]','','g')
        ORDER BY call_started_at ASC NULLS LAST
      `)
    : { rows: [] as Record<string, unknown>[] };

  const msgsRes = await db.execute(sql`
    SELECT direction, sender, text, received_at
    FROM messages
    WHERE manychat_sub_id = ${clean}
    ORDER BY received_at ASC
  `);

  const calls: DossierCall[] = [
    ...(ghlCallsRes.rows as Record<string, unknown>[]).map((r) => ({
      source: "ghl" as const,
      startedAt: asIso(r.call_started_at),
      durationSec: (r.call_duration_sec as number) ?? null,
      sentiment: (r.analysis as { sentiment?: string } | null)?.sentiment ?? null,
      summary: (r.analysis as { call_summary?: string } | null)?.call_summary ?? null,
      transcript: trim((r.transcript as string) ?? null, MAX_TRANSCRIPT_CHARS),
    })),
    ...(elevenCallsRes.rows as Record<string, unknown>[]).map((r) => ({
      source: "elevenlabs" as const,
      startedAt: asIso(r.call_started_at),
      durationSec: (r.call_duration_sec as number) ?? null,
      sentiment: (r.analysis as { sentiment?: string } | null)?.sentiment ?? null,
      summary:
        (r.analysis as { call_summary?: string } | null)?.call_summary ??
        ((r.eleven_summary as string) ?? null),
      transcript: trim((r.transcript as string) ?? null, MAX_TRANSCRIPT_CHARS),
    })),
  ].sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));

  const messages: DossierMessage[] = (msgsRes.rows as Record<string, unknown>[]).map(
    (r) => ({
      dir: (r.direction as string) ?? null,
      sender: (r.sender as string) ?? null,
      text: (r.text as string) ?? null,
      at: asIso(r.received_at),
    })
  );

  const quotes: DossierQuote[] = (quotesRes.rows as Record<string, unknown>[]).map(
    (r) => ({
      source: (r.source as string) ?? "",
      totalIls: (r.quote_total_ils as number) ?? null,
      altTotalIls: (r.quote_alt_total_ils as number) ?? null,
      text: (r.quote_text as string) ?? null,
      sentAt: asIso(r.sent_at),
    })
  );

  return {
    sid: clean,
    name: (l.name as string) ?? null,
    phone,
    ghlContactId,
    stage: (l.pipeline_stage as string) ?? null,
    lossReason: (l.loss_reason as string) ?? null,
    notes: (l.notes as string) ?? null,
    quoteTotal: (l.quote_total as string) ?? null,
    quoteAlt: (l.quote_alt as string) ?? null,
    createdAt: asIso(l.created_at),
    quotes,
    calls,
    messages,
    stats: {
      callCount: calls.length,
      messageCount: messages.length,
      quoteCount: quotes.length,
    },
  };
}

/** True when there's basically nothing to analyze. */
export function isThinDossier(d: LeadDossier): boolean {
  const transcriptChars = d.calls.reduce(
    (n, c) => n + (c.transcript?.length ?? 0),
    0
  );
  return d.calls.length === 0 && d.messages.length < 3 && transcriptChars === 0;
}

/** Stable hash of the analysis-relevant inputs → cache key for skip-if-unchanged. */
export function hashDossier(d: LeadDossier): string {
  const material = JSON.stringify({
    stage: d.stage,
    lossReason: d.lossReason,
    notes: d.notes,
    quotes: d.quotes.map((q) => [q.source, q.totalIls, q.text]),
    calls: d.calls.map((c) => [c.startedAt, c.transcript]),
    messages: d.messages.map((m) => [m.at, m.sender, m.text]),
  });
  return createHash("sha256").update(material).digest("hex");
}

/** Hebrew text render fed to the LLM judge. */
export function renderDossierText(d: LeadDossier): string {
  const parts: string[] = [];
  parts.push(`# תיק ליד`);
  parts.push(
    `שם: ${d.name ?? "—"} | טלפון: ${d.phone ?? "—"} | שלב: ${d.stage ?? "—"}` +
      (d.lossReason ? ` | סיבת הפסד: ${d.lossReason}` : "")
  );
  if (d.notes) parts.push(`הערות אלי: ${d.notes}`);
  if (d.quoteTotal) parts.push(`הצעה אחרונה רשומה: ${d.quoteTotal}`);

  if (d.quotes.length) {
    parts.push(`\n## הצעות מחיר שנשלחו (${d.quotes.length})`);
    d.quotes.forEach((q, i) => {
      parts.push(
        `[${i + 1}] ${q.sentAt ?? ""} (${q.source}) סה"כ ${q.totalIls ?? "?"}₪` +
          (q.altTotalIls ? ` / חלופי ${q.altTotalIls}₪` : "")
      );
      if (q.text) parts.push(q.text);
    });
  }

  // Call SUMMARIES are compact + high-signal → always in the core.
  if (d.calls.length) {
    parts.push(`\n## שיחות טלפון (${d.calls.length}) — סיכומים`);
    d.calls.forEach((c, i) => {
      parts.push(
        `[${i + 1}] ${c.startedAt ?? ""} (${c.source}, סנטימנט ${c.sentiment ?? "?"}): ${
          c.summary ?? "—"
        }`
      );
    });
  }

  // WhatsApp timeline — short, high-signal (objection quotes live here too).
  if (d.messages.length) {
    parts.push(`\n## שרשור וואטסאפ (${d.messages.length} הודעות)`);
    d.messages.forEach((m) => {
      const who =
        m.sender === "lead" || m.dir === "in"
          ? "לקוח"
          : m.sender === "eli"
          ? "אלי"
          : "בוט";
      parts.push(`[${m.at ?? ""}] ${who}: ${m.text ?? ""}`);
    });
  }

  // Core (header + quotes + summaries + messages) is never truncated. Raw
  // transcripts are the trimmable tail — append only what fits the budget so
  // the high-signal evidence above always survives the TPM cap.
  let text = parts.join("\n");
  let budget = MAX_RENDER_CHARS - text.length;
  if (budget > 500 && d.calls.some((c) => c.transcript)) {
    const transcripts: string[] = ["\n## תמלולי שיחות (גולמי)"];
    for (let i = 0; i < d.calls.length; i++) {
      const t = d.calls[i].transcript;
      if (t) transcripts.push(`\n### תמלול שיחה ${i + 1}\n${t}`);
    }
    const tail = transcripts.join("\n");
    text += tail.length > budget ? tail.slice(0, budget) + "\n…[נחתך]" : tail;
  }
  return text;
}

/**
 * Resolve a free-form identifier (sid / phone / name) to candidate leads.
 * Used by the test/seed scripts; the widget passes a sid directly.
 */
export async function resolveLeadSid(
  query: string
): Promise<{ sid: string; name: string | null }[]> {
  const q = query.trim();
  const digits = q.replace(/[^0-9]/g, "");
  const res = await db.execute(sql`
    SELECT manychat_sub_id AS sid, name FROM leads
    WHERE trim(manychat_sub_id) = ${q}
       OR (${digits} <> '' AND regexp_replace(COALESCE(phone_e164,''),'[^0-9]','','g') LIKE '%' || ${digits} || '%')
       OR (${q} <> '' AND name ILIKE '%' || ${q} || '%')
    LIMIT 25
  `);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    sid: r.sid as string,
    name: (r.name as string) ?? null,
  }));
}

function asIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function trim(s: string | null, max: number): string | null {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) + " …[נחתך]" : s;
}
