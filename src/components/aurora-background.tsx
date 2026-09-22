export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div className="hairline-grid absolute inset-0 opacity-55" />
      <div className="brand-wash absolute inset-x-0 top-0 h-72" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-surface to-transparent" />
    </div>
  );
}