'use client';

type Listener = (key: string) => void;

const listeners = new Set<Listener>();

/**
 * The hero's four "world" tiles choose which programme tab is showing, so the
 * tiles and the tablist — two separate sections of one page — share the
 * selection through this instead of a context the whole page would have to be
 * wrapped in. Only one tablist exists at a time, so a set is enough.
 */
export function onProgrammeSelect(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function selectProgramme(key: string): void {
  for (const listener of listeners) listener(key);
}
