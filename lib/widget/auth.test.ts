import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("widgetAuthed", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("GHL_WIDGET_TOKEN", "widget-secret");
    vi.stubEnv("ADMIN_PASSWORD", "admin-secret");
  });

  it("accepts the GHL query token", async () => {
    const { widgetAuthed } = await import("./auth");
    const req = new NextRequest(
      "https://example.test/api/widget/messages?widget_token=widget-secret"
    );
    expect(widgetAuthed(req)).toBe(true);
  });

  it("accepts the standalone login cookie", async () => {
    const { widgetAuthed } = await import("./auth");
    const req = new NextRequest("https://example.test/api/widget/messages", {
      headers: { cookie: "albadi_auth=admin-secret" },
    });
    expect(widgetAuthed(req)).toBe(true);
  });

  it("rejects a request without either credential", async () => {
    const { widgetAuthed } = await import("./auth");
    const req = new NextRequest("https://example.test/api/widget/messages");
    expect(widgetAuthed(req)).toBe(false);
  });
});
