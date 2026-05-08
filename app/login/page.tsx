import { LoginForm } from "./LoginForm";
import { colors, fontStack, headingStyle, leading, size, space, weight } from "@/lib/ui/tokens";

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
        background: colors.paper,
        padding: space.lg,
      }}
    >
      <div
        style={{
          background: colors.surface,
          padding: `${space["2xl"]}px ${space.xl}px`,
          border: `1px solid ${colors.rule}`,
          borderRadius: 8,
          width: "100%",
          maxWidth: 380,
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: fontStack.body,
            fontSize: size.xs,
            fontWeight: weight.medium,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: colors.accent,
            margin: 0,
            marginBottom: space.sm,
          }}
        >
          Albadi · CRM
        </p>
        <h1 style={{ ...headingStyle("h2"), fontSize: size["2xl"] }}>כניסה</h1>
        <p
          style={{
            fontFamily: fontStack.body,
            color: colors.inkMuted,
            fontSize: size.sm,
            lineHeight: leading.normal,
            marginTop: space.sm,
            marginBottom: space.xl,
          }}
        >
          הזן סיסמה כדי להמשיך לדאשבורד.
        </p>
        <LoginForm searchParams={searchParams} />
      </div>
    </div>
  );
}
