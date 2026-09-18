/**
 * Deep links between hub tabs. Every tab renders inside the hub's iframe, so a
 * link to ANOTHER tab must load the hub (target="_parent"), and a sub-view
 * change inside a tab should also update the hub's own URL — that URL is what
 * a colleague gets when Eli copies it (ui-ux-pro-max: deep-linking).
 * Client-safe.
 */

export interface HubTarget {
  tab: string;
  view?: string;
  section?: string;
}

/** Hub URL for a tab + sub-view. Widget mode when a token is present. */
export function hubHref(widgetToken: string, target: HubTarget): string {
  const p = new URLSearchParams({ tab: target.tab });
  if (widgetToken) p.set("widget_token", widgetToken);
  if (target.view) p.set("view", target.view);
  if (target.section) p.set("section", target.section);
  return `${widgetToken ? "/widget/hub" : "/"}?${p.toString()}`;
}

/**
 * Mirror a sub-view change into the parent hub URL (no reload). Silently a
 * no-op when not framed by the hub, or when the frame is cross-origin.
 */
export function syncHubUrl(params: { view?: string | null; section?: string | null }): void {
  if (typeof window === "undefined" || window.parent === window) return;
  try {
    const loc = window.parent.location;
    const url = new URL(loc.href);
    if (!url.searchParams.has("tab")) return;
    for (const k of ["view", "section"] as const) {
      const v = params[k];
      if (v === undefined) continue;
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    window.parent.history.replaceState(window.parent.history.state, "", url.pathname + url.search);
  } catch {
    // cross-origin parent (GHL) — nothing to sync
  }
}
