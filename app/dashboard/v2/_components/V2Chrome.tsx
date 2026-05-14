import Link from "next/link";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";

/**
 * The light-theme navbar + 1200px-container chrome that wraps every v2
 * dashboard page (and the legacy home + instructions pages). Used by
 * app/dashboard/v2/layout.tsx, app/dashboard/page.tsx, and
 * app/dashboard/instructions/page.tsx so v3 routes can opt out cleanly.
 */
export function V2Chrome({ children }: { children: React.ReactNode }) {
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
        <NavLink href="/dashboard/v2">Inbox + Pipeline</NavLink>
        <NavLink href="/dashboard/v3">v3 (חדש)</NavLink>
        <NavLink href="/dashboard/v2/instructions">מדריך</NavLink>
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
