"use client";

/**
 * "מי מקבל את הלידים" — picks the GHL user that new leads (contact +
 * opportunity owner) and new tasks are assigned to.
 *
 * Everything was hardwired to Itay by the 2026-07-01 "every task defaults to
 * Itay" rule; Eli asked (2026-08-01) to switch it between himself and Itay
 * without a redeploy. Saves independently of the pricing config — its own
 * endpoint, its own button — so a half-edited pricing form can't block it.
 */

import { useEffect, useState } from "react";
import { Loader2, Check, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";

interface GhlUser {
  id: string;
  name: string;
  email?: string;
}

export function AssigneeSection({ apiToken }: { apiToken: string }) {
  const [users, setUsers] = useState<GhlUser[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [savedId, setSavedId] = useState<string>("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  const url = (p: string) => `${p}?widget_token=${encodeURIComponent(apiToken)}`;

  useEffect(() => {
    fetch(url("/api/widget/settings/assignee"))
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) throw new Error(j?.error ?? "load failed");
        setUsers(j.users ?? []);
        const cur = j.current?.userId ?? j.envDefault ?? "";
        setSelected(cur);
        setSavedId(cur);
      })
      .catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(userId: string) {
    const u = users?.find((x) => x.id === userId);
    setState("saving");
    setErr(null);
    try {
      const res = await fetch(url("/api/widget/settings/assignee"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: u?.name }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setSavedId(userId);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setErr(String(e));
      setState("error");
    }
  }

  return (
    <div className="rounded-xl border border-border/70 bg-background/20 p-4" dir="rtl">
      <div className="flex items-center gap-2.5">
        <UserRound className="size-4 text-primary" />
        <div>
          <div className="text-sm font-medium">שיוך לידים ומשימות</div>
          <div className="text-xs text-muted-foreground">
            כל ליד חדש וכל משימה שנפתחת אוטומטית משויכים לאיש הזה ב-GHL
          </div>
        </div>
      </div>

      {users === null && !err && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> טוען משתמשים מ-GHL…
        </div>
      )}

      {users !== null && users.length === 0 && (
        <div className="mt-3 text-xs text-amber-400">
          לא הצלחתי למשוך את רשימת המשתמשים מ-GHL — נסה לרענן.
        </div>
      )}

      {users !== null && users.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {users.map((u) => {
            const active = selected === u.id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  setSelected(u.id);
                  void save(u.id);
                }}
                disabled={state === "saving"}
                className={cn(
                  "px-3.5 py-2 rounded-lg border text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border bg-card/40 text-muted-foreground hover:bg-secondary"
                )}
              >
                {u.name}
                {savedId === u.id && (
                  <span className="text-[10px] text-emerald-400 me-1.5"> ✓ פעיל</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 min-h-4 text-xs">
        {state === "saving" && (
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" /> שומר…
          </span>
        )}
        {state === "saved" && (
          <span className="text-emerald-400 inline-flex items-center gap-1">
            <Check className="size-3" /> נשמר — לידים חדשים ישויכו אליו
          </span>
        )}
        {err && <span className="text-red-400">שגיאה: {err}</span>}
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        משפיע רק על שיוך <b>חדש</b>. לידים ומשימות קיימים נשארים אצל מי שהם משויכים
        אליו עכשיו.
      </div>
    </div>
  );
}
