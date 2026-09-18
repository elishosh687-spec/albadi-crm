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
import { AlertTriangle, CheckCircle2, ClipboardCopy, Loader2, RotateCcw, Save, ShieldCheck } from "lucide-react";
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
import { CODE_TONE, TONE_CLASS } from "./AdRecommendationsView";

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
      <div className="flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs leading-5 text-emerald-100">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <span>ההגדרות משנות המלצות בלבד. הן אינן מפעילות או עוצרות מודעות ב-Meta.</span>
      </div>

      {policy && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            גרסה <strong className="text-foreground">{policy.revision}</strong>
            {policy.isDefault ? " — ברירת המחדל שאושרה 18/09, עוד לא נשמרה" : ""}
            {policy.updatedAt ? ` · עודכן ${new Date(policy.updatedAt).toLocaleString("he-IL")}` : ""}
          </span>
          <div className="ms-auto flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirmReset((v) => !v)} className="lux-tap inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground">
              <RotateCcw className="size-3.5" /> איפוס לברירת המחדל
            </button>
            <button type="button" onClick={save} disabled={busy || !dirty || (validation !== null && !validation.ok)}
              className="lux-cta-champagne disabled:cursor-not-allowed disabled:opacity-50" style={{ minHeight: 36, padding: "0 14px", fontSize: 12 }}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {busy ? "שומר…" : dirty ? `שמור ${dirtyKeys.length} שינויים` : "נשמר"}
            </button>
          </div>
        </div>
      )}

      {dirty && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
          יש {dirtyKeys.length} שינויים שלא נשמרו: {dirtyKeys.map((k) => FIELD_LABELS[k]?.label ?? k).join(" · ")}
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
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${TONE_CLASS[CODE_TONE[c.from]]}`}>{RECOMMENDATION_LABELS[c.from]}</span>
                  ←
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${TONE_CLASS[CODE_TONE[c.to]]}`}>{RECOMMENDATION_LABELS[c.to]}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="text-[11px] text-sky-100/70">סטטוסים מאושרים לא משתנים בשמירה. שינוי התגית משפיע על הספירה רק אחרי שמירה.</div>
        </div>
      )}

      {!draft ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> טוען הגדרות…
        </div>
      ) : (
        GROUPS.map((g) => (
          <details key={g.key} open className="group rounded-lg border border-border/60 bg-background/20">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-sm font-medium">{g.title}</div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{g.description}</p>
              </div>
              <span className="mt-1 text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
            </summary>
            <div className="lux-stack-sm grid gap-3 border-t border-border/50 p-3 lg:grid-cols-2">
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
          </details>
        ))
      )}

      {revisions.length > 0 && (
        <details className="rounded-lg border border-border/60 bg-background/20">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">היסטוריית גרסאות</summary>
          <ul className="space-y-1 border-t border-border/50 p-3 text-[11px] text-muted-foreground">
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
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 p-3 text-[11px] leading-5 text-muted-foreground">{markdown}</pre>
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
  const label = FIELD_LABELS[path];
  const help = SETTING_HELP[path as keyof typeof SETTING_HELP];
  const dirty = saved !== undefined && saved !== value;
  const isSpendGate = /^gates\.(firstGate|stability|dealProof)SpendIls$/.test(path);

  return (
    <div className={`rounded-lg border p-3 ${error ? "border-red-400/40 bg-red-400/5" : dirty ? "border-primary/35 bg-primary/5" : "border-border/50 bg-card/20"}`}>
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs font-medium">{label?.label ?? path}</label>
        {dirty && <span className="text-[10px] text-primary">שונה מ-{fmt(saved)}</span>}
      </div>
      {help && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{help.help}</p>}
      {help?.whenUnset && <p className="mt-1 text-[11px] leading-5 text-muted-foreground/80">כשלא מוגדר: {help.whenUnset}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {typeof value === "boolean" ? (
          <button type="button" role="switch" aria-label={label?.label ?? path} aria-checked={value} onClick={() => onChange(!value)}
            className={`lux-tap inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${value ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-border bg-background/30 text-muted-foreground"}`}>
            <span className={`size-2 rounded-full ${value ? "bg-emerald-400" : "bg-muted-foreground/50"}`} />
            {value ? "מופעל" : "כבוי"}
          </button>
        ) : path === "suitableLead.tag" ? (
          <input type="text" aria-label={label?.label ?? path} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} dir="ltr"
            className="w-56 rounded-md border border-border bg-background/60 px-3 py-2 text-xs" />
        ) : (
          <input type="number" aria-label={label?.label ?? path} inputMode="decimal" step="any" value={value === null ? "" : String(value)}
            placeholder={value === null ? "לא מוגדר" : undefined}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") onChange(path === "suitableLead.qualityOverrideMinSuitable" ? null : NaN);
              else onChange(Number(raw));
            }}
            className="w-32 rounded-md border border-border bg-background/60 px-3 py-2 text-xs" />
        )}
        {label?.unit && <span className="text-[11px] text-muted-foreground" style={{ unicodeBidi: "isolate", direction: label.unit === ":1" ? "ltr" : undefined }}>{label.unit}</span>}
        {isSpendGate && typeof value === "number" && daily > 0 && (
          <span className="text-[11px] text-muted-foreground">≈ {Math.ceil(value / daily)} ימי מסירה ב-₪{daily} ליום</span>
        )}
      </div>
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
