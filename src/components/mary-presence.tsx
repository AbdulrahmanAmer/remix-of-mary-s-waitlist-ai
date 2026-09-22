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
  /** How much the band's outline breathes and folds. */
  flow: number;
  /** How fast the light sweeps around the band. */
  swirl: number;
  /** Overall brightness. */
  glow: number;
  /** Halo reach. */
  halo: number;
  /** Band thickness multiplier. */
  thick: number;
};

const TUNING: Record<PresenceState, Tuning> = {
  idle: { flow: 0.022, swirl: 0.16, glow: 0.8, halo: 1.5, thick: 1 },
  listening: { flow: 0.03, swirl: 0.24, glow: 0.88, halo: 1.56, thick: 1.04 },
  hearing: { flow: 0.045, swirl: 0.34, glow: 0.96, halo: 1.66, thick: 1.14 },
  thinking: { flow: 0.026, swirl: 0.7, glow: 0.9, halo: 1.54, thick: 0.96 },
  speaking: { flow: 0.055, swirl: 0.46, glow: 1.06, halo: 1.78, thick: 1.22 },
  done: { flow: 0.018, swirl: 0.12, glow: 1, halo: 1.66, thick: 1.06 },
};

/** Each shell is one soft tube of light wrapped around the sphere. */
type Shell = {
  /** Radius, relative to the sphere. */
  r: number;
  /** Tube thickness, relative to the sphere radius. */
  w: number;
  /** Sweep rotation speed and direction. */
  speed: number;
  /** Outline wobble seed. */
  phase: number;
  /** Vertical squash — makes the tube read as a ring seen slightly from above. */
  squash: number;
  /** Uses the cobalt accent instead of lime. */
  accent: boolean;
  /** Base opacity. */
  alpha: number;
};

const SHELLS: Shell[] = [
  { r: 1.0, w: 0.085, speed: 0.55, phase: 0.0, squash: 0.995, accent: false, alpha: 1.0 },
  { r: 0.955, w: 0.062, speed: -0.38, phase: 2.1, squash: 0.97, accent: false, alpha: 0.85 },
  { r: 1.025, w: 0.045, speed: 0.78, phase: 4.3, squash: 1.012, accent: true, alpha: 0.55 },
  { r: 0.915, w: 0.032, speed: -0.95, phase: 5.6, squash: 0.95, accent: false, alpha: 0.7 },
];

/** Soft-tube stroke passes: wide + faint through narrow + bright. */
const PASSES = [
  { k: 3.4, a: 0.035 },
  { k: 2.4, a: 0.055 },
  { k: 1.7, a: 0.09 },
  { k: 1.15, a: 0.16 },
  { k: 0.7, a: 0.3 },
  { k: 0.34, a: 0.55 },
];

/**
 * MARY's living presence: a hollow sphere ringed by soft tubes of liquid light
 * that sweep around it, brightening where they pass the front and fading as
 * they wrap behind — breathing on its own and swelling with the real voice.
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
    const accent = styles.getPropertyValue("--secondary") || primary;

    let width = 0;
    let boxHeight = 0;
    let small = false;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      boxHeight = Math.max(1, rect.height);
      small = width < 420;
      const dpr = Math.min(small ? 2 : 2.25, window.devicePixelRatio || 1);
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
    let sweep = 0;
    let bloom = 0;
    let lastDone = false;
    let last = performance.now();

    const cur: Tuning = { ...TUNING.idle };
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

    const MOTES = Array.from({ length: 10 }, (_, i) => {
      const a = i * 2.399;
      const d = 0.2 + ((i * 41) % 55) / 100;
      return { x: Math.cos(a) * d * 0.72, y: Math.sin(a) * d * 0.6 + 0.14, p: i * 1.7 };
    });

    /** Sweeping brightness around the tube — bright at the front, faint behind. */
    const sweepGradient = (cx: number, cy: number, R: number, angle: number, color: string) => {
      const hasConic = typeof ctx.createConicGradient === "function";
      const g = hasConic
        ? ctx.createConicGradient(angle, cx, cy)
        : ctx.createLinearGradient(
            cx - Math.cos(angle) * R,
            cy - Math.sin(angle) * R,
            cx + Math.cos(angle) * R,
            cy + Math.sin(angle) * R,
          );
      const stops: [number, number][] = hasConic
        ? [
            [0, 0.28],
            [0.14, 1],
            [0.32, 0.46],
            [0.5, 0.86],
            [0.68, 0.3],
            [0.86, 0.72],
            [1, 0.28],
          ]
        : [
            [0, 0.3],
            [0.5, 1],
            [1, 0.34],
          ];
      for (const [p, a] of stops) g.addColorStop(p, withAlpha(color, a));
      return g;
    };

    /** One soft tube: a gently folded closed curve stroked from wide-faint to narrow-bright. */
    const drawShell = (cx: number, cy: number, R: number, shell: Shell) => {
      const segments = small ? 60 : 96;
      const rr = R * shell.r;
      ctx.beginPath();
      let prev: { x: number; y: number } | null = null;
      let first: { x: number; y: number } | null = null;
      const pt = (i: number) => {
        const u = (i / segments) * Math.PI * 2;
        const fold =
          Math.sin(u + t * 0.5 + shell.phase) * 0.6 +
          Math.sin(u * 2 - t * 0.37 + shell.phase * 1.4) * 0.28 +
          Math.sin(u * 3 + t * 0.29) * 0.12;
        const ripple = Math.sin(u * 3 - t * 3.4 + shell.phase) * lv * 0.045;
        const rad = rr * (1 + fold * cur.flow + ripple);
        return { x: cx + Math.cos(u) * rad, y: cy + Math.sin(u) * rad * shell.squash };
      };
      for (let i = 0; i <= segments; i++) {
        const p = pt(i % segments);
        if (!prev) {
          ctx.moveTo(p.x, p.y);
          first = p;
        } else {
          ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + p.x) / 2, (prev.y + p.y) / 2);
        }
        prev = p;
      }
      if (prev && first) ctx.quadraticCurveTo(prev.x, prev.y, first.x, first.y);
      ctx.closePath();

      const angle = sweep * shell.speed + shell.phase;
      ctx.strokeStyle = sweepGradient(cx, cy, R, angle, shell.accent ? accent : primary);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const base = R * shell.w * cur.thick * (1 + lv * 0.22);
      for (const pass of PASSES) {
        ctx.globalAlpha = Math.min(1, pass.a * shell.alpha * cur.glow * (0.85 + lv * 0.4));
        ctx.lineWidth = Math.max(0.5, base * pass.k);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const draw = (animated: boolean) => {
      ctx.clearRect(0, 0, width, boxHeight);

      // The canvas overflows its layout box, so the halo and shadow always fit.
      const R0 = Math.min(boxHeight * 0.5, width * 0.5) / 1.78;
      if (R0 <= 0) return;
      const cx = width / 2;
      const cy = boxHeight / 2 - R0 * 0.05;

      const breath = animated ? 1 + Math.sin(t * 0.85) * 0.018 + lv * 0.045 + bloom * 0.06 : 1;
      const R = R0 * breath;

      // Grounding shadow: lifts the sphere off the paper.
      const gy = cy + R * 1.5;
      ctx.save();
      ctx.translate(cx, gy);
      ctx.scale(1, 0.2);
      ctx.translate(-cx, -gy);
      const shadow = ctx.createRadialGradient(cx, gy, 0, cx, gy, R * 1.05);
      shadow.addColorStop(0, withAlpha(ink, 0.09));
      shadow.addColorStop(1, withAlpha(ink, 0));
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.arc(cx, gy, R * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Outer halo.
      const haloR = R * (cur.halo + lv * 0.22 + bloom * 0.35);
      const halo = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, haloR);
      halo.addColorStop(0, withAlpha(primary, (0.11 + lv * 0.12) * cur.glow));
      halo.addColorStop(0.5, withAlpha(primary, (0.035 + lv * 0.045) * cur.glow));
      halo.addColorStop(1, withAlpha(primary, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Hollow interior: light pooling low inside the sphere, with slow motes.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.97, 0, Math.PI * 2);
      ctx.clip();
      const inner = ctx.createRadialGradient(
        cx,
        cy + R * 0.55,
        R * 0.03,
        cx,
        cy + R * 0.3,
        R * 1.05,
      );
      inner.addColorStop(0, withAlpha(primary, (0.12 + lv * 0.16) * cur.glow));
      inner.addColorStop(0.32, withAlpha(primary, 0.035 * cur.glow));
      inner.addColorStop(1, withAlpha(primary, 0));
      ctx.fillStyle = inner;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      for (const m of MOTES) {
        const tw = 0.25 + 0.75 * Math.abs(Math.sin(t * 1.1 + m.p));
        const sx = cx + m.x * R + Math.sin(t * 0.4 + m.p) * R * 0.035;
        const sy = cy + m.y * R + Math.cos(t * 0.33 + m.p) * R * 0.035;
        ctx.fillStyle = withAlpha(primary, tw * (0.2 + lv * 0.24));
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.55, R * 0.009), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // The tubes of light.
      for (const shell of SHELLS) drawShell(cx, cy, R, shell);

      // A single crisp filament riding the front of the main tube.
      const fa = sweep * 0.55 + 0.4;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.0, fa, fa + 1.25);
      const fg = ctx.createLinearGradient(
        cx + Math.cos(fa) * R,
        cy + Math.sin(fa) * R,
        cx + Math.cos(fa + 1.25) * R,
        cy + Math.sin(fa + 1.25) * R,
      );
      fg.addColorStop(0, withAlpha(paper, 0));
      fg.addColorStop(0.5, withAlpha(paper, 0.75 * cur.glow));
      fg.addColorStop(1, withAlpha(paper, 0));
      ctx.strokeStyle = fg;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(0.6, R * 0.014);
      ctx.stroke();

      // Completion bloom.
      if (bloom > 0.01) {
        ctx.strokeStyle = withAlpha(primary, bloom * 0.35);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1 + (1 - bloom) * 0.8), 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;

      const current = stateRef.current;
      const target = TUNING[current];
      const k = Math.min(1, dt * 2.6);
      cur.flow = lerp(cur.flow, target.flow, k);
      cur.swirl = lerp(cur.swirl, target.swirl, k);
      cur.glow = lerp(cur.glow, target.glow, k);
      cur.halo = lerp(cur.halo, target.halo, k);
      cur.thick = lerp(cur.thick, target.thick, k);

      const voiced = current === "speaking" || current === "listening" || current === "hearing";
      const targetLevel = voiced ? Math.min(1, Math.max(0, levelRef.current)) : 0;
      const rate = targetLevel > lv ? dt / 0.1 : dt / 0.32;
      lv += (targetLevel - lv) * Math.min(1, rate);

      sweep += dt * cur.swirl;

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
      className={`pointer-events-none relative w-full overflow-visible ${className}`}
      style={{ height }}
      role="img"
      aria-label={`MARY is ${STATE_LABEL[state].toLowerCase()}`}
    >
      <canvas ref={canvasRef} className="absolute -inset-y-[30%] left-0 w-full" />
    </div>
  );
});

export { STATE_LABEL as PRESENCE_LABEL };
