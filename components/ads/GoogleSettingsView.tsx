"use client";

/**
 * "הגדרות ← שיווק · גוגל ← כללי בדיקה — גוגל". The Google world's own
 * settings — separate from Meta's by Eli's decision (23/09). Same pattern as
 * AdRecommendationSettingsView: an explanation for every field, warnings that
 * never overwrite, save with the revision it started from, reset, history,
 * Markdown. There is no live preview: Google has no recommendation engine yet.
 *
 * Nothing here reaches Google Ads.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Info, Loader2, RotateCcw, Save, ShieldCheck } from "lucide-react";
import {
  GOOGLE_DEFAULTS_2026_09_23,
  GOOGLE_FIELD_LABELS,
  GOOGLE_GROUPS,
  GOOGLE_SETTING_HELP,
  changedGoogleKeys,
  googleConsistencyWarnings,
  validateGoogleSettings,
  type GoogleAdsSettings,
  type GoogleSettingsError,
} from "@/lib/ads/google-settings";

type Revision = { revision: number; changedKeys: string[]; actor: string | null; createdAt: string };
type Policy = { revision: number; settings: GoogleAdsSettings; updatedAt: string | null; isDefault: boolean; history: Revision[] };

const NULLABLE = new Set(["economics.targetCplIls"]);
const TEXT = new Set(["suitableLead.tag", "measurement.formConversionActionId", "reporting.qualifiedActionId", "reporting.quoteActionId", "reporting.purchaseActionId"]);

const fmt = (v: unknown) => (v === null ? "לא מוגדר" : typeof v === "boolean" ? (v ? "כן" : "לא") : String(v));
const get = (s: GoogleAdsSettings, path: string) => {
  const [g, k] = path.split(".");
  return (s as unknown as Record<string, Record<string, unknown>>)[g][k];
};
const setPath = (s: GoogleAdsSettings, path: string, value: unknown): GoogleAdsSettings => {
  const [g, k] = path.split(".");
  const next = structuredClone(s) as unknown as Record<string, Record<string, unknown>>;
  next[g][k] = value;
  return next as unknown as GoogleAdsSettings;
};

export function GoogleSettingsView({ apiToken }: { apiToken: string }) {
  const url = `/api/widget/ads/google-settings?widget_token=${encodeURIComponent(apiToken)}`;
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<GoogleAdsSettings | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<GoogleSettingsError[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(url);
    const body = await r.json();
    if (!r.ok || !body.ok) throw new Error(body.error ?? "טעינת ההגדרות נכשלה");
    setPolicy(body.policy);
    setDraft(body.policy.settings);
    setMarkdown(body.markdown ?? "");
  }, [url]);

  useEffect(() => {
    load().catch((e) => setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  }, [load]);

  const dirtyKeys = useMemo(() => (policy && draft ? changedGoogleKeys(policy.settings, draft) : []), [policy, draft]);
  const dirty = dirtyKeys.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const validation = useMemo(() => (draft ? validateGoogleSettings(draft) : null), [draft]);
  const errors: GoogleSettingsError[] = validation && !validation.ok ? validation.errors : serverErrors;
  const errorsByPath = new Map(errors.map((e) => [e.path, e.message]));
  const warnings = draft ? googleConsistencyWarnings(draft) : [];
  const resetDiff = draft ? changedGoogleKeys(draft, GOOGLE_DEFAULTS_2026_09_23) : [];

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
      setMessage({ ok: true, text: `נשמר כגרסה ${body.policy.revision}. חל על ההתראות והמספרים בלשונית גוגל.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section dir="rtl" className="space-y-4">
      <div className="inline-flex items-center gap-1 text-[13px] text-emerald-300/90">
        <ShieldCheck className="size-3.5" /> ההגדרות לא משנות שום הגדרה ב-Google Ads, ונפרדות לגמרי מההגדרות של מטא. רק ״דיווח חזרה לגוגל״ קובע אילו ערכים נשלחים כהמרות.
      </div>

      {policy && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="text-[13px]">
            גרסה {policy.revision}
            {policy.isDefault ? " · ברירת המחדל מ-23/09" : ""}
            {policy.updatedAt ? ` · ${new Date(policy.updatedAt).toLocaleDateString("he-IL")}` : ""}
          </span>
          <div className="ms-auto flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirmReset((v) => !v)} className="lux-tap inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground" style={{ minHeight: 44 }}>
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
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground" aria-live="polite">
          {dirtyKeys.length === 1 ? "שינוי אחד לא נשמר" : `${dirtyKeys.length} שינויים לא נשמרו`}: {dirtyKeys.map((k) => GOOGLE_FIELD_LABELS[k]?.label ?? k).join(" · ")}
        </div>
      )}

      {confirmReset && draft && (
        <div className="space-y-2 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 text-xs">
          {resetDiff.length === 0 ? (
            <div>הערכים כבר זהים לברירת המחדל מ-23/09/2026.</div>
          ) : (
            <>
              <div className="font-medium">האיפוס יחזיר את הערכים האלה לברירת המחדל מ-23/09/2026:</div>
              <ul className="space-y-0.5">
                {resetDiff.map((k) => (
                  <li key={k}>
                    {GOOGLE_FIELD_LABELS[k]?.label ?? k}: {fmt(get(draft, k))} ← <strong>{fmt(get(GOOGLE_DEFAULTS_2026_09_23, k))}</strong>
                  </li>
                ))}
              </ul>
              <div className="text-muted-foreground">זה ממלא את הטופס בלבד — עדיין צריך לשמור.</div>
              <button type="button" onClick={() => { setDraft(structuredClone(GOOGLE_DEFAULTS_2026_09_23)); setConfirmReset(false); }}
                className="lux-tap rounded-md border border-amber-300/40 px-3 py-1.5 text-amber-100" style={{ minHeight: 44 }}>
                אשר איפוס
              </button>
            </>
          )}
        </div>
      )}

      {message && (
        <div role="status" className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${message.ok ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-200" : "border-red-400/20 bg-red-400/5 text-red-200"}`}>
          {message.ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
          {message.text}
        </div>
      )}

      {warnings.map((w) => (
        <div key={w} className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>לא תואם: {w}. הערך נשאר כמו שהוא — זו רק אזהרה.</span>
        </div>
      ))}
      {errors.filter((e) => !e.path || !GOOGLE_FIELD_LABELS[e.path]).map((e) => (
        <div key={e.message} className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-200">{e.message}</div>
      ))}

      {!draft ? (
        <div className="space-y-2" aria-busy="true">
          <div className="ux-skel" style={{ height: 44 }} />
          <div className="ux-skel" style={{ height: 44 }} />
          <div className="ux-skel" style={{ height: 44 }} />
        </div>
      ) : (
        GOOGLE_GROUPS.map((g) => (
          <div key={g.key}>
            <h3 className="mb-0.5 text-xs font-medium text-muted-foreground">{g.title}</h3>
            <p className="mb-1 text-[13px] text-muted-foreground">{g.description}</p>
            <div className="divide-y divide-border/50 rounded-lg border border-border/60">
              {Object.keys(draft[g.key]).map((k) => {
                const path = `${g.key}.${k}`;
                return (
                  <Field
                    key={path}
                    path={path}
                    value={get(draft, path)}
                    saved={policy ? get(policy.settings, path) : undefined}
                    error={errorsByPath.get(path)}
                    onChange={(v) => { setDraft((d) => (d ? setPath(d, path, v) : d)); setServerErrors([]); }}
                  />
                );
              })}
            </div>
          </div>
        ))
      )}

      {policy && policy.history.length > 0 && (
        <details className="rounded-lg border border-border/60 bg-background/20">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">היסטוריית גרסאות</summary>
          <ul className="space-y-1 border-t border-border/50 p-3 text-[13px] text-muted-foreground">
            {policy.history.map((r) => (
              <li key={r.revision}>
                <strong className="text-foreground">גרסה {r.revision}</strong> · {new Date(r.createdAt).toLocaleString("he-IL")} ·{" "}
                {r.changedKeys.length > 8 ? `${r.changedKeys.length} שדות` : r.changedKeys.map((k) => GOOGLE_FIELD_LABELS[k]?.label ?? k).join(", ")}
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
              className="lux-tap inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs" style={{ minHeight: 44 }}>
              <ClipboardCopy className="size-3.5" /> העתק
            </button>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 p-3 text-[13px] leading-5 text-muted-foreground">{markdown}</pre>
          </div>
        </details>
      )}
    </section>
  );
}

function Field({ path, value, saved, error, onChange }: { path: string; value: unknown; saved: unknown; error?: string; onChange: (v: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const label = GOOGLE_FIELD_LABELS[path];
  const help = GOOGLE_SETTING_HELP[path];
  const dirty = saved !== undefined && saved !== value;
  const name = label?.label ?? path;
  return (
    <div className={`px-3 py-2 ${error ? "bg-red-400/5" : dirty ? "bg-primary/5" : ""}`}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-start text-xs" style={{ minHeight: 44 }} title="מה זה?">
          {dirty && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="שונה" />}
          <span>{name}</span>
          <Info className="size-3 shrink-0 text-muted-foreground/60" />
        </button>
        {typeof value === "boolean" ? (
          <button type="button" role="switch" aria-label={name} aria-checked={value} onClick={() => onChange(!value)}
            className={`lux-tap shrink-0 rounded-full border px-3 py-1 text-xs ${value ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-border text-muted-foreground"}`} style={{ minHeight: 44 }}>
            {value ? "כן" : "לא"}
          </button>
        ) : TEXT.has(path) ? (
          <input type="text" aria-label={name} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} dir="ltr"
            className="w-36 shrink-0 rounded-md border border-border bg-background/60 px-2 py-1.5" style={{ minHeight: 44, fontSize: 16 }} />
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1">
            <input type="number" aria-label={name} inputMode="decimal" step="any" value={value === null ? "" : String(value)}
              placeholder={value === null ? "ריק" : undefined}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") onChange(NULLABLE.has(path) ? null : NaN);
                else onChange(Number(raw));
              }}
              className="w-20 rounded-md border border-border bg-background/60 px-2 py-1.5" style={{ minHeight: 44, fontSize: 16 }} />
            <span className="w-11 text-[13px] text-muted-foreground">{label?.unit ?? ""}</span>
          </span>
        )}
      </div>
      {error && <p className="mt-1 text-[13px] text-red-300">{error}</p>}
      {open && (
        <div className="mt-1 space-y-1 text-[13px] leading-5 text-muted-foreground">
          {help && <p>{help.help}</p>}
          {help?.whenUnset && <p>כשריק: {help.whenUnset}</p>}
          {dirty && <p className="text-primary">הערך השמור: {fmt(saved)}</p>}
        </div>
      )}
    </div>
  );
}
