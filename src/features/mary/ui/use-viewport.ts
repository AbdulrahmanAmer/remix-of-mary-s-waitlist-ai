import { useEffect, useState } from "react";

/** The usable height of the screen, following zoom, rotation and resizes. */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(() =>
    typeof window === "undefined" ? 900 : window.innerHeight,
  );
  useEffect(() => {
    const update = () => setHeight(window.visualViewport?.height ?? window.innerHeight);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return height;
}

/**
 * On phones the on-screen keyboard shrinks the visual viewport without shrinking
 * the layout; the call screen follows it so the composer sits right above the keys.
 */
export function useKeyboardViewport(active: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const viewport = typeof window === "undefined" ? null : window.visualViewport;
    if (!active || !viewport) {
      setHeight(null);
      return;
    }
    const update = () => {
      setHeight(Math.round(viewport.height));
      // iOS scrolls the page to reveal the focused field; the shell is already sized to fit.
      if (window.innerHeight - viewport.height > 120 && window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [active]);
  return height;
}

/** Hover-capable pointer: focusing the composer will not pop up a keyboard. */
export function hasFinePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches
  );
}
