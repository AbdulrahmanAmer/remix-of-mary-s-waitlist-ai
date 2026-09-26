import type { ListeningPhase, MicState, Notices, PresenceState } from "../conversation/types";

/**
 * Whose turn it is, as the composer shows it. One word of state drives the line
 * above the hold button, the button's colour and what a screen reader hears.
 */
export type Floor = "listening" | "hers-thinking" | "hers-speaking" | "yours";

export function floorFor(presence: PresenceState, listening: ListeningPhase): Floor {
  if (listening === "hearing") return "listening";
  if (listening === "finishing" || presence === "thinking") return "hers-thinking";
  if (presence === "speaking") return "hers-speaking";
  return "yours";
}

/** The line directly above the hold button (14px, never smaller). */
export function floorLine(floor: Floor, keyboard: boolean): string {
  switch (floor) {
    case "listening":
      return "Listening… let go when you're done";
    case "hers-thinking":
      return "MARY is thinking · hold to cut in";
    case "hers-speaking":
      return "MARY is talking · hold to cut in";
    default:
      return keyboard
        ? "Your turn — hold the button or the space bar"
        : "Your turn — hold to answer";
  }
}

/** Hands-free mode has no hold button, so one line under the box carries the state. */
export function handsFreeStatus(state: {
  presence: PresenceState;
  listening: ListeningPhase;
  micLive: boolean;
  micMuted: boolean;
}): string {
  const typingOnly = !state.micLive;
  if (state.presence === "speaking" && !state.micMuted)
    return typingOnly ? "MARY is speaking." : "MARY is speaking · just talk to cut in";
  if (state.listening === "hearing") return "Go ahead, I'm listening.";
  if (state.listening === "finishing") return "Got it. MARY is preparing her reply.";
  if (state.presence === "thinking") return "MARY is thinking…";
  if (state.micMuted) return "Your microphone is muted. Unmute to keep talking, or type.";
  return typingOnly
    ? "Type your reply, MARY is reading."
    : "MARY is listening. Just talk, she answers when you pause.";
}

export const NOTICE_TEXT = {
  missedHold: "Didn't catch that. Hold, speak close to the phone, and try again.",
  suggestTyping: "Loud in here? Type your answer below instead.",
  voiceFailed: "My voice didn't come through just now. The words are on screen.",
  echoHint: "On speakers? Headphones make cutting in smoother.",
  silentHint: "Can't hear her? Use the Play sound button.",
} as const;

/**
 * What the one always-mounted status region says: the most pressing notice, or
 * nothing. Live regions that are inserted already filled are often skipped by
 * screen readers, so the visual notices are decorative and this one talks.
 */
export function noticeAnnouncement(
  notices: Notices,
  mic: Pick<MicState, "live" | "error">,
): string {
  if (mic.error) return mic.error;
  if (notices.missedHold) return NOTICE_TEXT.missedHold;
  if (notices.suggestTyping) return NOTICE_TEXT.suggestTyping;
  if (notices.voiceFailed) return NOTICE_TEXT.voiceFailed;
  if (notices.silentHint) return NOTICE_TEXT.silentHint;
  if (notices.echoHint && mic.live) return NOTICE_TEXT.echoHint;
  return "";
}

/**
 * What a screen reader hears about her line. With her voice on, reading the
 * whole line would talk over her, so only the floor is announced; with voice
 * off (or when her audio failed) the words are the only channel.
 */
export function captionAnnouncement(state: {
  text: string | null;
  floor: Floor;
  voiceOff: boolean;
  voiceFailed: boolean;
}): string {
  if (!state.text) return "";
  if (state.voiceOff || state.voiceFailed) return `MARY: ${state.text}`;
  if (state.floor === "yours") return "Your turn";
  if (state.floor === "hers-speaking") return "MARY is speaking";
  return "";
}
