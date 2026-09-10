/**
 * lib/observability/jobs.ts — heartbeats for scheduled jobs.
 *
 * `recordJobRun` is a same-module call, so it can't be spied on; the heartbeat
 * is observed at the DB boundary instead. This file's own `vi.mock("@/lib/db")`
 * replaces the unit-setup Proxy (which throws on any access) with a recording
 * `execute`, and a helper flattens the drizzle `sql` template into text +
 * params so the assertions read the actual statement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({
  execute: vi.fn<(q: unknown) => Promise<{ rows: unknown[] }>>(async () => ({ rows: [] })),
}));
vi.mock("@/lib/db", () => ({ db: { execute } }));

import { FEATURES } from "./log";
import { JOBS, lateAfterMin, recordJobRun, withJob } from "./jobs";

/** Flatten a drizzle SQL object into its text with params inlined as JSON. */
function flatten(chunk: unknown): string {
  if (typeof chunk === "string") return JSON.stringify(chunk);
  if (chunk && typeof chunk === "object") {
    const c = chunk as { queryChunks?: unknown[]; value?: unknown };
    if (Array.isArray(c.queryChunks)) return c.queryChunks.map(flatten).join("");
    if (Array.isArray(c.value)) return c.value.join(""); // StringChunk
    if ("value" in c) return flatten(c.value); // Param
  }
  return String(chunk);
}

/** `void recordJobRun(...)` is fire-and-forget — let its microtasks settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const req = () => new Request("http://x/api/cron/y", { headers: { "x-vercel-id": "abc" } });

describe("lateAfterMin", () => {
  it.each([
    [5, 20],
    [15, 50],
    [30, 95],
    [60, 185],
    [61, 421],
    [1440, 1800],
  ])("everyMin=%i → late after %i min", (every, late) => {
    expect(lateAfterMin(every)).toBe(late);
  });

  it("is the documented formula: three missed ticks for ≤1h jobs, +6h grace for daily ones", () => {
    for (const m of [1, 10, 45, 60]) expect(lateAfterMin(m)).toBe(m * 3 + 5);
    for (const m of [90, 720, 1440]) expect(lateAfterMin(m)).toBe(m + 360);
  });
});

describe("JOBS", () => {
  it("every entry has a Hebrew label, a positive schedule and a known trigger", () => {
    for (const [name, def] of Object.entries(JOBS)) {
      expect(name).toMatch(/^[a-z][a-z0-9-]+$/);
      expect(def.label.trim().length, `${name} label`).toBeGreaterThan(0);
      expect(def.everyMin, `${name} everyMin`).toBeGreaterThan(0);
      expect(["vercel", "github"]).toContain(def.via);
    }
  });

  it("the watchdog's own tick is a job too (so a dead watchdog is at least visible in its own state)", () => {
    expect(JOBS["job-watchdog"]).toBeDefined();
  });

  it("FEATURES carries the cron feature the module logs under", () => {
    expect(FEATURES).toContain("cron");
  });
});

describe("recordJobRun", () => {
  beforeEach(() => execute.mockClear());

  it("upserts the job's sub-object in app_config jobs.status via jsonb_set", async () => {
    await recordJobRun("refresh-fx", { ok: true, status: 200, durationMs: 12 });
    expect(execute).toHaveBeenCalledTimes(1);
    const text = flatten(execute.mock.calls[0][0]);
    expect(text).toContain("INSERT INTO app_config");
    expect(text).toContain('"jobs.status"');
    expect(text).toContain("jsonb_set");
    expect(text).toContain('"refresh-fx"');
    const patch = JSON.parse(JSON.parse(/::text, (".*?"(?:\\"|[^"])*")::jsonb/.exec(text)![1]));
    expect(patch).toMatchObject({ lastStatus: "ok", lastDurationMs: 12 });
    expect(patch.lastOkAt).toBe(patch.lastRunAt);
    expect(patch).not.toHaveProperty("lastError");
  });

  it("records a failure with the error text, and never touches lastOkAt", async () => {
    await recordJobRun("followups", { ok: false, status: 500, error: "x".repeat(400) });
    const text = flatten(execute.mock.calls[0][0]);
    const patch = JSON.parse(JSON.parse(/::text, (".*?"(?:\\"|[^"])*")::jsonb/.exec(text)![1]));
    expect(patch.lastStatus).toBe("failed");
    expect(patch.lastError).toHaveLength(300); // clipped
    expect(patch).not.toHaveProperty("lastOkAt");
  });

  it("falls back to `HTTP <status>` when no error text is given", async () => {
    await recordJobRun("followups", { ok: false, status: 503 });
    const text = flatten(execute.mock.calls[0][0]);
    expect(text).toContain("HTTP 503");
  });

  it("never throws — a heartbeat must not break the job", async () => {
    execute.mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordJobRun("followups", { ok: true })).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe("withJob", () => {
  const errorSpy = vi.spyOn(console, "error");
  beforeEach(() => {
    execute.mockClear();
    errorSpy.mockClear().mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockReset());

  it("2xx → one heartbeat with ok:true naming the job", async () => {
    const run = withJob("refresh-fx", "fx", async () => Response.json({ ok: true }));
    const res = await run(req(), undefined);
    await settle();
    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(1);
    const text = flatten(execute.mock.calls[0][0]);
    expect(text).toContain('"refresh-fx"');
    expect(text).toContain('\\"lastStatus\\":\\"ok\\"');
  });

  it("5xx → one heartbeat with ok:false", async () => {
    const run = withJob("followups", "followups", async () => Response.json({ ok: false }, { status: 500 }));
    const res = await run(req(), undefined);
    await settle();
    expect(res.status).toBe(500);
    expect(execute).toHaveBeenCalledTimes(1);
    const text = flatten(execute.mock.calls[0][0]);
    expect(text).toContain('"followups"');
    expect(text).toContain('\\"lastStatus\\":\\"failed\\"');
    expect(text).toContain("HTTP 500");
  });

  it.each([401, 307, 404])("%i is not a run — no heartbeat", async (status) => {
    const run = withJob("followups", "followups", async () => new Response(null, { status }));
    const res = await run(req(), undefined);
    await settle();
    expect(res.status).toBe(status);
    expect(execute).not.toHaveBeenCalled();
  });

  it("a throw is recorded as a failure AND answered by withRequestLog's JSON 500", async () => {
    const run = withJob("process-recordings", "calls", async () => {
      throw new Error("whisper down");
    });
    const res = await run(req(), undefined);
    await settle();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "internal_error", request_id: "abc" });
    expect(execute).toHaveBeenCalledTimes(1);
    const text = flatten(execute.mock.calls[0][0]);
    expect(text).toContain('"process-recordings"');
    expect(text).toContain("whisper down");
    // and the request line went out at error level under the job's feature
    const line = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ feature: "calls", event: "request.failed", request_id: "abc", err_msg: "whisper down" });
  });

  it("passes the child logger and context through to the handler", async () => {
    const run = withJob<Request, { tag: string }>("refresh-fx", "fx", async (_r, log, ctx) => {
      expect(log.feature).toBe("fx");
      return Response.json({ tag: ctx.tag });
    });
    const res = await run(req(), { tag: "t" });
    await expect(res.json()).resolves.toEqual({ tag: "t" });
  });
});
