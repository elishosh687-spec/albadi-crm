"use client";

/**
 * "מי מקבל את הלידים" — picks who new leads (contact + opportunity owner) and
 * new auto-tasks are assigned to. Two modes:
 *   • אדם אחד (single)      — every new lead → one chosen person.
 *   • אחד-אחד (round_robin) — lead #1 → first person, #2 → second, and so on.
 *
 * Saves independently of the pricing config — its own endpoint, its own button —
 * so a half-edited pricing form can't block it.
 */

import { useEffect, useState } from "react";
import { Loader2, Check, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/cn";

interface GhlUser {
  id: string;
  name: string;
  email?: string;
}
interface RotationMember {
  userId: string;
  name?: string;
}

type Mode = "single" | "round_robin";

export function AssigneeSection({ apiToken }: { apiToken: string }) {
  const [users, setUsers] = useState<GhlUser[] | null>(null);
  const [mode, setMode] = useState<Mode>("single");
  const [selected, setSelected] = useState<string>(""); // single
  const [savedId, setSavedId] = useState<string>(""); // single
  const [rotation, setRotation] = useState<RotationMember[]>([]); // round_robin
  const [cursor, setCursor] = useState<number>(-1); // round_robin: last-assigned index
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  const url = (p: string) => `${p}?widget_token=${encodeURIComponent(apiToken)}`;

  useEffect(() => {
    fetch(url("/api/widget/settings/assignee"))
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) throw new Error(j?.error ?? "load failed");
        setUsers(j.users ?? []);
        const cur = j.current ?? null;
        if (cur?.mode === "round_robin" && Array.isArray(cur.rotation)) {
          setMode("round_robin");
          setRotation(cur.rotation);
          setCursor(typeof cur.cursor === "number" ? cur.cursor : -1);
        } else {
          setMode("single");
          const id = cur?.userId ?? j.envDefault ?? "";
          setSelected(id);
          setSavedId(id);
        }
      })
      .catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSingle(userId: string) {
    const u = users?.find((x) => x.id === userId);
    setState("saving");
    setErr(null);
    try {
      const res = await fetch(url("/api/widget/settings/assignee"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "single", userId, name: u?.name }),
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

  async function saveRotation(next: RotationMember[]) {
    setState("saving");
    setErr(null);
    try {
      const res = await fetch(url("/api/widget/settings/assignee"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "round_robin", rotation: next }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      // Server resets the cursor to -1 → the next lead goes to rotation[0].
      setCursor(-1);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setErr(String(e));
      setState("error");
    }
  }

  function toggleMember(u: GhlUser) {
    const exists = rotation.some((m) => m.userId === u.id);
    const next = exists
      ? rotation.filter((m) => m.userId !== u.id)
      : [...rotation, { userId: u.id, name: u.name }];
    setRotation(next);
  }

  const nextInLine =
    rotation.length > 0 ? rotation[(cursor + 1 + rotation.length) % rotation.length] : null;

  return (
    <div className="rounded-xl border border-border/70 bg-background/20 p-4" dir="rtl">
      <div className="flex items-center gap-2.5">
        <UserRound className="size-4 text-primary" />
        <div>
          <div className="text-sm font-medium">שיוך לידים ומשימות</div>
          <div className="text-xs text-muted-foreground">
            מי מקבל כל ליד חדש (וכל משימה שנפתחת עליו אוטומטית) ב-GHL
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="mt-3 inline-flex rounded-lg border border-border p-0.5 bg-card/40">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={cn(
            "px-3 py-1.5 rounded-md text-xs transition-colors inline-flex items-center gap-1.5",
            mode === "single" ? "bg-primary/15 text-foreground" : "text-muted-foreground"
          )}
        >
          <UserRound className="size-3.5" /> אדם אחד
        </button>
        <button
          type="button"
          onClick={() => setMode("round_robin")}
          className={cn(
            "px-3 py-1.5 rounded-md text-xs transition-colors inline-flex items-center gap-1.5",
            mode === "round_robin" ? "bg-primary/15 text-foreground" : "text-muted-foreground"
          )}
        >
          <Users className="size-3.5" /> אחד-אחד (סבב)
        </button>
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

      {/* SINGLE mode */}
      {mode === "single" && users !== null && users.length > 0 && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {users.map((u) => {
              const active = selected === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setSelected(u.id);
                    void saveSingle(u.id);
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
          <div className="mt-2 text-[11px] text-muted-foreground">
            כל ליד חדש משויך לאיש הזה.
          </div>
        </>
      )}

      {/* ROUND-ROBIN mode */}
      {mode === "round_robin" && users !== null && users.length > 0 && (
        <>
          <div className="mt-3 text-[11px] text-muted-foreground">
            בחר את האנשים בסבב, לפי הסדר — ליד ראשון לראשון, שני לשני, וחוזר חלילה.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {users.map((u) => {
              const order = rotation.findIndex((m) => m.userId === u.id);
              const inRotation = order >= 0;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleMember(u)}
                  disabled={state === "saving"}
                  className={cn(
                    "px-3.5 py-2 rounded-lg border text-sm transition-colors inline-flex items-center gap-1.5",
                    inRotation
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border bg-card/40 text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {inRotation && (
                    <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary/80 text-[10px] font-bold text-background">
                      {order + 1}
                    </span>
                  )}
                  {u.name}
                </button>
              );
            })}
          </div>

          {rotation.length > 0 && (
            <div className="mt-3 text-xs text-muted-foreground">
              הסבב:{" "}
              <span className="text-foreground">
                {rotation.map((m) => m.name || m.userId).join(" ← ")}
              </span>
              {nextInLine && (
                <span className="text-emerald-400">
                  {" "}
                  · הבא בתור: {nextInLine.name || nextInLine.userId}
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => void saveRotation(rotation)}
            disabled={state === "saving" || rotation.length < 2}
            className={cn(
              "mt-3 px-4 py-2 rounded-lg border text-sm transition-colors",
              rotation.length < 2
                ? "border-border bg-card/30 text-muted-foreground/60"
                : "border-primary bg-primary/15 text-foreground hover:bg-primary/25"
            )}
          >
            שמור סבב
          </button>
          {rotation.length < 2 && (
            <div className="mt-1.5 text-[11px] text-amber-400">בחר לפחות 2 אנשים לסבב.</div>
          )}
        </>
      )}

      <div className="mt-2 min-h-4 text-xs">
        {state === "saving" && (
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" /> שומר…
          </span>
        )}
        {state === "saved" && (
          <span className="text-emerald-400 inline-flex items-center gap-1">
            <Check className="size-3" /> נשמר — משפיע על לידים חדשים מכאן והלאה
          </span>
        )}
        {err && <span className="text-red-400">שגיאה: {err}</span>}
      </div>

      <div className="mt-1 text-[11px] text-muted-foreground">
        משפיע רק על שיוך <b>חדש</b>. לידים ומשימות קיימים נשארים אצל מי שהם משויכים
        אליו עכשיו.
      </div>
    </div>
  );
}
