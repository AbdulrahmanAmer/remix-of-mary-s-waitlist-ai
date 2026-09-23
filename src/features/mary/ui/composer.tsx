import { useState, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Headphones, Mic, MicOff, Send, VolumeX } from "lucide-react";

import type { SessionStore } from "../conversation/store";
import { useSession } from "../conversation/store";
import { QUICK } from "./motion";

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
          className="mt-1.5 flex items-center justify-center gap-1.5 text-accent-text"
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
}: {
  store: SessionStore;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  onMicButton: () => void;
  onPlaySound: () => void;
}) {
  const reduced = useReducedMotion();
  const [draft, setDraft] = useState("");
  const mic = useSession(store, (s) => s.mic);
  const presence = useSession(store, (s) => s.presence);
  const listening = useSession(store, (s) => s.listening);
  const notices = useSession(store, (s) => s.notices);
  const typingOnly = !mic.live;
  const status = statusFor({
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
      <div
        className={`mt-2 flex w-full items-end gap-1 rounded-[1.75rem] bg-card/90 px-2 py-1.5 shadow-[0_0_0_1px_var(--color-border),0_18px_40px_-24px_oklch(0.2_0.02_110/0.4)] backdrop-blur-sm transition-shadow duration-300 ${
          listening === "hearing"
            ? "shadow-[0_0_0_2px_var(--color-primary),0_18px_40px_-24px_oklch(0.55_0.15_118/0.55)]"
            : ""
        }`}
      >
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
            listeningLive ? "bg-primary text-ink" : "bg-muted text-muted-foreground hover:text-ink"
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
            !mic.live
              ? "Type your answer"
              : listening === "hearing"
                ? "I can hear you…"
                : listening === "finishing"
                  ? "Finishing your answer…"
                  : mic.muted
                    ? "Muted, type your answer"
                    : "Speak or type your answer"
          }
          className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-base text-ink outline-none placeholder:text-muted-foreground sm:text-sm"
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
      <div className="mt-2 text-center text-[0.7rem] text-muted-foreground">
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
            {listeningLive && (
              <span className="size-1.5 rounded-full bg-primary shadow-[0_0_0_4px_oklch(0.79_0.175_118/0.2)]" />
            )}
            {status}
          </motion.p>
        </AnimatePresence>
        {notices.silentHint && (
          <p className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-accent-text">
            <span>
              Can't hear her? Turn the ring switch on the side of your phone on, or plug in
              headphones.
            </span>
            <button
              type="button"
              onClick={onPlaySound}
              className="rounded-full px-2.5 py-0.5 ring-1 ring-border transition-colors hover:bg-muted"
            >
              Play sound
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
