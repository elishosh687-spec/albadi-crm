import { redirect } from "next/navigation";

/**
 * Bare /dashboard hits land here. v3 is the only CRM (v2 was removed
 * 2026-05-14). Anything that still links to /dashboard ends up at /v3.
 */
export default function DashboardRoot() {
  redirect("/dashboard/v3");
}
