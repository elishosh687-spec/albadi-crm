import { HubShell } from "@/components/hub/HubShell";
import { WidgetSurface } from "@/components/hub/WidgetSurface";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; sid?: string }>;
}) {
  const params = await searchParams;
  return (
    <WidgetSurface>
      <HubShell
        mode="standalone"
        activeTab={params.tab}
        sid={params.sid?.trim() ?? ""}
      />
    </WidgetSurface>
  );
}
