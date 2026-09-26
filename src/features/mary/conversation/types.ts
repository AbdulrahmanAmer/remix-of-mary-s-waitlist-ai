import type { Collected, TurnFlags } from "@/lib/mary.functions";

export type Stage = "landing" | "call" | "done";

/** What the orb shows. */
export type PresenceState = "idle" | "listening" | "hearing" | "thinking" | "speaking" | "done";

export type ListeningPhase = "idle" | "listening" | "hearing" | "finishing" | "paused";

/**
 * How the person takes the floor. "hold": they hold the mic button while talking
 * (the room cannot trigger a turn). "hands-free": the open line decides.
 */
export type TalkMode = "hold" | "hands-free";

/** Who runs the voice call: MARY's own pipeline, or the Retell agent (hands-free only). */
export type VoiceVia = "mary" | "retell";

export type Line = {
  id: string;
  role: "user" | "mary";
  text: string;
  /** She was cut off; `text` holds only what was actually heard. */
  interrupted?: boolean;
};

export type ConversationOutcome = "signed_up" | "callback" | "declined";

export type ConversationResult = {
  outcome: ConversationOutcome;
  /** Confirmed by the sheet, or worked out locally when no sheet is connected. */
  position: number | null;
  sync: "pending" | "sheet" | "local" | "failed";
};

export type MicState = {
  live: boolean;
  muted: boolean;
  error: string | null;
  /** Bumped to ask the browser for the microphone all over again. */
  attempt: number;
};

export type Notices = {
  /** On speakers with strong echo: headphones make cutting in smoother. */
  echoHint: boolean;
  /** A line's audio never arrived. */
  voiceFailed: boolean;
  /** iPhone: a "Can't hear her?" way out, until they answer or when her voice had to move. */
  silentHint: boolean;
  /** A hold produced no words: "Didn't catch that". */
  missedHold: boolean;
  /** Two holds in a row produced nothing: typing is offered instead. */
  suggestTyping: boolean;
};

export type SessionState = {
  stage: Stage;
  startedAt: number;
  lines: Line[];
  collected: Collected;
  flags: TurnFlags;
  result: ConversationResult | null;
  presence: PresenceState;
  listening: ListeningPhase;
  /** Live caption of what the person is saying. */
  interim: string;
  /** How many words of a MARY line are revealed on screen. */
  reveal: { id: string; count: number };
  mic: MicState;
  /** "Voice off": she types instead of talking. */
  voiceOff: boolean;
  talkMode: TalkMode;
  via: VoiceVia;
  notices: Notices;
  /** Whether they spoke, typed, or both — kept for the record. */
  source: { voice: boolean; text: boolean };
};

export type SessionAction =
  | { type: "START_CALL"; at: number }
  | { type: "ADD_LINE"; line: Line }
  /** Adds the line, or replaces the one with the same id in place (a Retell turn growing). */
  | { type: "UPSERT_LINE"; line: Line }
  | { type: "CUT_LINE"; id: string; spoken: string }
  | { type: "SET_COLLECTED"; collected: Collected }
  | { type: "MERGE_FLAGS"; flags: Partial<TurnFlags> }
  | { type: "SET_PRESENCE"; presence: PresenceState }
  | { type: "SET_LISTENING"; listening: ListeningPhase }
  | { type: "SET_INTERIM"; interim: string }
  | { type: "SET_REVEAL"; id: string; count: number }
  | { type: "SET_MIC"; mic: Partial<MicState> }
  | { type: "SET_VOICE_OFF"; off: boolean }
  | { type: "SET_TALK_MODE"; mode: TalkMode }
  | { type: "SET_VIA"; via: VoiceVia }
  | { type: "SET_NOTICE"; key: keyof Notices; value: boolean }
  | { type: "NOTE_SOURCE"; via: "voice" | "text" }
  | { type: "FINISH"; outcome: ConversationOutcome }
  | { type: "SET_RESULT"; result: ConversationResult }
  | { type: "RESUME" };
