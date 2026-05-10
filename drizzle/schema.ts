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
