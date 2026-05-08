import Link from "next/link";
import { colors, fontStack, leading, size, space, weight } from "@/lib/ui/tokens";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: `${space["2xl"]}px clamp(${space.lg}px, 6vw, ${space["4xl"]}px)`,
      }}
    >
      <header>
        <span
          style={{
            fontFamily: fontStack.body,
            fontSize: size.xs,
            fontWeight: weight.medium,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: colors.inkMuted,
          }}
        >
          Albadi · CRM
        </span>
      </header>

      <section style={{ maxWidth: 880 }}>
        <p
          style={{
            fontFamily: fontStack.body,
            fontSize: size.xs,
            fontWeight: weight.medium,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: colors.accent,
            margin: 0,
            marginBottom: space.lg,
          }}
        >
          ניהול לידים אוטומטי · WhatsApp
        </p>
        <h1
          style={{
            fontFamily: fontStack.display,
            fontSize: "clamp(2.5rem, 9vw, 5.5rem)",
            fontWeight: weight.medium,
            color: colors.ink,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          הבוט שמטפל
          <br />
          בלידים שלך
          <span style={{ color: colors.accent }}>.</span>
        </h1>
        <p
          style={{
            fontFamily: fontStack.body,
            fontSize: size.lg,
            color: colors.inkMuted,
            lineHeight: leading.normal,
            marginTop: space.xl,
            marginBottom: 0,
            maxWidth: 560,
          }}
        >
          מערכת פנימית לזיהוי, סיווג, וטיפול בלידים תקועים ב-ManyChat. רץ כל שעה, מסלים רק כשצריך מגע אנושי.
        </p>

        <div style={{ marginTop: space["3xl"], display: "flex", gap: space.md, flexWrap: "wrap" }}>
          <Link
            href="/dashboard"
            style={{
              fontFamily: fontStack.body,
              fontSize: size.md,
              fontWeight: weight.medium,
              padding: `${space.md}px ${space.xl}px`,
              background: colors.ink,
              color: colors.surface,
              borderRadius: 6,
              textDecoration: "none",
              transition: "background 150ms",
            }}
          >
            כניסה לדאשבורד ←
          </Link>
          <Link
            href="/dashboard/instructions"
            style={{
              fontFamily: fontStack.body,
              fontSize: size.md,
              fontWeight: weight.medium,
              padding: `${space.md}px ${space.xl}px`,
              border: `1px solid ${colors.rule}`,
              color: colors.ink,
              borderRadius: 6,
              textDecoration: "none",
              background: "transparent",
            }}
          >
            איך זה עובד
          </Link>
        </div>
      </section>

      <footer
        style={{
          fontFamily: fontStack.body,
          fontSize: size.xs,
          color: colors.inkSubtle,
          letterSpacing: "0.05em",
        }}
      >
        Phase 1 · {new Date().getFullYear()}
      </footer>
    </main>
  );
}
