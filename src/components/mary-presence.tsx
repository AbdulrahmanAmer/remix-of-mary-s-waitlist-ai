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
  /** Surface flow strength. */
  flow: number;
  /** Ribbon orbit speed. */
  swirl: number;
  /** Core brightness. */
  glow: number;
  /** Halo reach. */
  halo: number;
};

const TUNING: Record<PresenceState, Tuning> = {
  idle: { flow: 0.03, swirl: 0.3, glow: 0.78, halo: 1.55 },
  listening: { flow: 0.04, swirl: 0.44, glow: 0.84, halo: 1.62 },
  hearing: { flow: 0.065, swirl: 0.66, glow: 0.92, halo: 1.74 },
  thinking: { flow: 0.025, swirl: 1.35, glow: 0.88, halo: 1.6 },
  speaking: { flow: 0.085, swirl: 0.9, glow: 1, halo: 1.86 },
  done: { flow: 0.022, swirl: 0.22, glow: 0.96, halo: 1.72 },
};

type Ring = {
  r: number;
  tilt: number;
  roll: number;
  speed: number;
  weight: number;
  accent: boolean;
  phase: number;
};

const RINGS: Ring[] = [
  { r: 1.0, tilt: 0.42, roll: 0.1, speed: 0.22, weight: 3.4, accent: false, phase: 0.0 },
  { r: 0.94, tilt: -0.6, roll: 1.2, speed: -0.17, weight: 2.8, accent: false, phase: 1.3 },
  { r: 0.99, tilt: 0.8, roll: 2.4, speed: 0.13, weight: 2.3, accent: false, phase: 2.7 },
  { r: 0.87, tilt: -0.38, roll: 3.6, speed: -0.29, weight: 1.9, accent: true, phase: 4.1 },
  { r: 0.81, tilt: 0.58, roll: 5.0, speed: 0.34, weight: 1.6, accent: false, phase: 5.4 },
];

/**
 * MARY's living presence: a liquid sphere of light with ribbons orbiting it in
 * depth, breathing on its own and rippling with the real audio level.
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
    const paper = styles.getPropertyValue("--background") || "oklch(0.985 0.004 95)";
    const accent = styles.getPropertyValue("--secondary") || ink;

    let width = 0;
    let boxHeight = 0;
    let small = false;
    const resize = () => {
      const dpr = Math.min(small ? 1.5 : 2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      boxHeight = Math.max(1, rect.height);
      small = width < 420;
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

    const cur: Tuning = { ...TUNING.idle };
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

    const SPARKS = Array.from({ length: 14 }, (_, i) => {
      const a = i * 2.399;
      const d = 0.16 + ((i * 37) % 60) / 100;
      return { x: Math.cos(a) * d * 0.8, y: Math.sin(a) * d * 0.7 + 0.1, p: i * 1.7 };
    });

    /**
     * One ribbon, projected as a tilted circle rolled in the picture plane and
     * drawn as smooth curve chunks so the band reads as flowing liquid light.
     */
    const ringPoints = (cx: number, cy: number, R: number, ring: Ring, roll: number) => {
      const segments = small ? 44 : 72;
      const st = Math.sin(ring.tilt);
      const ct = Math.cos(ring.tilt);
      const sr = Math.sin(roll);
      const cr = Math.cos(roll);
      const ox = Math.cos(roll * 0.7) * R * 0.05;
      const oy = Math.sin(roll * 0.7) * R * 0.05;

      const pts: { x: number; y: number; d: number }[] = [];
      for (let i = 0; i < segments; i++) {
        const u = (i / segments) * Math.PI * 2;
        // Layered flow: the band folds and swells instead of wobbling in place.
        const flow =
          Math.sin(u * 2 + t * 0.9 + ring.phase) * 0.55 +
          Math.sin(u * 3 - t * 1.4 + ring.phase * 1.7) * 0.3 +
          Math.sin(u * 5 + t * 0.6) * 0.15;
        const ripple = Math.sin(u * 4 - t * 6 + ring.phase) * lv * 0.09;
        const rr = R * ring.r * (1 + flow * cur.flow + ripple) * (1 + lv * 0.06);
        const x0 = Math.cos(u) * rr;
        const y0 = Math.sin(u) * rr * ct;
        const z0 = Math.sin(u) * rr * st;
        pts.push({
          x: cx + ox + (x0 * cr - y0 * sr),
          y: cy + oy + (x0 * sr + y0 * cr),
          d: z0 / Math.max(1, rr),
        });
      }
      return pts;
    };

    const strokeChunks = (
      pts: { x: number; y: number; d: number }[],
      ring: Ring,
      R: number,
      color: string,
      front: boolean,
    ) => {
      const n = pts.length;
      const chunk = small ? 4 : 6;
      const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      });

      for (let start = 0; start < n; start += chunk) {
        const idx: number[] = [];
        for (let k = -1; k <= chunk + 1; k++) idx.push((start + k + n) % n);
        let depth = 0;
        for (let k = 1; k <= chunk; k++) depth += pts[idx[k]!]!.d;
        depth /= chunk;
        const isFront = depth >= 0;
        if (isFront !== front) continue;

        // 0 (far) .. 1 (near)
        const near = (depth + 1) / 2;
        const a = Math.min(1, (0.08 + near * near * 0.95) * cur.glow * (0.82 + lv * 0.35));
        const w = ring.weight * (0.4 + near * 1.05) * (R / 70);

        const p0 = pts[idx[0]!]!;
        const p1 = pts[idx[1]!]!;
        ctx.beginPath();
        const startPt = mid(p0, p1);
        ctx.moveTo(startPt.x, startPt.y);
        for (let k = 1; k <= chunk; k++) {
          const c = pts[idx[k]!]!;
          const nx = pts[idx[k + 1]!]!;
          const m = mid(c, nx);
          ctx.quadraticCurveTo(c.x, c.y, m.x, m.y);
        }
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        // Soft bloom, then the bright liquid core.
        ctx.strokeStyle = withAlpha(color, a * 0.16);
        ctx.lineWidth = w * 4.2;
        ctx.stroke();
        ctx.strokeStyle = withAlpha(color, a * 0.34);
        ctx.lineWidth = w * 2.1;
        ctx.stroke();
        ctx.strokeStyle = withAlpha(color, a);
        ctx.lineWidth = w;
        ctx.stroke();
        if (front && near > 0.78) {
          // Specular sheen on the ribbons sweeping past the front.
          ctx.strokeStyle = withAlpha(paper, (near - 0.78) * 2.2 * cur.glow);
          ctx.lineWidth = Math.max(0.5, w * 0.34);
          ctx.stroke();
        }
      }
    };

    const draw = (animated: boolean) => {
      ctx.clearRect(0, 0, width, boxHeight);

      // Size from the space available *including* the halo and ground shadow,
      // so nothing is ever clipped at the top or bottom.
      const R0 = Math.min(boxHeight * 0.5, width * 0.5) / 1.5;
      if (R0 <= 0) return;
      const cx = width / 2;
      const cy = boxHeight / 2 - R0 * 0.08;

      const breath = animated ? 1 + Math.sin(t * 1.05) * 0.022 + lv * 0.05 + bloom * 0.07 : 1;
      const R = R0 * breath;

      // Grounding shadow + reflected pool: lifts the sphere off the paper.
      const gy = cy + R * 1.42;
      const shadow = ctx.createRadialGradient(cx, gy, 0, cx, gy, R * 1.05);
      shadow.addColorStop(0, withAlpha(ink, 0.1 + lv * 0.02));
      shadow.addColorStop(1, withAlpha(ink, 0));
      ctx.save();
      ctx.translate(cx, gy);
      ctx.scale(1, 0.22);
      ctx.translate(-cx, -gy);
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.arc(cx, gy, R * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const pool = ctx.createRadialGradient(cx, gy, 0, cx, gy, R * 1.3);
      pool.addColorStop(0, withAlpha(primary, (0.16 + lv * 0.14) * cur.glow));
      pool.addColorStop(1, withAlpha(primary, 0));
      ctx.save();
      ctx.translate(cx, gy);
      ctx.scale(1, 0.3);
      ctx.translate(-cx, -gy);
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.arc(cx, gy, R * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Outer halo.
      const haloR = R * (cur.halo + lv * 0.28 + bloom * 0.4);
      const halo = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, haloR);
      halo.addColorStop(0, withAlpha(primary, 0.24 + lv * 0.16));
      halo.addColorStop(0.55, withAlpha(primary, 0.07 + lv * 0.05));
      halo.addColorStop(1, withAlpha(primary, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      const rings = RINGS.map((ring) => ({
        ring,
        pts: ringPoints(cx, cy, R, ring, ring.roll + swirlPhase * ring.speed),
      }));

      // Ribbons passing behind the body.
      for (const { ring, pts } of rings) {
        strokeChunks(pts, ring, R, ring.accent ? accent : primary, false);
      }

      // The body itself: translucent liquid glass that occludes the back ribbons.
      const body = ctx.createRadialGradient(
        cx - R * 0.32,
        cy - R * 0.36,
        R * 0.06,
        cx,
        cy + R * 0.12,
        R * 1.02,
      );
      body.addColorStop(0, withAlpha(paper, 0.94));
      body.addColorStop(0.42, withAlpha(paper, 0.74));
      body.addColorStop(0.78, withAlpha(primary, 0.2 * cur.glow));
      body.addColorStop(1, withAlpha(primary, 0.05));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
      ctx.fill();

      // Light pooling low in the body + drifting sparks.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
      ctx.clip();
      const inner = ctx.createRadialGradient(
        cx,
        cy + R * 0.48,
        R * 0.04,
        cx,
        cy + R * 0.28,
        R * 1.1,
      );
      inner.addColorStop(0, withAlpha(primary, (0.34 + lv * 0.26) * cur.glow));
      inner.addColorStop(0.35, withAlpha(primary, 0.1 * cur.glow));
      inner.addColorStop(1, withAlpha(primary, 0));
      ctx.fillStyle = inner;
      ctx.fillRect(cx - R * 1.1, cy - R * 1.1, R * 2.2, R * 2.2);

      for (const s of SPARKS) {
        const tw = 0.25 + 0.75 * Math.abs(Math.sin(t * 1.3 + s.p));
        const sx = cx + s.x * R + Math.sin(t * 0.5 + s.p) * R * 0.03;
        const sy = cy + s.y * R + Math.cos(t * 0.42 + s.p) * R * 0.03;
        ctx.fillStyle = withAlpha(primary, tw * (0.26 + lv * 0.3));
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.6, R * 0.011), 0, Math.PI * 2);
        ctx.fill();
      }

      // Rim shading on the lower-far side gives the sphere volume.
      const rim = ctx.createRadialGradient(
        cx + R * 0.24,
        cy + R * 0.3,
        R * 0.5,
        cx + R * 0.1,
        cy + R * 0.16,
        R,
      );
      rim.addColorStop(0, withAlpha(ink, 0));
      rim.addColorStop(1, withAlpha(ink, 0.07));
      ctx.fillStyle = rim;
      ctx.fillRect(cx - R * 1.1, cy - R * 1.1, R * 2.2, R * 2.2);

      // Drifting specular highlight.
      const hx = cx - R * (0.34 + Math.sin(t * 0.33) * 0.05);
      const hy = cy - R * (0.4 + Math.cos(t * 0.27) * 0.05);
      const spec = ctx.createRadialGradient(hx, hy, 0, hx, hy, R * 0.52);
      spec.addColorStop(0, withAlpha(paper, 0.9));
      spec.addColorStop(1, withAlpha(paper, 0));
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.arc(hx, hy, R * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Ribbons sweeping across the front.
      for (const { ring, pts } of rings) {
        strokeChunks(pts, ring, R, ring.accent ? accent : primary, true);
      }

      // Completion bloom.
      if (bloom > 0.01) {
        ctx.strokeStyle = withAlpha(primary, bloom * 0.4);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1 + (1 - bloom) * 0.7), 0, Math.PI * 2);
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
      cur.flow = lerp(cur.flow, target.flow, k);
      cur.swirl = lerp(cur.swirl, target.swirl, k);
      cur.glow = lerp(cur.glow, target.glow, k);
      cur.halo = lerp(cur.halo, target.halo, k);

      const voiced = current === "speaking" || current === "listening" || current === "hearing";
      const targetLevel = voiced ? Math.min(1, Math.max(0, levelRef.current)) : 0;
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
