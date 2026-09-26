import type { StoredLesson } from "@/lib/experience-store";
import {
  browserOutbox,
  flushOutbox,
  watchOutboxTriggers,
  worthKeeping,
  type LeadOutbox,
  type LeadOutcome,
  type LeadPayload,
  type LeadSyncResult,
} from "@/lib/lead-sync";
import type { Collected, WaitlistField } from "@/lib/mary.functions";
import type { WaitlistFields } from "@/lib/waitlist-store";

import { createSignal, type Signal } from "../signal/signal";
import type { SessionStore } from "./store";
import { closingCopy, fieldsKey, transcriptOf } from "./text";
import type { ConversationOutcome, ConversationResult } from "./types";

export type LeadLifecycleDeps = {
  store: SessionStore;
  sessionId: () => string;
  syncLead: (payload: LeadPayload) => Promise<LeadSyncResult>;
  beaconLead: (payload: LeadPayload) => void;
  /** Writes this visit's row in the browser; returns it as stored. */
  saveProgress: (id: string, fields: WaitlistFields) => { position: number };
  /** MARY's debrief; returns the lessons she wrote, or null. */
  reflect: (payload: LeadPayload) => Promise<StoredLesson[] | null>;
  addLessons: (lessons: StoredLesson[]) => void;
  context: () => {
    page: string;
    referrer: string;
    userAgent: string;
    language: string;
    timezone: string;
  };
  /**
   * A stable browser-side number sent as `localPosition` for the sheet's own
   * bookkeeping. It is never a waitlist position and never reaches the screen.
   */
  positionFor?: (seed: string) => number;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  /** Where an unconfirmed row waits. Defaults to this browser's localStorage. */
  outbox?: LeadOutbox;
  /** What the end screen reads about delivery. Defaults to the shared signal. */
  delivery?: Signal<LeadDelivery>;
  /**
   * A Retell call: the server already wrote the row, so this lifecycle never
   * takes over the page's retry, corrections, outbox or background flushes.
   */
  detached?: boolean;
};

/** Holds nothing: a detached lifecycle must never queue a row for /api/lead. */
const INERT_OUTBOX: LeadOutbox = {
  list: () => [],
  stash: () => {},
  failed: () => {},
  drop: () => {},
  clear: () => {},
};

const CHECKPOINT_MS = 5000;

/** What is known about getting this conversation's row to the sheet. */
export type LeadDelivery = {
  /** The sheet confirmed the row at least once. */
  saved: boolean;
  /** The sheet sent a confirmation to this address (its optional feature). */
  emailedTo: string;
  /** A delivery is running right now. */
  busy: boolean;
  /** Why the last attempt did not confirm: "not configured", "HTTP 500", "timeout"… */
  error: string;
  attempts: number;
};

export const IDLE_DELIVERY: LeadDelivery = {
  saved: false,
  emailedTo: "",
  busy: false,
  error: "",
  attempts: 0,
};

/** Delivery state of the conversation on this page; the end screen subscribes to it. */
export const leadDelivery = createSignal<LeadDelivery>(IDLE_DELIVERY);

/**
 * The lifecycle behind each store. React's development mode builds the
 * controller twice and keeps one, so "the last one made" is not reliable; the
 * store the screen renders from is.
 */
const byStore = new WeakMap<SessionStore, LeadLifecycle>();
/** The lifecycle the app last drove: the one whose store is on screen. */
let live: LeadLifecycle | null = null;
let triggersWatched = false;

function setLive(lifecycle: LeadLifecycle): void {
  live = lifecycle;
}

/** One watcher per page, whoever is live when it fires. */
function ensureTriggers(): void {
  if (triggersWatched) return;
  triggersWatched = true;
  watchOutboxTriggers(() => {
    void (live ? live.flushDue() : flushOutbox());
  });
}

/** "Try again" on the end screen: the final row goes to the sheet once more, backoff or not. */
export function retryLeadDelivery(store: SessionStore): Promise<void> {
  return byStore.get(store)?.resync({ force: true }) ?? Promise.resolve();
}

/**
 * The visitor fixed a misheard detail on the end screen: the corrected details
 * become the record, and the final row is sent again under the same session id.
 */
export function correctLeadDetails(store: SessionStore, collected: Collected): Promise<void> {
  store.dispatch({ type: "SET_COLLECTED", collected });
  return byStore.get(store)?.resync({ force: true }) ?? Promise.resolve();
}

/**
 * Everything about getting a lead safely to the sheet: every detail saved in the
 * browser at once, a checkpoint shortly after, the final row with the real
 * position, a beacon if the tab closes mid-call, an outbox for anything the
 * sheet did not confirm, and MARY's debrief.
 */
export class LeadLifecycle {
  private synced = { lines: 0, fields: "", outcome: "" };
  /** Their answer count at the last debrief, so she never reviews the same talk twice. */
  private reflectedAt = 0;
  private checkpoint = 0;
  private finished = false;
  /** How the conversation ended, once it has; what a re-send is about. */
  private final: ConversationOutcome | null = null;
  private delivering = false;
  /** A correction arrived while a delivery was running: send once more when it lands. */
  private dirty = false;
  private readonly outbox: LeadOutbox;
  private readonly delivery: Signal<LeadDelivery>;

  constructor(private readonly deps: LeadLifecycleDeps) {
    this.outbox = deps.detached ? INERT_OUTBOX : (deps.outbox ?? browserOutbox);
    this.delivery = deps.delivery ?? leadDelivery;
    this.delivery.set(IDLE_DELIVERY);
    this.claim();
    if (!deps.detached) ensureTriggers();
  }

  /** This lifecycle drives the page: retry, corrections and background flushes reach it. */
  private claim(): void {
    if (this.deps.detached) return;
    byStore.set(this.deps.store, this);
    setLive(this);
  }

  /** The row the sheet receives, built from what is known right now. */
  payload(outcome: LeadOutcome, extra: Partial<LeadPayload> = {}): LeadPayload {
    const { store, sessionId, now, context, positionFor } = this.deps;
    const state = store.get();
    const known = state.collected;
    const { voice, text } = state.source;
    return {
      sessionId: sessionId(),
      outcome,
      name: known.name ?? "",
      email: known.email ?? "",
      phone: known.phone ?? "",
      business: known.business ?? "",
      industry: known.industry ?? "",
      operations: known.operations ?? "",
      callbackRequested: outcome === "callback" || Boolean(state.flags.callback),
      transcript: transcriptOf(state.lines),
      turns: state.lines.filter((line) => line.role === "user").length,
      durationSec: state.startedAt ? Math.round((now() - state.startedAt) / 1000) : 0,
      source: voice && text ? "mixed" : voice ? "voice" : text ? "text" : "none",
      mode: state.flags.mode ?? "",
      startedAt: state.startedAt ? new Date(state.startedAt).toISOString() : "",
      ...context(),
      localPosition: positionFor ? positionFor(known.email || sessionId()) : 0,
      reflect: false,
      ...extra,
    };
  }

  /** Call after every change to the collected details. */
  onCollectedChanged(): void {
    this.claim();
    const deps = this.deps;
    const { store } = deps;
    const collected = store.get().collected;
    if (Object.keys(collected).length === 0) return;
    // Write through: a refresh mid-call loses nothing (and a correction on the
    // end screen lands here too; correctLeadDetails re-sends the row itself).
    deps.saveProgress(deps.sessionId(), collected);
    if (store.get().stage !== "call" || this.finished) return;
    // Someone who leaves mid-conversation still lands as a partial row.
    deps.clearTimer(this.checkpoint);
    this.checkpoint = deps.setTimer(() => {
      if (this.finished) return;
      this.markSynced("in_progress");
      void deps.syncLead(this.payload("in_progress"));
    }, CHECKPOINT_MS);
  }

  /** The conversation is over: end screen at once, then the sheet's answer, then the debrief. */
  async finalize(collected: Collected, outcome: ConversationOutcome): Promise<void> {
    this.claim();
    const deps = this.deps;
    const { store } = deps;
    this.finished = true;
    this.final = outcome;
    deps.clearTimer(this.checkpoint);
    store.dispatch({ type: "SET_COLLECTED", collected });
    deps.saveProgress(deps.sessionId(), {
      name: collected.name ?? "",
      email: collected.email ?? "",
      phone: collected.phone ?? "",
      business: collected.business ?? "",
      industry: collected.industry ?? "",
      operations: collected.operations ?? "",
      transcript: transcriptOf(store.get().lines),
      complete: outcome === "signed_up",
      callbackRequested: outcome === "callback",
    });
    store.dispatch({ type: "FINISH", outcome });

    const payload = this.payload(outcome);
    this.markSynced(outcome);
    this.delivering = true;
    let result: ConversationResult;
    try {
      result = await this.deliver(payload, outcome, null);
    } finally {
      this.delivering = false;
    }
    store.dispatch({ type: "SET_RESULT", result });
    if (this.dirty) void this.resync({ force: true });
    await this.debrief(payload);
  }

  /**
   * The final row goes to the sheet again: after a correction, on "Try again",
   * or when the browser gets another chance (online, tab visible). The screen
   * shows "pending" meanwhile and the honest outcome after. Without `force`
   * the outbox's backoff is respected.
   */
  async resync(opts: { force?: boolean } = {}): Promise<void> {
    const { store, sessionId, now } = this.deps;
    const state = store.get();
    if (!this.final || state.stage !== "done" || !state.result) return;
    if (this.delivering) {
      this.dirty = true;
      return;
    }
    if (!opts.force) {
      const waiting = this.outbox.list().find((entry) => entry.payload.sessionId === sessionId());
      if (!waiting || waiting.nextAt > now()) return;
    }
    const outcome = this.final;
    const previous = state.result;
    this.delivering = true;
    this.dirty = false;
    store.dispatch({ type: "SET_RESULT", result: { ...previous, sync: "pending" } });
    try {
      const payload = this.payload(outcome);
      this.markSynced(outcome);
      const result = await this.deliver(payload, outcome, previous.position);
      store.dispatch({ type: "SET_RESULT", result });
    } finally {
      this.delivering = false;
    }
    if (this.dirty) await this.resync({ force: true });
  }

  /**
   * Another chance came (page open, back online, tab visible): this
   * conversation's row first when it is due, then older rows from the outbox.
   */
  async flushDue(): Promise<void> {
    const { store, sessionId, syncLead, now } = this.deps;
    const state = store.get();
    const mine = sessionId();
    if (
      state.stage === "done" &&
      state.result &&
      (state.result.sync === "failed" || state.result.sync === "local")
    ) {
      await this.resync();
    }
    await flushOutbox({
      outbox: this.outbox,
      send: syncLead,
      // The running conversation writes its own row; the finished one was handled above.
      skip: (id) => id === mine && state.stage !== "landing",
      now,
    });
  }

  /** They changed their mind after declining — the call picks back up. */
  resume(): void {
    this.claim();
    this.finished = false;
    this.final = null;
    // What the declined row saved says nothing about the sign-up that may follow.
    this.delivery.set(IDLE_DELIVERY);
    this.deps.store.dispatch({ type: "RESUME" });
  }

  /** The tab is closing or going to the background mid-call. */
  flush(): void {
    this.claim();
    const state = this.deps.store.get();
    if (this.finished || (state.stage !== "call" && state.stage !== "fallback")) return;
    const turns = state.lines.filter((line) => line.role === "user").length;
    if (turns < 1) return;
    const fields = fieldsKey(state.collected);
    const already = this.synced;
    if (
      already.outcome === "abandoned" &&
      already.lines === state.lines.length &&
      already.fields === fields
    )
      return;
    const reflect = turns >= 2 && turns - this.reflectedAt >= 2;
    if (reflect) this.reflectedAt = turns;
    this.markSynced("abandoned");
    const payload = this.payload("abandoned", { reflect });
    // A beacon never reports back: the row waits in the outbox for the next visit as well.
    if (worthKeeping(payload)) this.outbox.stash(payload, this.deps.now());
    this.deps.beaconLead(payload);
  }

  dispose(): void {
    this.deps.clearTimer(this.checkpoint);
    if (live === this) live = null;
  }

  /**
   * One delivery of the final row. The row is in the outbox before the attempt
   * (a tab closed mid-flight still leaves it queued) and leaves it only when the
   * sheet says saved. A position is shown only when the sheet handed it out;
   * `keepPosition` is the one it handed out earlier in this conversation.
   */
  private async deliver(
    payload: LeadPayload,
    outcome: ConversationOutcome,
    keepPosition: number | null,
  ): Promise<ConversationResult> {
    const { syncLead, saveProgress, now } = this.deps;
    const keep = worthKeeping(payload);
    if (keep) this.outbox.stash(payload, now());
    const before = this.delivery.get();
    this.delivery.set({ ...before, busy: true });
    let synced: LeadSyncResult;
    try {
      synced = await syncLead(payload);
    } catch (error) {
      synced = {
        configured: true,
        saved: false,
        position: null,
        error: error instanceof Error ? error.message : "network",
      };
    }
    const attempts = before.attempts + 1;
    if (synced.saved) {
      this.outbox.drop(payload.sessionId);
      const position = synced.position ?? keepPosition;
      const emailedTo = synced.emailed && payload.email ? payload.email : before.emailedTo;
      saveProgress(payload.sessionId, {
        position: position ?? 0,
        syncedAt: new Date(now()).toISOString(),
        emailedTo,
      });
      this.delivery.set({ saved: true, emailedTo, busy: false, error: "", attempts });
      return { outcome, position, sync: "sheet" };
    }
    const error = synced.error ?? (synced.configured ? "not saved" : "not configured");
    if (keep) this.outbox.failed(payload.sessionId, error, now());
    this.delivery.set({ ...before, busy: false, error, attempts });
    return { outcome, position: keepPosition, sync: synced.configured ? "failed" : "local" };
  }

  private markSynced(outcome: string) {
    const state = this.deps.store.get();
    this.synced = { lines: state.lines.length, fields: fieldsKey(state.collected), outcome };
  }

  private async debrief(payload: LeadPayload): Promise<void> {
    if (payload.turns < 2 || payload.turns - this.reflectedAt < 2) return;
    this.reflectedAt = payload.turns;
    try {
      const lessons = await this.deps.reflect(payload);
      if (lessons?.length) this.deps.addLessons(lessons);
    } catch {
      // A missed debrief costs nothing but a lesson.
    }
  }
}

// ---------------------------------------------------------------------------
// Corrections on the end screen: what counts as a usable contact detail.
// ---------------------------------------------------------------------------

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Why a corrected value cannot be saved, or "" when it can. Phone may be cleared. */
export function detailProblem(field: WaitlistField, value: string): string {
  const trimmed = value.trim();
  switch (field) {
    case "name":
      if (!trimmed) return "Please add a name.";
      if (trimmed.length > 120) return "That name is too long.";
      return "";
    case "email":
      if (!EMAIL_SHAPE.test(trimmed) || trimmed.length > 200)
        return "That doesn't look like an email address.";
      return "";
    case "phone":
      if (!trimmed) return "";
      if ((trimmed.match(/\d/g) ?? []).length < 6 || trimmed.length > 60)
        return "That doesn't look like a phone number.";
      return "";
    default:
      return trimmed ? "" : "Please add a value.";
  }
}

// ---------------------------------------------------------------------------
// The honest words for how the delivery went: one view per case.
// ---------------------------------------------------------------------------

export type LeadStatusKind = "none" | "pending" | "position" | "saved" | "unsaved";

export type LeadOutcomeView = {
  eyebrow: string;
  title: string;
  body: string;
  steps: string[];
  status: { kind: LeadStatusKind; text: string; detail: string };
  /** The screen offers "Try again". */
  retry: boolean;
};

/**
 * What the end screen says, given the sheet's answer. A position appears only
 * when the sheet handed one out; "confirmed" only once it said saved; and a row
 * that never got there says so, warmly, with the way to fix it.
 */
export function leadOutcomeCopy(
  result: ConversationResult,
  delivery: LeadDelivery,
  collected: Collected,
): LeadOutcomeView {
  const firstName = (collected.name ?? "").trim().split(/\s+/)[0] ?? "";
  const who = firstName ? `, ${firstName}` : "";
  const phone = collected.phone ?? "";
  const base = closingCopy(result.outcome, firstName, phone);
  const none = { kind: "none" as const, text: "", detail: "" };
  const emailNote = delivery.emailedTo
    ? `A confirmation is on its way to ${delivery.emailedTo}.`
    : "";

  if (result.outcome === "declined") {
    return { ...base, status: none, retry: false };
  }

  const callback = result.outcome === "callback";
  const reason =
    delivery.error === "not configured"
      ? callback
        ? "the team's inbox isn't connected to this page yet"
        : "the list isn't taking sign-ups from this page yet"
      : callback
        ? "the team's inbox didn't answer just now"
        : "the list didn't answer just now";

  if (result.sync === "pending") {
    if (delivery.saved) {
      return {
        ...base,
        status: { kind: "pending", text: "Updating your details…", detail: "" },
        retry: false,
      };
    }
    return {
      eyebrow: callback ? "Callback requested" : "Early access",
      title: `One moment${who}.`,
      body: callback
        ? "MARY is passing your request to the Omnikom team."
        : "MARY is writing your details to the early-access list.",
      steps: base.steps,
      status: {
        kind: "pending",
        text: callback ? "Sending your request…" : "Securing your place…",
        detail: "",
      },
      retry: false,
    };
  }

  if (result.sync === "sheet") {
    if (callback) return { ...base, status: none, retry: false };
    if (result.position) {
      return {
        ...base,
        status: {
          kind: "position",
          text: `Early access position #${result.position}`,
          detail: emailNote,
        },
        retry: false,
      };
    }
    return {
      ...base,
      status: {
        kind: "saved",
        text: "Your details are with the team.",
        detail: emailNote || "Your invite goes to the email above when early access opens.",
      },
      retry: false,
    };
  }

  // The sheet did not confirm this attempt.
  if (delivery.saved) {
    return {
      ...base,
      status: {
        kind: "unsaved",
        text: callback
          ? "Your request is with the team, but the change you made hasn't gone through yet."
          : "Your spot is saved, but the change you made hasn't reached the list yet.",
        detail: "MARY will keep trying from this browser.",
      },
      retry: true,
    };
  }
  return {
    eyebrow: "Almost there",
    title: `Thanks${who} — one more step.`,
    body: callback
      ? `MARY has your number, but ${reason}, so your request hasn't reached the team. It's safe in this browser, and she'll keep trying.`
      : `MARY kept everything you told her, but ${reason}, so your spot isn't locked in. It's safe in this browser, and she'll keep trying.`,
    steps: [
      callback
        ? "Your request stays saved in this browser"
        : "Your details stay saved in this browser",
      "MARY retries on her own whenever you're back here — or tap Try again",
      callback
        ? phone
          ? `Once it goes through, a real person calls you on ${phone}`
          : "Once it goes through, a real person gets in touch"
        : "Once it goes through, you're on the list in order of sign-up",
    ],
    status: {
      kind: "unsaved",
      text: callback ? "Not with the team yet" : "Not on the list yet",
      detail: "",
    },
    retry: true,
  };
}
