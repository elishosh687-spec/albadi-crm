// Widget layout — no dashboard chrome, no auth wrapper.
// Embedded inside GHL Custom Menu Link iframes.
//
// Notes:
//   - Auth is per-route via verifyWidgetToken().
//   - Iframe embedding allowed via middleware/global headers + this layout's
//     metadata sets a wide viewport for small panels.
//   - Hebrew RTL preserved (calculator components depend on it).

import type { Metadata } from "next";

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
      style={{
        minHeight: "100vh",
        background: "#050506",
        color: "#f5f6f7",
        padding: "16px",
      }}
    >
      {children}
    </div>
  );
}
