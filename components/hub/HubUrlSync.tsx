"use client";

/**
 * Renders nothing. Mirrors the tab's current sub-view into the parent hub URL
 * so the address Eli copies opens the same screen (ui-ux-pro-max deep links).
 */
import { useEffect } from "react";
import { syncHubUrl } from "@/lib/widget/hub-link";

export function HubUrlSync({ view, section }: { view?: string | null; section?: string | null }) {
  useEffect(() => {
    syncHubUrl({ view, section });
  }, [view, section]);
  return null;
}
