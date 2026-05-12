import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

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
});

export const analysisQueue = pgTable("analysis_queue", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status").default("pending").notNull(),
  queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  errorText: text("error_text"),
});

export const pipelineSuggestions = pgTable("pipeline_suggestions", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  prevStage: text("prev_stage"),
  suggestedStage: text("suggested_stage").notNull(),
  suggestedFlags: jsonb("suggested_flags").$type<string[]>(),
  suggestedNextAction: text("suggested_next_action"),
  suggestedSummary: text("suggested_summary"),
  reason: text("reason").notNull(),
  source: text("source").default("claude").notNull(),
  status: text("status").default("pending_review").notNull(),
  approvedStage: text("approved_stage"),
  approvedFlags: jsonb("approved_flags").$type<string[]>(),
  overrideReason: text("override_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  pushedToManychatAt: timestamp("pushed_to_manychat_at", { withTimezone: true }),
});

export const eliDecisions = pgTable("eli_decisions", {
  id: serial("id").primaryKey(),
  suggestionId: integer("suggestion_id").references(() => pipelineSuggestions.id),
  manychatSubId: text("manychat_sub_id").notNull(),
  action: text("action").notNull(),
  claudeSuggested: jsonb("claude_suggested"),
  eliChose: jsonb("eli_chose"),
  overrideReason: text("override_reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
});
