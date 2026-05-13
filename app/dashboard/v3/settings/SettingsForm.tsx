"use client";

import { useState, useTransition } from "react";
import { Lock, Save } from "lucide-react";
import { cn } from "@/lib/cn";
import { saveBotConfigAction } from "@/app/actions/v2";

export type SettingItem =
  | {
      key: string;
      label: string;
      hint: string;
      value: string;
      type: "readonly-env";
    }
  | {
      key: string;
      label: string;
      hint: string;
      value: string;
      type: "editable-textarea";
      rows?: number;
    }
  | {
      key: string;
      label: string;
      hint: string;
      value: string;
      type: "editable-bool";
    };

export function SettingsForm({
  sections,
}: {
  sections: Array<{ id: string; label: string; items: SettingItem[] }>;
}) {
  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <header>
        <h1
          className="text-3xl font-medium tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          הגדרות
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          שינויים ב-Bot prompts נשמרים מיד ל-DB. Feature flags ב-Vercel דורשים redeploy.
        </p>
      </header>

      {sections.map((section) => (
        <section
          key={section.id}
          className="rounded-xl border border-border bg-card p-5"
        >
          <h2 className="text-base font-medium mb-1">{section.label}</h2>
          <div className="border-b border-border mb-4" />
          <div className="flex flex-col gap-5">
            {section.items.map((item) => (
              <SettingRow key={item.key} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SettingRow({ item }: { item: SettingItem }) {
  if (item.type === "readonly-env") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Lock className="size-3 text-muted-foreground" />
            {item.label}
          </div>
          <span
            className={cn(
              "text-xs rounded-full px-2 py-0.5 border tabular-nums",
              item.value === "1"
                ? "bg-success/15 text-success border-success/30"
                : "bg-muted/40 text-muted-foreground border-border"
            )}
          >
            {item.value ? `= "${item.value}"` : "(unset)"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{item.hint}</p>
        <p className="text-xs text-muted-foreground/70">
          ערוך דרך Vercel → Project Settings → Environment Variables.
        </p>
      </div>
    );
  }

  return <EditableSettingRow item={item} />;
}

function EditableSettingRow({
  item,
}: {
  item: Extract<SettingItem, { type: "editable-textarea" | "editable-bool" }>;
}) {
  const [value, setValue] = useState(item.value);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = value !== item.value;

  const save = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await saveBotConfigAction(item.key, value);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נשמר" : r.error ?? "כשל" });
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{item.label}</div>
        <code className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
          {item.key}
        </code>
      </div>
      <p className="text-xs text-muted-foreground">{item.hint}</p>
      {item.type === "editable-textarea" ? (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={item.rows ?? 4}
          disabled={isPending}
          className="w-full bg-background/50 border border-border rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/30 leading-relaxed"
          dir="auto"
        />
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setValue("true")}
            disabled={isPending}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs border",
              value === "true"
                ? "bg-success/15 border-success/40 text-success"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            ON
          </button>
          <button
            type="button"
            onClick={() => setValue("false")}
            disabled={isPending}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs border",
              value === "false"
                ? "bg-muted text-foreground border-border"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            OFF
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={save}
          disabled={isPending || !dirty}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Save className="size-3" />
          {isPending ? "שומר…" : dirty ? "שמור" : "נשמר"}
        </button>
        {msg && (
          <span
            className={cn(
              "text-xs",
              msg.ok ? "text-success" : "text-destructive"
            )}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
