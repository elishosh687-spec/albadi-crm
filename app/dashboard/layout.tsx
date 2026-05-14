/**
 * Passthrough layout. v3 owns its own dark-theme chrome inside its layout —
 * this parent stays clean so any future dashboard sub-app does not inherit
 * unwanted styling. v2 was removed on 2026-05-14.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
