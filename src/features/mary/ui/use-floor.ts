import { useEffect, useState } from "react";

import type { Floor } from "./floor";

/**
 * Between two beats of one turn her presence dips to idle for about a quarter
 * of a second (the runner's pause before the follow-up), which would flash
 * "your turn" and a pulse she immediately takes back. The floor becomes theirs
 * only once it has stayed theirs; every other state shows at once.
 */
export const YOURS_SETTLE_MS = 450;

export function useSettledFloor(floor: Floor): Floor {
  const [settled, setSettled] = useState<Floor>(floor === "yours" ? "hers-thinking" : floor);
  useEffect(() => {
    if (floor !== "yours") {
      setSettled(floor);
      return;
    }
    const timer = window.setTimeout(() => setSettled("yours"), YOURS_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [floor]);
  return settled;
}
