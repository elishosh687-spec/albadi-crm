/**
 * lib/observability/log.ts — the one logger.
 *
 * LOG_LEVEL=error in the unit env (vitest.config.mts), so only error-level
 * lines reach the console; that is what makes the request.failed assertion
 * precise — the success `request` line (info) is filtered, the failure is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEATURES, featureForPath, serializeError, withRequestLog } from "./log";

describe("featureForPath", () => {
  it.each([
    ["/api/greenapi/webhook", "webhook.green"],
    ["/api/bridge/webhook", "webhook.bridge"],
    ["/api/ghl/stage-changed", "webhook.ghl"],
    ["/api/integrations/inbound/ghl-tag", "webhook.ghl"],
    ["/api/bot/followups", "followups"],
    ["/api/bot/callback-requests", "followups"],
    ["/api/bot/process-recordings", "calls"],
    ["/api/bot/cron", "bot"],
    ["/api/bot/new-lead", "bot"],
    ["/api/elevenlabs/sync-calls", "elevenlabs"],
    ["/api/cron/refresh-fx", "fx"],
    ["/api/cron/enrich-meta-attribution", "meta"],
    ["/api/cron/analyze-active-leads", "analysis"],
    ["/api/cron/job-watchdog", "cron"],
    ["/api/cron/x", "cron"],
    ["/api/widget/zoho/match", "zoho"],
    ["/api/widget/factory/close-deal/1", "factory"],
    ["/api/widget/calculator/quote", "calculator"],
    ["/api/widget/analyze-lead", "analysis"],
    ["/api/widget/analysis-aggregate", "analysis"],
    ["/api/widget/pipeline-audit", "analysis"],
    ["/api/widget/ads", "meta"],
    ["/api/widget/x", "widget"],
    ["/api/widget/leads/recent", "widget"],
    ["/api/factory/refresh", "factory"],
    ["/api/factory/abc/pdf", "factory"],
    ["/api/sales/quote", "calculator"],
    ["/api/leads/facebook-import", "leads"],
    ["/api/configurator/save", "configurator"],
    ["/api/admin/meta-send-test", "meta"],
    ["/api/admin/ci-alert", "admin"],
    ["/api/admin/audit-ghl-gap", "admin"],
    ["/api/drafts/pending", "bot"],
    ["/api/auth/login", "auth"],
    ["/api/ai/suggest", "setter"],
    ["/widget/hub", "widget"],
    ["/dashboard/v3", "app"],
    ["/", "app"],
    ["/api/unknown-thing", "app"],
  ] as const)("%s → %s", (pathname, feature) => {
    expect(featureForPath(pathname)).toBe(feature);
  });

  it("only ever returns a FEATURES member", () => {
    for (const p of ["/api/greenapi", "/api/widget/zoho", "/api/admin/meta", "/nope", ""]) {
      expect(FEATURES).toContain(featureForPath(p));
    }
  });

  it("is prefix-based: the more specific rule wins over its parent", () => {
    expect(featureForPath("/api/bot/followups/anything")).toBe("followups");
    expect(featureForPath("/api/admin/metaverse")).toBe("meta"); // prefix match, documented behaviour
  });
});

describe("serializeError", () => {
  it("flattens an Error with cause into err_* fields", () => {
    const out = serializeError(new Error("x", { cause: "y" }));
    expect(out).toMatchObject({ err_name: "Error", err_msg: "x", err_cause: "y" });
    expect(typeof out.err_stack).toBe("string");
    expect((out.err_stack as string).split("\n").length).toBeLessThanOrEqual(8);
  });

  it("uses the cause's message when the cause is itself an Error", () => {
    const out = serializeError(new Error("outer", { cause: new TypeError("inner") }));
    expect(out.err_cause).toBe("inner");
  });

  it("keeps a plain string as err_msg and JSON-encodes anything else", () => {
    expect(serializeError("str")).toEqual({ err_msg: "str" });
    expect(serializeError({ code: 7 })).toEqual({ err_msg: '{"code":7}' });
  });
});

describe("withRequestLog", () => {
  const errorSpy = vi.spyOn(console, "error");
  const logSpy = vi.spyOn(console, "log");
  beforeEach(() => {
    errorSpy.mockClear().mockImplementation(() => {});
    logSpy.mockClear().mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockReset();
    logSpy.mockReset();
  });

  const req = () => new Request("http://x/api/y", { method: "POST", headers: { "x-vercel-id": "abc" } });

  it("turns a thrown handler into a JSON 500 carrying the request_id, without rethrowing", async () => {
    const wrapped = withRequestLog("admin", async () => {
      throw new Error("boom");
    });
    const res = await wrapped(req(), undefined);
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "internal_error", request_id: "abc" });
  });

  it("logs request.failed at error level as one JSON line with feature + request_id + route", async () => {
    const wrapped = withRequestLog("admin", async () => {
      throw new Error("boom");
    });
    await wrapped(req(), undefined);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      level: "error",
      feature: "admin",
      event: "request.failed",
      request_id: "abc",
      route: "/api/y",
      method: "POST",
      err_msg: "boom",
    });
    expect(typeof line.duration_ms).toBe("number");
  });

  it("passes a 204 through untouched and logs nothing at error level", async () => {
    const wrapped = withRequestLog("widget", async () => new Response(null, { status: 204 }));
    const res = await wrapped(req(), undefined);
    expect(res.status).toBe(204);
    expect(errorSpy).not.toHaveBeenCalled();
    // The success `request` line is info-level — filtered by LOG_LEVEL=error.
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("hands the handler a child logger bound to the request (its error lines carry request_id)", async () => {
    const wrapped = withRequestLog("factory", async (_req, log) => {
      log.error("feishu.parse_failed", "bad row", { row: 7 });
      return Response.json({ ok: true });
    });
    const res = await wrapped(req(), undefined);
    expect(res.status).toBe(200);
    const line = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ feature: "factory", event: "feishu.parse_failed", request_id: "abc", row: 7, err_msg: "bad row" });
  });

  it("falls back to x-request-id, then to a random id, when x-vercel-id is absent", async () => {
    const wrapped = withRequestLog("admin", async () => {
      throw new Error("e");
    });
    const viaHeader = await wrapped(new Request("http://x/api/y", { headers: { "x-request-id": "rid" } }), undefined);
    await expect(viaHeader.json()).resolves.toMatchObject({ request_id: "rid" });
    const random = await wrapped(new Request("http://x/api/y"), undefined);
    const body = (await random.json()) as { request_id: string };
    expect(body.request_id).toMatch(/^[a-z0-9]{6,10}$/);
  });

  it("forwards the route context (params) to the handler", async () => {
    const wrapped = withRequestLog<Request, { params: { id: string } }>("admin", async (_r, _l, ctx) =>
      Response.json({ id: ctx.params.id }),
    );
    const res = await wrapped(req(), { params: { id: "q1" } });
    await expect(res.json()).resolves.toEqual({ id: "q1" });
  });
});
