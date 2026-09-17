"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock3,
  ExternalLink,
  Loader2,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";

interface ActionProposal {
  action: {
    actionType: string;
    description: string;
    responsibleParty: string;
    confidence: number;
    evidence: { quote: string | null; validation: string };
  } | null;
  resolvedDueAt: string | null;
  callSummary?: string;
  statusRecommendation?: { status: string; reason: string; confidence: number } | null;
}

interface CallActionRow {
  id: number;
  source: string;
  sourceRecordId: string;
  status: "pending" | "failed";
  decisionReason: string;
  proposal: ActionProposal;
  editedProposal: ActionProposal | null;
  createdAt: string;
  lastError: string | null;
  leadName: string | null;
  leadPhone: string | null;
  leadStage: string | null;
  transcript: string | null;
  callStartedAt: string | null;
  ghlUrl: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  callback: "חזרה ללקוח",
  send_quote: "שליחת הצעת מחיר",
  send_sample: "שליחת דוגמה",
  check_logo_received: "בדיקת קבלת לוגו",
  check_payment: "בדיקת תשלום",
  follow_up: "מעקב",
  factory_check: "בדיקה מול המפעל",
  other: "פעולה אחרת",
};

const REASON_LABELS: Record<string, string> = {
  shadow_mode: "מצב צל — נדרש אישור לפני הפעלה",
  approve_all_mode: "הוגדר שכל פעולה חייבת אישור",
  owner_missing: "לא נמצא אחראי למשימה",
  due_missing: "לא נאמר מועד ברור",
  evidence_missing: "הציטוט חסר או לא נמצא בתמלול",
  confidence_below_threshold: "רמת הביטחון נמוכה מהרף",
  action_requires_approval: "סוג הפעולה תמיד דורש אישור",
  action_not_allowed_automatically: "סוג הפעולה אינו מורשה לאוטומציה",
  possible_duplicate: "ייתכן שכבר קיימת משימה דומה",
  contradiction: "ההצעה סותרת משימה פתוחה",
};

function endpoint(path: string, token: string): string {
  const url = new URL(path, "http://placeholder.local");
  url.searchParams.set("widget_token", token);
  return url.pathname + url.search;
}

function localInputDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CallActionApprovals({ apiToken }: { apiToken: string }) {
  const [rows, setRows] = useState<CallActionRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ pending: number; failed: number; oldestPendingAt: string | null } | null>(null);

  const load = useCallback(async (preserve = true) => {
    setLoading(true);
    try {
      const response = await fetch(endpoint("/api/widget/call-actions/pending", apiToken));
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "טעינת פעולות השיחה נכשלה");
      const next = body.candidates as CallActionRow[];
      setRows(next);
      setHealth(body.health);
      setSelectedId((current) => preserve && next.some((row) => row.id === current) ? current : next[0]?.id ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [apiToken]);

  useEffect(() => {
    void load(false);
    const timer = setInterval(() => void load(true), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const oldestHours = health?.oldestPendingAt
    ? Math.max(0, Math.round((Date.now() - new Date(health.oldestPendingAt).getTime()) / 3_600_000))
    : 0;

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/20 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-200">{health?.pending ?? 0} ממתינות</span>
          <span className={`rounded-full px-2.5 py-1 ${(health?.failed ?? 0) > 0 ? "bg-red-500/10 text-red-200" : "bg-emerald-500/10 text-emerald-200"}`}>
            {health?.failed ?? 0} נכשלו
          </span>
          {oldestHours > 0 && <span>הוותיקה ביותר לפני {oldestHours} שעות</span>}
        </div>
        <button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-muted-foreground disabled:opacity-50">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} רענן
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-400/25 bg-red-400/5 p-3 text-xs text-red-200">{error}</div>}
      {loading && rows.length === 0 ? (
        <div className="grid min-h-52 place-items-center rounded-xl border border-border/60 bg-card/20 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Check className="mx-auto size-8 text-emerald-400" />
          <h3 className="mt-3 text-base font-medium">אין פעולות שיחה שמחכות לך</h3>
          <p className="mt-1 text-xs text-muted-foreground">פעולה לא ברורה או ביצוע שנכשל יופיעו כאן אוטומטית.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(250px,0.85fr)_minmax(0,1.7fr)]">
          <div className="max-h-[72vh] space-y-2 overflow-auto pl-1">
            {rows.map((row) => {
              const proposal = row.editedProposal ?? row.proposal;
              return (
                <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={`w-full rounded-lg border p-3 text-right transition-colors ${row.id === selectedId ? "border-primary/40 bg-primary/5" : "border-border/60 bg-card/20 hover:bg-card/40"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="truncate text-sm font-medium">{row.leadName || row.leadPhone || "ליד ללא שם"}</div>
                    {row.status === "failed" && <AlertTriangle className="size-4 shrink-0 text-red-300" />}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{proposal.action?.description ?? "המלצת סטטוס ללא משימה"}</div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground/70">
                    <span>{row.source === "ghl" ? "שיחת GHL" : "סוכן קולי"}</span>
                    <span>{new Date(row.createdAt).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </button>
              );
            })}
          </div>
          {selected && <CallActionDetail key={selected.id} row={selected} apiToken={apiToken} onDone={() => load(false)} />}
        </div>
      )}
    </div>
  );
}

function CallActionDetail({ row, apiToken, onDone }: { row: CallActionRow; apiToken: string; onDone: () => void }) {
  const proposal = row.editedProposal ?? row.proposal;
  const [actionType, setActionType] = useState(proposal.action?.actionType ?? "follow_up");
  const [description, setDescription] = useState(proposal.action?.description ?? "");
  const [dueAt, setDueAt] = useState(localInputDate(proposal.resolvedDueAt));
  const [assignedTo, setAssignedTo] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const confidence = Math.round((proposal.action?.confidence ?? 0) * 100);
  const evidence = proposal.action?.evidence;
  const canApprove = description.trim().length >= 4 && dueAt !== "";

  const act = useCallback(async (kind: "approve" | "reject" | "retry") => {
    setBusy(true);
    setMessage(null);
    try {
      const body = kind === "approve"
        ? { actionType, description, dueAt: new Date(dueAt).toISOString(), assignedTo: assignedTo || undefined }
        : kind === "reject" ? { reason: rejectReason } : {};
      const response = await fetch(endpoint(`/api/widget/call-actions/${row.id}/${kind}`, apiToken), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? result.execution?.reason ?? "הפעולה נכשלה");
      onDone();
    } catch (actionError) {
      setMessage(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusy(false);
    }
  }, [actionType, apiToken, assignedTo, description, dueAt, onDone, rejectReason, row.id]);

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-card/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium">{row.leadName || row.leadPhone || "ליד ללא שם"}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{proposal.callSummary || "אין סיכום קצר"}</p>
        </div>
        {row.ghlUrl && <a href={row.ghlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"><ExternalLink className="size-3.5" /> פתח ב-GHL</a>}
      </div>

      <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100">
        <div className="font-medium">למה זה הגיע לאישור</div>
        <div className="mt-1">{REASON_LABELS[row.decisionReason] ?? row.decisionReason}</div>
        {row.lastError && <div className="mt-2 text-red-200">שגיאת ביצוע: {row.lastError}</div>}
      </div>

      {proposal.action && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="סוג פעולה" help="משפיע על הכותרת והסיווג של המשימה ב-GHL.">
            <select value={actionType} onChange={(event) => setActionType(event.target.value)} className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-xs">
              {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="מועד" help="נדרש לפני יצירת המשימה.">
            <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-xs" />
          </Field>
          <div className="sm:col-span-2"><Field label="מה הנציג צריך לעשות" help="זה הטקסט שיופיע במשימה."><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="w-full resize-y rounded-md border border-border bg-background/60 px-3 py-2 text-xs leading-5" /></Field></div>
          <Field label="אחראי חלופי" help="אפשר להשאיר ריק כדי להשתמש בבעל הליד ב-GHL.">
            <input value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} placeholder="מזהה משתמש GHL, אופציונלי" className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-xs" />
          </Field>
          <div className="rounded-lg border border-border/60 p-3 text-xs">
            <div className="flex items-center justify-between"><span className="font-medium">ביטחון המנתח</span><span>{confidence}%</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${confidence}%` }} /></div>
          </div>
        </div>
      )}

      <div className={`rounded-lg border p-3 text-xs ${evidence?.validation === "valid" ? "border-emerald-400/20 bg-emerald-400/5" : "border-red-400/20 bg-red-400/5"}`}>
        <div className="font-medium">הראיה מתוך השיחה</div>
        <blockquote className="mt-2 leading-6">{evidence?.quote ? `״${evidence.quote}״` : "לא נמצא ציטוט שמוכיח את הפעולה"}</blockquote>
      </div>

      {proposal.statusRecommendation && (
        <div className="rounded-lg border border-border/60 p-3 text-xs">
          <div className="font-medium">המלצת סטטוס: {proposal.statusRecommendation.status}</div>
          <p className="mt-1 text-muted-foreground">{proposal.statusRecommendation.reason}</p>
        </div>
      )}

      {row.transcript && <details className="rounded-lg border border-border/60"><summary className="cursor-pointer px-3 py-2 text-xs font-medium">פתח תמלול מלא</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-border/60 p-3 text-[11px] leading-5 text-muted-foreground">{row.transcript}</pre></details>}

      {message && <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-200">{message}</div>}

      <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-4">
        {row.status === "failed" ? (
          <button type="button" disabled={busy} onClick={() => void act("retry")} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground disabled:opacity-50"><RotateCcw className="size-3.5" /> נסה לבצע שוב</button>
        ) : (
          <button type="button" disabled={busy || !canApprove} onClick={() => void act("approve")} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs text-white disabled:opacity-50"><Check className="size-3.5" /> אשר וצור משימה</button>
        )}
        <div className="flex min-w-[240px] flex-1 items-center gap-2">
          <input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="סיבת דחייה, אופציונלי" className="min-w-0 flex-1 rounded-md border border-border bg-background/60 px-3 py-2 text-xs" />
          <button type="button" disabled={busy} onClick={() => void act("reject")} className="inline-flex items-center gap-1.5 rounded-md border border-red-400/30 px-3 py-2 text-xs text-red-200 disabled:opacity-50"><X className="size-3.5" /> דחה</button>
        </div>
        {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}

function Field({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs font-medium">{label}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{help}</span><span className="mt-2 block">{children}</span></label>;
}
