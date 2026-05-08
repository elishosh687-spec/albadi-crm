"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { colors, eyebrowStyle, fontStack, leading, radius, size, space, weight } from "@/lib/ui/tokens";
import { addLead, runBotNow, triggerRestartSend, type RunBotResult, type SimpleResult } from "@/app/actions/bot";

export function ActionButtons() {
  return (
    <Card title="פעולות מהירות" eyebrow="ידני">
      <div style={{ display: "flex", flexDirection: "column" }}>
        <RunBotRow />
        <Divider />
        <RestartSendRow />
        <Divider />
        <AddLeadRow />
      </div>
    </Card>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      style={{ height: 1, background: colors.rule, margin: `${space.lg}px 0` }}
    />
  );
}

function RowLayout({
  title,
  description,
  control,
  result,
}: {
  title: string;
  description: string;
  control: React.ReactNode;
  result?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: space.lg,
        alignItems: "center",
      }}
    >
      <div>
        <h3 style={{ ...rowTitleStyle, margin: 0 }}>{title}</h3>
        <p style={rowDescStyle}>{description}</p>
        {result}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

const rowTitleStyle: React.CSSProperties = {
  fontFamily: fontStack.body,
  fontSize: size.md,
  fontWeight: weight.semibold,
  color: colors.ink,
};

const rowDescStyle: React.CSSProperties = {
  fontFamily: fontStack.body,
  fontSize: size.sm,
  color: colors.inkMuted,
  marginTop: space.xs,
  marginBottom: 0,
  lineHeight: leading.normal,
};

function ResultLine({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: fontStack.body,
        fontSize: size.sm,
        color: tone === "ok" ? colors.success : colors.danger,
        marginTop: space.sm,
        marginBottom: 0,
      }}
    >
      {children}
    </p>
  );
}

function RunBotRow() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RunBotResult | null>(null);

  function onClick() {
    setResult(null);
    start(async () => {
      const r = await runBotNow();
      setResult(r);
    });
  }

  return (
    <RowLayout
      title="הרץ בוט עכשיו"
      description="מפעיל סבב סיווג מיידי לכל הלידים הפעילים. בדרך כלל לוקח 15–60 שניות."
      control={
        <Button onClick={onClick} pending={pending} pendingText="רץ..." variant="primary">
          הרץ
        </Button>
      }
      result={
        result?.ok ? (
          <ResultLine tone="ok">
            סיים: {result.leadsSeen ?? 0} לידים, {result.decisions ?? 0} החלטות,{" "}
            {result.escalations ?? 0} הסלמות
          </ResultLine>
        ) : result ? (
          <ResultLine tone="error">שגיאה: {result.error}</ResultLine>
        ) : undefined
      }
    />
  );
}

function RestartSendRow() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SimpleResult | null>(null);

  function onClick() {
    const ok = window.confirm(
      "אזהרה: זה ישלח template ב-WhatsApp לכל הלידים התקועים (יכול להיות עשרות). להמשיך?"
    );
    if (!ok) return;
    setResult(null);
    start(async () => {
      const r = await triggerRestartSend();
      setResult(r);
    });
  }

  return (
    <RowLayout
      title="שלח Re-engagement"
      description="שולח template חוזר לכל ליד תקוע לפי הקטגוריה שלו. ירוץ ברקע, פעולה בלתי-הפיכה."
      control={
        <Button onClick={onClick} pending={pending} pendingText="שולח..." variant="danger">
          שלח לכולם
        </Button>
      }
      result={
        result?.ok ? (
          <ResultLine tone="ok">{result.message}</ResultLine>
        ) : result ? (
          <ResultLine tone="error">שגיאה: {result.error}</ResultLine>
        ) : undefined
      }
    />
  );
}

function AddLeadRow() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SimpleResult | null>(null);
  const [subId, setSubId] = useState("");
  const [name, setName] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await addLead(fd);
      setResult(r);
      if (r.ok) {
        setSubId("");
        setName("");
      }
    });
  }

  return (
    <div>
      <h3 style={{ ...rowTitleStyle, margin: 0 }}>הוסף ליד ידני</h3>
      <p style={rowDescStyle}>
        רושם subscriber חדש ב-DB. השתמש כשליד לא נכנס דרך ManyChat webhook.
      </p>
      <form
        onSubmit={onSubmit}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto",
          gap: space.sm,
          marginTop: space.md,
          alignItems: "stretch",
        }}
      >
        <Field
          label="Subscriber ID"
          name="subscriber_id"
          value={subId}
          onChange={setSubId}
          required
          placeholder="לדוגמה: 123456789"
        />
        <Field
          label="שם"
          name="name"
          value={name}
          onChange={setName}
          placeholder="(אופציונלי)"
        />
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <Button type="submit" pending={pending} pendingText="..." variant="secondary">
            הוסף
          </Button>
        </div>
      </form>
      {result?.ok && <ResultLine tone="ok">{result.message}</ResultLine>}
      {result && !result.ok && <ResultLine tone="error">שגיאה: {result.error}</ResultLine>}
    </div>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
      <span style={eyebrowStyle}>
        {label}
        {required && <span style={{ color: colors.accent, marginInlineStart: 4 }}>*</span>}
      </span>
      <input
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        style={{
          background: colors.surface,
          border: `1px solid ${colors.rule}`,
          borderRadius: radius.md,
          padding: `${space.sm}px ${space.md}px`,
          fontSize: size.md,
          fontFamily: fontStack.body,
          color: colors.ink,
          width: "100%",
          outline: "none",
          transition: "border-color 150ms",
        }}
      />
    </label>
  );
}
