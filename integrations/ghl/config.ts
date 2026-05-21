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
// User fills these after running scripts/_ghl-bootstrap.ts.
// Mirrors lib/manychat/stages.ts → V2_PIPELINE_STAGES (8-stage journey model).
export const GHL_STAGE_IDS: Record<string, string> = {
  INITIAL_QUOTE_SENT: readEnv("GHL_STAGE_INITIAL_QUOTE_SENT"),
  AWAITING_FIRST_RESPONSE: readEnv("GHL_STAGE_AWAITING_FIRST_RESPONSE"),
  SHOWED_INTEREST: readEnv("GHL_STAGE_SHOWED_INTEREST"),
  FACTORY_CHECK: readEnv("GHL_STAGE_FACTORY_CHECK"),
  FINAL_QUOTE_SENT: readEnv("GHL_STAGE_FINAL_QUOTE_SENT"),
  NEGOTIATING: readEnv("GHL_STAGE_NEGOTIATING"),
  WON: readEnv("GHL_STAGE_WON"),
  LOST: readEnv("GHL_STAGE_LOST"),
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
] as const;

export type LocalStage = keyof typeof GHL_STAGE_IDS;
export type GHLFieldKey = keyof typeof GHL_FIELD_IDS;
