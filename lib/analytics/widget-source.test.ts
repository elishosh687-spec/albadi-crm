import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("GHL analytics UI ownership", () => {
  it("keeps the dashboard route as a thin alias of the widget implementation", () => {
    const dashboardRoute = readFileSync(
      join(process.cwd(), "app/dashboard/v3/analytics/page.tsx"),
      "utf8"
    );
    expect(dashboardRoute).toContain(
      'import AnalyticsContent from "@/app/widget/analytics/AnalyticsContent"'
    );
    expect(dashboardRoute).not.toContain('from "@/lib/db"');
    expect(dashboardRoute).not.toContain("<AnalyticsView");
  });
});
