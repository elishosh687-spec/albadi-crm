const NEGATED_EXPRESS_RX =
  /(?:לא\s+(?:צריך|צריכים|דחוף|מהר|מהיר|אקספרס|אוירי|אווירי)|אין\s+(?:צורך|לחץ))/i;

const EXPRESS_RX =
  /(?:אקספרס|express|אוירי|אווירי|מהיר(?:ה|ים)?|מהר|דחוף(?:ה|ים)?|בהקדם)/i;

/** Detect a customer's explicit request for a faster-than-sea route. */
export function isExpressRequest(text: string | null | undefined): boolean {
  const normalized = (text ?? "").trim();
  if (!normalized || NEGATED_EXPRESS_RX.test(normalized)) return false;
  return EXPRESS_RX.test(normalized);
}

export const EXPRESS_HANDOFF_REPLY =
  "קיבלתי — מסלול אקספרס או אווירי נבדק מול נציג. נמשיך לאסוף את המפרט כדי שנוכל לחזור אליכם עם אפשרות מתאימה.";
