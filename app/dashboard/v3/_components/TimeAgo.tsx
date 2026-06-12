"use client";

import { timeAgoHe } from "@/lib/messaging/stage-meta";
import { useMounted } from "@/hooks/useMounted";

export function TimeAgo({
  iso,
  fallback,
}: {
  iso: string | null | undefined;
  fallback?: string;
}) {
  const mounted = useMounted();

  if (!iso) return <>{fallback ?? null}</>;
  if (!mounted) return <>{fallback ?? null}</>;

  return <>{timeAgoHe(iso)}</>;
}
