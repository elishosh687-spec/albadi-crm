/**
 * /api/admin/ci-alert — the WhatsApp hop for CI failures. sendEliDM is mocked;
 * the secret is stubbed BEFORE the route is imported (auth reads env per call,
 * but keep the habit — other modules capture env at load).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { sendEliDM } = vi.hoisted(() => ({
  sendEliDM: vi.fn<(text: string) => Promise<"sent" | "dry_run" | "no_jid" | "error">>(async () => "sent"),
}));
vi.mock("@/lib/notify/eli", () => ({ sendEliDM }));

type Route = typeof import("./route");
let route: Route;

beforeAll(async () => {
  vi.stubEnv("CALL_TRIGGER_SECRET", "t-secret");
  route = await import("./route");
});
beforeEach(() => sendEliDM.mockClear());

const BODY = {
  workflow: "test",
  sha: "0123456789abcdef",
  run_url: "https://github.com/x/y/actions/runs/42",
  message: "Fix the thing\n\nlonger body",
  status: "failure" as const,
};

function post(body: unknown, opts: { auth?: string; dry?: boolean } = {}) {
  const url = new URL(`http://localhost/api/admin/ci-alert${opts.dry ? "?dry=1" : ""}`);
  return new NextRequest(url, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(opts.auth ? { authorization: opts.auth } : {}),
    },
  });
}

describe("POST /api/admin/ci-alert", () => {
  it("401 without the bearer", async () => {
    const res = await route.POST(post(BODY), undefined);
    expect(res.status).toBe(401);
    expect(sendEliDM).not.toHaveBeenCalled();
  });

  it("401 with the wrong bearer", async () => {
    const res = await route.POST(post(BODY, { auth: "Bearer nope" }), undefined);
    expect(res.status).toBe(401);
  });

  it("dry=1 composes the text and sends nothing", async () => {
    const res = await route.POST(post(BODY, { auth: "Bearer t-secret", dry: true }), undefined);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.dry).toBe(true);
    expect(j.text).toContain("❌");
    expect(j.text).toContain("0123456");
    expect(j.text).not.toContain("0123456789abcdef");
    expect(j.text).toContain("Fix the thing");
    expect(j.text).not.toContain("longer body");
    expect(j.text).toContain(BODY.run_url);
    expect(sendEliDM).not.toHaveBeenCalled();
  });

  it("sends once via sendEliDM and reports the result", async () => {
    const res = await route.POST(post(BODY, { auth: "Bearer t-secret" }), undefined);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, result: "sent" });
    expect(sendEliDM).toHaveBeenCalledTimes(1);
    expect(sendEliDM.mock.calls[0][0]).toContain(BODY.run_url);
  });

  it("a recovery uses the green header", async () => {
    const res = await route.POST(post({ ...BODY, status: "success" }, { auth: "Bearer t-secret", dry: true }), undefined);
    expect((await res.json()).text.startsWith("✅")).toBe(true);
  });

  it("no_jid → ok:false so the workflow log shows the DM did not land", async () => {
    sendEliDM.mockResolvedValueOnce("no_jid");
    const res = await route.POST(post(BODY, { auth: "Bearer t-secret" }), undefined);
    expect(await res.json()).toMatchObject({ ok: false, result: "no_jid" });
  });

  it("400 on invalid JSON", async () => {
    const res = await route.POST(post("{not json", { auth: "Bearer t-secret" }), undefined);
    expect(res.status).toBe(400);
  });
});

describe("composeCiAlert", () => {
  it("handles an empty body without throwing", async () => {
    expect(route.composeCiAlert({})).toContain("?");
  });
});
