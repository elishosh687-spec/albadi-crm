"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";

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
    <form onSubmit={submit} style={{ marginTop: 16 }}>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="סיסמה"
        autoFocus
        style={{
          width: "100%",
          padding: 10,
          fontSize: 14,
          borderRadius: 6,
          border: "1px solid #ddd",
          boxSizing: "border-box",
        }}
      />
      {error && (
        <div style={{ color: "#c1272d", fontSize: 13, marginTop: 8 }}>{error}</div>
      )}
      <button
        type="submit"
        disabled={busy || !password}
        style={{
          marginTop: 12,
          width: "100%",
          padding: 10,
          background: busy || !password ? "#ccc" : "#1a1a1a",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "..." : "כניסה"}
      </button>
    </form>
  );
}
