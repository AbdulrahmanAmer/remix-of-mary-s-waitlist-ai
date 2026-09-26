import type { SessionAction, SessionState } from "./types";

export function initialState(): SessionState {
  return {
    stage: "landing",
    startedAt: 0,
    lines: [],
    collected: {},
    flags: { revealed: false, lanesDone: false, introDone: false },
    result: null,
    presence: "idle",
    listening: "idle",
    interim: "",
    reveal: { id: "", count: 0 },
    mic: { live: false, muted: false, error: null, attempt: 0 },
    voiceOff: false,
    talkMode: "hold",
    via: "mary",
    notices: {
      echoHint: false,
      voiceFailed: false,
      silentHint: false,
      missedHold: false,
      suggestTyping: false,
    },
    source: { voice: false, text: false },
  };
}

/**
 * Every change to the conversation goes through here. It returns the same object
 * when nothing changed, so the store can skip waking the screen.
 */
export function reduce(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "START_CALL":
      if (state.stage === "call") return state;
      return { ...state, stage: "call", startedAt: state.startedAt || action.at };
    case "ADD_LINE":
      return { ...state, lines: [...state.lines, action.line] };
    case "UPSERT_LINE": {
      const i = state.lines.findIndex((line) => line.id === action.line.id);
      if (i < 0) return { ...state, lines: [...state.lines, action.line] };
      const old = state.lines[i]!;
      if (
        old.role === action.line.role &&
        old.text === action.line.text &&
        old.interrupted === action.line.interrupted
      )
        return state;
      const lines = state.lines.slice();
      lines[i] = action.line;
      return { ...state, lines };
    }
    case "CUT_LINE": {
      if (!state.lines.some((line) => line.id === action.id)) return state;
      const lines = action.spoken
        ? state.lines.map((line) =>
            line.id === action.id ? { ...line, text: action.spoken, interrupted: true } : line,
          )
        : state.lines.filter((line) => line.id !== action.id);
      return { ...state, lines };
    }
    case "SET_COLLECTED":
      return { ...state, collected: action.collected };
    case "MERGE_FLAGS":
      return { ...state, flags: { ...state.flags, ...action.flags } };
    case "SET_PRESENCE":
      return state.presence === action.presence ? state : { ...state, presence: action.presence };
    case "SET_LISTENING":
      return state.listening === action.listening
        ? state
        : { ...state, listening: action.listening };
    case "SET_INTERIM":
      return state.interim === action.interim ? state : { ...state, interim: action.interim };
    case "SET_REVEAL":
      return state.reveal.id === action.id && state.reveal.count === action.count
        ? state
        : { ...state, reveal: { id: action.id, count: action.count } };
    case "SET_MIC": {
      const mic = { ...state.mic, ...action.mic };
      const same = (Object.keys(mic) as (keyof typeof mic)[]).every((k) => mic[k] === state.mic[k]);
      return same ? state : { ...state, mic };
    }
    case "SET_TALK_MODE":
      return state.talkMode === action.mode ? state : { ...state, talkMode: action.mode };
    case "SET_VIA":
      return state.via === action.via ? state : { ...state, via: action.via };
    case "SET_VOICE_OFF":
      return state.voiceOff === action.off ? state : { ...state, voiceOff: action.off };
    case "SET_NOTICE":
      return state.notices[action.key] === action.value
        ? state
        : { ...state, notices: { ...state.notices, [action.key]: action.value } };
    case "NOTE_SOURCE":
      return state.source[action.via]
        ? state
        : { ...state, source: { ...state.source, [action.via]: true } };
    case "FINISH":
      return {
        ...state,
        stage: "done",
        presence: "done",
        interim: "",
        result: { outcome: action.outcome, position: null, sync: "pending" },
      };
    case "SET_RESULT":
      return state.stage === "done" ? { ...state, result: action.result } : state;
    case "RESUME":
      return { ...state, stage: "call", result: null, presence: "idle" };
    case "ENTER_FALLBACK":
      if (state.stage !== "call") return state;
      return { ...state, stage: "fallback", presence: "idle", listening: "idle", interim: "" };
  }
}
