import {
  pgTable,
  serial,
  bigserial,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  doublePrecision,
} from "drizzle-orm/pg-core";
/* eslint-disable @typescript-eslint/no-unused-vars */
// `integer` kept in import list for forward compat; unused right now.

export const leads = pgTable("leads", {
  manychatSubId: text("manychat_sub_id").primaryKey(),
  name: text("name"),
  active: boolean("active").default(true).notNull(),
  source: text("source").default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),

  // === bridge migration: DB-owned identity + tags + custom fields ===
  // Populated when USE_BRIDGE=1; left null for legacy ManyChat-only rows
  // until the backfill script runs.
  waJid: text("wa_jid"),
  phoneE164: text("phone_e164"),

  // Pipeline state (mirror of v2 ManyChat custom fields, but DB is the
  // source of truth once USE_BRIDGE=1).
  pipelineStage: text("pipeline_stage"),
  nextAction: text("next_action"),
  botSummary: text("bot_summary"),
  notes: text("notes"),

  // Free-form fields previously stored in ManyChat custom_fields.
  quoteTotal: text("quote_total"),
  quoteAlt: text("quote_alt"),
  leadSource: text("lead_source"),
  lastContactDate: text("last_contact_date"),
  followUpDate: text("follow_up_date"),
  leadScore: text("lead_score"),
  quantity: text("quantity"),
  lastContactType: text("last_contact_type"),

  // Auto-responder questionnaire state. Null = no active questionnaire.
  // Shape: { step: 1..9, shipping?, quantity?, product?, handles?, colors?, quoteResult?, doneAt? }
  qState: jsonb("q_state"),

  // === follow-up engine (spec: docs/FOLLOWUP-SPEC.md) ===
  followUpCount: integer("follow_up_count").default(0).notNull(),
  lastFollowUpAt: timestamp("last_follow_up_at", { withTimezone: true }),
  botPaused: boolean("bot_paused").default(false).notNull(),
  // Currently single-flag scalar (e.g. 'NEEDS_ELI'). Migrate to array later if needed.
  pipelineFlag: text("pipeline_flag"),

  // Manual factory-quote spec that Eli filled but hasn't sent yet.
  // Shape: FactoryProductSpec + optional notes. Cleared on successful
  // POST /api/factory/quote-request. See lib/factory/types.ts.
  factorySpecDraft: jsonb("factory_spec_draft"),
});

// DB-owned tags (replaces ManyChat tag IDs). One row per (lead, tag).
// Tag names are the keys of TAG_IDS / V2_FLAG_TAG_IDS, not numeric IDs.
export const leadTags = pgTable("lead_tags", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  tag: text("tag").notNull(),
  setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
});

// Bridge webhook event log — every signed event we receive lands here.
// Acts as both audit + idempotency dedupe (unique evt_id) + catch-up cursor.
export const bridgeEvents = pgTable("bridge_events", {
  id: serial("id").primaryKey(),
  evtId: text("evt_id").notNull().unique(),
  type: text("type").notNull(),
  tenant: text("tenant"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  payload: jsonb("payload"),
});

// === v2 (Claude-only classification) ===

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  direction: text("direction").notNull(),
  text: text("text"),
  payload: jsonb("payload"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),

  // bridge-side message id (e.g. "3A1B…"), null for ManyChat-origin rows.
  waMessageId: text("wa_message_id"),

  // Origin of the message. 'lead' = inbound from customer.
  // For direction='out': 'bot' = autoresponder/cron, 'eli' = manual reply
  // (dashboard sendManualReply or WA Business app — distinguished by the
  // bridge webhook sender-attribution heuristic in app/api/bridge/webhook).
  // Nullable: legacy rows pre-migration are NULL.
  sender: text("sender"),
});

// Key/value config table. Pre-existed from the v1 schema; re-declared here
// so the Settings UI can read/write entries (bot prompts, feature toggles).
export const botConfig = pgTable("bot_config", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Bot-generated draft replies awaiting Eli's approval. Created when a money
// moment is detected (stage gate or LLM is_money_moment flag) so Eli can
// review/edit/approve before the message goes out to the customer.
export const botDrafts = pgTable("bot_drafts", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  draftText: text("draft_text").notNull(),
  editedText: text("edited_text"),
  // pending | approved | rejected | sent | failed
  status: text("status").notNull().default("pending"),
  // 'stage_gate' | 'discount_request' | 'price_question' | 'negotiation' |
  // 'commitment' | 'manual'
  moneyReason: text("money_reason"),
  llmConfidence: text("llm_confidence"),
  // Stage the lead was at when the draft was generated (snapshot for UI).
  pipelineStageAtGen: text("pipeline_stage_at_gen"),
  // Optional snapshot of the inbound message that triggered the draft.
  triggerMessageId: integer("trigger_message_id"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentWaMessageId: text("sent_wa_message_id"),
  rejectReason: text("reject_reason"),
});

// analysisQueue, pipelineSuggestions, eliDecisions tables were removed
// when the standalone classifier skill was retired. The bot now writes
// pipeline_stage / flags directly to `leads` based on LLM intent on
// each inbound message.

// === Factory quote pipeline (Feishu integration) ===

// k/v table for pricing + shipping + FX config. Keys we use:
//   'factory_pricing' → JSON with { shippingOptions, exchangeRates, defaultProfitMargin }
// Kept separate from bot_config to avoid mixing operational bot settings
// with pricing/business config (different audiences for editing).
export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// One row per "send to factory" event. Lifecycle:
//   pending  — row written to Feishu, awaiting factory to fill J..R
//   received — refresh pulled J..R, factory cost known, awaiting Eli's
//              profit-margin pick + finalize
//   finalized — priceFactoryQuote ran, customer PDF generated and saved
export const factoryQuoteRequests = pgTable("factory_quote_requests", {
  id: text("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  quotationNo: text("quotation_no"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // FactoryProductSpec — { description, material, widthCm, heightCm, depthCm,
  // quantity, printing, finishing, picUrl?, notes? }
  productSpec: jsonb("product_spec").notNull(),
  feishuRowIndex: text("feishu_row_index"),
  // pending | received | finalized
  factoryStatus: text("factory_status").notNull().default("pending"),
  // FactoryResponse — { unitCostCny, cartonQty, cartonLengthCm, cartonWidthCm,
  // cartonHeightCm, cartonCbm, weightKg, supplier, notes }
  factoryResponse: jsonb("factory_response"),
  // FactoryPricingResult — full pricing snapshot at finalize time
  finalPricing: jsonb("final_pricing"),
  pdfUrl: text("pdf_url"),
  sentToCustomerAt: timestamp("sent_to_customer_at", { withTimezone: true }),
});

// Append-only audit log of every bot-side quote sent on WhatsApp. Captures
// both the initial quote (after questionnaire completion) and any auto-requote
// triggered by `requoteWithUpdatedSpec` after a mid-conversation spec change.
// The `leads.quoteTotal` / `leads.quoteAlt` columns are overwritten on each
// requote — this table preserves the full timeline so the dashboard can show
// "quote history" and analytics can compute requote rates / price drift.
export const botQuotes = pgTable(
  "bot_quotes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    leadSid: text("lead_sid").notNull(), // = leads.manychat_sub_id
    source: text("source").notNull(), // 'initial' | 'requote'
    qState: jsonb("q_state").notNull(), // snapshot of qState at send time
    quoteText: text("quote_text").notNull(), // the WhatsApp message body
    quoteTotalIls: doublePrecision("quote_total_ils"), // calc result.totalOrderPriceIls
    quoteAltTotalIls: doublePrecision("quote_alt_total_ils"), // alt shipping tier total
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    leadSidSentAtIdx: index("bot_quotes_lead_sid_sent_at_idx").on(
      t.leadSid,
      t.sentAt
    ),
  })
);
