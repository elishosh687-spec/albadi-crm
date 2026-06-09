import { colors, eyebrowStyle, fontStack, headingStyle, leading, size, space, weight } from "@/lib/ui/tokens";

interface PageProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function Page({ eyebrow, title, description, actions }: PageProps) {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        gap: space.lg,
        flexWrap: "wrap",
        paddingBottom: space.xl,
        marginBottom: space["2xl"],
        borderBottom: `1px solid ${colors.rule}`,
        minWidth: 0,
      }}
    >
      <div style={{ minWidth: 0, maxWidth: "100%" }}>
        {eyebrow && <p style={eyebrowStyle}>{eyebrow}</p>}
        <h1
          style={{
            ...headingStyle("h1"),
            fontSize: "clamp(30px, 7vw, 40px)",
            marginTop: eyebrow ? space.sm : 0,
            overflowWrap: "anywhere",
          }}
        >
          {title}
        </h1>
        {description && (
          <p
            style={{
              fontFamily: fontStack.body,
              fontSize: size.md,
              fontWeight: weight.regular,
              color: colors.inkMuted,
              lineHeight: leading.normal,
              marginTop: space.sm,
              marginBottom: 0,
              maxWidth: 640,
              overflowWrap: "anywhere",
            }}
          >
            {description}
          </p>
        )}
      </div>
      {actions && <div style={{ flexShrink: 0, maxWidth: "100%" }}>{actions}</div>}
    </header>
  );
}
