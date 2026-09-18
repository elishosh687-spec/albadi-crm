/**
 * One spelling of a Meta Ad ID for every join.
 *
 * `leads.meta_ad_id` is stored as the Instant-Form sheet writes it —
 * `ag:120252199875770562` — while the Graph API returns the bare digits.
 * Comparing the raw values silently matches nothing.
 */
export function normalizeAdId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^ag:/i, "").trim();
  return /^\d+$/.test(s) ? s : null;
}
