// Widget layout — no dashboard chrome, no auth wrapper.
// Embedded inside GHL Custom Menu Link iframes.
//
// Notes:
//   - Auth is per-route via verifyWidgetToken().
//   - Iframe embedding allowed via middleware/global headers + this layout's
//     metadata sets a wide viewport for small panels.
//   - Hebrew RTL preserved (calculator components depend on it).

import type { Metadata } from "next";
import { WidgetNav } from "@/components/widget/WidgetNav";

// Nested layout — root <html>/<body> + globals.css already provided by
// app/layout.tsx. This wrapper only sets metadata + a container with the
// dark theme used by the calculator components.

export const metadata: Metadata = {
  title: "Albadi widget",
  robots: { index: false, follow: false },
};

export default function WidgetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="gg-theme"
      style={{
        minHeight: "100vh",
        padding: "12px",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <WidgetNav />
        {children}
      </div>
    </div>
  );
}
