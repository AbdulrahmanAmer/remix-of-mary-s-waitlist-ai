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
    const ink = styles.getPropertyValue("--ink") || "oklch(0.15 0.01 110)";

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

    /** Ribbons of light orbiting the sphere. Each has its own tilt, roll and speed. */
    const RINGS = [
      { r: 1.0, tilt: 0.22, roll: 0.1, speed: 0.55, weight: 3.2, accent: false },
      { r: 0.94, tilt: -0.5, roll: 0.85, speed: -0.42, weight: 2.4, accent: false },
      { r: 0.99, tilt: 0.72, roll: -0.6, speed: 0.33, weight: 2.8, accent: true },
      { r: 0.88, tilt: -0.18, roll: 1.9, speed: -0.66, weight: 1.8, accent: false },
      { r: 0.82, tilt: 0.95, roll: 2.7, speed: 0.48, weight: 1.5, accent: true },
    ];

    const SPARKS = Array.from({ length: 16 }, (_, i) => {
      const a = i * 2.399;
      const d = 0.18 + ((i * 37) % 60) / 100;
      return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.9 + 0.12, p: i * 1.7 };
    });

    const SEGMENTS = 72;

    const drawRing = (
      cx: number,
      cy: number,
      radius: number,
      ring: (typeof RINGS)[number],
      phase: number,
      color: string,
    ) => {
      const st = Math.sin(ring.tilt);
      const ct = Math.cos(ring.tilt);
      const sr = Math.sin(ring.roll);
      const cr = Math.cos(ring.roll);
      const sp = Math.sin(phase);
      const cp = Math.cos(phase);

      let prevX = 0;
      let prevY = 0;
      let prevD = 0;

      for (let i = 0; i <= SEGMENTS; i++) {
        const u = (i / SEGMENTS) * Math.PI * 2;
        const wob = 1 + Math.sin(u * 3 + t * 2.2 + ring.roll) * (0.02 + lv * 0.09);
        const rr = radius * ring.r * wob * (1 + lv * 0.08);
        let x = Math.cos(u) * rr;
        let y = Math.sin(u) * rr;
        let z = 0;
        // tilt about X
        let ny = y * ct - z * st;
        z = y * st + z * ct;
        y = ny;
        // roll about Z
        const nx = x * cr - y * sr;
        ny = x * sr + y * cr;
        x = nx;
        y = ny;
        // spin about Y
        const fx = x * cp + z * sp;
        const fz = -x * sp + z * cp;
        const depth = fz / Math.max(1, rr); // -1 back .. 1 front
        const px = cx + fx;
        const py = cy + y;

        if (i > 0) {
          const d = (prevD + depth) / 2;
          const front = (d + 1) / 2;
          const a = (0.1 + front * front * 0.62) * cur.glow * (0.75 + lv * 0.4);
          const w = ring.weight * (0.45 + front * 0.85) * (radius / 70);
          // soft bloom pass
          ctx.strokeStyle = withAlpha(color, a * 0.28);
          ctx.lineWidth = w * 3.4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(px, py);
          ctx.stroke();
          // bright core pass
          ctx.strokeStyle = withAlpha(color, a);
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
        prevX = px;
        prevY = py;
        prevD = depth;
      }
    };

    const draw = (animated: boolean) => {
      ctx.clearRect(0, 0, width, boxHeight);
      const cx = width / 2;
      const cy = boxHeight / 2;
      const radius = Math.min(boxHeight * 0.34, width * 0.22);
      if (radius <= 0) return;

      const breath = animated ? 1 + Math.sin(t * 1.1) * 0.025 + lv * 0.06 + bloom * 0.08 : 1;
      const R = radius * breath;

      // Outer halo.
      const haloR = R * (cur.halo + lv * 0.5 + bloom * 0.6);
      const halo = ctx.createRadialGradient(cx, cy, R * 0.45, cx, cy, haloR);
      halo.addColorStop(0, withAlpha(primary, 0.22 + lv * 0.16));
      halo.addColorStop(0.5, withAlpha(primary, 0.07 + lv * 0.05));
      halo.addColorStop(1, withAlpha(primary, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Interior: hollow at the top, light pooling toward the bottom.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.99, 0, Math.PI * 2);
      ctx.clip();
      const pool = ctx.createRadialGradient(
        cx,
        cy + R * 0.45,
        R * 0.05,
        cx,
        cy + R * 0.25,
        R * 1.15,
      );
      pool.addColorStop(0, withAlpha(primary, (0.34 + lv * 0.26) * cur.glow));
      pool.addColorStop(0.45, withAlpha(primary, 0.12 * cur.glow));
      pool.addColorStop(1, withAlpha(primary, 0));
      ctx.fillStyle = pool;
      ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);

      // Drifting sparks suspended inside.
      for (const s of SPARKS) {
        const tw = 0.25 + 0.75 * Math.abs(Math.sin(t * 1.3 + s.p));
        const sx = cx + s.x * R + Math.sin(t * 0.5 + s.p) * R * 0.03;
        const sy = cy + s.y * R + Math.cos(t * 0.42 + s.p) * R * 0.03;
        ctx.fillStyle = withAlpha(primary, tw * (0.28 + lv * 0.3));
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.6, R * 0.012), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Ribbons of light.
      RINGS.forEach((ring, i) => {
        const phase = swirlPhase * ring.speed + i * 0.9;
        drawRing(cx, cy, R, ring, phase, ring.accent ? accent : primary);
      });

      // Completion bloom.
      if (bloom > 0.01) {
        ctx.strokeStyle = withAlpha(primary, bloom * 0.45);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1 + (1 - bloom) * 0.9), 0, Math.PI * 2);
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
