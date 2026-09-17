/**
 * GHL widget analytics surface.
 *
 * This is the canonical analytics surface. The legacy dashboard route imports
 * this same component so GHL owns the implementation and the two cannot drift.
 */
import AnalyticsContent from "./AnalyticsContent";
import { widgetPageAuthed } from "@/lib/widget/page-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export default async function AnalyticsWidgetPage({
  searchParams,
}: {
  searchParams: Promise<{ widget_token?: string }>;
}) {
  const { widget_token } = await searchParams;
  const token = widget_token ?? "";
  if (!(await widgetPageAuthed(token))) {
    return (
      <div dir="rtl" style={{ padding: 24, color: "#f87171" }}>
        <h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
        <p>
          חסר / לא תקין <code>widget_token</code>.
        </p>
      </div>
    );
  }

  return <AnalyticsContent />;
}
