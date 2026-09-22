import { useEffect, useState } from "react";
import { MaryBoot } from "./mary-boot";
import { MaryExperience } from "./mary-experience";

// The boot sequence always plays its full arc, never lingers once the app is
// ready, and dissolves into the home page instead of cutting to it.
const MIN_BOOT_MS = 2500;
const EXIT_MS = 800;

// The boot screen is already on screen (server-rendered) before the app's
// JavaScript runs, so the clock must start at the moment it was first painted —
// not at hydration. Otherwise the hydrated copy restarts the arc from frame
// zero and the whole sequence appears to play twice.
function bootPaintedAt() {
  if (typeof performance === "undefined") return 0;
  const paint = performance.getEntriesByType?.("paint") ?? [];
  const fcp = paint.find((entry) => entry.name === "first-contentful-paint");
  return fcp ? fcp.startTime : 0;
}

export function BootGate() {
  const [phase, setPhase] = useState<"booting" | "leaving" | "gone">("booting");
  const [elapsed] = useState(() =>
    typeof performance !== "undefined"
      ? Math.max(0, performance.now() - bootPaintedAt())
      : 0,
  );

  useEffect(() => {
    const paintedAt = bootPaintedAt();
    const remaining = Math.max(0, MIN_BOOT_MS - (performance.now() - paintedAt));
    const leave = window.setTimeout(() => setPhase("leaving"), remaining);
    return () => window.clearTimeout(leave);
  }, []);


  useEffect(() => {
    if (phase !== "leaving") return;
    const done = window.setTimeout(() => setPhase("gone"), EXIT_MS);
    return () => window.clearTimeout(done);
  }, [phase]);

  return (
    <>
      <MaryExperience
        introDelay={phase === "gone" ? 0 : Math.max(0, MIN_BOOT_MS - elapsed) * 0.001}
      />
      {phase !== "gone" && (
        <div className="fixed inset-0 z-50 bg-background">
          <MaryBoot exiting={phase === "leaving"} elapsedMs={elapsed} />
        </div>
      )}
    </>
  );
}
