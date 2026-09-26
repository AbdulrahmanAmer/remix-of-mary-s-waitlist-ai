import { useEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Headphones, Mic, MicOff, Send, VolumeX } from "lucide-react";

import type { SessionStore } from "../conversation/store";
import { useSession } from "../conversation/store";
import { voiceLevel } from "../signal/signal";
import { floorLine, handsFreeStatus, NOTICE_TEXT, noticeAnnouncement, type Floor } from "./floor";
import { QUICK } from "./motion";
import { hasFinePointer } from "./use-viewport";

/** Live input level while held, so people can see it is working at arm's length. */
function HoldMeter() {
  const bar = useRef<HTMLSpanElement | null>(null);
  useEffect(
    () =>
      voiceLevel.subscribe((level) => {
        if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, level * 1.4)})`;
      }),
    [],
  );
  return (
    <span className="absolute inset-x-6 bottom-2 h-1 overflow-hidden rounded-full bg-ink/10">
      <span
        ref={bar}
        className="block h-full origin-left rounded-full bg-primary transition-transform duration-75"
        style={{ transform: "scaleX(0)" }}
      />
    </span>
  );
}

/**
 * The primary control. Its label never changes underneath a thumb; the floor
 * shows in its colour (full lime when it is their turn, paler while she has
 * it) and in the line above it.
 */
function HoldButton({
  held,
  yours,
  onHoldStart,
  onHoldEnd,
}: {
  held: boolean;
  yours: boolean;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="relative">
      {yours && !held && !reduced && (
        <span
          aria-hidden="true"
          className="mary-turn-ping pointer-events-none absolute inset-0 rounded-full"
        />
      )}
      <motion.button
        type="button"
        aria-label="Hold to talk to MARY"
        aria-pressed={held}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          onHoldStart();
        }}
        onPointerUp={onHoldEnd}
        onPointerCancel={onHoldEnd}
        onLostPointerCapture={onHoldEnd}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if ((event.key === " " || event.key === "Enter") && !event.repeat) {
            event.preventDefault();
            onHoldStart();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            onHoldEnd();
          }
        }}
        animate={reduced ? {} : { scale: held ? 1.03 : 1 }}
        transition={QUICK}
        style={{ touchAction: "none", WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
        className={`relative flex h-16 w-full select-none items-center justify-center gap-3 overflow-hidden rounded-full font-display text-base font-medium transition-[background-color,box-shadow] duration-300 sm:h-14 ${
          held
            ? "bg-ink text-background shadow-[0_0_0_4px_oklch(0.79_0.175_118/0.45),0_18px_40px_-18px_oklch(0.55_0.15_118/0.7)]"
            : yours
              ? "bg-primary text-ink shadow-[0_0_0_1px_var(--color-border),0_18px_40px_-24px_oklch(0.55_0.15_118/0.55)]"
              : "bg-primary/60 text-ink shadow-[0_0_0_1px_var(--color-border)]"
        }`}
      >
        {held && !reduced && (
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/25" />
        )}
        <Mic className="relative size-5" />
        <span className="relative">{held ? "Listening… let go when done" : "Hold to talk"}</span>
        {held && <HoldMeter />}
      </motion.button>
    </div>
  );
}

/** A visual notice. Screen readers get the same text from the one status region below. */
function Notice({
  show,
  icon,
  children,
}: {
  show: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.p
          aria-hidden="true"
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={QUICK}
          className="mt-1.5 flex items-center justify-center gap-1.5 text-center text-[0.8125rem] leading-snug text-accent-text"
        >
          {icon}
          {children}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

export function Composer({
  store,
  floor,
  inputRef,
  onSend,
  onMicButton,
  onPlaySound,
  onHearHer,
  onHoldStart,
  onHoldEnd,
}: {
  store: SessionStore;
  /** Whose turn it is, already settled past the pause between her beats. */
  floor: Floor;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  onMicButton: () => void;
  onPlaySound: () => void;
  onHearHer: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}) {
  const reduced = useReducedMotion();
  const [draft, setDraft] = useState("");
  const mic = useSession(store, (s) => s.mic);
  const presence = useSession(store, (s) => s.presence);
  const listening = useSession(store, (s) => s.listening);
  const notices = useSession(store, (s) => s.notices);
  const talkMode = useSession(store, (s) => s.talkMode);
  const holdMode = talkMode === "hold";
  const status = handsFreeStatus({
    presence,
    listening,
    micLive: mic.live,
    micMuted: mic.muted,
  });
  const listeningLive = mic.live && !mic.muted;
  const announcement = noticeAnnouncement(notices, mic);

  // The iPhone "Can't hear her?" row keeps its slot once it has appeared, so the
  // hold button never drops 40px under a thumb when the row goes away.
  const [hintSlot, setHintSlot] = useState(false);
  useEffect(() => {
    if (notices.silentHint) setHintSlot(true);
  }, [notices.silentHint]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="w-full">
      <Notice show={!!mic.error}>
        <span className="text-muted-foreground">{mic.error}</span>
      </Notice>
      {holdMode && (
        <div className="mt-2">
          {/* Notices sit above the button: the composer grows upward, so the button
              never moves under a thumb that is about to press it again. */}
          <Notice show={notices.missedHold}>{NOTICE_TEXT.missedHold}</Notice>
          <Notice show={notices.suggestTyping}>{NOTICE_TEXT.suggestTyping}</Notice>
          <p
            aria-hidden="true"
            className={`mb-1.5 mt-1.5 text-center text-sm leading-snug transition-colors duration-300 ${
              floor === "yours"
                ? "font-medium text-ink"
                : floor === "listening"
                  ? "font-medium text-accent-text"
                  : "text-muted-foreground"
            }`}
          >
            {floorLine(floor, hasFinePointer())}
          </p>
          <HoldButton
            held={listening === "hearing"}
            yours={floor === "yours"}
            onHoldStart={onHoldStart}
            onHoldEnd={onHoldEnd}
          />
        </div>
      )}
      <div
        className={`mt-2 flex w-full items-end gap-1 rounded-[1.75rem] bg-card/90 px-2 py-1.5 backdrop-blur-sm transition-shadow duration-300 ${
          listening === "hearing"
            ? "shadow-[0_0_0_2px_var(--color-primary),0_18px_40px_-24px_oklch(0.55_0.15_118/0.55)]"
            : "shadow-[0_0_0_1px_var(--color-border),0_18px_40px_-24px_oklch(0.2_0.02_110/0.4)] focus-within:shadow-[0_0_0_2px_oklch(0.15_0.01_110/0.55),0_18px_40px_-24px_oklch(0.2_0.02_110/0.4)]"
        }`}
      >
        {!holdMode && (
          <motion.button
            type="button"
            onClick={onMicButton}
            whileTap={reduced ? {} : { scale: 0.94 }}
            aria-label={
              !mic.live
                ? "Turn the microphone on"
                : mic.muted
                  ? "Unmute your microphone"
                  : "Mute your microphone"
            }
            className={`relative grid size-11 shrink-0 place-items-center rounded-full transition-colors ${
              listeningLive
                ? "bg-primary text-ink"
                : "bg-muted text-muted-foreground hover:text-ink"
            }`}
          >
            {listeningLive && listening === "hearing" && !reduced && (
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
            )}
            {listeningLive ? (
              <Mic className="relative size-5" />
            ) : (
              <MicOff className="relative size-5" />
            )}
          </motion.button>
        )}
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          enterKeyHint="send"
          aria-label="Your answer"
          placeholder={
            holdMode
              ? "Or type your answer"
              : !mic.live
                ? "Type your answer"
                : listening === "hearing"
                  ? "I can hear you…"
                  : listening === "finishing"
                    ? "Finishing your answer…"
                    : mic.muted
                      ? "Muted, type your answer"
                      : "Speak or type your answer"
          }
          // 16px wherever a finger taps it: iPhone Safari zooms into any smaller field and never zooms back.
          className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-base text-ink outline-none placeholder:text-muted-foreground pointer-fine:text-sm"
        />
        <AnimatePresence initial={false}>
          {draft.trim() && (
            <motion.button
              type="button"
              initial={reduced ? false : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={QUICK}
              onClick={submit}
              aria-label="Send"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-background"
            >
              <Send className="size-4" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-2 text-center text-muted-foreground">
        {!holdMode && (
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={status}
              initial={reduced ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-center gap-2 text-sm leading-snug"
              aria-live="off"
            >
              {listeningLive && (
                <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_0_4px_oklch(0.79_0.175_118/0.2)]" />
              )}
              {status}
            </motion.p>
          </AnimatePresence>
        )}
        {(notices.silentHint || hintSlot) && (
          <p
            aria-hidden="true"
            className={`mt-1 flex min-h-11 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[0.8125rem] text-accent-text transition-opacity duration-300 ${notices.silentHint ? "" : "pointer-events-none opacity-0"}`}
          >
            <span>Can't hear her?</span>
            <button
              type="button"
              tabIndex={notices.silentHint ? 0 : -1}
              onClick={onPlaySound}
              className="inline-flex min-h-11 items-center rounded-full px-3.5 font-medium text-ink ring-1 ring-border transition-colors hover:bg-muted"
            >
              Play sound
            </button>
            <button
              type="button"
              tabIndex={notices.silentHint ? 0 : -1}
              onClick={onHearHer}
              className="inline-flex min-h-11 items-center rounded-full px-3.5 text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
            >
              I can hear her
            </button>
          </p>
        )}
        <Notice
          show={notices.voiceFailed}
          icon={<VolumeX className="size-3.5" aria-hidden="true" />}
        >
          {NOTICE_TEXT.voiceFailed}
        </Notice>
        <Notice
          show={notices.echoHint && mic.live}
          icon={<Headphones className="size-3.5" aria-hidden="true" />}
        >
          {NOTICE_TEXT.echoHint}
        </Notice>
        {/* The one live region for notices: always mounted, so it is actually announced. */}
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
    </div>
  );
}
