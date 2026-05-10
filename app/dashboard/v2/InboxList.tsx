"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { bulkApprove } from "@/app/actions/v2";
import { InboxRow, type InboxItem } from "./InboxRow";

export function InboxList({ items }: { items: InboxItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [checked, setChecked] = useState<Set<number>>(
    new Set(items.map((i) => i.id))
  );
  const [result, setResult] = useState<string | null>(null);

  function toggle(id: number, next: boolean) {
    setChecked((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });
  }

  function selectAll() {
    setChecked(new Set(items.map((i) => i.id)));
  }
  function selectNone() {
    setChecked(new Set());
  }

  function onBulkApprove() {
    const ids = Array.from(checked);
    if (ids.length === 0) {
      setResult("לא נבחרו שורות");
      return;
    }
    if (!confirm(`לאשר ${ids.length} הצעות? יישלח עדכון ל-ManyChat לכל ליד.`)) return;
    setResult(null);
    start(async () => {
      const r = await bulkApprove(ids);
      setResult(
        r.failed === 0
          ? `אושרו ${r.approved}`
          : `אושרו ${r.approved}, נכשלו ${r.failed}: ${(r.errors ?? []).join(" | ")}`
      );
      router.refresh();
    });
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space.lg,
          padding: space.md,
          marginBottom: space.lg,
          background: colors.surfaceMuted,
          borderRadius: 6,
        }}
      >
        <Button variant="primary" size="md" onClick={onBulkApprove} pending={pending} pendingText="מאשר...">
          אישור הכל ({checked.size})
        </Button>
        <Button variant="ghost" size="sm" onClick={selectAll} disabled={pending}>
          בחר הכל
        </Button>
        <Button variant="ghost" size="sm" onClick={selectNone} disabled={pending}>
          נקה בחירה
        </Button>
        {result && (
          <span
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: result.startsWith("אושרו") && !result.includes("נכשלו") ? colors.success : colors.danger,
              fontWeight: weight.medium,
            }}
          >
            {result}
          </span>
        )}
      </div>

      {items.map((item) => (
        <InboxRow
          key={item.id}
          item={item}
          checked={checked.has(item.id)}
          onToggle={(next) => toggle(item.id, next)}
        />
      ))}
    </div>
  );
}
