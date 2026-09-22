export function AuroraBackground({ intensity = 0 }: { intensity?: number }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div
        className="brand-focus absolute left-1/2 top-[40%] size-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-700"
        style={{ opacity: 0.65 + intensity * 0.35, transform: `translate(-50%, -50%)` }}
      />
      <div className="paper-vignette absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-border" />
    </div>
  );
}
