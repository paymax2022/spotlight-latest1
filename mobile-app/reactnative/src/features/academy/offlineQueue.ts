// ── Spotlight Academy — Offline queue + connectivity (Phase 0/1) ─────────────
// nfr.md: progress, attempts and reward-eligible events queue locally and
// reconcile on reconnect; sync is deterministic and idempotent. No NetInfo dep
// is available, so connectivity is a simulated, app-controlled flag (the
// offline banner exposes a toggle in mock mode). The queue is an in-memory stub
// — swap the store for AsyncStorage/SQLite + real sync later without changing
// call sites.

import { useSyncExternalStore } from 'react';

// ── Pending mutation queue (stub) ─────────────────────────────────────────────
export interface QueuedMutation {
  id: string;
  type: 'reward_earn' | 'attempt_answer' | 'progress' | 'attempt_submit';
  payload: Record<string, unknown>;
  ts: string;
}

let queue: QueuedMutation[] = [];

export function enqueue(item: Omit<QueuedMutation, 'id' | 'ts'>): QueuedMutation {
  const q: QueuedMutation = { ...item, id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ts: new Date().toISOString() };
  queue = [...queue, q];
  notify();
  return q;
}

export function pendingCount(): number {
  return queue.length;
}

/** Deterministic, idempotent drain. In mock mode it simply clears after a tick. */
export async function flushQueue(): Promise<number> {
  const n = queue.length;
  await new Promise((r) => setTimeout(r, 300));
  queue = [];
  notify();
  return n;
}

// ── Connectivity (simulated; server-authoritative semantics preserved) ────────
let offline = false;
const listeners = new Set<() => void>();

function notify() { listeners.forEach((l) => l()); }

export function setOffline(value: boolean) {
  offline = value;
  notify();
  if (!value) { void flushQueue(); }   // reconnect → drain queue
}

export function isOffline(): boolean { return offline; }

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook: live offline flag + pending count for banners. */
export function useConnectivity() {
  const snap = useSyncExternalStore(
    subscribe,
    () => `${offline}:${queue.length}`,
    () => `${offline}:${queue.length}`,
  );
  const [off, pending] = snap.split(':');
  return { offline: off === 'true', pendingCount: Number(pending), setOffline };
}
