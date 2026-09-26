import type { ClientLesson } from "@/lib/experience-store";
import { isAbort } from "@/lib/mary-stream";
import type { Collected, MaryTurn, TurnFlags } from "@/lib/mary.functions";

import type { SessionStore } from "./store";
import {
  FALLBACK_AFTER_FAILURES,
  FALLBACK_LINE,
  OFFLINE_LINE,
  SNAG_LINES,
  endingFor,
  isNearRepeat,
  spokenLines,
  toMessages,
  uid,
} from "./text";
import type { ConversationOutcome } from "./types";

export type TurnRequest = {
  messages: { role: "user" | "assistant"; content: string }[];
  collected: Collected;
  flags: TurnFlags;
  experience?: ClientLesson[];
};

export type TurnRunnerDeps = {
  store: SessionStore;
  /**
   * Streams a turn; `onSay` fires as soon as the first beat is written. Rejects
   * when the turn produced nothing; an abort of `signal` is never a failure.
   */
  streamTurn: (
    request: TurnRequest,
    onSay: (text: string) => void,
    signal: AbortSignal,
  ) => Promise<MaryTurn>;
  /** The non-streaming path, used once when she is about to repeat herself. */
  retryTurn: (request: TurnRequest, signal: AbortSignal) => Promise<MaryTurn>;
  /** Voices a line and records it in the conversation; resolves when it ends or is cut off. */
  say: (text: string) => Promise<void>;
  /** A status line in her voice, on screen only: never spoken, never sent to the model. */
  aside: (text: string) => void;
  /** Ends her current line, keeping only the words that were heard. */
  stopSpeaking: () => void;
  /** A real cut-in is in progress: she must not start her next beat. */
  isHeld: () => boolean;
  wait: (ms: number) => Promise<void>;
  lessons: (industry?: string) => ClientLesson[];
  /** Her fixed opener, chosen from what she already knows about this visitor. */
  openingLine: (known: Collected) => string;
  /** The browser's view of the network; a turn waits for `whenOnline` instead of failing. */
  online?: () => boolean;
  /** Resolves once the browser is back online, or when `signal` aborts the wait. */
  whenOnline?: (signal: AbortSignal) => Promise<void>;
  onFinish: (collected: Collected, outcome: ConversationOutcome) => void;
  /** The newest turn has handed the floor back. */
  onSettled: () => void;
};

const REPEAT_NUDGE =
  "(You just repeated yourself. Say something completely different that reacts to me and moves us forward.)";

/**
 * MARY's turns, one at a time and in the order things were said. Every turn gets
 * a number; a turn overtaken by a newer message stops at its next step instead of
 * talking over it, and its request is dropped so the newer one never queues
 * behind a hung connection.
 */
export class TurnRunner {
  private chain: Promise<void> = Promise.resolve();
  private generation = 0;
  private interrupted = false;
  /** The request of the turn in flight, so a newer message can drop it. */
  private controller: AbortController | null = null;
  /** Messages accepted but not yet worked on. */
  private queued = 0;
  /** Turns in a row that produced nothing; a reply resets it. */
  private failures = 0;
  busy = false;

  constructor(private readonly deps: TurnRunnerDeps) {}

  /** Her welcome: a fixed line, spoken the moment the call opens, in the same queue as everything after it. */
  welcome(): Promise<void> {
    return this.enqueue(() => this.open());
  }

  /**
   * Something the person said or typed. It goes on screen at once and ends her
   * current line and the turn she was working on, so nothing they say can be
   * lost behind a request that never answers.
   */
  send(text: string, via: "voice" | "text"): Promise<void> {
    const clean = text.trim();
    const { store } = this.deps;
    if (!clean || store.get().stage !== "call") return this.chain;
    store.dispatch({ type: "NOTE_SOURCE", via });
    // Retry notices belong to the hold that failed, not to what they say next.
    store.dispatch({ type: "SET_NOTICE", key: "missedHold", value: false });
    store.dispatch({ type: "SET_NOTICE", key: "suggestTyping", value: false });
    this.interrupt();
    store.dispatch({ type: "SET_INTERIM", interim: "" });
    store.dispatch({ type: "ADD_LINE", line: { id: uid(), role: "user", text: clean } });
    this.busy = true;
    this.queued += 1;
    return this.enqueue(async () => {
      this.queued -= 1;
      if (store.get().stage !== "call") return;
      // Two messages in quick succession: the first turn already answered both.
      const last = store
        .get()
        .lines.filter((line) => !line.aside)
        .at(-1);
      if (!last || last.role !== "user") return;
      this.deps.stopSpeaking();
      await this.run();
    });
  }

  /**
   * The person took the floor (a real hold, not a tap): her current line stops
   * and the rest of this turn, including the follow-up, is never spoken.
   */
  interrupt(): void {
    this.interrupted = true;
    this.controller?.abort();
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

  private begin(): number {
    this.busy = true;
    this.interrupted = false;
    return ++this.generation;
  }

  /** Only the newest turn hands the floor back, and never with her still "thinking". */
  private settle(generation: number): void {
    if (this.generation !== generation || this.queued > 0) return;
    this.busy = false;
    const { store } = this.deps;
    if (store.get().presence === "thinking")
      store.dispatch({ type: "SET_PRESENCE", presence: "idle" });
    this.deps.onSettled();
  }

  /** The same status line twice in a row says nothing new. */
  private aside(text: string): void {
    const last = this.deps.store.get().lines.at(-1);
    if (last?.aside && last.text === text) return;
    this.deps.aside(text);
  }

  private async open(): Promise<void> {
    const { deps } = this;
    const { store } = deps;
    const generation = this.begin();
    const stale = () => this.generation !== generation || this.interrupted;
    try {
      const line = deps.openingLine(store.get().collected);
      await deps.say(line);
      if (stale()) return;
      // The opener always says who she is and what OmniSuite is; a returning
      // visitor heard it last time. Cut off, it resumes through /api/turn.
      store.dispatch({ type: "MERGE_FLAGS", flags: { introDone: true } });
    } finally {
      this.settle(generation);
    }
  }

  private async run(): Promise<void> {
    const { deps } = this;
    const { store } = deps;
    const generation = this.begin();
    const stale = () => this.generation !== generation || this.interrupted;
    const controller = new AbortController();
    this.controller = controller;
    const offline = () => Boolean(deps.online && !deps.online());

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (offline() && deps.whenOnline) {
          this.aside(OFFLINE_LINE);
          store.dispatch({ type: "SET_PRESENCE", presence: "idle" });
          await deps.whenOnline(controller.signal);
          if (stale()) return;
        }
        store.dispatch({ type: "SET_PRESENCE", presence: "thinking" });
        try {
          await this.turn(stale, controller.signal);
          this.failures = 0;
          return;
        } catch (error) {
          if (stale() || isAbort(error)) return;
          // The connection went away mid-request: not the service's doing.
          if (attempt === 0 && offline() && deps.whenOnline) continue;
          this.failures += 1;
          if (this.failures >= FALLBACK_AFTER_FAILURES) {
            // Apologising a third time would be the loop the person is stuck in.
            this.aside(FALLBACK_LINE);
            store.dispatch({ type: "ENTER_FALLBACK" });
            return;
          }
          await deps.say(SNAG_LINES[(this.failures - 1) % SNAG_LINES.length]!);
          return;
        }
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      this.settle(generation);
    }
  }

  /** One attempt at her reply. Throws when nothing came back. */
  private async turn(stale: () => boolean, signal: AbortSignal): Promise<void> {
    const { deps } = this;
    const { store } = deps;

    /** Beats the person heard all the way through this turn. */
    const heard: string[] = [];
    const deliver = async (text: string) => {
      await deps.say(text);
      // A cut-off marks the turn stale before the line resolves, so anything
      // that resolves without it was heard in full.
      if (!stale()) heard.push(text);
    };

    const current = store.get();
    const messages = toMessages(current.lines);
    const previous = spokenLines(current.lines);
    const repeats = (text: string) => previous.some((p) => isNearRepeat(p, text));
    const request: TurnRequest = {
      messages,
      collected: current.collected,
      flags: current.flags,
      experience: deps.lessons(current.collected.industry),
    };

    let firstBeat: Promise<void> | null = null;
    let turn = await deps.streamTurn(
      request,
      (text) => {
        if (stale() || repeats(text)) return;
        if (!firstBeat) firstBeat = deliver(text);
      },
      signal,
    );

    if (!stale() && !firstBeat && !turn.complete && repeats(turn.say)) {
      try {
        const fresh = await deps.retryTurn(
          {
            messages: [
              ...messages,
              { role: "assistant", content: turn.say },
              { role: "user", content: REPEAT_NUDGE },
            ],
            collected: current.collected,
            flags: current.flags,
          },
          signal,
        );
        if (!isNearRepeat(turn.say, fresh.say))
          turn = { ...fresh, collected: { ...turn.collected, ...fresh.collected } };
      } catch {
        // keep the original line if the retry fails
      }
    }

    // What they told her is theirs to keep, even when a hold overtook this turn.
    store.dispatch({
      type: "SET_COLLECTED",
      collected: { ...store.get().collected, ...turn.collected },
    });
    if (stale()) return;

    if (firstBeat) await firstBeat;
    // A line she already said is skipped only when the follow-up can carry the
    // turn by itself: a turn that says nothing leaves her "thinking" for good.
    else if (!repeats(turn.say) || !turn.followUp) await deliver(turn.say);
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
      if (!stale()) deps.onFinish(store.get().collected, ending);
    }
  }
}
