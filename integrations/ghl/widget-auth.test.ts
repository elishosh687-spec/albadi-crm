import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("verifyWidgetTokenOrDashboard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("GHL_WIDGET_TOKEN", "widget-secret");
    vi.stubEnv("ADMIN_PASSWORD", "admin-secret");
  });

  it("accepts the canonical GHL widget token", async () => {
    const { verifyWidgetTokenOrDashboard } = await import("./widget-auth");
    const req = new NextRequest("https://example.test/api/widget/analysis-aggregate");

    expect(verifyWidgetTokenOrDashboard(req, "widget-secret")).toBe(true);
  });

  it("accepts the protected dashboard cookie without exposing the widget token", async () => {
    const { verifyWidgetTokenOrDashboard } = await import("./widget-auth");
    const req = new NextRequest("https://example.test/api/widget/analysis-aggregate", {
      headers: { cookie: "albadi_auth=admin-secret" },
    });

    expect(verifyWidgetTokenOrDashboard(req, null)).toBe(true);
  });

  it("rejects a request with neither credential", async () => {
    const { verifyWidgetTokenOrDashboard } = await import("./widget-auth");
    const req = new NextRequest("https://example.test/api/widget/analysis-aggregate");

    expect(verifyWidgetTokenOrDashboard(req, null)).toBe(false);
  });
});
