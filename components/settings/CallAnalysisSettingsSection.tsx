"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, Loader2, Save, ShieldCheck } from "lucide-react";
import {
  BOT_SETTING_FIELDS,
  DEFAULT_BOT_SETTINGS,
  type BotSettingField,
  type BotSettings,
} from "@/lib/bot-settings/schema";

const ANALYSIS_KEYS: Array<keyof BotSettings> = [
  "callAnalysisEnabled",
  "callAnalysisGhlEnabled",
  "callAnalysisElevenlabsEnabled",
  "analysisModel",
  "callAnalysisGuidance",
  "callAnalysisPublishNote",
  "callAnalysisIncludeTranscript",
  "callAnalysisIncludeScore",
  "callAnalysisNoteSections",
  "callAnalysisTaskMode",
  "callAnalysisConfidenceThreshold",
  "callAnalysisEvidenceRequired",
  "callAnalysisMissingDuePolicy",
  "callAnalysisDefaultDueHours",
  "callAnalysisWorkdayStart",
  "callAnalysisWorkdayEnd",
  "callAnalysisAssigneeMode",
  "callAnalysisFixedAssigneeId",
  "callAnalysisDuplicateWindowHours",
  "callAnalysisSupersedeAutoTasks",
  "callAnalysisAutoActionTypes",
  "callAnalysisAlwaysApproveActionTypes",
  "callAnalysisNegotiationStatusMode",
  "callAnalysisFutureStatusMode",
  "callAnalysisWonStatusMode",
  "callAnalysisLostStatusMode",
  "callAnalysisMaxFutureDays",
  "callAnalysisMinTranscriptChars",
];

const SECTIONS: Array<{
  title: string;
  description: string;
  keys: Array<keyof BotSettings>;
  open?: boolean;
  write?: boolean;
}> = [
  {
    title: "הפעלה ומקורות",
    description: "מה עובר ניתוח ומאיזה מקור. כיבוי כאן לא מוחק ניתוחים ישנים.",
    open: true,
    keys: ["callAnalysisEnabled", "callAnalysisGhlEnabled", "callAnalysisElevenlabsEnabled", "analysisModel"],
  },
  {
    title: "מה מחפשים בשיחה",
    description: "הנחיות עסקיות למנתח. מבנה הנתונים ובדיקות הבטיחות נשארים מוגנים בקוד.",
    keys: ["callAnalysisGuidance", "callAnalysisMinTranscriptChars", "callAnalysisMaxFutureDays"],
  },
  {
    title: "הערה בכרטיס הלקוח",
    description: "מה יוצג ב-GHL. הנתונים המלאים נשמרים במערכת גם אם בוחרים הערה קצרה.",
    write: true,
    keys: [
      "callAnalysisPublishNote",
      "callAnalysisIncludeTranscript",
      "callAnalysisIncludeScore",
      "callAnalysisNoteSections",
    ],
  },
  {
    title: "יצירת משימות ובטיחות",
    description: "החלק שקובע אם הצעה נשמרת בלבד, מחכה לאישור או הופכת למשימה אמיתית.",
    open: true,
    write: true,
    keys: [
      "callAnalysisTaskMode",
      "callAnalysisConfidenceThreshold",
      "callAnalysisEvidenceRequired",
      "callAnalysisAutoActionTypes",
      "callAnalysisAlwaysApproveActionTypes",
      "callAnalysisDuplicateWindowHours",
      "callAnalysisSupersedeAutoTasks",
    ],
  },
  {
    title: "אחראי ומועד",
    description: "מי מקבל את המשימה ומה קורה כאשר השיחה לא כוללת שעה מדויקת.",
    keys: [
      "callAnalysisMissingDuePolicy",
      "callAnalysisDefaultDueHours",
      "callAnalysisWorkdayStart",
      "callAnalysisWorkdayEnd",
      "callAnalysisAssigneeMode",
      "callAnalysisFixedAssigneeId",
    ],
  },
  {
    title: "המלצות סטטוס",
    description: "כל סטטוס נשלט בנפרד. נסגר ואבוד נשארים המלצה בלבד בשלב ההשקה.",
    write: true,
    keys: [
      "callAnalysisNegotiationStatusMode",
      "callAnalysisFutureStatusMode",
      "callAnalysisWonStatusMode",
      "callAnalysisLostStatusMode",
    ],
  },
];

function widgetUrl(token: string): string {
  return `/api/widget/bot-settings?widget_token=${encodeURIComponent(token)}`;
}

export function CallAnalysisSettingsSection({ apiToken }: { apiToken: string }) {
  const [values, setValues] = useState<BotSettings | null>(null);
  const [saved, setSaved] = useState<BotSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewTranscript, setPreviewTranscript] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewResult, setPreviewResult] = useState<null | {
    decision: string;
    reason: string;
    note: string;
  }>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(widgetUrl(apiToken));
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error ?? "טעינת ההגדרות נכשלה");
        if (active) {
          setValues(body.settings);
          setSaved(body.settings);
        }
      } catch (error) {
        if (active) setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, [apiToken]);

  const dirtyCount = useMemo(() => {
    if (!values || !saved) return 0;
    return ANALYSIS_KEYS.filter((key) => values[key] !== saved[key]).length;
  }, [saved, values]);

  async function save() {
    if (!values) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(widgetUrl(apiToken), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "שמירת ההגדרות נכשלה");
      setValues(body.settings);
      setSaved(body.settings);
      setMessage({ ok: true, text: "נשמר. שיחות חדשות ישתמשו בהגדרות האלה." });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (previewTranscript.trim().length < 10) return;
    setPreviewBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/widget/call-analysis/preview?widget_token=${encodeURIComponent(apiToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: previewTranscript, callStartedAt: new Date().toISOString() }),
        },
      );
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "התצוגה המקדימה נכשלה");
      setPreviewResult({ decision: body.policy.decision, reason: body.policy.reason, note: body.note });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPreviewBusy(false);
    }
  }

  const taskMode = values?.callAnalysisTaskMode ?? DEFAULT_BOT_SETTINGS.callAnalysisTaskMode;
  const writesTasks = taskMode === "hybrid" || taskMode === "automatic";

  return (
    <section dir="rtl" className="space-y-4 rounded-xl border border-border/70 bg-card/25 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <BrainCircuit className="size-5" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">שיחות ומעקב</div>
            <h2 className="mt-1 text-lg font-medium">ניתוח שיחות ומשימות</h2>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-muted-foreground">
              המנתח מוציא עובדות והצעת פעולה. הקוד בודק ציטוט, אחראי, מועד וביטחון לפני שמשהו נכתב ל-GHL.
              כל אפשרות מסבירה אם היא רק משנה ניתוח או מבצעת פעולה אמיתית.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {values && (
            <span className={`rounded-full px-2.5 py-1 text-[11px] ${writesTasks ? "bg-amber-500/10 text-amber-300" : "bg-emerald-500/10 text-emerald-300"}`}>
              {writesTasks ? "יצירת משימות פעילה" : taskMode === "shadow" ? "מצב צל — ללא משימות" : "ללא יצירה אוטומטית"}
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!values || busy || dirtyCount === 0}
            className="lux-cta-champagne disabled:cursor-not-allowed disabled:opacity-50"
            style={{ minHeight: 38, padding: "0 14px", fontSize: 12 }}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {busy ? "שומר…" : dirtyCount ? `שמור ${dirtyCount} שינויים` : "נשמר"}
          </button>
        </div>
      </div>

      <div className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-5 ${writesTasks ? "border-amber-400/20 bg-amber-400/5 text-amber-100" : "border-emerald-400/20 bg-emerald-400/5 text-emerald-100"}`}>
        {writesTasks ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <ShieldCheck className="mt-0.5 size-4 shrink-0" />}
        <span>
          {writesTasks
            ? "מצב זה רשאי ליצור משימות אמיתיות ב-GHL, אבל רק אחרי שכל בדיקות הבטיחות עוברות. מקרים לא ברורים נשארים בתור האישורים."
            : "ברירת המחדל בטוחה: הניתוח נשמר כדי למדוד איכות, אך לא נוצרת משימה אוטומטית ב-GHL."}
        </span>
      </div>

      {message && (
        <div className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${message.ok ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-200" : "border-red-400/20 bg-red-400/5 text-red-200"}`}>
          {message.ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
          {message.text}
        </div>
      )}

      {!values ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> טוען הגדרות ניתוח…
        </div>
      ) : (
        <div className="space-y-3">
          {SECTIONS.map((section) => (
            <details key={section.title} open={section.open} className="group rounded-lg border border-border/60 bg-background/20">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {section.title}
                    {section.write && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">עשוי לכתוב ל-GHL</span>}
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{section.description}</p>
                </div>
                <span className="mt-1 text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
              </summary>
              <div className="grid gap-3 border-t border-border/50 p-3 lg:grid-cols-2">
                {section.keys.map((key) => {
                  const field = BOT_SETTING_FIELDS.find((item) => item.key === key);
                  return field ? (
                    <AnalysisSetting
                      key={key}
                      field={field}
                      value={values[key]}
                      dirty={saved ? values[key] !== saved[key] : false}
                      onChange={(next) => setValues((current) => current ? { ...current, [key]: next } : current)}
                    />
                  ) : null;
                })}
              </div>
            </details>
          ))}
        </div>
      )}

      <details className="rounded-lg border border-sky-400/20 bg-sky-400/5">
        <summary className="cursor-pointer list-none px-4 py-3">
          <div className="text-sm font-medium text-sky-100">בדיקה יבשה על תמלול</div>
          <p className="mt-1 text-[11px] leading-5 text-sky-100/70">
            מדביקים תמלול ורואים מה ינותח, איזו החלטה תתקבל ואיך תיראה ההערה. הבדיקה לא שומרת דבר ולא כותבת ל-GHL.
          </p>
        </summary>
        <div className="space-y-3 border-t border-sky-400/15 p-3">
          <textarea
            value={previewTranscript}
            onChange={(event) => setPreviewTranscript(event.target.value)}
            rows={7}
            placeholder="הדבק כאן תמלול לדוגמה…"
            className="w-full resize-y rounded-md border border-border bg-background/70 px-3 py-2 text-xs leading-5"
          />
          <button type="button" onClick={preview} disabled={previewBusy || previewTranscript.trim().length < 10} className="inline-flex items-center gap-1.5 rounded-md border border-sky-300/30 bg-sky-300/10 px-4 py-2 text-xs text-sky-100 disabled:opacity-50">
            {previewBusy ? <Loader2 className="size-3.5 animate-spin" /> : <BrainCircuit className="size-3.5" />}
            {previewBusy ? "מנתח…" : "הרץ בדיקה ללא שמירה"}
          </button>
          {previewResult && (
            <div className="space-y-2">
              <div className="rounded-md border border-border/60 bg-background/40 p-3 text-xs">
                החלטה: <strong>{previewResult.decision}</strong> · סיבה: {previewResult.reason}
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 p-3 text-[11px] leading-5 text-muted-foreground">{previewResult.note}</pre>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

function AnalysisSetting({
  field,
  value,
  dirty,
  onChange,
}: {
  field: BotSettingField;
  value: string | number | boolean;
  dirty: boolean;
  onChange: (value: string | number | boolean) => void;
}) {
  return (
    <div className={`rounded-lg border p-3 ${dirty ? "border-primary/35 bg-primary/5" : "border-border/50 bg-card/20"}`}>
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs font-medium">{field.label}</label>
        {dirty && <span className="text-[10px] text-primary">שונה, טרם נשמר</span>}
      </div>
      <p className="mt-1 whitespace-pre-line text-[11px] leading-5 text-muted-foreground">{field.description}</p>
      {field.where && <p className="mt-1 text-[10px] text-muted-foreground/70">איפה זה משפיע: {field.where}</p>}
      <div className="mt-3">
        <AnalysisControl field={field} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

function AnalysisControl({
  field,
  value,
  onChange,
}: {
  field: BotSettingField;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}) {
  if (field.type === "toggle") {
    const checked = Boolean(value);
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${checked ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-border bg-background/30 text-muted-foreground"}`}
      >
        <span className={`size-2 rounded-full ${checked ? "bg-emerald-400" : "bg-muted-foreground/50"}`} />
        {checked ? "מופעל" : "מכובה"}
      </button>
    );
  }
  if (field.type === "select") {
    return (
      <select
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-xs"
      >
        {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }
  if (field.type === "number") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={Number(value)}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-32 rounded-md border border-border bg-background/60 px-3 py-2 text-xs"
        />
        {field.unit && <span className="text-[11px] text-muted-foreground">{field.unit}</span>}
      </div>
    );
  }
  if (field.type === "longtext") {
    return (
      <textarea
        value={String(value)}
        rows={7}
        onChange={(event) => onChange(event.target.value)}
        placeholder="ריק = הנחיות ברירת המחדל הבטוחות"
        className="w-full resize-y rounded-md border border-border bg-background/60 px-3 py-2 text-xs leading-5"
      />
    );
  }
  return (
    <input
      type="text"
      value={String(value)}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-xs"
    />
  );
}
