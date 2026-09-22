import { useEffect, useState } from "react";
import { MaryBoot } from "./mary-boot";
import { MaryExperience } from "./mary-experience";

// The boot sequence always plays its full arc, never lingers once the app is
// ready, and dissolves into the home page instead of cutting to it.
const MIN_BOOT_MS = 2500;
const EXIT_MS = 800;

// Recorded the first time this module runs on the client — effectively page
// load. Both the CSS arc and the leave timer read from this single clock, so a
// fast hydration no longer cuts the sequence short.
const startedAt = typeof performance !== "undefined" ? performance.now() : 0;

export function BootGate() {
  const [phase, setPhase] = useState<"booting" | "leaving" | "gone">("booting");
  const [elapsed] = useState(() =>
    typeof performance !== "undefined" ? Math.max(0, performance.now() - startedAt) : 0,
  );

  useEffect(() => {
    const remaining = Math.max(0, MIN_BOOT_MS - (performance.now() - startedAt));
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
