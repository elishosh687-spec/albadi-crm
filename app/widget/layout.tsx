// Widget layout — no dashboard chrome, no auth wrapper.
// Embedded inside GHL Custom Menu Link iframes.
//
// Notes:
//   - Auth is per-route via the GHL token or standalone login cookie.
//   - Iframe embedding allowed via middleware/global headers.
//   - This layout sets NO viewport. The only viewport in the app is
//     app/layout.tsx (`width=device-width, initial-scale=1`) and it applies
//     here. (An older comment claimed a "wide viewport" was set here — it
//     never was.)
//   - Hebrew RTL preserved (calculator components depend on it).

import type { Metadata } from "next";
import { WidgetSurface } from "@/components/hub/WidgetSurface";

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
  return <WidgetSurface>{children}</WidgetSurface>;
}
