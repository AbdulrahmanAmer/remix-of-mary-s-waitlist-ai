import { memo, useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

export type PresenceState = "idle" | "listening" | "hearing" | "thinking" | "speaking" | "done";

const STATE_LABEL: Record<PresenceState, string> = {
  idle: "Ready",
  listening: "Listening",
  hearing: "Hearing you",
  thinking: "Thinking",
  speaking: "Speaking",
  done: "Complete",
};

/** Turns a token colour such as `oklch(0.79 0.175 118)` into an alpha variant. */
function withAlpha(color: string, alpha: number) {
  const trimmed = color.trim();
  if (!trimmed) return `rgb(0 0 0 / ${alpha})`;
  if (trimmed.endsWith(")")) {
    const inner = trimmed.slice(trimmed.indexOf("(") + 1, -1);
    if (inner.includes("/")) {
      return `${trimmed.slice(0, trimmed.indexOf("(") + 1)}${inner.split("/")[0]!.trim()} / ${alpha})`;
    }
    return `${trimmed.slice(0, -1)} / ${alpha})`;
  }
  return trimmed;
}

type Tuning = {
  /** Outline wobble strength. */
  wobble: number;
  /** Inner bloom drift speed. */
  swirl: number;
  /** Core brightness. */
  glow: number;
  /** Halo reach. */
  halo: number;
};

const TUNING: Record<PresenceState, Tuning> = {
  idle: { wobble: 0.05, swirl: 0.35, glow: 0.78, halo: 1.9 },
  listening: { wobble: 0.07, swirl: 0.5, glow: 0.84, halo: 2.05 },
  hearing: { wobble: 0.11, swirl: 0.72, glow: 0.9, halo: 2.25 },
  thinking: { wobble: 0.04, swirl: 1.45, glow: 0.88, halo: 2.0 },
  speaking: { wobble: 0.14, swirl: 0.95, glow: 1, halo: 2.45 },
  done: { wobble: 0.035, swirl: 0.25, glow: 0.95, halo: 2.2 },
};

const POINTS = 96;

/**
 * MARY's living presence: a liquid orb of light that breathes on its own and
 * ripples with the real audio level while she speaks or listens.
 */
export const MaryPresence = memo(function MaryPresence({
  state,
  level,
  height = 200,
  className = "",
}: {
  state: PresenceState;
  level: number;
  height?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);

  stateRef.current = state;
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const styles = getComputedStyle(canvas);
    const primary = styles.getPropertyValue("--primary") || "oklch(0.79 0.175 118)";

    let width = 0;
    let boxHeight = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      boxHeight = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(boxHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let raf = 0;
    let t = 0;
    let lv = 0;
    let swirlPhase = 0;
    let bloom = 0;
    let lastDone = false;
    let last = performance.now();

    // Smoothed tuning so state changes glide instead of snapping.
    const cur: Tuning = { ...TUNING.idle };

    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

    /** Radius modulation at angle `a` — layered harmonics plus the audio term. */
    const shape = (a: number, breath: number) => {
      const w = cur.wobble + lv * 0.22;
      const n =
        Math.sin(a * 2 + t * 0.7) * 0.55 +
        Math.sin(a * 3 - t * 0.53 + 1.7) * 0.32 +
        Math.sin(a * 5 + t * 0.91 + 3.1) * 0.18 +
        Math.sin(a * 7 - t * 1.23 + 0.6) * 0.1;
      const ripple = Math.sin(a * 4 - t * 3.4) * lv * 0.16;
      return breath * (1 + n * w + ripple);
    };

    const traceBlob = (cx: number, cy: number, radius: number, breath: number) => {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < POINTS; i++) {
        const a = (i / POINTS) * Math.PI * 2;
        const r = radius * shape(a, breath);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      ctx.beginPath();
      const first = pts[0]!;
      const lastPt = pts[POINTS - 1]!;
      ctx.moveTo((lastPt[0] + first[0]) / 2, (lastPt[1] + first[1]) / 2);
      for (let i = 0; i < POINTS; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % POINTS]!;
        ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      }
      ctx.closePath();
    };

    const draw = (animated: boolean) => {
      ctx.clearRect(0, 0, width, boxHeight);
      const cx = width / 2;
      const cy = boxHeight / 2;
      const radius = Math.min(boxHeight * 0.34, width * 0.22);
      if (radius <= 0) return;

      const breath = animated ? 1 + Math.sin(t * 1.1) * 0.03 + lv * 0.07 + bloom * 0.09 : 1;

      // Halo.
      const haloR = radius * (cur.halo + lv * 0.5 + bloom * 0.6);
      const halo = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, haloR);
      halo.addColorStop(0, withAlpha(primary, 0.3 + lv * 0.2));
      halo.addColorStop(0.55, withAlpha(primary, 0.08 + lv * 0.06));
      halo.addColorStop(1, withAlpha(primary, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Liquid body.
      ctx.save();
      traceBlob(cx, cy, radius, breath);
      ctx.clip();

      const base = ctx.createRadialGradient(
        cx - radius * 0.2,
        cy - radius * 0.24,
        radius * 0.05,
        cx,
        cy,
        radius * 1.25,
      );
      base.addColorStop(0, withAlpha(primary, 0.92 * cur.glow));
      base.addColorStop(0.62, withAlpha(primary, 0.62 * cur.glow));
      base.addColorStop(1, withAlpha(primary, 0.22));
      ctx.fillStyle = base;
      ctx.fillRect(cx - radius * 2, cy - radius * 2, radius * 4, radius * 4);

      // Drifting inner blooms.
      const blooms: Array<[number, number, number, number]> = [
        [0.42, swirlPhase * 0.9, 0.72, 0.78],
        [0.5, -swirlPhase * 0.62 + 2.2, 0.56, 0.6],
        [0.3, swirlPhase * 1.4 + 4.1, 0.42, 0.48],
      ];
      for (const [dist, phase, size, strength] of blooms) {
        const bx = cx + Math.cos(phase) * radius * dist;
        const by = cy + Math.sin(phase * 0.8) * radius * dist * 0.8;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, radius * size);
        g.addColorStop(0, withAlpha(primary, strength * cur.glow * (0.8 + lv * 0.5)));
        g.addColorStop(1, withAlpha(primary, 0));
        ctx.fillStyle = g;
        ctx.fillRect(cx - radius * 2, cy - radius * 2, radius * 4, radius * 4);
      }

      // Specular highlight.
      const hx = cx - radius * 0.3 + Math.cos(swirlPhase * 0.4) * radius * 0.08;
      const hy = cy - radius * 0.36 + Math.sin(swirlPhase * 0.33) * radius * 0.06;
      const spec = ctx.createRadialGradient(hx, hy, 0, hx, hy, radius * 0.52);
      spec.addColorStop(0, withAlpha(primary, 0.85));
      spec.addColorStop(1, withAlpha(primary, 0));
      ctx.fillStyle = spec;
      ctx.fillRect(cx - radius * 2, cy - radius * 2, radius * 4, radius * 4);
      ctx.restore();

      // Surface edge.
      traceBlob(cx, cy, radius, breath);
      ctx.strokeStyle = withAlpha(primary, 0.6 + lv * 0.3);
      ctx.lineWidth = 1.2;
      ctx.stroke();

      if (bloom > 0.01) {
        traceBlob(cx, cy, radius * (1 + (1 - bloom) * 0.9), breath);
        ctx.strokeStyle = withAlpha(primary, bloom * 0.5);
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;

      const current = stateRef.current;
      const target = TUNING[current];
      const k = Math.min(1, dt * 3.2);
      cur.wobble = lerp(cur.wobble, target.wobble, k);
      cur.swirl = lerp(cur.swirl, target.swirl, k);
      cur.glow = lerp(cur.glow, target.glow, k);
      cur.halo = lerp(cur.halo, target.halo, k);

      const voiced = current === "speaking" || current === "listening" || current === "hearing";
      const targetLevel = voiced ? Math.min(1, Math.max(0, levelRef.current)) : 0;
      // Fast attack, slow release.
      const rate = targetLevel > lv ? dt / 0.12 : dt / 0.35;
      lv += (targetLevel - lv) * Math.min(1, rate);

      swirlPhase += dt * cur.swirl;

      const isDone = current === "done";
      if (isDone && !lastDone) bloom = 1;
      lastDone = isDone;
      if (bloom > 0) bloom = Math.max(0, bloom - dt * 0.9);

      draw(true);
      raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      draw(false);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [reduced]);

  return (
    <div
      className={`relative w-full ${className}`}
      style={{ height }}
      role="img"
      aria-label={`MARY is ${STATE_LABEL[state].toLowerCase()}`}
    >
      <canvas ref={canvasRef} className="size-full" />
    </div>
  );
});

export { STATE_LABEL as PRESENCE_LABEL };
