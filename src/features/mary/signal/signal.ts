/**
 * A value that lives outside React. Things that change every frame (her voice
 * level) go through here, so the page never re-renders just because sound moved;
 * the orb reads it inside its own animation loop.
 */
export type Signal<T> = {
  get: () => T;
  set: (next: T) => void;
  subscribe: (listener: (value: T) => void) => () => void;
};

export function createSignal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const listener of listeners) listener(value);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Loudness of whoever is speaking right now, 0..1: her voice or the microphone. */
export const voiceLevel = createSignal(0);
