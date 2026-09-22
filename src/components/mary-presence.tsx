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

/**
 * MARY's single living presence. She rests as a luminous sphere and melts into a
 * ribbon of light that rides real audio while she speaks or listens.
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
    let morph = 0;
    let bloom = 0;
    let lastDone = false;
    let last = performance.now();

    const drawSphere = (cx: number, cy: number, radius: number, alpha: number, breath: number) => {
      if (alpha <= 0.01 || radius <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;

      const glow = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 2.1);
      glow.addColorStop(0, withAlpha(primary, 0.3));
      glow.addColorStop(1, withAlpha(primary, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 2.1, 0, Math.PI * 2);
      ctx.fill();

      const driftX = Math.cos(t * 0.45) * radius * 0.18;
      const driftY = Math.sin(t * 0.33) * radius * 0.14;
      const body = ctx.createRadialGradient(
        cx - radius * 0.28 + driftX,
        cy - radius * 0.32 + driftY,
        radius * 0.08,
        cx,
        cy,
        radius * breath,
      );
      body.addColorStop(0, withAlpha(primary, 0.95));
      body.addColorStop(0.45, withAlpha(primary, 0.5));
      body.addColorStop(1, withAlpha(primary, 0.12));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * breath, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = withAlpha(primary, 0.4);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * breath, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = withAlpha(ink, 0.85);
      ctx.font = `700 ${Math.round(radius * 0.62)}px "Space Grotesk", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("M", cx, cy + radius * 0.03);
      ctx.restore();
    };

    const drawRibbon = (cx: number, cy: number, alpha: number, spread: number) => {
      if (alpha <= 0.01) return;
      const reach = Math.max(1, (width / 2) * spread);
      const amp = boxHeight * (0.06 + lv * 0.34);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineCap = "round";

      for (let layer = 0; layer < 3; layer++) {
        const phase = t * (0.9 + layer * 0.28) + layer * 1.7;
        const layerAmp = amp * (1 - layer * 0.26);
        const gradient = ctx.createLinearGradient(cx - reach, 0, cx + reach, 0);
        gradient.addColorStop(0, withAlpha(primary, 0));
        gradient.addColorStop(0.5, withAlpha(primary, layer === 0 ? 0.95 : 0.45));
        gradient.addColorStop(1, withAlpha(primary, 0));
        ctx.strokeStyle = gradient;
        ctx.lineWidth = layer === 0 ? 2.4 : 1.4;

        for (const flip of [1, -1]) {
          ctx.globalAlpha = alpha * (flip === 1 ? 1 : 0.28);
          ctx.beginPath();
          for (let x = cx - reach; x <= cx + reach; x += 3) {
            const u = (x - cx) / reach;
            const envelope = Math.exp(-u * u * 2.4);
            const wave =
              Math.sin(u * 5.2 + phase) * 0.6 +
              Math.sin(u * 9.1 - phase * 0.7) * 0.28 +
              Math.sin(u * 2.3 + phase * 1.4) * 0.22;
            const y = cy + flip * wave * layerAmp * envelope;
            if (x === cx - reach) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;

      const current = stateRef.current;
      const ribbonState =
        current === "speaking" || current === "listening" || current === "hearing";
      const targetLevel = ribbonState ? Math.min(1, Math.max(0.05, levelRef.current)) : 0;
      lv += (targetLevel - lv) * Math.min(1, dt * 9);
      morph += ((ribbonState ? 1 : 0) - morph) * Math.min(1, dt * 5);

      const isDone = current === "done";
      if (isDone && !lastDone) bloom = 1;
      lastDone = isDone;
      if (bloom > 0) bloom = Math.max(0, bloom - dt * 1.1);

      ctx.clearRect(0, 0, width, boxHeight);
      const cx = width / 2;
      const cy = boxHeight / 2;
      const baseRadius = Math.min(boxHeight * 0.36, width * 0.22);
      const breath =
        current === "thinking"
          ? 1 + Math.sin(t * 2.6) * 0.035
          : 1 + Math.sin(t * 1.15) * 0.028 + (isDone ? 0.04 : 0);

      drawSphere(cx, cy, baseRadius * (1 - morph * 0.45), 1 - morph, breath);
      drawRibbon(cx, cy, morph, 0.08 + morph * 0.92);

      if (bloom > 0) {
        ctx.save();
        ctx.globalAlpha = bloom * 0.6;
        ctx.strokeStyle = withAlpha(primary, 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, baseRadius * (1 + (1 - bloom) * 1.1), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      ctx.clearRect(0, 0, width, boxHeight);
      drawSphere(width / 2, boxHeight / 2, Math.min(boxHeight * 0.36, width * 0.22), 1, 1);
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
