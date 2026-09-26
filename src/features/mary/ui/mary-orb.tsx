import { memo, useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

import type { PresenceState } from "../conversation/types";
import { voiceLevel } from "../signal/signal";
import { nextFrameDelay, orbInterval, orbShouldRest } from "./orb-pace";
import { orbGpu } from "./orb-renderer";

const STATE_LABEL: Record<PresenceState, string> = {
  idle: "ready",
  listening: "listening",
  hearing: "hearing you",
  thinking: "thinking",
  speaking: "speaking",
  done: "done",
};

/** How each state moves: time speed, swirl, and how much the live level counts. */
const TUNING: Record<PresenceState, { speed: number; swirl: number; gain: number }> = {
  idle: { speed: 0.55, swirl: 0, gain: 0 },
  listening: { speed: 0.75, swirl: 0, gain: 0.55 },
  hearing: { speed: 0.95, swirl: 0, gain: 1 },
  thinking: { speed: 1.35, swirl: 1, gain: 0 },
  speaking: { speed: 1.15, swirl: 0, gain: 1 },
  done: { speed: 0.5, swirl: 0, gain: 0 },
};

/** Shown while the shader compiles, and where WebGL is unavailable: the same palette in 2D. */
function drawFallback(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  lv: number,
  bloom: number,
) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const R =
    (Math.min(w, h) / 2 / 1.2) * 0.6 * (1 + 0.07 * lv + 0.035 * bloom + 0.01 * Math.sin(t * 1.3));
  ctx.save();
  ctx.translate(cx, cy + R * 1.35);
  ctx.scale(1, 0.2);
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  shadow.addColorStop(0, "rgba(23,26,20,0.12)");
  shadow.addColorStop(1, "rgba(23,26,20,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const body = ctx.createLinearGradient(cx, cy - R, cx + R * Math.sin(t * 0.2) * 0.3, cy + R);
  body.addColorStop(0, "rgb(92,110,232)");
  body.addColorStop(0.55, "rgb(170,190,210)");
  body.addColorStop(1, "rgb(214,234,133)");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  const mist = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R);
  mist.addColorStop(0, "rgba(255,255,248,0.75)");
  mist.addColorStop(1, "rgba(255,255,248,0)");
  ctx.fillStyle = mist;
  ctx.fill();
}

/**
 * MARY's presence. The page's single GPU canvas is moved into this box (the newest
 * orb on screen takes it), her voice level is read from the signal store inside
 * the frame loop, and drawing pauses when nobody can see it. The loop runs at
 * full rate only while a voice moves the orb, and stops on the end screen once
 * the bloom has settled.
 */
export const MaryOrb = memo(function MaryOrb({
  state,
  size,
  className = "",
  decorative = false,
}: {
  state: PresenceState;
  size: number;
  className?: string;
  /** On the landing the orb is scenery: screen readers skip it. */
  decorative?: boolean;
}) {
  const reduced = useReducedMotion();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const fallbackRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const startRef = useRef<() => void>(() => {});

  useEffect(() => {
    const box = boxRef.current;
    const fallback = fallbackRef.current;
    const ctx = fallback?.getContext("2d");
    if (!box || !fallback || !ctx) return;
    const gpu = orbGpu();
    const token = gpu?.claim() ?? 0;
    if (gpu) box.appendChild(gpu.canvas);
    const software = gpu?.software ?? false;

    let w = 1;
    let h = 1;
    const fit = () => {
      const rect = box.getBoundingClientRect();
      // The orb is soft: 1.5x looks the same as 2x and draws ~44% fewer pixels.
      // Software GL shades every pixel on the CPU, so it gets 1x.
      const dpr = Math.min(software ? 1 : 1.5, window.devicePixelRatio || 1);
      w = Math.max(1, Math.round(rect.width * dpr));
      h = Math.max(1, Math.round(rect.height * dpr));
      fallback.width = w;
      fallback.height = h;
    };
    fit();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    resizeObserver?.observe(box);

    let raf = 0;
    let timer = 0;
    let last = performance.now();
    let t = Math.random() * 20;
    let lv = 0;
    let bloom = 0;
    let lastState: PresenceState = stateRef.current;
    let inState = 0;
    const cur = { ...TUNING[stateRef.current] };
    let visible = true;
    let usingGpu = false;

    const paint = () => {
      const gpuOk = !!gpu && gpu.owns(token) && gpu.ready();
      if (gpuOk) {
        gpu.draw(w, h, t, lv, cur.swirl, bloom);
      } else if (!gpu || gpu.owns(token)) {
        drawFallback(ctx, w, h, t, lv, bloom);
      }
      if (gpuOk !== usingGpu) {
        usingGpu = gpuOk;
        fallback.style.visibility = gpuOk ? "hidden" : "visible";
      }
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const current = stateRef.current;
      const target = TUNING[current];
      const k = Math.min(1, dt * 2.4);
      cur.speed += (target.speed - cur.speed) * k;
      cur.swirl += (target.swirl - cur.swirl) * k;
      cur.gain += (target.gain - cur.gain) * k;
      t += dt * cur.speed;
      // Fast attack, slower release: a voice swells in and settles out.
      const reading = Math.min(1, Math.max(0, voiceLevel.get())) * cur.gain;
      lv += (reading - lv) * Math.min(1, dt * (reading > lv ? 14 : 5));
      if (current === "done" && lastState !== "done") bloom = 1;
      inState = current === lastState ? inState + dt : 0;
      lastState = current;
      bloom = Math.max(0, bloom - dt * 0.8);
      paint();
      // A newer orb has taken the GPU canvas: this one has nothing left to draw.
      if (gpu && !gpu.owns(token)) return;
      if (!visible || document.hidden) return;
      // Nothing will change on screen: rest until the state does.
      if (orbShouldRest(current, inState, bloom)) return;
      const wait = nextFrameDelay(orbInterval(current, software), performance.now() - now);
      if (wait > 4) {
        timer = window.setTimeout(() => {
          timer = 0;
          raf = requestAnimationFrame(frame);
        }, wait);
      } else {
        raf = requestAnimationFrame(frame);
      }
    };
    const start = () => {
      if (raf || timer || (gpu && !gpu.owns(token))) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    startRef.current = start;

    if (reduced) {
      // A still frame; repainted briefly while the shader finishes compiling.
      paint();
      let tries = 0;
      const settle = window.setInterval(() => {
        paint();
        tries += 1;
        if (usingGpu || tries > 20) window.clearInterval(settle);
      }, 150);
      return () => {
        window.clearInterval(settle);
        resizeObserver?.disconnect();
      };
    }
    start();

    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? true;
            if (visible) start();
          });
    intersection?.observe(box);
    const onVisibility = () => {
      if (!document.hidden) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      startRef.current = () => {};
      resizeObserver?.disconnect();
      intersection?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced]);

  // A resting orb wakes when its state changes (the loop reads the state itself otherwise).
  useEffect(() => {
    startRef.current();
  }, [state]);

  return (
    <div
      ref={boxRef}
      className={`pointer-events-none relative shrink-0 ${className}`}
      style={{ width: size, height: size }}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `MARY is ${STATE_LABEL[state]}`}
    >
      <canvas ref={fallbackRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
});
