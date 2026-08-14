/**
 * Bot playground session — a disposable lead the real bot handlers run against.
 *
 * Design notes:
 *  - The sid is prefixed `playground:` so guards elsewhere can recognise it,
 *    and the name carries "בדיקה" so the existing `isInternalLead` filter in
 *    callback-request.ts skips it.
 *  - `active = false` keeps it out of the followups cron and the callback
 *    detector. `ghl_contact_id` stays NULL and nothing here calls
 *    syncLeadToGHL — the handlers themselves never sync (only the webhooks
 *    do), so a playground run creates no GHL contact or opportunity.
 *  - `wa_jid` is required: loadLeadCtx returns null without a jid or phone,
 *    and then handleInbound would no-op. It is deliberately NOT a real phone
 *    number, so even if interception failed the send could not reach a person.
 *  - Messages ARE written to the `messages` table for this sid. The bot reads
 *    conversation history for its LLM fallbacks, so skipping this would make
 *    the playground behave differently from production. Reset deletes them.
 */
import { db } from "../db";
import { leads, messages, botDrafts, botQuotes } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import type { CapturedSend } from "./capture";

export const PLAYGROUND_SID = "playground:bot";
/** Not a routable number — nothing can be delivered to it. */
const PLAYGROUND_JID = "playground@c.us";
const PLAYGROUND_NAME = "מגרש בדיקות (בדיקה)";

export interface PlaygroundMessage {
  id: number;
  direction: "in" | "out";
  text: string | null;
  sender: string | null;
  receivedAt: string;
  /** Poll options / buttons, when the bot sent an interactive message. */
  options?: string[];
  kind?: string;
}

/** Create the playground lead if missing. Idempotent. */
export async function ensurePlaygroundLead(): Promise<void> {
  await db
    .insert(leads)
    .values({
      manychatSubId: PLAYGROUND_SID,
      name: PLAYGROUND_NAME,
      waJid: PLAYGROUND_JID,
      active: false,
      source: "playground",
      pipelineStage: null,
      qState: null,
      botPaused: false,
    })
    .onConflictDoNothing();
}

/** Wipe the conversation and all bot state, keeping the lead row itself. */
export async function resetPlayground(): Promise<void> {
  await ensurePlaygroundLead();
  await db.delete(messages).where(eq(messages.manychatSubId, PLAYGROUND_SID));
  await db.delete(botDrafts).where(eq(botDrafts.manychatSubId, PLAYGROUND_SID));
  await db.delete(botQuotes).where(eq(botQuotes.leadSid, PLAYGROUND_SID));
  await db
    .update(leads)
    .set({
      qState: null,
      pipelineStage: null,
      pipelineFlag: null,
      botPaused: false,
      botSummary: null,
      quoteTotal: null,
      updatedAt: new Date(),
    })
    .where(eq(leads.manychatSubId, PLAYGROUND_SID));
}

/** Record the customer's message exactly as the webhook would. */
export async function recordInbound(text: string): Promise<void> {
  await db.insert(messages).values({
    manychatSubId: PLAYGROUND_SID,
    direction: "in",
    text,
    sender: "lead",
    payload: { from: "playground" },
  });
}

/**
 * Persist what the bot produced. Eli DMs are stored too (marked in payload) so
 * the transcript shows the internal alerts inline, the way they really fire.
 */
export async function recordCaptured(sends: CapturedSend[]): Promise<void> {
  if (sends.length === 0) return;
  await db.insert(messages).values(
    sends.map((s) => ({
      manychatSubId: PLAYGROUND_SID,
      direction: "out",
      text: s.text,
      sender: s.kind === "eli_dm" ? "system" : s.sender,
      payload: {
        from: "playground",
        kind: s.kind,
        options: s.options,
        buttons: s.buttons,
        mediaPath: s.mediaPath,
      } as Record<string, unknown>,
    }))
  );
}

export async function loadTranscript(): Promise<PlaygroundMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.manychatSubId, PLAYGROUND_SID))
    .orderBy(messages.id);
  return rows.map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const opts = Array.isArray(p.options)
      ? (p.options as string[])
      : Array.isArray(p.buttons)
        ? (p.buttons as string[])
        : undefined;
    return {
      id: r.id,
      direction: r.direction === "in" ? "in" : "out",
      text: r.text,
      sender: r.sender,
      receivedAt: r.receivedAt.toISOString(),
      options: opts,
      kind: typeof p.kind === "string" ? p.kind : undefined,
    };
  });
}

export interface PlaygroundLeadState {
  pipelineStage: string | null;
  pipelineFlag: string | null;
  botPaused: boolean;
  qState: Record<string, unknown> | null;
}

export async function loadLeadState(): Promise<PlaygroundLeadState> {
  const [row] = await db
    .select({
      pipelineStage: leads.pipelineStage,
      pipelineFlag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      qState: leads.qState,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${PLAYGROUND_SID}`)
    .limit(1);
  return {
    pipelineStage: row?.pipelineStage ?? null,
    pipelineFlag: row?.pipelineFlag ?? null,
    botPaused: row?.botPaused ?? false,
    qState: (row?.qState as Record<string, unknown> | null) ?? null,
  };
}

/**
 * Put the playground lead into "waiting for a callback time" so the reply
 * handler can be exercised. Mirrors markCallbackAsked in callback-request.ts,
 * which is module-private there.
 */
export async function markCallbackAskedForPlayground(): Promise<void> {
  const patch = JSON.stringify({
    callbackFlow: "awaiting_reply",
    callbackAskedAt: new Date().toISOString(),
  });
  await db
    .update(leads)
    .set({
      qState: sql`COALESCE(${leads.qState}, '{}'::jsonb) || ${patch}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(leads.manychatSubId, PLAYGROUND_SID));
}

/**
 * Time travel — shift the playground conversation into the past by N hours.
 *
 * Follow-up behaviour is driven by message timestamps, so testing "customer
 * silent for 3 days" used to require waiting 3 days. This rewrites the
 * playground rows' received_at backwards; every consumer (setter context,
 * callback detector, follow-up logic) then sees a genuinely old conversation.
 * Playground-only by construction — it touches only the playground sid.
 */
export async function shiftPlaygroundTime(hours: number): Promise<void> {
  const h = Math.max(1, Math.min(24 * 30, Math.round(hours)));
  await db.execute(
    sql`UPDATE messages SET received_at = received_at - make_interval(hours => ${h}) WHERE manychat_sub_id = ${PLAYGROUND_SID}`
  );
  await db.execute(
    sql`UPDATE leads SET updated_at = updated_at - make_interval(hours => ${h}), created_at = created_at - make_interval(hours => ${h}) WHERE manychat_sub_id = ${PLAYGROUND_SID}`
  );
}
