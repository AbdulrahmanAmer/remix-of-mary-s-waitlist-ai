/**
 * The first paint: a calm orb and her name while the app loads. Pure CSS, so the
 * server-rendered copy and the hydrated one look identical. It never waits on a
 * timer chain: the app fades it out as soon as the landing underneath is ready.
 */
export function BootScreen({ leaving = false }: { leaving?: boolean }) {
  return (
    <div
      className={`mary-boot fixed inset-0 z-50 grid place-items-center bg-background ${leaving ? "mary-boot--leaving" : ""}`}
      aria-hidden={leaving}
    >
      <div className="flex flex-col items-center">
        <div className="mary-boot-orb" />
        <p className="mary-boot-word mt-9 font-display text-lg font-semibold tracking-[0.42em] text-ink">
          MARY
        </p>
        <p className="mary-boot-caption mt-4 text-[0.68rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Preparing your conversation
        </p>
      </div>
    </div>
  );
}
