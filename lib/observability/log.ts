/**
 * Structured logging — ONE way to log across the whole CRM.
 *
 *   import { logger } from "@/lib/observability/log";
 *   const log = logger("factory");
 *   log.info("quote.sent", { sid, quotationNo, totalIls });
 *   log.error("feishu.parse_failed", err, { row });
 *
 * Every line is a single JSON object with the same envelope:
 *   { ts, level, feature, event, msg?, sid?, route?, request_id?, env, commit, ...fields }
 *
 * Two transports, both best-effort, neither ever throws:
 *   1. console  — always. Vercel captures it; with the Axiom↔Vercel
 *                 integration (log drain) every line lands in Axiom with the
 *                 request/function metadata attached, zero config in code.
 *   2. Axiom ingest — when AXIOM_TOKEN + AXIOM_DATASET are set. Direct POST to
 *                 the ingest API, batched per invocation and flushed via
 *                 next/server `after()` (or a short timer outside a request).
 *                 Lets a script, a GitHub-Action-triggered cron, or a local run
 *                 ship logs too, not only Vercel-hosted functions.
 *
 * `feature` is the axis Eli filters on ("show me everything the setter did
 * today"), so it is a closed list — add to FEATURES, don't invent strings.
 *
 * Client-bundle rule: this module reads process.env but never throws on a
 * missing var, so importing it from a "use client" file is harmless — but
 * there is no reason to; log from the server side.
 */

export const FEATURES = [
  "bot", // questionnaire / autoresponder / supervisor
  "setter", // sales brain (lib/setter)
  "followups", // cadence + follow-up crons
  "webhook.green", // GreenAPI inbound/outbound
  "webhook.bridge", // whatsapp-bridge tenant (dormant)
  "webhook.ghl", // GHL app-webhook / stage-changed / resync
  "ghl", // GHL sync, tasks, contacts, opps
  "messaging", // sendBridgeMessage / outbound path
  "factory", // factory quotes, Feishu sheet, pricing
  "calculator", // manual calculator + estimator
  "deals", // עסקאות, milestones, addons, close-deal
  "zoho", // Zoho Books read/write
  "feishu", // Feishu sheets / order follow
  "meta", // Meta CAPI, attribution, ads insights
  "calls", // GHL call recording pipeline
  "elevenlabs", // voice agent sync
  "analysis", // lead analyzer, pipeline audit
  "leads", // lead import (FB / website), dedupe, gaps
  "cron", // any scheduled job (paired with the job's own feature in `job`)
  "widget", // widget API routes (generic)
  "admin", // /api/admin/*
  "configurator", // 3D configurator
  "notify", // DMs to Eli / team
  "fx", // exchange rates
  "auth", // token / secret checks
  "app", // anything that doesn't fit yet — the queue for a new feature name
] as const;
export type Feature = (typeof FEATURES)[number];

export type Level = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

interface LogEvent extends LogFields {
  ts: string;
  level: Level;
  feature: Feature;
  event: string;
  env: string;
  commit: string;
}

const ENV = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "local";
const COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "dev";
const AXIOM_TOKEN = process.env.AXIOM_TOKEN ?? "";
const AXIOM_DATASET = process.env.AXIOM_DATASET ?? "";
const AXIOM_URL = (process.env.AXIOM_URL ?? "https://api.axiom.co").replace(/\/$/, "");
const AXIOM_ON = Boolean(AXIOM_TOKEN && AXIOM_DATASET);
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) ?? (ENV === "production" ? "info" : "debug");
const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// ---------------------------------------------------------------- transport

let buffer: LogEvent[] = [];
let flushScheduled = false;

async function postToAxiom(events: LogEvent[]): Promise<void> {
  if (!AXIOM_ON || events.length === 0) return;
  try {
    const res = await fetch(`${AXIOM_URL}/v1/datasets/${encodeURIComponent(AXIOM_DATASET)}/ingest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AXIOM_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(events),
      // keep the request alive if the runtime is tearing down
      keepalive: true,
    });
    if (!res.ok) {
      // Only ever to console — never recurse into the logger from the transport.
      console.warn(`[log.axiom] ingest ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
    }
  } catch (e) {
    console.warn("[log.axiom] ingest failed", e instanceof Error ? e.message : e);
  }
}

/** Ship whatever is buffered. Safe to call any time; scripts call it before exit. */
export async function flushLogs(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  flushScheduled = false;
  await postToAxiom(batch);
}

function scheduleFlush(): void {
  if (!AXIOM_ON || flushScheduled) return;
  flushScheduled = true;
  // Inside a Next request/cron handler `after()` runs once the response is
  // sent — the right moment, and Vercel keeps the function alive for it.
  // Outside a request (scripts, tests) it throws; fall back to a short timer.
  try {
    // Lazy require so scripts that never touch Next don't load its runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { after } = require("next/server") as { after: (fn: () => Promise<void>) => void };
    after(flushLogs);
  } catch {
    const t = setTimeout(() => void flushLogs(), 250);
    // don't keep a script's event loop alive just for logs
    (t as { unref?: () => void }).unref?.();
  }
}

// ---------------------------------------------------------------- formatting

export function serializeError(err: unknown): LogFields {
  if (err instanceof Error) {
    const out: LogFields = { err_name: err.name, err_msg: err.message };
    if (err.stack) out.err_stack = err.stack.split("\n").slice(0, 8).join("\n");
    const cause = (err as { cause?: unknown }).cause;
    if (cause) out.err_cause = cause instanceof Error ? cause.message : String(cause);
    return out;
  }
  return { err_msg: typeof err === "string" ? err : JSON.stringify(err) };
}

function emit(level: Level, feature: Feature, event: string, fields: LogFields): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;
  const evt: LogEvent = {
    ts: new Date().toISOString(),
    level,
    feature,
    event,
    env: ENV,
    commit: COMMIT,
    ...fields,
  };
  // One JSON line per event. Vercel's log drain (and Axiom's Vercel app) parse
  // JSON messages into fields, so `feature`/`event`/`sid` are queryable there
  // even without the direct ingest.
  const line = JSON.stringify(evt);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  if (AXIOM_ON) {
    buffer.push(evt);
    scheduleFlush();
  }
}

// ---------------------------------------------------------------- public API

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  /** `err` is serialized into err_name / err_msg / err_stack. */
  error(event: string, err?: unknown, fields?: LogFields): void;
  /** Same feature, with extra fields (sid, request_id…) attached to every line. */
  child(bound: LogFields): Logger;
  readonly feature: Feature;
}

export function logger(feature: Feature, bound: LogFields = {}): Logger {
  return {
    feature,
    debug: (event, fields) => emit("debug", feature, event, { ...bound, ...fields }),
    info: (event, fields) => emit("info", feature, event, { ...bound, ...fields }),
    warn: (event, fields) => emit("warn", feature, event, { ...bound, ...fields }),
    error: (event, err, fields) =>
      emit("error", feature, event, { ...bound, ...(err !== undefined ? serializeError(err) : {}), ...fields }),
    child: (more) => logger(feature, { ...bound, ...more }),
  };
}

/**
 * Wrap a route handler so EVERY request of that feature gets one line —
 * route, method, status, duration — and an uncaught throw becomes a logged
 * `request.failed` + a JSON 500 instead of a silent Vercel crash page.
 *
 *   export const POST = withRequestLog("factory", async (req, log) => { ... });
 *
 * The handler receives a child logger already bound to request_id + route,
 * so its own lines correlate with the request line in Axiom.
 */
export function withRequestLog<Req extends Request = Request, Ctx = unknown>(
  feature: Feature,
  handler: (req: Req, log: Logger, ctx: Ctx) => Promise<Response>,
): (req: Req, ctx: Ctx) => Promise<Response> {
  return async (req: Req, ctx: Ctx) => {
    const started = Date.now();
    const request_id =
      req.headers.get("x-vercel-id") ?? req.headers.get("x-request-id") ?? Math.random().toString(36).slice(2, 10);
    const route = safePath(req.url);
    const log = logger(feature, { request_id, route });
    try {
      const res = await handler(req, log, ctx);
      log.info("request", { method: req.method, status: res.status, duration_ms: Date.now() - started });
      return res;
    } catch (err) {
      log.error("request.failed", err, { method: req.method, duration_ms: Date.now() - started });
      return Response.json({ ok: false, error: "internal_error", request_id }, { status: 500 });
    }
  };
}

/**
 * Best-effort feature for a request path — used by instrumentation.ts to tag
 * uncaught errors from routes that were never wrapped. Order matters: the
 * more specific prefix must come first.
 */
export function featureForPath(pathname: string): Feature {
  const rules: Array<[string, Feature]> = [
    ["/api/greenapi", "webhook.green"],
    ["/api/bridge", "webhook.bridge"],
    ["/api/ghl", "webhook.ghl"],
    ["/api/integrations", "webhook.ghl"],
    ["/api/bot/followups", "followups"],
    ["/api/bot/callback-requests", "followups"],
    ["/api/bot/process-recordings", "calls"],
    ["/api/bot", "bot"],
    ["/api/elevenlabs", "elevenlabs"],
    ["/api/cron/refresh-fx", "fx"],
    ["/api/cron/enrich-meta-attribution", "meta"],
    ["/api/cron/analyze-active-leads", "analysis"],
    ["/api/cron", "cron"],
    ["/api/widget/zoho", "zoho"],
    ["/api/widget/factory", "factory"],
    ["/api/widget/calculator", "calculator"],
    ["/api/widget/analy", "analysis"],
    ["/api/widget/pipeline-audit", "analysis"],
    ["/api/widget/ads", "meta"],
    ["/api/widget", "widget"],
    ["/api/factory", "factory"],
    ["/api/sales", "calculator"],
    ["/api/leads", "leads"],
    ["/api/configurator", "configurator"],
    ["/api/admin/meta", "meta"],
    ["/api/admin", "admin"],
    ["/api/drafts", "bot"],
    ["/api/auth", "auth"],
    ["/api/ai", "setter"],
    ["/widget", "widget"],
  ];
  for (const [prefix, feature] of rules) if (pathname.startsWith(prefix)) return feature;
  return "app";
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
