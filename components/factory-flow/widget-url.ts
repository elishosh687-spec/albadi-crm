/**
 * Client helper for widget components. Builds a URL with `?widget_token=...`
 * (or appends it as an extra param) so all fetches inside the factory-flow
 * widget carry auth.
 */

export function widgetUrl(path: string, token: string, extra?: Record<string, string | undefined>): string {
  const u = new URL(path, "http://placeholder.local");
  u.searchParams.set("widget_token", token);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== "") u.searchParams.set(k, v);
    }
  }
  // Return only path + query (relative), strip the placeholder origin.
  return u.pathname + u.search;
}
