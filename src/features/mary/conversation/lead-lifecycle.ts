import type { StoredLesson } from "@/lib/experience-store";
import type { LeadOutcome, LeadPayload, LeadSyncResult } from "@/lib/lead-sync";
import type { Collected } from "@/lib/mary.functions";
import type { WaitlistFields } from "@/lib/waitlist-store";

import type { SessionStore } from "./store";
import { fieldsKey, transcriptOf } from "./text";
import type { ConversationOutcome } from "./types";

export type LeadLifecycleDeps = {
  store: SessionStore;
  sessionId: () => string;
  syncLead: (payload: LeadPayload) => Promise<LeadSyncResult>;
  beaconLead: (payload: LeadPayload) => void;
  /** Writes this visit's row in the browser; returns it with its local position. */
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
  positionFor: (seed: string) => number;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
};

const CHECKPOINT_MS = 5000;

/**
 * Everything about getting a lead safely to the sheet: every detail saved in the
 * browser at once, a checkpoint shortly after, the final row with the real
 * position, a beacon if the tab closes mid-call, and MARY's debrief.
 */
export class LeadLifecycle {
  private synced = { lines: 0, fields: "", outcome: "" };
  /** Their answer count at the last debrief, so she never reviews the same talk twice. */
  private reflectedAt = 0;
  private checkpoint = 0;
  private finished = false;

  constructor(private readonly deps: LeadLifecycleDeps) {}

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
      localPosition: positionFor(known.email || sessionId()),
      reflect: false,
      ...extra,
    };
  }

  /** Call after every change to the collected details. */
  onCollectedChanged(): void {
    const deps = this.deps;
    const { store } = deps;
    const collected = store.get().collected;
    if (Object.keys(collected).length === 0) return;
    // Write through: a refresh mid-call loses nothing.
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
    const deps = this.deps;
    const { store } = deps;
    this.finished = true;
    deps.clearTimer(this.checkpoint);
    store.dispatch({ type: "SET_COLLECTED", collected });
    const entry = deps.saveProgress(deps.sessionId(), {
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
    let synced: LeadSyncResult;
    try {
      synced = await deps.syncLead(payload);
    } catch {
      synced = { configured: true, saved: false, position: null };
    }
    const result = !synced.configured
      ? { outcome, position: entry.position, sync: "local" as const }
      : synced.saved
        ? {
            outcome,
            position: synced.position ?? (outcome === "signed_up" ? entry.position : null),
            sync: "sheet" as const,
          }
        : { outcome, position: null, sync: "failed" as const };
    store.dispatch({ type: "SET_RESULT", result });
    await this.debrief(payload);
  }

  /** They changed their mind after declining — the call picks back up. */
  resume(): void {
    this.finished = false;
    this.deps.store.dispatch({ type: "RESUME" });
  }

  /** The tab is closing or going to the background mid-call. */
  flush(): void {
    const state = this.deps.store.get();
    if (this.finished || state.stage !== "call") return;
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
    this.deps.beaconLead(this.payload("abandoned", { reflect }));
  }

  dispose(): void {
    this.deps.clearTimer(this.checkpoint);
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
