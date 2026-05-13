export const STAGE_LABEL: Record<string, string> = {
  NEW: "חדש",
  WAITING_FACTORY: "ממתין למפעל",
  QUOTED: "הצעה נשלחה",
  AWAITING_DECISION: "ממתין להחלטה",
  AWAITING_LOGO: "ממתין ללוגו",
  IN_PROGRESS: "בתהליך",
  AWAITING_FINAL: "ממתין למחיר סופי",
  NEGOTIATING: "במשא ומתן",
  WAITING_CALL: "ממתין לשיחה",
  WON: "נסגרה",
  DROPPED: "ננטשה",
  UNCLASSIFIED: "לא מסווג",
};

// Tone tokens used by the column header + lead card accent.
// Each value pairs with the dark-mode color tokens defined in app/globals.css.
export const STAGE_TONE: Record<
  string,
  { bar: string; pill: string; text: string }
> = {
  NEW: {
    bar: "bg-sky-500/60",
    pill: "bg-sky-500/15 text-sky-300 border border-sky-500/20",
    text: "text-sky-300",
  },
  WAITING_FACTORY: {
    bar: "bg-amber-500/60",
    pill: "bg-amber-500/15 text-amber-300 border border-amber-500/20",
    text: "text-amber-300",
  },
  QUOTED: {
    bar: "bg-violet-500/60",
    pill: "bg-violet-500/15 text-violet-300 border border-violet-500/20",
    text: "text-violet-300",
  },
  AWAITING_DECISION: {
    bar: "bg-fuchsia-500/60",
    pill: "bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/20",
    text: "text-fuchsia-300",
  },
  AWAITING_LOGO: {
    bar: "bg-cyan-500/60",
    pill: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/20",
    text: "text-cyan-300",
  },
  IN_PROGRESS: {
    bar: "bg-orange-500/60",
    pill: "bg-orange-500/15 text-orange-300 border border-orange-500/20",
    text: "text-orange-300",
  },
  AWAITING_FINAL: {
    bar: "bg-rose-500/60",
    pill: "bg-rose-500/15 text-rose-300 border border-rose-500/20",
    text: "text-rose-300",
  },
  NEGOTIATING: {
    bar: "bg-pink-500/60",
    pill: "bg-pink-500/15 text-pink-300 border border-pink-500/20",
    text: "text-pink-300",
  },
  WAITING_CALL: {
    bar: "bg-yellow-500/60",
    pill: "bg-yellow-500/15 text-yellow-300 border border-yellow-500/20",
    text: "text-yellow-300",
  },
  WON: {
    bar: "bg-emerald-500/60",
    pill: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20",
    text: "text-emerald-300",
  },
  DROPPED: {
    bar: "bg-zinc-500/60",
    pill: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
    text: "text-zinc-400",
  },
  UNCLASSIFIED: {
    bar: "bg-slate-500/60",
    pill: "bg-slate-500/15 text-slate-300 border border-slate-500/20",
    text: "text-slate-300",
  },
};

export function timeAgoHe(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "עכשיו";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} ד׳`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ש׳`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ימ׳`;
  const mo = Math.floor(d / 30);
  return `${mo} ח׳`;
}
