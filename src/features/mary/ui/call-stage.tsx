import { memo, useEffect, useId, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Hand, MessageSquareText, PhoneOff, Radio, Volume2, VolumeX, X } from "lucide-react";

import type { SessionStore } from "../conversation/store";
import { useSession } from "../conversation/store";
import type { Line } from "../conversation/types";
import { CALL_TITLE, captionOf, captionSize } from "./caption";
import { Composer } from "./composer";
import { CALL_ORB_SHARES, fitOrb } from "./fit";
import { captionAnnouncement, floorFor } from "./floor";
import { MaryOrb } from "./mary-orb";
import { EASE, QUICK, SWAP } from "./motion";
import { ProgressPills } from "./progress-pills";
import { Logo, SiteHeader } from "./site-frame";
import { useSettledFloor } from "./use-floor";
import { useViewportHeight } from "./use-viewport";

/**
 * Her line, revealed word by word in step with her voice. Unspoken words are a
 * dimmer ink, not a faded one: 4.8:1 against the paper, so the whole line can
 * be read ahead by anyone.
 */
const RevealedLine = memo(function RevealedLine({ text, count }: { text: string; count: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((word, i) => (
        <span key={i}>
          <span
            className={`transition-colors duration-300 ease-out ${i < count ? "text-ink" : "text-caption-dim"}`}
          >
            {word}
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
});

/**
 * The conversation so far, as a native modal dialog: the browser traps focus
 * inside, closes it on Escape, keeps the page behind inert and hands focus
 * back when it closes. It stays mounted; `open` shows and hides it.
 */
function ConversationPanel({
  lines,
  open,
  onClose,
}: {
  lines: Line[];
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // The newest lines are at the bottom, which is where "so far" ends.
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // Clicks on the backdrop land on the dialog itself; inside, on its children.
        if (event.target === event.currentTarget) onClose();
      }}
      className="mary-dialog fixed inset-0 mx-auto mb-3 mt-auto w-[calc(100%-1.5rem)] max-w-lg overflow-hidden rounded-[1.75rem] border-0 bg-card p-0 text-ink shadow-[0_0_0_1px_var(--color-border),0_40px_80px_-40px_oklch(0.2_0.02_110/0.55)] sm:my-auto"
    >
      <div className="flex max-h-[80dvh] flex-col">
        <div className="flex items-center justify-between pb-1 pl-5 pr-2 pt-2">
          <p id={titleId} className="eyebrow">
            Conversation so far
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 place-items-center rounded-full hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <ol
          ref={listRef}
          tabIndex={0}
          aria-label="Messages"
          className="no-scrollbar flex-1 space-y-2.5 overflow-y-auto px-5 pb-5 pt-1 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-ink)]"
        >
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
                <span className="sr-only">{line.role === "user" ? "You: " : "MARY: "}</span>
                {line.text}
                {line.interrupted && <span className="text-muted-foreground"> …</span>}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </dialog>
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
  onHearHer,
  onToggleVoice,
  onHoldStart,
  onHoldEnd,
  onToggleTalkMode,
  onHangUp,
}: {
  store: SessionStore;
  orbSize: number;
  /** Locked to the visible screen on phones, so the composer sits above the keyboard. */
  height: number | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  onMicButton: () => void;
  onPlaySound: () => void;
  onHearHer: () => void;
  onToggleVoice: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onToggleTalkMode: () => void;
  /** Retell calls: one "End call" button takes the place of the talk-mode and voice toggles. */
  onHangUp?: (() => void) | undefined;
}) {
  const reduced = useReducedMotion();
  const [panel, setPanel] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const showRef = useRef<HTMLButtonElement | null>(null);
  const lines = useSession(store, (s) => s.lines);
  const presence = useSession(store, (s) => s.presence);
  const listening = useSession(store, (s) => s.listening);
  const reveal = useSession(store, (s) => s.reveal);
  const interim = useSession(store, (s) => s.interim);
  const collected = useSession(store, (s) => s.collected);
  const voiceOff = useSession(store, (s) => s.voiceOff);
  const voiceFailed = useSession(store, (s) => s.notices.voiceFailed);
  const talkMode = useSession(store, (s) => s.talkMode);
  const viewportHeight = useViewportHeight();
  const orb = fitOrb(orbSize, viewportHeight, CALL_ORB_SHARES);

  // Her lines since the person last spoke: the newest is the caption, the one before it sits above.
  const { lastUser, current, before } = captionOf(lines);
  const floor = useSettledFloor(floorFor(presence, listening));

  // A new screen: focus lands on its heading (not on <body>) and the tab says where we are.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    const previous = document.title;
    document.title = CALL_TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  const closePanel = () => {
    setPanel(false);
    // The browser returns focus to what had it; Safari does not focus a tapped button, so make sure.
    showRef.current?.focus({ preventScroll: true });
  };

  return (
    <motion.section
      key="call"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="screen-gutter fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden"
      style={height ? { height } : {}}
    >
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        Talking with MARY
      </h1>
      <SiteHeader
        start={<Logo className="h-6 sm:h-7" />}
        end={
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden min-w-0 md:block">
              <ProgressPills collected={collected} />
            </div>
            {onHangUp ? (
              <button
                type="button"
                onClick={onHangUp}
                aria-label="End the call"
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors hover:text-ink"
              >
                <PhoneOff className="size-4" />
                <span className="hidden sm:inline">End call</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onToggleTalkMode}
                  aria-pressed={talkMode === "hands-free"}
                  aria-label={
                    talkMode === "hold"
                      ? "Quiet room: switch to hands-free talking"
                      : "Loud room: switch to hold to talk"
                  }
                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors hover:text-ink"
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
                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-ink"
                >
                  {voiceOff ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                  <span className="hidden sm:inline">{voiceOff ? "Voice off" : "Voice on"}</span>
                </button>
              </>
            )}
          </div>
        }
      />
      <div className="md:hidden">
        <ProgressPills collected={collected} />
      </div>

      {/* With her voice on, screen readers hear whose turn it is; with it off, her words. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {captionAnnouncement({ text: current?.text ?? null, floor, voiceOff, voiceFailed })}
      </p>

      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col items-center gap-3 py-3 text-center sm:gap-5 short:flex-row short:items-stretch short:gap-6 short:py-2 short:text-left">
        <motion.div
          layoutId="mary-orb"
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
          className="shrink-0 short:self-center"
        >
          <MaryOrb state={presence} size={orb} />
        </motion.div>

        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-center short:items-start">
          {/* The caption box takes the room that is left and clamps its lines, so nothing is sliced. */}
          <div
            data-caption-box
            className="flex min-h-0 w-full flex-1 flex-col items-center overflow-hidden short:items-start short:justify-center"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {interim ? (
                <motion.p
                  key="interim"
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={QUICK}
                  className="mb-1.5 line-clamp-2 w-full max-w-xl shrink-0 text-pretty text-sm text-muted-foreground short:line-clamp-1"
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
                  className="mb-1.5 w-full max-w-xl shrink-0 truncate text-sm text-muted-foreground"
                >
                  You · “{lastUser.text}”
                </motion.p>
              ) : null}
            </AnimatePresence>

            <p className="eyebrow shrink-0">MARY</p>
            {/* mode="wait": the old line is gone (120 ms, opacity only) before the new one appears, so they never overlap. */}
            <AnimatePresence mode="wait" initial={false}>
              {current ? (
                <motion.div
                  key={current.id}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: reduced ? { duration: 0 } : SWAP }}
                  transition={QUICK}
                  className="mt-1.5 flex min-h-0 w-full max-w-2xl flex-col items-center short:items-start"
                >
                  {before && (
                    <p className="mb-2 hidden line-clamp-2 shrink-0 text-pretty text-lg leading-snug text-muted-foreground sm:block sm:text-xl short:hidden">
                      {before.text}
                    </p>
                  )}
                  <p
                    className={`line-clamp-4 text-pretty font-display font-medium leading-tight tracking-[-0.02em] text-ink sm:line-clamp-5 short:line-clamp-3 short:text-xl ${captionSize(current.text)}`}
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
                  exit={{ opacity: 0, transition: SWAP }}
                  className="mt-2 font-display text-2xl text-muted-foreground sm:text-[2.1rem]"
                >
                  {presence === "thinking" ? "…" : ""}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          {/* Outside the clipped box, with its room reserved, so it is never pushed out of view. */}
          <div className="flex min-h-9 shrink-0 items-center justify-center short:min-h-0 short:justify-start">
            {lines.length > 2 && (
              <button
                ref={showRef}
                type="button"
                onClick={() => setPanel(true)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-muted hover:text-ink short:min-h-8"
              >
                <MessageSquareText className="size-3.5" />
                Show conversation
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-xl shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Composer
          store={store}
          floor={floor}
          inputRef={inputRef}
          onSend={onSend}
          onMicButton={onMicButton}
          onPlaySound={onPlaySound}
          onHearHer={onHearHer}
          onHoldStart={onHoldStart}
          onHoldEnd={onHoldEnd}
        />
      </div>

      <ConversationPanel lines={lines} open={panel} onClose={closePanel} />
    </motion.section>
  );
}
