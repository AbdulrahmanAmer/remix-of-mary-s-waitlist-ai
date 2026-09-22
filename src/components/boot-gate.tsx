import { useEffect, useState } from "react";
import { MaryBoot } from "./mary-boot";
import { MaryExperience } from "./mary-experience";

// The boot sequence always plays long enough to read, never lingers once the
// app is ready, and dissolves into the home page instead of cutting to it.
const MIN_BOOT_MS = 1600;
const EXIT_MS = 720;

export function BootGate() {
  const [phase, setPhase] = useState<"booting" | "leaving" | "gone">("booting");

  useEffect(() => {
    const leave = window.setTimeout(() => setPhase("leaving"), MIN_BOOT_MS);
    return () => window.clearTimeout(leave);
  }, []);

  useEffect(() => {
    if (phase !== "leaving") return;
    const done = window.setTimeout(() => setPhase("gone"), EXIT_MS);
    return () => window.clearTimeout(done);
  }, [phase]);

  return (
    <>
      <MaryExperience introDelay={phase === "gone" ? 0 : MIN_BOOT_MS * 0.001} />
      {phase !== "gone" && (
        <div className="fixed inset-0 z-50 bg-background">
          <MaryBoot exiting={phase === "leaving"} />
        </div>
      )}
    </>
  );
}
