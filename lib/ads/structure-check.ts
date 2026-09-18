/**
 * Round-structure check: what is actually delivering in Meta (read-only
 * `effective_status`) against the slot settings and Eli's assigned roles.
 *
 * Warnings only. A mismatch is something for Eli to fix by hand in Ads
 * Manager; nothing here changes an account.
 */
import type { AdRecommendationSettings } from "./recommendation-settings";

export type AdSegment = "prospecting" | "remarketing";
export type AdRole = "control" | "challenger" | "remarketing";

export interface StructureInput {
  adId: string;
  adName: string;
  segment: AdSegment | null;
  role: AdRole | null;
  /** Meta effective_status, e.g. ACTIVE, PAUSED, CAMPAIGN_PAUSED. Null = unknown. */
  effectiveStatus: string | null;
}

export interface SlotUsage {
  active: number;
  max: number;
  control: { used: number; max: number };
  challenger: { used: number; max: number };
  remarketing: { used: number; max: number };
  /** Delivering ads with no role, or no segment. */
  unassigned: number;
}

export interface StructureReport {
  usage: SlotUsage;
  warnings: string[];
}

export function checkStructure(
  ads: StructureInput[],
  s: AdRecommendationSettings,
): StructureReport {
  const st = s.structure;
  const active = ads.filter((a) => a.effectiveStatus === "ACTIVE");
  const byRole = (r: AdRole) => active.filter((a) => a.role === r).length;
  const unassigned = active.filter((a) => a.role === null || a.segment === null);

  const usage: SlotUsage = {
    active: active.length,
    max: st.maxActiveAds,
    control: { used: byRole("control"), max: st.controlSlots },
    challenger: { used: byRole("challenger"), max: st.challengerSlots },
    remarketing: { used: byRole("remarketing"), max: st.remarketingSlots },
    unassigned: unassigned.length,
  };

  const warnings: string[] = [];
  if (usage.active > usage.max) {
    warnings.push(`${usage.active} מודעות פעילות במטא, המקסימום הוא ${usage.max}.`);
  }
  const slot = (name: string, u: { used: number; max: number }) => {
    if (u.used > u.max) warnings.push(`${u.used} מודעות ${name} פעילות, מוגדרות ${u.max}.`);
  };
  slot("Control", usage.control);
  slot("Challenger", usage.challenger);
  slot("רימרקטינג", usage.remarketing);

  for (const a of unassigned) {
    warnings.push(`המודעה ${a.adName} (${a.adId}) פעילה במטא אבל ${a.segment === null ? "לא סווגה לפרוספקטינג או רימרקטינג" : "אין לה תפקיד בסבב"}.`);
  }
  for (const a of ads) {
    if (a.role === "remarketing" && a.segment === "prospecting") {
      warnings.push(`המודעה ${a.adName} (${a.adId}) מסומנת כמשבצת רימרקטינג אבל סווגה לפרוספקטינג.`);
    }
    if ((a.role === "control" || a.role === "challenger") && a.segment === "remarketing") {
      warnings.push(`המודעה ${a.adName} (${a.adId}) היא מודעת רימרקטינג בתפקיד של פרוספקטינג.`);
    }
  }
  return { usage, warnings };
}
