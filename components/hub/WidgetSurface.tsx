export function WidgetSurface({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="gg-theme mfit"
      style={{
        minHeight: "100dvh",
        padding: "clamp(6px, 2vw, 12px)",
      }}
    >
      {children}
    </div>
  );
}
