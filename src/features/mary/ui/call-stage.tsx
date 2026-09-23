import { memo, useState, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Hand, MessageSquareText, Radio, Volume2, VolumeX, X } from "lucide-react";

import type { SessionStore } from "../conversation/store";
import { useSession } from "../conversation/store";
import type { Line } from "../conversation/types";
import { Composer } from "./composer";
import { MaryOrb } from "./mary-orb";
import { EASE, QUICK, SOFT } from "./motion";
import { ProgressPills } from "./progress-pills";
import { Logo, SiteHeader } from "./site-frame";

/** Her line, revealed word by word in step with her voice (CSS opacity only). */
const RevealedLine = memo(function RevealedLine({ text, count }: { text: string; count: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((word, i) => (
        <span
          key={i}
          className={`mr-[0.26em] inline-block transition-opacity duration-300 ease-out ${i < count ? "opacity-100" : "opacity-20"}`}
        >
          {word}
        </span>
      ))}
    </>
  );
});

function ConversationPanel({ lines, onClose }: { lines: Line[]; onClose: () => void }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={QUICK}
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/10 p-3 sm:items-center"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-label="Conversation so far"
        initial={reduced ? false : { y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={SOFT}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] bg-card shadow-[0_0_0_1px_var(--color-border),0_40px_80px_-40px_oklch(0.2_0.02_110/0.55)]"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <p className="eyebrow">Conversation so far</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <ol className="no-scrollbar flex-1 space-y-2.5 overflow-y-auto px-5 pb-5">
          {lines.map((line) => (
            <li
              key={line.id}
              className={`flex ${line.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <p
                className={`max-w-[85%] rounded-[1.25rem] px-4 py-2.5 text-sm leading-relaxed ${
                  line.role === "user"
                    ? "rounded-br-md bg-ink text-background"
                    : "rounded-bl-md bg-muted text-ink"
                }`}
              >
                {line.text}
                {line.interrupted && <span className="text-muted-foreground"> …</span>}
              </p>
            </li>
          ))}
        </ol>
      </motion.div>
    </motion.div>
  );
}

export function CallStage({
  store,
  orbSize,
  height,
  inputRef,
  onSend,
  onMicButton,
  onPlaySound,
  onToggleVoice,
  onHoldStart,
  onHoldEnd,
  onToggleTalkMode,
}: {
  store: SessionStore;
  orbSize: number;
  /** Locked to the visible screen on phones, so the composer sits above the keyboard. */
  height: number | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  onMicButton: () => void;
  onPlaySound: () => void;
  onToggleVoice: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onToggleTalkMode: () => void;
}) {
  const reduced = useReducedMotion();
  const [panel, setPanel] = useState(false);
  const lines = useSession(store, (s) => s.lines);
  const presence = useSession(store, (s) => s.presence);
  const reveal = useSession(store, (s) => s.reveal);
  const interim = useSession(store, (s) => s.interim);
  const collected = useSession(store, (s) => s.collected);
  const voiceOff = useSession(store, (s) => s.voiceOff);
  const talkMode = useSession(store, (s) => s.talkMode);

  // Her lines since the person last spoke: the newest is the caption, the one before it sits above.
  const lastUserIndex = lines.map((l) => l.role).lastIndexOf("user");
  const lastUser = lastUserIndex >= 0 ? lines[lastUserIndex] : undefined;
  const maryNow = lines.slice(lastUserIndex + 1).filter((l) => l.role === "mary");
  const current = maryNow[maryNow.length - 1];
  const before = maryNow.length > 1 ? maryNow[maryNow.length - 2] : undefined;

  return (
    <motion.section
      key="call"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden px-4 sm:px-8"
      style={height ? { height } : {}}
    >
      <SiteHeader
        start={<Logo className="h-6 sm:h-7" />}
        end={
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden min-w-0 md:block">
              <ProgressPills collected={collected} />
            </div>
            <button
              type="button"
              onClick={onToggleTalkMode}
              aria-pressed={talkMode === "hands-free"}
              aria-label={
                talkMode === "hold"
                  ? "Quiet room: switch to hands-free talking"
                  : "Loud room: switch to hold to talk"
              }
              className="inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors hover:text-ink"
            >
              {talkMode === "hold" ? <Radio className="size-4" /> : <Hand className="size-4" />}
              <span className="hidden sm:inline">
                {talkMode === "hold" ? "Quiet room? Go hands-free" : "Hold to talk"}
              </span>
            </button>
            <button
              type="button"
              onClick={onToggleVoice}
              aria-label={voiceOff ? "Turn MARY's voice on" : "Turn MARY's voice off"}
              className="inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-ink"
            >
              {voiceOff ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              <span className="hidden sm:inline">{voiceOff ? "Voice off" : "Voice on"}</span>
            </button>
          </div>
        }
      />
      <div className="md:hidden">
        <ProgressPills collected={collected} />
      </div>

      {/* Screen readers hear each of her lines once, whole. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {current ? `MARY: ${current.text}` : ""}
      </p>

      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 py-3 text-center sm:gap-6">
        <motion.div
          layoutId="mary-orb"
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
        >
          <MaryOrb state={presence} size={orbSize} />
        </motion.div>

        <div className="flex h-[10.5rem] w-full flex-col items-center justify-start overflow-hidden sm:h-[12.5rem]">
          <AnimatePresence mode="popLayout" initial={false}>
            {interim ? (
              <motion.p
                key="interim"
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={QUICK}
                className="mb-3 max-w-xl text-pretty text-sm text-muted-foreground"
              >
                <span className="font-medium text-ink">You</span> · {interim}
              </motion.p>
            ) : lastUser ? (
              <motion.p
                key={`echo-${lastUser.id}`}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={QUICK}
                className="mb-3 max-w-xl truncate text-sm text-muted-foreground"
              >
                You · “{lastUser.text}”
              </motion.p>
            ) : null}
          </AnimatePresence>

          <p className="eyebrow">MARY</p>
          <AnimatePresence mode="popLayout" initial={false}>
            {current ? (
              <motion.div
                key={current.id}
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={SOFT}
                className="mt-3 max-w-2xl"
              >
                {before && (
                  <p className="mb-2 text-pretty text-lg leading-snug text-muted-foreground sm:text-xl">
                    {before.text}
                  </p>
                )}
                <p
                  className={`text-pretty font-display font-medium leading-tight tracking-[-0.02em] text-ink ${current.text.length > 110 ? "text-xl sm:text-[1.6rem]" : "text-2xl sm:text-[2.1rem]"}`}
                >
                  <RevealedLine
                    text={current.text}
                    count={reveal.id === current.id ? reveal.count : 999}
                  />
                  {current.interrupted && <span className="text-muted-foreground">…</span>}
                </p>
              </motion.div>
            ) : (
              <motion.p
                key="waiting"
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-3 font-display text-2xl text-muted-foreground sm:text-[2.1rem]"
              >
                {presence === "thinking" ? "…" : ""}
              </motion.p>
            )}
          </AnimatePresence>
          {lines.length > 2 && (
            <button
              type="button"
              onClick={() => setPanel(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
            >
              <MessageSquareText className="size-3.5" />
              Show conversation
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-xl shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Composer
          store={store}
          inputRef={inputRef}
          onSend={onSend}
          onMicButton={onMicButton}
          onPlaySound={onPlaySound}
          onHoldStart={onHoldStart}
          onHoldEnd={onHoldEnd}
        />
      </div>

      <AnimatePresence>
        {panel && <ConversationPanel lines={lines} onClose={() => setPanel(false)} />}
      </AnimatePresence>
    </motion.section>
  );
}
