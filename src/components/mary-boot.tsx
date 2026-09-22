// Full-screen boot sequence shown while MARY's experience loads.
// Pure CSS animation so it renders identically before and after hydration.

export function MaryBoot() {
  return (
    <div className="mary-boot relative grid h-dvh place-items-center overflow-hidden">
      {/* soft lime glow that blooms in from the centre */}
      <div className="mary-boot-glow" aria-hidden="true" />

      <div className="relative flex flex-col items-center">
        {/* liquid sphere: layered rings of light around a hollow core,
            mirroring the live presence */}
        <div className="mary-boot-orb" aria-hidden="true">
          <span className="mary-boot-ring mary-boot-ring--a" />
          <span className="mary-boot-ring mary-boot-ring--b" />
          <span className="mary-boot-ring mary-boot-ring--c" />
          <span className="mary-boot-core" />
          <span className="mary-boot-shadow" />
        </div>

        <p className="mary-boot-word mt-10 font-display text-lg font-semibold tracking-[0.42em] text-ink">
          <span style={{ animationDelay: "0.55s" }}>M</span>
          <span style={{ animationDelay: "0.68s" }}>A</span>
          <span style={{ animationDelay: "0.81s" }}>R</span>
          <span style={{ animationDelay: "0.94s" }}>Y</span>
        </p>

        {/* hairline that draws itself across, then dissolves */}
        <div className="mary-boot-line mt-5" aria-hidden="true" />

        <p className="mary-boot-caption mt-5 text-[0.68rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Preparing your conversation
        </p>
      </div>
    </div>
  );
}
