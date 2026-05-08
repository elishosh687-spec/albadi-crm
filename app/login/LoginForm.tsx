"use client";

import { useState, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { colors, fontStack, radius, size, space } from "@/lib/ui/tokens";

export function LoginForm({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const params = use(searchParams);
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.error ?? null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "סיסמה שגויה");
        return;
      }
      router.push(params.from || "/dashboard");
      router.refresh();
    } catch {
      setError("שגיאת חיבור");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ textAlign: "start" }}>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="סיסמה"
        autoFocus
        style={{
          width: "100%",
          padding: `${space.md}px ${space.md}px`,
          fontSize: size.md,
          fontFamily: fontStack.body,
          color: colors.ink,
          background: colors.surface,
          borderRadius: radius.md,
          border: `1px solid ${colors.rule}`,
          boxSizing: "border-box",
          outline: "none",
        }}
      />
      {error && (
        <div
          style={{
            color: colors.danger,
            fontSize: size.sm,
            marginTop: space.sm,
            fontFamily: fontStack.body,
          }}
          role="alert"
        >
          {error}
        </div>
      )}
      <Button
        type="submit"
        disabled={!password}
        pending={busy}
        pendingText="מתחבר..."
        variant="primary"
        size="md"
        fullWidth
        style={{ marginTop: space.lg }}
      >
        כניסה
      </Button>
    </form>
  );
}
