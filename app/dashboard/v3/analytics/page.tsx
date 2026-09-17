/**
 * Compatibility route only.
 *
 * Eli works from the GHL widget. The canonical analytics implementation lives
 * under app/widget/analytics; this route deliberately contains no separate UI
 * or data logic so it always renders the exact same analytics screen.
 */
import AnalyticsContent from "@/app/widget/analytics/AnalyticsContent";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export default AnalyticsContent;
