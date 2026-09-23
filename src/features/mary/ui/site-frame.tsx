import { useCallback, useRef, type ReactNode } from "react";

import lockup from "@/assets/omnisuite-lockup.png.asset.json";
import { OWNER_VIEW_EVENT } from "@/components/waitlist-vault";

export function Logo({ className = "h-7" }: { className?: string }) {
  return (
    <img
      src={lockup.url}
      alt="OmniSuite"
      className={`w-auto select-none ${className}`}
      draggable={false}
    />
  );
}

/** Five quick taps on "omnikom" open the owner view where there is no keyboard. */
function useOwnerTaps() {
  const taps = useRef<number[]>([]);
  return useCallback(() => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2000), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      window.dispatchEvent(new Event(OWNER_VIEW_EVENT));
    }
  }, []);
}

export function SiteFooter({ className = "" }: { className?: string }) {
  const onTap = useOwnerTaps();
  return (
    <footer
      className={`flex shrink-0 flex-wrap items-center justify-between gap-2 py-4 text-[0.7rem] text-muted-foreground ${className}`}
    >
      <span>OmniSuite · AI-native revenue infrastructure</span>
      <span>
        A product by{" "}
        <span
          className="wordmark cursor-default select-none text-ink"
          onClick={onTap}
          aria-hidden="true"
        >
          omnikom
        </span>
      </span>
    </footer>
  );
}

export function SiteHeader({
  start,
  end,
  centered = false,
}: {
  start?: ReactNode;
  end?: ReactNode;
  centered?: boolean;
}) {
  return (
    <header
      className={`flex min-h-14 shrink-0 items-center gap-4 ${centered ? "justify-center" : "justify-between"}`}
    >
      {start ?? <Logo />}
      {end}
    </header>
  );
}
