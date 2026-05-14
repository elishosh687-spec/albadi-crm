import { redirect } from "next/navigation";

/**
 * Bare /dashboard hits land here. v3 is the active CRM; v2 stays available at
 * /dashboard/v2 as a fallback. Anything that needs the legacy v2 home (the
 * old stats + Eli alert summary) should link explicitly to /dashboard/v2.
 */
export default function DashboardRoot() {
  redirect("/dashboard/v3");
}
