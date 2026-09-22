export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div className="brand-focus absolute left-1/2 top-[42%] size-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-border" />
    </div>
  );
}
