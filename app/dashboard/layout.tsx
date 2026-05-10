import Link from "next/link";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", background: colors.paper, color: colors.ink }}>
      <nav
        style={{
          background: colors.surface,
          borderBottom: `1px solid ${colors.rule}`,
          padding: `${space.lg}px ${space["2xl"]}px`,
          display: "flex",
          gap: space.xl,
          alignItems: "baseline",
        }}
      >
        <Link
          href="/dashboard"
          style={{
            fontFamily: fontStack.display,
            fontWeight: weight.medium,
            fontSize: size.xl,
            letterSpacing: "-0.01em",
            color: colors.ink,
            marginInlineEnd: space.lg,
          }}
        >
          Albadi
        </Link>
        <NavLink href="/dashboard">בית</NavLink>
        <NavLink href="/dashboard/v2">v2 (חדש)</NavLink>
        <NavLink href="/dashboard/escalations">הסלמות</NavLink>
        <NavLink href="/dashboard/pipeline">Pipeline</NavLink>
        <NavLink href="/dashboard/runs">היסטוריית ריצות</NavLink>
        <NavLink href="/dashboard/instructions">מדריך</NavLink>
      </nav>
      <main
        style={{
          padding: `${space["2xl"]}px ${space["2xl"]}px ${space["4xl"]}px`,
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
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
        fontFamily: fontStack.body,
        fontSize: size.sm,
        fontWeight: weight.medium,
        color: colors.inkMuted,
        padding: `${space.xs}px 0`,
        borderBottom: "2px solid transparent",
        transition: "color 150ms, border-color 150ms",
      }}
    >
      {children}
    </Link>
  );
}
