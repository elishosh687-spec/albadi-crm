import { DraftsWithDecisions } from "@/components/drafts/DraftsWithDecisions";

export const dynamic = "force-dynamic";

/** Standalone fallback: render the exact canonical GHL Hub implementation. */
export default function V3DraftsPage() {
  return <DraftsWithDecisions apiToken={process.env.GHL_WIDGET_TOKEN ?? ""} />;
}
