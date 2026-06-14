/** Israeli phone helpers — E.164 without "+", country code 972. */

export function digitsOnly(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

/** Last 9 digits (national significant number) for fuzzy matching. */
export function israeliPhoneSuffix(phone: string): string {
  const d = digitsOnly(phone);
  if (d.length >= 9) return d.slice(-9);
  return d;
}

/**
 * Normalize user input to `972XXXXXXXXX`.
 * Handles 050…, 50…, +972…, and values already in E.164 form.
 */
export function normalizeIsraeliPhoneE164(raw: string): string | null {
  let d = digitsOnly(raw);
  if (!d || d.length < 7) return null;

  if (d.startsWith("972")) {
    return d.length >= 11 ? d : null;
  }

  if (d.startsWith("0") && d.length === 10) {
    return `972${d.slice(1)}`;
  }

  if (d.length === 9 && /^[5-9]/.test(d)) {
    return `972${d}`;
  }

  if (d.length >= 9 && d.length <= 10 && d.startsWith("0")) {
    return `972${d.slice(1)}`;
  }

  return d.length >= 9 ? d : null;
}

/** Common stored variants (972…, 0…, 9-digit) for DB lookup. */
export function israeliPhoneLookupVariants(normalized: string): string[] {
  const d = digitsOnly(normalized);
  const out = new Set<string>([d]);
  if (d.startsWith("972") && d.length >= 11) {
    out.add(`0${d.slice(3)}`);
    out.add(d.slice(3));
  }
  return [...out];
}
