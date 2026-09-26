import type { PresenceState } from "../conversation/types";

/**
 * How often the orb draws. Only a voice (hers or theirs) needs the full rate:
 * the mist moves slowly, so a resting orb at 24-30 fps looks the same and
 * presents half the frames.
 */
export const ORB_FPS: Record<PresenceState, number> = {
  idle: 24,
  listening: 30,
  hearing: 60,
  thinking: 40,
  speaking: 60,
  done: 30,
};

/** Software GL (SwiftShader, llvmpipe) renders every pixel on the CPU: 20 fps is the ceiling there. */
export const SOFTWARE_FPS = 20;

/** Seconds after the end-screen bloom has faded before the orb stops drawing altogether. */
export const DONE_REST_S = 2.5;

export function orbInterval(state: PresenceState, software = false): number {
  const fps = software ? Math.min(ORB_FPS[state], SOFTWARE_FPS) : ORB_FPS[state];
  return 1000 / fps;
}

/**
 * On the end screen nothing changes once the bloom has settled, so the loop
 * stops instead of redrawing the same frame forever. Any state change starts it again.
 */
export function orbShouldRest(
  state: PresenceState,
  secondsInState: number,
  bloom: number,
): boolean {
  return state === "done" && bloom <= 0 && secondsInState >= DONE_REST_S;
}

/** How long to wait before the next frame, given when the last one was drawn. */
export function nextFrameDelay(interval: number, sinceLastFrameMs: number): number {
  // rAF adds up to one display frame of its own, so the wait is trimmed a little.
  return Math.max(0, interval - sinceLastFrameMs - 6);
}

export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa offscreen/i.test(
    renderer,
  );
}
