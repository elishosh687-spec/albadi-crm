"use client";

/**
 * "מודעות → הגדרות בדיקה" — every number that can change a recommendation,
 * each with its explanation, plus a live preview: the engine re-runs in the
 * browser on the unsaved values against the evidence the API already returned,
 * so the effect of a change is visible before it is saved.
 *
 * Settings change recommendations only. They never touch an approved manual
 * status, and nothing here reaches Meta.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Info, Loader2, RotateCcw, Save, ShieldCheck } from "lucide-react";
import {
  APPROVED_DEFAULTS_2026_09_18,
  FIELD_LABELS,
  changedSettingKeys,
  consistencyWarnings,
  validateSettings,
  type AdRecommendationSettings,
  type SettingsError,
} from "@/lib/ads/recommendation-settings";
import { SETTING_HELP } from "@/lib/ads/settings-help";
import { RECOMMENDATION_LABELS, recommend, type RecommendationCode } from "@/lib/ads/recommendation-engine";
import type { RecommendationsReport } from "@/lib/ads/assemble";
import { CODE_TONE, TONE_CLASS } from "./ReviewEditor";

type Policy = { revision: number; settings: AdRecommendationSettings; updatedAt: string | null; actor: string | null; isDefault: boolean };
type Revision = { revision: number; changedKeys: string[]; actor: string | null; createdAt: string };

const GROUPS: { key: keyof AdRecommendationSettings; title: string; description: string }[] = [
  { key: "economics", title: "כלכלה", description: "כמה שווה עסקה, כמה מותר לשלם עליה, ומה נחשב ליד זול." },
  { key: "gates", title: "שערי בדיקה", description: "שלושת שלבי ההוצאה ומה נדרש בכל אחד. הלידים נספרים ברגע שההוצאה המצטברת עברה את השער." },
  { key: "suitableLead", title: "ליד מתאים", description: "רק התגית שאתה שם ב-GHL. אין מספר סף בשיטה המאושרת, ולכן העקיפה כבויה עד שתקבע אחד." },
  { key: "structure", title: "מבנה סבב", description: "כמה מודעות רצות במקביל ובאיזה תפקיד. חריגה = אזהרה בלבד." },
  { key: "verdict", title: "מועמדת למנצחת / למפסידה", description: "מתי המערכת ממליצה. ההכרעה עצמה נשארת שלך — בשמירת סטטוס מאושר." },
];

const fmt = (v: unknown) => (v === null ? "לא מוגדר" : typeof v === "boolean" ? (v ? "כן" : "לא") : String(v));
const get = (s: AdRecommendationSettings, path: string) => {
  const [g, k] = path.split(".");
  return (s as unknown as Record<string, Record<string, unknown>>)[g][k];
};
const setPath = (s: AdRecommendationSettings, path: string, value: unknown): AdRecommendationSettings => {
  const [g, k] = path.split(".");
  const next = structuredClone(s) as unknown as Record<string, Record<string, unknown>>;
  next[g][k] = value;
  return next as unknown as AdRecommendationSettings;
};

export function AdRecommendationSettingsView({ apiToken }: { apiToken: string }) {
  const url = `/api/widget/ads/recommendation-settings?widget_token=${encodeURIComponent(apiToken)}`;
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<AdRecommendationSettings | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [report, setReport] = useState<RecommendationsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<SettingsError[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(url);
    const body = await r.json();
    if (!r.ok || !body.ok) throw new Error(body.error ?? "טעינת ההגדרות נכשלה");
    setPolicy(body.policy);
    setDraft(body.policy.settings);
    setRevisions(body.revisions ?? []);
    setMarkdown(body.markdown ?? "");
  }, [url]);

  useEffect(() => {
    load().catch((e) => setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) }));
    fetch(`/api/widget/ads/recommendations?widget_token=${encodeURIComponent(apiToken)}`)
      .then((r) => r.json())
      .then((b) => b.ok && setReport(b))
      .catch(() => undefined);
  }, [apiToken, load]);

  const dirtyKeys = useMemo(() => (policy && draft ? changedSettingKeys(policy.settings, draft) : []), [policy, draft]);
  const dirty = dirtyKeys.length > 0;

  // A full-page navigation (the sub-tabs are plain links) would drop the draft.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const validation = useMemo(() => (draft ? validateSettings(draft) : null), [draft]);
  const errors: SettingsError[] = validation && !validation.ok ? validation.errors : serverErrors;
  const errorsByPath = new Map(errors.map((e) => [e.path, e.message]));
  const warnings = draft ? consistencyWarnings(draft) : [];

  // Live preview: re-run the engine on saved vs draft settings.
  const preview = useMemo(() => {
    if (!report || !policy || !draft || !validation?.ok || !dirty) return null;
    const changes: { name: string; adId: string; from: RecommendationCode; to: RecommendationCode }[] = [];
    const before: Partial<Record<RecommendationCode, number>> = {};
    const after: Partial<Record<RecommendationCode, number>> = {};
    for (const row of report.rows) {
      const a = recommend(row.evidence, policy.settings, report.today).code;
      const b = recommend(row.evidence, validation.value, report.today).code;
      before[a] = (before[a] ?? 0) + 1;
      after[b] = (after[b] ?? 0) + 1;
      if (a !== b) changes.push({ name: row.adName, adId: row.adId, from: a, to: b });
    }
    return { changes, before, after };
  }, [report, policy, draft, validation, dirty]);

  async function save() {
    if (!draft || !policy) return;
    setBusy(true);
    setMessage(null);
    setServerErrors([]);
    try {
      const r = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: draft, expectedRevision: policy.revision }),
      });
      const body = await r.json();
      if (r.status === 400 && body.errors) {
        setServerErrors(body.errors);
        throw new Error(body.error ?? "ההגדרות לא נשמרו");
      }
      if (!r.ok || !body.ok) throw new Error(body.error ?? "השמירה נכשלה");
      await load();
      setMessage({ ok: true, text: `נשמר כגרסה ${body.policy.revision}. ההמלצות מחושבות מחדש; סטטוסים מאושרים לא השתנו.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const resetDiff = draft ? changedSettingKeys(draft, APPROVED_DEFAULTS_2026_09_18) : [];

  return (
    <section dir="rtl" className="space-y-4">
      <div className="inline-flex items-center gap-1 text-[13px] text-emerald-300/90">
        <ShieldCheck className="size-3.5" /> ההגדרות משנות המלצות בלבד. הן אינן מפעילות או עוצרות מודעות ב-Meta.
      </div>

      {policy && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="text-[13px]">
            גרסה {policy.revision}
            {policy.isDefault ? " · ברירת המחדל מ-18/09" : ""}
            {policy.updatedAt ? ` · ${new Date(policy.updatedAt).toLocaleDateString("he-IL")}` : ""}
          </span>
          <div className="ms-auto flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirmReset((v) => !v)} className="lux-tap inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground">
              <RotateCcw className="size-3.5" /> איפוס
            </button>
            <button type="button" onClick={save} disabled={busy || !dirty || (validation !== null && !validation.ok)}
              className="lux-cta-champagne disabled:cursor-not-allowed disabled:opacity-50" style={{ minHeight: 44, padding: "0 18px", fontSize: 14 }}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {busy ? "שומר…" : dirty ? `שמור ${dirtyKeys.length} שינויים` : "נשמר"}
            </button>
          </div>
        </div>
      )}

      {dirty && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
          {dirtyKeys.length === 1 ? "שינוי אחד לא נשמר" : `${dirtyKeys.length} שינויים לא נשמרו`}: {dirtyKeys.map((k) => FIELD_LABELS[k]?.label ?? k).join(" · ")}
        </div>
      )}

      {confirmReset && draft && (
        <div className="space-y-2 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 text-xs">
          {resetDiff.length === 0 ? (
            <div>הערכים כבר זהים לברירת המחדל שאושרה ב-18/09/2026.</div>
          ) : (
            <>
              <div className="font-medium">האיפוס יחזיר את הערכים האלה לברירת המחדל שאושרה ב-18/09/2026:</div>
              <ul className="space-y-0.5">
                {resetDiff.map((k) => (
                  <li key={k}>
                    {FIELD_LABELS[k]?.label ?? k}: {fmt(get(draft, k))} ← <strong>{fmt(get(APPROVED_DEFAULTS_2026_09_18, k))}</strong>
                  </li>
                ))}
              </ul>
              <div className="text-muted-foreground">זה ממלא את הטופס בלבד — עדיין צריך לשמור.</div>
              <button type="button" onClick={() => { setDraft(structuredClone(APPROVED_DEFAULTS_2026_09_18)); setConfirmReset(false); }}
                className="lux-tap rounded-md border border-amber-300/40 px-3 py-1.5 text-amber-100">
                אשר איפוס
              </button>
            </>
          )}
        </div>
      )}

      {message && (
        <div className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${message.ok ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-200" : "border-red-400/20 bg-red-400/5 text-red-200"}`}>
          {message.ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
          {message.text}
        </div>
      )}

      {warnings.map((w) => (
        <div key={w} className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>לא תואם: {w}. הערך השמור נשאר כמו שהוא — זו רק אזהרה.</span>
        </div>
      ))}
      {errors.filter((e) => !e.path || !FIELD_LABELS[e.path]).map((e) => (
        <div key={e.message} className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-200">{e.message}</div>
      ))}

      {preview && (
        <div className="space-y-2 rounded-lg border border-sky-400/25 bg-sky-400/5 p-3 text-xs">
          <div className="font-medium text-sky-100">תצוגה מקדימה — ההמלצות אחרי השינוי (לפני שמירה)</div>
          {preview.changes.length === 0 ? (
            <div className="text-sky-100/80">אף המלצה לא משתנה.</div>
          ) : (
            <ul className="space-y-1">
              {preview.changes.map((c) => (
                <li key={c.adId} className="flex flex-wrap items-center gap-1.5">
                  <span style={{ unicodeBidi: "isolate", direction: "ltr" }}>{c.name}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${TONE_CLASS[CODE_TONE[c.from]]}`}>{RECOMMENDATION_LABELS[c.from]}</span>
                  ←
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${TONE_CLASS[CODE_TONE[c.to]]}`}>{RECOMMENDATION_LABELS[c.to]}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="text-[13px] text-sky-100/70">סטטוסים מאושרים לא משתנים בשמירה. שינוי התגית משפיע על הספירה רק אחרי שמירה.</div>
        </div>
      )}

      {!draft ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> טוען הגדרות…
        </div>
      ) : (
        GROUPS.map((g) => (
          <div key={g.key}>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{g.title}</h3>
            <div className="divide-y divide-border/50 rounded-lg border border-border/60">
              {Object.keys(draft[g.key]).map((k) => {
                const path = `${g.key}.${k}`;
                return (
                  <SettingField
                    key={path}
                    path={path}
                    value={get(draft, path)}
                    saved={policy ? get(policy.settings, path) : undefined}
                    error={errorsByPath.get(path)}
                    daily={draft.gates.referenceDailyBudgetIls}
                    onChange={(v) => { setDraft((d) => (d ? setPath(d, path, v) : d)); setServerErrors([]); }}
                  />
                );
              })}
            </div>
          </div>
        ))
      )}

      {revisions.length > 0 && (
        <details className="rounded-lg border border-border/60 bg-background/20">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">היסטוריית גרסאות</summary>
          <ul className="space-y-1 border-t border-border/50 p-3 text-[13px] text-muted-foreground">
            {revisions.map((r) => (
              <li key={r.revision}>
                <strong className="text-foreground">גרסה {r.revision}</strong> · {new Date(r.createdAt).toLocaleString("he-IL")} ·{" "}
                {r.changedKeys.length > 8 ? `${r.changedKeys.length} שדות` : r.changedKeys.map((k) => FIELD_LABELS[k]?.label ?? k).join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      {markdown && (
        <details className="rounded-lg border border-border/60 bg-background/20">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">סיכום Markdown למסמכי האסטרטגיה</summary>
          <div className="space-y-2 border-t border-border/50 p-3">
            <button type="button" onClick={() => navigator.clipboard?.writeText(markdown).then(() => setMessage({ ok: true, text: "הסיכום הועתק" }))}
              className="lux-tap inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs">
              <ClipboardCopy className="size-3.5" /> העתק
            </button>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 p-3 text-[13px] leading-5 text-muted-foreground">{markdown}</pre>
          </div>
        </details>
      )}
    </section>
  );
}

function SettingField({
  path, value, saved, error, daily, onChange,
}: {
  path: string;
  value: unknown;
  saved: unknown;
  error?: string;
  daily: number;
  onChange: (v: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = FIELD_LABELS[path];
  const help = SETTING_HELP[path as keyof typeof SETTING_HELP];
  const dirty = saved !== undefined && saved !== value;
  const isSpendGate = /^gates\.(firstGate|stability|dealProof)SpendIls$/.test(path);
  const name = label?.label ?? path;

  return (
    <div className={`px-3 py-2 ${error ? "bg-red-400/5" : dirty ? "bg-primary/5" : ""}`}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-start text-xs" title="מה זה?">
          {dirty && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="שונה" />}
          <span className="truncate">{name}</span>
          <Info className="size-3 shrink-0 text-muted-foreground/60" />
        </button>
        {typeof value === "boolean" ? (
          <button type="button" role="switch" aria-label={name} aria-checked={value} onClick={() => onChange(!value)}
            className={`lux-tap shrink-0 rounded-full border px-3 py-1 text-xs ${value ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-border text-muted-foreground"}`}>
            {value ? "כן" : "לא"}
          </button>
        ) : path === "suitableLead.tag" ? (
          <input type="text" aria-label={name} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} dir="ltr"
            className="w-36 shrink-0 rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs" />
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1">
            <input type="number" aria-label={name} inputMode="decimal" step="any" value={value === null ? "" : String(value)}
              placeholder={value === null ? "ריק" : undefined}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") onChange(path === "suitableLead.qualityOverrideMinSuitable" ? null : NaN);
                else onChange(Number(raw));
              }}
              className="w-20 rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs" />
            <span className="w-11 text-[13px] text-muted-foreground" style={{ unicodeBidi: "isolate", direction: undefined }}>{label?.unit ?? ""}</span>
          </span>
        )}
      </div>
      {error && <p className="mt-1 text-[13px] text-red-300">{error}</p>}
      {open && (
        <div className="mt-1 space-y-1 text-[13px] leading-5 text-muted-foreground">
          {help && <p>{help.help}</p>}
          {help?.whenUnset && <p>כשריק: {help.whenUnset}</p>}
          {isSpendGate && typeof value === "number" && daily > 0 && <p>≈ {Math.ceil(value / daily)} ימי מסירה ב-₪{daily} ליום.</p>}
          {dirty && <p className="text-primary">הערך השמור: {fmt(saved)}</p>}
        </div>
      )}
    </div>
  );
}
