import Link from "next/link";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", background: "#f7f7f8", color: "#1a1a1a" }}>
      <nav
        style={{
          background: "#fff",
          borderBottom: "1px solid #e5e5e5",
          padding: "16px 32px",
          display: "flex",
          gap: 24,
          alignItems: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <Link href="/dashboard" style={{ fontWeight: 700, fontSize: 18, textDecoration: "none", color: "#000" }}>
          🎒 Albadi
        </Link>
        <NavLink href="/dashboard">בית</NavLink>
        <NavLink href="/dashboard/escalations">הסלמות</NavLink>
        <NavLink href="/dashboard/pipeline">Pipeline</NavLink>
        <NavLink href="/dashboard/runs">היסטוריית ריצות</NavLink>
      </nav>
      <main style={{ padding: 32, maxWidth: 1200, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        color: "#444",
        fontSize: 14,
        padding: "6px 12px",
        borderRadius: 6,
      }}
    >
      {children}
    </Link>
  );
}
