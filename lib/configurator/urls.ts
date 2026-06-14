/**
 * Public URLs for the 3D bag configurator.
 *
 * CONFIGURATOR_PUBLIC_URL — customer-facing page (website or CRM route).
 * Defaults to albadi.ecobrotherss.com; override when staging on another host.
 */

export function getConfiguratorPublicBaseUrl(): string {
  // The configurator is served by THIS app (albadi-crm). albadi.ecobrotherss.com
  // is the separate customer website, so the default points at the CRM domain.
  // Override with CONFIGURATOR_PUBLIC_URL once a custom domain is connected.
  const raw =
    process.env.CONFIGURATOR_PUBLIC_URL?.trim() ||
    "https://albadi-crm.vercel.app/configurator";
  return raw.replace(/\/$/, "");
}

export function buildConfiguratorSessionLink(token: string): string {
  const base = getConfiguratorPublicBaseUrl();
  const url = new URL(
    base.includes("://") ? base : `https://${base}`
  );
  url.searchParams.set("t", token);
  return url.toString();
}

/** Client-side API base for cross-origin fetches (bag-quote-app → albadi-crm). */
export function getConfiguratorApiBase(): string {
  if (typeof window !== "undefined") {
    const fromEnv = process.env.NEXT_PUBLIC_CONFIGURATOR_API_URL?.trim();
    if (fromEnv) return fromEnv.replace(/\/$/, "");
    return "";
  }
  return (
    process.env.NEXT_PUBLIC_CONFIGURATOR_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
}
