/** Shared CRM stage semantics used by the GHL widget and legacy dashboard. */
export type LifecycleKey =
  | "NEW_INQUIRY"
  | "QUALIFIED"
  | "SALES_ACCEPTED"
  | "OPPORTUNITY"
  | "CUSTOMER"
  | "CLOSED_LOST";

export type PriorityBand = "HOT" | "WARM" | "NURTURE" | "LOW";

export const LIFECYCLE_LABEL: Record<LifecycleKey, string> = {
  NEW_INQUIRY: "פנייה חדשה",
  QUALIFIED: "כשיר",
  SALES_ACCEPTED: "בטיפול מכירה",
  OPPORTUNITY: "הזדמנות",
  CUSTOMER: "לקוח",
  CLOSED_LOST: "נסגר שלילי",
};

export const PRIORITY_LABEL: Record<PriorityBand, string> = {
  HOT: "חם",
  WARM: "חמים",
  NURTURE: "לטיפוח",
  LOW: "נמוך",
};

export function lifecycleOf(stage: string | null | undefined): LifecycleKey {
  switch ((stage ?? "").toUpperCase()) {
    case "":
      return "NEW_INQUIRY";
    case "INTAKE":
      return "QUALIFIED";
    case "DISCAVERY":
    case "FACTORY_WAIT":
      return "SALES_ACCEPTED";
    case "CONSIDERATION":
      return "OPPORTUNITY";
    case "WON":
      return "CUSTOMER";
    case "LOST":
      return "CLOSED_LOST";
    default:
      return "NEW_INQUIRY";
  }
}
