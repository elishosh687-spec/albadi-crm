// Server-only GHL (GoHighLevel) config. Mirrors lib/bridge/config.ts pattern.
// Client components MUST NOT import this file — it reads tokens.
//
// GHL API V2 base: https://services.leadconnectorhq.com
// All requests need:
//   Authorization: Bearer <token>
//   Version: 2021-07-28
//   Accept: application/json

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

// ---- Core ----

export const GHL_BASE = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-07-28";

export function requireGHLToken(): string {
  // Accept either a Location-scoped Private Integration Token (preferred for
  // single-location apps) or an OAuth access token.
  const t = readEnv("GHL_API_KEY") || readEnv("GHL_ACCESS_TOKEN");
  if (!t) throw new Error("GHL_API_KEY (or GHL_ACCESS_TOKEN) is not set");
  return t;
}

export function requireGHLLocationId(): string {
  const id = readEnv("GHL_LOCATION_ID");
  if (!id) throw new Error("GHL_LOCATION_ID is not set");
  return id;
}

export const GHL_PIPELINE_ID = readEnv("GHL_PIPELINE_ID");

// Custom Conversation Provider id (assigned by GHL when our Marketplace App
// is installed in the location). When set, messages mirrored into GHL via
// forwardMessage are routed through this provider so inbound + outbound
// share a single thread tagged "Albadi WhatsApp" in the Inbox.
export const GHL_CONVERSATION_PROVIDER_ID = readEnv(
  "GHL_CONVERSATION_PROVIDER_ID"
);

// Toggle to start mirroring leads/messages to GHL. Off by default until
// bootstrap script populates all stage + custom-field ids.
export const ENABLE_GHL_SYNC = readEnv("ENABLE_GHL_SYNC") === "1";

// ---- Pipeline stage mapping ----
// Local stage  →  GHL Opportunity Stage ID (UUID)
// Mirrors lib/manychat/stages.ts → V2_PIPELINE_STAGES (4-stage funnel post
// 2026-06-07 rename; merged INITIAL_QUOTE_SENT + AWAITING_FIRST_RESPONSE
// into INTAKE and FINAL_QUOTE_SENT + NEGOTIATING into CONSIDERATION).
export const GHL_STAGE_IDS: Record<string, string> = {
  INTAKE: readEnv("GHL_STAGE_INTAKE"),
  DISCAVERY: readEnv("GHL_STAGE_DISCAVERY"),
  FACTORY_WAIT: readEnv("GHL_STAGE_FACTORY_WAIT"),
  CONSIDERATION: readEnv("GHL_STAGE_CONSIDERATION"),
  WON: readEnv("GHL_STAGE_WON"),
  LOST: readEnv("GHL_STAGE_LOST"),
  // Manual stage Eli drags opps into when a customer asks to circle back
  // later (e.g. "תחזור אליי בעוד חודש"). Bot does NOT followup here — the
  // cron has no STAGE_RULE for it. Without this entry, reverseLookupStage
  // returns null on drag → DB stays at the prior stage → next
  // syncLeadToGHL push reverts the opp to that prior stage in the UI.
  FUTURE_FOLLOW_UP: readEnv("GHL_STAGE_FUTURE_FOLLOW_UP"),
  // Manual stage Eli drags opps into when a customer has been completely
  // unresponsive (3+ calls and 3+ messages with no reply). The bot then
  // runs a low-frequency re-engagement loop (every 3 days, skipping
  // holidays/sabbaths) with an LLM-personalized message until the customer
  // replies, opts out ("הסר"), or Eli manually drags the opp to LOST. See
  // app/api/bot/followups/route.ts STAGE_RULE for the cadence.
  NO_RESPONSE_REENGAGE: readEnv("GHL_STAGE_NO_RESPONSE_REENGAGE"),
  // Virtual stage triggered when leads.pipeline_flag = 'NEEDS_ELI'.
  // Overrides whatever local pipeline_stage says (escalations bubble up).
  NEEDS_ELI: readEnv("GHL_STAGE_NEEDS_ELI"),
};

// ---- Custom field ids ----
//
// Minimal set. Calculator widget (embedded as iframe in GHL contact card)
// reads the full q_state directly from the Albadi DB — GHL does NOT need to
// hold the questionnaire fields. Only what Eli needs to SEE/SEARCH inside
// the GHL native UI without opening the calc.
//
// 6 fields total:
//   - manychat_sub_id  → sync key (mapping back to Albadi DB)
//   - wa_jid           → debugging
//   - bot_summary      → one-line status on lead card
//   - quote_total      → monetary value (also sets Opportunity.monetaryValue)
//   - pipeline_flag    → NEEDS_ELI escalation visibility (search/filter)
//   - loss_reason      → required when stage = LOST (one of LOSS_REASONS)
export const GHL_FIELD_IDS: Record<string, string> = {
  manychat_sub_id: readEnv("GHL_FIELD_MANYCHAT_SUB_ID"),
  wa_jid: readEnv("GHL_FIELD_WA_JID"),
  bot_summary: readEnv("GHL_FIELD_BOT_SUMMARY"),
  quote_total: readEnv("GHL_FIELD_QUOTE_TOTAL"),
  pipeline_flag: readEnv("GHL_FIELD_PIPELINE_FLAG"),
  loss_reason: readEnv("GHL_FIELD_LOSS_REASON"),
  bot_paused: readEnv("GHL_FIELD_BOT_PAUSED"),
  follow_up_date: readEnv("GHL_FIELD_FOLLOW_UP_DATE"),
  follow_up_count: readEnv("GHL_FIELD_FOLLOW_UP_COUNT"),
  next_action: readEnv("GHL_FIELD_NEXT_ACTION"),
  lead_owner: readEnv("GHL_FIELD_LEAD_OWNER"),
  lead_score: readEnv("GHL_FIELD_LEAD_SCORE"),
  next_action_v2: readEnv("GHL_FIELD_NEXT_ACTION_V2"),
};

// Names used when creating fields in the bootstrap script. The bootstrap
// reads existing custom fields and only creates the missing ones, then
// prints an env block for the user to paste.
export const GHL_FIELD_DEFINITIONS = [
  {
    envKey: "GHL_FIELD_MANYCHAT_SUB_ID",
    name: "ManyChat sub id / JID",
    dataType: "TEXT",
  },
  { envKey: "GHL_FIELD_WA_JID", name: "WhatsApp JID", dataType: "TEXT" },
  {
    envKey: "GHL_FIELD_BOT_SUMMARY",
    name: "Bot summary",
    dataType: "LARGE_TEXT",
  },
  {
    envKey: "GHL_FIELD_QUOTE_TOTAL",
    name: "Quote total (ILS)",
    dataType: "MONETORY", // sic — GHL API typo, validated 2026-05-XX
  },
  {
    envKey: "GHL_FIELD_PIPELINE_FLAG",
    name: "Pipeline flag",
    dataType: "TEXT",
  },
  {
    envKey: "GHL_FIELD_LOSS_REASON",
    name: "Loss reason",
    dataType: "TEXT",
  },
  {
    envKey: "GHL_FIELD_FOLLOW_UP_DATE",
    name: "Follow-up Date",
    dataType: "DATE",
  },
  {
    envKey: "GHL_FIELD_FOLLOW_UP_COUNT",
    name: "Follow-up Count",
    dataType: "NUMERICAL",
  },
  {
    envKey: "GHL_FIELD_NEXT_ACTION",
    name: "Next Action",
    dataType: "TEXT",
  },
  {
    envKey: "GHL_FIELD_LEAD_OWNER",
    name: "Lead Owner",
    dataType: "RADIO",
  },
] as const;

export type LocalStage = keyof typeof GHL_STAGE_IDS;
export type GHLFieldKey = keyof typeof GHL_FIELD_IDS;

// ---- Inbound webhook auth ----
// GHL Workflows send this token in `Authorization: Bearer <secret>`.
// Set in .env + Vercel: GHL_INBOUND_SECRET=<random 32+ hex string>
export const GHL_INBOUND_SECRET = readEnv("GHL_INBOUND_SECRET");
