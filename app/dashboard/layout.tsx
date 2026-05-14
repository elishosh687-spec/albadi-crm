/**
 * /dashboard parent layout is a passthrough so /dashboard/v2 (light, navbar)
 * and /dashboard/v3 (dark, sidebar) can each own their own chrome without
 * one leaking into the other. The v1 dashboard home page (/dashboard) and
 * the instructions page reach v2 chrome via the v2 layout because the home
 * link still routes there; if a future top-level page needs the v2 chrome
 * directly, wrap it explicitly.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
