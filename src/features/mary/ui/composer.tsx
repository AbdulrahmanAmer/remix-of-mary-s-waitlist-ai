import { useEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Headphones, Mic, MicOff, Send, VolumeX } from "lucide-react";

import type { SessionStore } from "../conversation/store";
import { useSession } from "../conversation/store";
import { voiceLevel } from "../signal/signal";
import { QUICK } from "./motion";
import { hasFinePointer } from "./use-viewport";

function holdStatusFor(presence: string, listening: string, keyboard: boolean) {
  if (listening === "hearing") return "Listening… release when done";
  if (listening === "finishing" || presence === "thinking") return "Thinking…";
  if (presence === "speaking") return "MARY is speaking · hold to cut in";
  return keyboard
    ? "Hold the button or the space bar while you talk, let go when you're done."
    : "Hold the button while you talk, let go when you're done.";
}

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

function HoldButton({
  held,
  busy,
  onHoldStart,
  onHoldEnd,
}: {
  held: boolean;
  busy: boolean;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}) {
  const reduced = useReducedMotion();
  return (
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
      className={`relative flex h-14 w-full select-none items-center justify-center gap-2.5 overflow-hidden rounded-full font-display text-sm font-medium transition-[background-color,box-shadow] duration-200 sm:gap-3 sm:text-base ${
        held
          ? "bg-ink text-background shadow-[0_0_0_4px_oklch(0.79_0.175_118/0.45),0_18px_40px_-18px_oklch(0.55_0.15_118/0.7)]"
          : "bg-primary text-ink shadow-[0_0_0_1px_var(--color-border),0_18px_40px_-24px_oklch(0.55_0.15_118/0.55)]"
      }`}
    >
      {held && !reduced && (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/25" />
      )}
      <Mic className="relative size-5" />
      <span className="relative">
        {held
          ? "Listening… release when done"
          : busy
            ? "Thinking… hold to talk"
            : "Hold to talk to MARY"}
      </span>
      {held && <HoldMeter />}
    </motion.button>
  );
}

function statusFor(state: {
  presence: string;
  listening: string;
  micLive: boolean;
  micMuted: boolean;
  typingOnly: boolean;
}) {
  if (state.presence === "speaking" && !state.micMuted)
    return state.typingOnly ? "MARY is speaking." : "MARY is speaking · just talk to cut in";
  if (state.listening === "hearing") return "Go ahead, I'm listening.";
  if (state.listening === "finishing") return "Got it. MARY is preparing her reply.";
  if (state.presence === "thinking") return "MARY is thinking…";
  if (state.micMuted) return "Your microphone is muted. Unmute to keep talking, or type.";
  return state.typingOnly
    ? "Type your reply, MARY is reading."
    : "MARY is listening. Just talk, she answers when you pause.";
}

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
          role="status"
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={QUICK}
          className="mt-1 flex items-center justify-center gap-1.5 text-[0.68rem] text-accent-text sm:mt-1.5 sm:text-xs"
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
  inputRef,
  onSend,
  onMicButton,
  onPlaySound,
  onHearHer,
  onHoldStart,
  onHoldEnd,
}: {
  store: SessionStore;
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
  const typingOnly = !mic.live;
  const status = holdMode
    ? holdStatusFor(presence, listening, hasFinePointer())
    : statusFor({
        presence,
        listening,
        micLive: mic.live,
        micMuted: mic.muted,
        typingOnly,
      });
  const listeningLive = mic.live && !mic.muted;

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
        <div className="mt-1.5 sm:mt-2">
          {/* Notices sit above the button: the composer grows upward, so the button
              never moves under a thumb that is about to press it again. */}
          <Notice show={notices.missedHold}>
            Didn't catch that. Hold, speak close to the phone, and try again.
          </Notice>
          <Notice show={notices.suggestTyping}>
            Loud in here? Type your answer below instead.
          </Notice>
          <div className="mt-1.5 sm:mt-2">
            <HoldButton
              held={listening === "hearing"}
              busy={listening === "finishing" || presence === "thinking"}
              onHoldStart={onHoldStart}
              onHoldEnd={onHoldEnd}
            />
          </div>
        </div>
      )}
      <div
        className={`mt-1.5 flex w-full items-end gap-1 rounded-[1.5rem] bg-card/90 px-1.5 py-1 shadow-[0_0_0_1px_var(--color-border),0_18px_40px_-24px_oklch(0.2_0.02_110/0.4)] backdrop-blur-sm transition-shadow duration-300 sm:mt-2 sm:rounded-[1.75rem] sm:px-2 sm:py-1.5 ${
          listening === "hearing"
            ? "shadow-[0_0_0_2px_var(--color-primary),0_18px_40px_-24px_oklch(0.55_0.15_118/0.55)]"
            : ""
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
          className="max-h-24 min-h-11 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted-foreground sm:max-h-28 sm:px-3"
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
      <div className="mt-1.5 text-center text-[0.62rem] text-muted-foreground sm:mt-2 sm:text-[0.7rem]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={status}
            initial={reduced ? false : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-center gap-2"
            aria-live="off"
          >
            {listeningLive && !holdMode && (
              <span className="size-1.5 rounded-full bg-primary shadow-[0_0_0_4px_oklch(0.79_0.175_118/0.2)]" />
            )}
            {status}
          </motion.p>
        </AnimatePresence>
        {notices.silentHint && (
          <p className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-accent-text">
            <span>Can't hear her? Turn the volume up and tap Play sound.</span>
            <button
              type="button"
              onClick={onPlaySound}
              className="rounded-full px-2.5 py-0.5 ring-1 ring-border transition-colors hover:bg-muted"
            >
              Play sound
            </button>
            <button
              type="button"
              onClick={onHearHer}
              className="rounded-full px-2.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted"
            >
              I can hear her
            </button>
          </p>
        )}
        <Notice show={notices.voiceFailed} icon={<VolumeX className="size-3" aria-hidden="true" />}>
          My voice didn't come through just now. The words are on screen.
        </Notice>
        <Notice
          show={notices.echoHint && mic.live}
          icon={<Headphones className="size-3" aria-hidden="true" />}
        >
          On speakers? Headphones make cutting in smoother.
        </Notice>
      </div>
    </div>
  );
}
