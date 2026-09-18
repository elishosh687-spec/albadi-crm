import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const HUB_PAGE_ROUTES = [
  "inbox",
  "factory-flow",
  "closed-quotes",
  "analytics",
  "playground",
  "calculator",
  "colors",
  "ads",
  "competitors",
  "shipping",
  "settings",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("standalone site and GHL Hub parity", () => {
  it("renders both entry points through the same HubShell", () => {
    const standalone = read("app/page.tsx");
    const widget = read("app/widget/hub/page.tsx");

    expect(standalone).toContain('from "@/components/hub/HubShell"');
    expect(standalone).toContain('from "@/components/hub/WidgetSurface"');
    expect(standalone).toContain('mode="standalone"');
    expect(widget).toContain('from "@/components/hub/HubShell"');
    expect(widget).toContain('mode="widget"');

    const widgetLayout = read("app/widget/layout.tsx");
    expect(widgetLayout).toContain('from "@/components/hub/WidgetSurface"');
  });

  it("redirects every legacy dashboard URL to the canonical Hub", () => {
    const middleware = read("middleware.ts");
    expect(middleware).toContain('path.startsWith("/dashboard")');
    expect(middleware).toContain('url.pathname = "/"');
    expect(middleware).not.toContain('url.pathname = "/dashboard/v3"');
  });

  it("keeps the standalone Hub free of widget credentials", () => {
    const shell = read("components/hub/HubShell.tsx");
    expect(shell).toContain('if (mode === "widget") params.set("widget_token", widgetToken)');
    expect(shell).not.toMatch(/mode === "standalone"[^\n]*widget_token/);
  });

  it("allows every canonical Hub page to use the standalone login cookie", () => {
    for (const route of HUB_PAGE_ROUTES) {
      expect(read(`app/widget/${route}/page.tsx`), route).toContain(
        "widgetPageAuthed"
      );
    }
  });

  it("does not leave token-only authentication in widget APIs", () => {
    const apiRoutes = walk(path.join(ROOT, "app/api/widget")).filter((file) =>
      file.endsWith("route.ts")
    );
    const tokenOnly = apiRoutes
      .filter((file) => /\bverifyWidgetToken\s*\(/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));
    expect(tokenOnly).toEqual([]);
  });
});
