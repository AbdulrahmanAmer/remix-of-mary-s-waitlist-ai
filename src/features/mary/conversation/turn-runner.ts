import type { ClientLesson } from "@/lib/experience-store";
import type { Collected, MaryTurn, TurnFlags } from "@/lib/mary.functions";

import type { SessionStore } from "./store";
import { endingFor, isNearRepeat, toMessages, uid } from "./text";
import type { ConversationOutcome } from "./types";

export type TurnRequest = {
  messages: { role: "user" | "assistant"; content: string }[];
  collected: Collected;
  flags: TurnFlags;
  experience?: ClientLesson[];
};

export type TurnRunnerDeps = {
  store: SessionStore;
  /** Streams a turn; `onSay` fires as soon as the first beat is written. */
  streamTurn: (request: TurnRequest, onSay: (text: string) => void) => Promise<MaryTurn>;
  /** The non-streaming path, used once when she is about to repeat herself. */
  retryTurn: (request: TurnRequest) => Promise<MaryTurn>;
  /** Voices a line and records it in the conversation; resolves when it ends or is cut off. */
  say: (text: string) => Promise<void>;
  /** Ends her current line, keeping only the words that were heard. */
  stopSpeaking: () => void;
  /** A real cut-in is in progress: she must not start her next beat. */
  isHeld: () => boolean;
  wait: (ms: number) => Promise<void>;
  lessons: (industry?: string) => ClientLesson[];
  onFinish: (collected: Collected, outcome: ConversationOutcome) => void;
  /** The newest turn has handed the floor back. */
  onSettled: () => void;
};

const SNAG = "I hit a snag on my side — could you try that once more?";
const REPEAT_NUDGE =
  "(You just repeated yourself. Say something completely different that reacts to me and moves us forward.)";

/**
 * MARY's turns, one at a time and in the order things were said. Every turn gets
 * a number; a turn overtaken by a newer message stops at its next step instead of
 * talking over it.
 */
export class TurnRunner {
  private chain: Promise<void> = Promise.resolve();
  private generation = 0;
  private interrupted = false;
  busy = false;

  constructor(private readonly deps: TurnRunnerDeps) {}

  /** Her welcome, in the same queue as everything after it. */
  welcome(): Promise<void> {
    return this.enqueue(() => this.run());
  }

  /** Something the person said or typed. It ends her current line at once. */
  send(text: string, via: "voice" | "text"): Promise<void> {
    const clean = text.trim();
    if (!clean) return this.chain;
    const { store } = this.deps;
    store.dispatch({ type: "NOTE_SOURCE", via });
    this.interrupted = true;
    this.deps.stopSpeaking();
    this.busy = true;
    return this.enqueue(async () => {
      if (store.get().stage === "done") return;
      this.deps.stopSpeaking();
      store.dispatch({ type: "SET_INTERIM", interim: "" });
      store.dispatch({ type: "ADD_LINE", line: { id: uid(), role: "user", text: clean } });
      await this.run();
    });
  }

  /**
   * The person took the floor (pressed hold to talk): her current line stops and
   * the rest of this turn, including the follow-up, is never spoken.
   */
  interrupt(): void {
    this.interrupted = true;
    this.deps.stopSpeaking();
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    // A turn's own failures are handled inside it; anything reaching here is a bug,
    // so it is logged rather than swallowed, and the queue keeps going.
    const run = this.chain.then(task).catch((error: unknown) => {
      console.error("[mary] turn queue", error);
    });
    this.chain = run;
    return run;
  }

  private async run(): Promise<void> {
    const { deps } = this;
    const { store } = deps;
    this.busy = true;
    this.interrupted = false;
    const generation = ++this.generation;
    const stale = () => this.generation !== generation || this.interrupted;
    store.dispatch({ type: "SET_PRESENCE", presence: "thinking" });

    /** Beats the person heard all the way through this turn. */
    const heard: string[] = [];
    const deliver = async (text: string) => {
      await deps.say(text);
      // A cut-off marks the turn stale before the line resolves, so anything
      // that resolves without it was heard in full.
      if (!stale()) heard.push(text);
    };

    try {
      const current = store.get();
      const messages = toMessages(current.lines);
      const previous = current.lines.filter((l) => l.role === "mary").map((l) => l.text);
      const request: TurnRequest = {
        messages,
        collected: current.collected,
        flags: current.flags,
        experience: deps.lessons(current.collected.industry),
      };

      let firstBeat: Promise<void> | null = null;
      let turn = await deps.streamTurn(request, (text) => {
        if (stale() || previous.some((p) => isNearRepeat(p, text))) return;
        if (!firstBeat) firstBeat = deliver(text);
      });
      if (stale()) return;

      if (!firstBeat && !turn.complete && previous.some((p) => isNearRepeat(p, turn.say))) {
        try {
          const fresh = await deps.retryTurn({
            messages: [
              ...messages,
              { role: "assistant", content: turn.say },
              { role: "user", content: REPEAT_NUDGE },
            ],
            collected: current.collected,
            flags: current.flags,
          });
          if (!isNearRepeat(turn.say, fresh.say))
            turn = { ...fresh, collected: { ...turn.collected, ...fresh.collected } };
        } catch {
          // keep the original line if the retry fails
        }
      }
      if (stale()) return;

      store.dispatch({ type: "SET_COLLECTED", collected: turn.collected });

      if (firstBeat) await firstBeat;
      // A streamed beat suppressed as a repeat must not slip back in here.
      else if (!previous.some((p) => isNearRepeat(p, turn.say))) await deliver(turn.say);
      if (stale()) return;

      if (turn.followUp && !deps.isHeld()) {
        await deps.wait(260);
        if (!stale() && !deps.isHeld()) await deliver(turn.followUp);
      }
      if (stale()) return;

      // The reveal, the lanes and the intro only count once they were heard in full.
      const heardText = heard.join(" ");
      const flags = store.get().flags;
      store.dispatch({
        type: "MERGE_FLAGS",
        flags: {
          revealed: flags.revealed || (turn.revealed && /convert/i.test(heardText)),
          lanesDone:
            flags.lanesDone ||
            (turn.lanesDone && /cultivate/i.test(heardText) && /recover/i.test(heardText)),
          introDone: flags.introDone || (turn.introDone && /omnisuite/i.test(heardText)),
          wrapAsked: flags.wrapAsked || turn.wrapAsked,
          callback: flags.callback || turn.callbackRequested,
          mode: turn.mode,
          rejected: turn.rejected,
        },
      });

      // Her last words stay on screen for a breath; if they speak in it, the call carries on.
      const ending = endingFor(turn);
      if (ending) {
        await deps.wait(1300);
        if (!stale()) deps.onFinish(turn.collected, ending);
      }
    } catch {
      if (!stale()) await deps.say(SNAG);
    } finally {
      // Only the newest turn hands the floor back.
      if (this.generation === generation) {
        this.busy = false;
        deps.onSettled();
      }
    }
  }
}
