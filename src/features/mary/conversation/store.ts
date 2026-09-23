import { useSyncExternalStore } from "react";

import { initialState, reduce } from "./reducer";
import type { SessionAction, SessionState } from "./types";

/**
 * The one source of truth for a conversation. Code that runs between renders
 * (the turn queue, the microphone callbacks) reads `get()` and always sees the
 * current state — no copies in refs to keep in sync.
 */
export type SessionStore = {
  get: () => SessionState;
  dispatch: (action: SessionAction) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createSessionStore(initial: SessionState = initialState()): SessionStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    dispatch(action) {
      const next = reduce(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribe a component to one slice; it re-renders only when that slice changes. */
export function useSession<T>(store: SessionStore, select: (state: SessionState) => T): T {
  const read = () => select(store.get());
  return useSyncExternalStore(store.subscribe, read, read);
}
