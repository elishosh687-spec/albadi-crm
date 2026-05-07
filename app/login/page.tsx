import { LoginForm } from "./LoginForm";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f7f7f8",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: 32,
          borderRadius: 8,
          border: "1px solid #e5e5e5",
          width: 360,
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24 }}>🎒 Albadi CRM</h1>
        <p style={{ color: "#666", fontSize: 14, marginTop: 8 }}>
          הזן סיסמה כדי להיכנס
        </p>
        <LoginForm searchParams={searchParams} />
      </div>
    </div>
  );
}
