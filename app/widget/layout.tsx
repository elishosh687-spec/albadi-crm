// Widget layout — no dashboard chrome, no auth wrapper.
// Embedded inside GHL Custom Menu Link iframes.
//
// Notes:
//   - Auth is per-route via verifyWidgetToken().
//   - Iframe embedding allowed via middleware/global headers.
//   - This layout sets NO viewport. The only viewport in the app is
//     app/layout.tsx (`width=device-width, initial-scale=1`) and it applies
//     here. (An older comment claimed a "wide viewport" was set here — it
//     never was.)
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
      className="gg-theme mfit"
      style={{
        // dvh, not vh — mobile Safari's collapsing toolbar makes 100vh taller
        // than the visible viewport, which clips the bottom of every screen.
        minHeight: "100dvh",
        // `.mfit` marks this subtree as a widget screen for the mobile layer
        // in globals.css. It is NOT `.gg-theme`-scoped there: the dashboard
        // carries .gg-theme too, and must not be restyled as a side effect.
        // Fluid padding: identical 12px at >=600px, 6px on a phone.
        padding: "clamp(6px, 2vw, 12px)",
      }}
    >
      {children}
    </div>
  );
}
