import { SettingsView } from "@/components/settings/SettingsView";

export const dynamic = "force-dynamic";

/** Standalone fallback: render the exact canonical GHL Hub implementation. */
export default function V3SettingsPage() {
  return <SettingsView apiToken={process.env.GHL_WIDGET_TOKEN ?? ""} />;
}
