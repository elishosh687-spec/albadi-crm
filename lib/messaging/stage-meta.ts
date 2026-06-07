// Shared stage display tokens — used by dashboard v3 and GHL widgets.
//
// 4-stage funnel (post 2026-06-07 rename) — must match V2_PIPELINE_STAGES in
// lib/manychat/stages.ts and the table in docs/CUSTOMER-FLOW.md.

export const STAGE_LABEL: Record<string, string> = {
  INTAKE: "שאלון + הצעה אוטומטית",
  DISCAVERY: "שיחת בירור",
  FACTORY_WAIT: "בדיקת מפעל",
  CONSIDERATION: "שוקל הצעה / מו״מ",
  WON: "נסגר",
  LOST: "לא נסגר",
  // Implicit pre-quote — for display when pipeline_stage IS NULL but lead exists.
  PRE_QUOTE: "בשאלון",
  UNCLASSIFIED: "לא מסווג",
};

export const STAGE_TONE: Record<
  string,
  { bar: string; pill: string; text: string }
> = {
  INTAKE: {
    bar: "bg-sky-500/60",
    pill: "bg-sky-500/15 text-sky-300 border border-sky-500/20",
    text: "text-sky-300",
  },
  DISCAVERY: {
    bar: "bg-cyan-500/60",
    pill: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/20",
    text: "text-cyan-300",
  },
  FACTORY_WAIT: {
    bar: "bg-amber-500/60",
    pill: "bg-amber-500/15 text-amber-300 border border-amber-500/20",
    text: "text-amber-300",
  },
  CONSIDERATION: {
    bar: "bg-rose-500/60",
    pill: "bg-rose-500/15 text-rose-300 border border-rose-500/20",
    text: "text-rose-300",
  },
  WON: {
    bar: "bg-emerald-500/60",
    pill: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20",
    text: "text-emerald-300",
  },
  LOST: {
    bar: "bg-zinc-500/60",
    pill: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
    text: "text-zinc-400",
  },
  PRE_QUOTE: {
    bar: "bg-slate-500/60",
    pill: "bg-slate-500/15 text-slate-300 border border-slate-500/20",
    text: "text-slate-300",
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
