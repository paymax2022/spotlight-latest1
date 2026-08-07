// ── Spotlight Academy — Offline queue + connectivity (Phase 0/1, hardened) ────
// nfr.md: progress, attempts and reward-eligible events queue locally and
// reconcile on reconnect; sync is deterministic and idempotent.
//
// This module replaces the earlier in-memory stub with:
//   1. AsyncStorage-backed persistence  — queued events survive app restart
//      (versioned key + JSON serialization, write-through with a serialised lock).
//   2. Real connectivity via NetInfo    — subscribed on first use, with a manual
//      override retained for tests/dev (the offline toggle + banner still drive it).
//   3. Idempotent reconciliation        — on reconnect the queue flushes to the
//      backend /sync endpoint IN ORDER, each event carrying a stable idempotency
//      key (client_event_id). Backend 409/duplicate counts as success; transient
//      failures leave the event queued. No double-submission.
//
// Both native deps are OPTIONAL at runtime: if a package is not installed the
// module degrades gracefully — persistence falls back to memory-only and
// connectivity falls back to the app-controlled (manual) flag. The packages MUST
// be installed for the real behaviour (see the module footer note):
//   @react-native-async-storage/async-storage
//   @react-native-community/netinfo
//
// The public API (QueuedMutation, enqueue, pendingCount, flushQueue, setOffline,
// isOffline, useConnectivity) is preserved so existing call sites keep working.

import { useSyncExternalStore } from 'react';
import { api } from '@/api/client';
import { USE_MOCK, ACADEMY_API_BASE } from './constants';

// ── Optional native deps (guarded so the app still runs if not installed) ─────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AsyncStorage: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {
  AsyncStorage = null; // memory-only fallback
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let NetInfo: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  NetInfo = require('@react-native-community/netinfo').default ?? require('@react-native-community/netinfo');
} catch {
  NetInfo = null; // app-controlled connectivity fallback
}

// ── Storage + wire constants ──────────────────────────────────────────────────
const STORAGE_KEY = 'academy.offlineQueue.v1'; // versioned — bump on shape changes
const SYNC_PATH = `${ACADEMY_API_BASE}/sync`;
const MAX_ATTEMPTS = 8; // give up (park) an event after this many failed flushes

// Client → server event kind mapping (academy_sync_events.kind domain:
// progress | attempt_queued | reward_eligible).
const KIND_MAP: Record<QueuedMutation['type'], 'progress' | 'attempt_queued' | 'reward_eligible'> = {
  progress: 'progress',
  attempt_answer: 'progress',
  attempt_submit: 'attempt_queued',
  reward_earn: 'reward_eligible',
};

// ── Pending mutation queue ────────────────────────────────────────────────────
export interface QueuedMutation {
  id: string;
  type: 'reward_earn' | 'attempt_answer' | 'progress' | 'attempt_submit';
  payload: Record<string, unknown>;
  ts: string;
  /**
   * Stable idempotency key (client_event_id) carried to the backend so retries
   * de-duplicate. Reused when the caller already owns one (e.g. an attempt id);
   * otherwise generated and persisted at enqueue time. Optional in the public
   * type for backward-compat — always populated internally.
   */
  key?: string;
  /** Flush attempt counter (for backoff / parking). Optional for back-compat. */
  attempts?: number;
}

/** Input accepted by enqueue — key/attempts are optional and auto-populated. */
export type EnqueueInput = Omit<QueuedMutation, 'id' | 'ts' | 'key' | 'attempts'> & { key?: string };

let queue: QueuedMutation[] = [];
let hydrated = false;

// ── Connectivity state ────────────────────────────────────────────────────────
// effectiveOffline = manualOverride !== null ? manualOverride : !netOnline.
// A manual override (setOffline) always wins until NetInfo reports a real change,
// at which point the override is cleared so genuine connectivity resumes control.
let netOnline = true;            // optimistic until NetInfo says otherwise
let manualOverride: boolean | null = null;
let netInfoSubscribed = false;

function computeOffline(): boolean {
  return manualOverride !== null ? manualOverride : !netOnline;
}

// ── External-store plumbing (stable snapshot for useSyncExternalStore) ────────
const listeners = new Set<() => void>();
let snapshot = `${computeOffline()}:${queue.length}`;

function notify() {
  snapshot = `${computeOffline()}:${queue.length}`;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Lazily boot persistence + connectivity the first time anything observes us.
  void ensureHydrated();
  ensureNetInfo();
  return () => listeners.delete(cb);
}

// ── Persistence (write-through with a serialised lock) ────────────────────────
let writeChain: Promise<void> = Promise.resolve();

function persist(): Promise<void> {
  if (!AsyncStorage) return Promise.resolve(); // memory-only fallback
  const snapshotQueue = JSON.stringify(queue);
  writeChain = writeChain.then(async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, snapshotQueue);
    } catch {
      /* best-effort; keep the in-memory copy authoritative for the session */
    }
  });
  return writeChain;
}

let hydrating: Promise<void> | null = null;

function ensureHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    if (!AsyncStorage) { hydrated = true; return; }
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const stored: QueuedMutation[] = parsed.map((m: QueuedMutation) => ({
            ...m,
            key: m.key ?? genKey(m.type, m.payload),
            attempts: m.attempts ?? 0,
          }));
          // MERGE (not replace): keep any events enqueued before hydration
          // finished, deduping by stable key. Stored events keep their order.
          const seen = new Set<string>();
          const merged: QueuedMutation[] = [];
          for (const m of [...stored, ...queue]) {
            const k = m.key ?? m.id;
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push(m);
          }
          queue = merged;
        }
      }
    } catch {
      /* corrupt/absent store → keep whatever is in memory */
    }
    hydrated = true;
    notify();
    void persist();
    // Opportunistically reconcile anything left from a previous session.
    if (!computeOffline()) void flushQueue();
  })();
  return hydrating;
}

// ── NetInfo subscription (real connectivity) ──────────────────────────────────
function ensureNetInfo(): void {
  if (netInfoSubscribed || !NetInfo || typeof NetInfo.addEventListener !== 'function') return;
  netInfoSubscribed = true;
  try {
    NetInfo.addEventListener((state: { isConnected?: boolean | null; isInternetReachable?: boolean | null }) => {
      const online = state?.isInternetReachable ?? state?.isConnected ?? true;
      const wasOffline = computeOffline();
      netOnline = !!online;
      // A genuine connectivity signal clears any stale manual override so the
      // banner reflects reality (tests that never fire NetInfo keep their override).
      manualOverride = null;
      notify();
      if (wasOffline && !computeOffline()) void flushQueue(); // reconnect → drain
    });
    // Prime current state.
    if (typeof NetInfo.fetch === 'function') {
      NetInfo.fetch().then((state: { isConnected?: boolean | null; isInternetReachable?: boolean | null }) => {
        netOnline = !!(state?.isInternetReachable ?? state?.isConnected ?? true);
        notify();
      }).catch(() => { /* keep optimistic default */ });
    }
  } catch {
    netInfoSubscribed = false; // allow a later retry
  }
}

// ── Idempotency key generation ────────────────────────────────────────────────
function genKey(type: QueuedMutation['type'], payload: Record<string, unknown>): string {
  // Prefer a natural, stable key from the payload so the same logical event
  // (e.g. an attempt submit) collapses to one client_event_id across retries.
  const attemptId = typeof payload.attemptId === 'string' ? payload.attemptId : undefined;
  if (attemptId && (type === 'attempt_submit' || type === 'attempt_answer')) {
    return `${type}:${attemptId}`;
  }
  return `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Queue a mutation. Synchronous & offline-first: the event is added to the
 * in-memory queue immediately, persisted write-through, and (if online) a flush
 * is kicked off in the background. Retries are safe because each event carries a
 * stable idempotency key.
 */
export function enqueue(item: EnqueueInput): QueuedMutation {
  const q: QueuedMutation = {
    ...item,
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    key: item.key ?? genKey(item.type, item.payload),
    ts: new Date().toISOString(),
    attempts: 0,
  };
  queue = [...queue, q];
  notify();
  // Persist AFTER hydration so a cold-start enqueue never clobbers events that
  // were persisted in a previous session (hydration merges, then we write).
  if (hydrated) {
    void persist();
    if (!computeOffline()) void flushQueue();
  } else {
    void ensureHydrated().then(() => {
      void persist();
      if (!computeOffline()) void flushQueue();
    });
  }
  return q;
}

export function pendingCount(): number {
  return queue.length;
}

/**
 * Deterministic, idempotent drain. Flushes queued events to the backend /sync
 * endpoint IN ORDER. Each event is sent with its stable idempotency key; a 2xx
 * or a 409/duplicate both count as acknowledged and the event is removed.
 * Transient failures stop the drain (preserving order) and leave the remaining
 * events queued. Concurrency-guarded so overlapping calls never double-submit.
 *
 * @returns the number of events acknowledged (and removed) this pass.
 */
let flushing = false;
export async function flushQueue(): Promise<number> {
  await ensureHydrated();
  if (flushing) return 0;          // another drain owns the queue
  if (computeOffline()) return 0;  // don't attempt while offline
  if (queue.length === 0) return 0;

  flushing = true;
  let acked = 0;
  try {
    // Mock mode has no backend: reconcile deterministically by clearing.
    if (USE_MOCK) {
      acked = queue.length;
      queue = [];
      notify();
      await persist();
      return acked;
    }

    // Snapshot the ids to flush in order; mutate the live queue as we ack.
    const batch = [...queue];
    for (const ev of batch) {
      if (computeOffline()) break; // connectivity dropped mid-drain → stop
      const ok = await pushEvent(ev);
      if (ok) {
        queue = queue.filter((q) => q.id !== ev.id);
        acked++;
        notify();
        void persist();
      } else {
        // Transient failure: bump the attempt counter.
        const nextAttempts = (ev.attempts ?? 0) + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          // Poison event — drop it so it can't wedge the ordered queue forever,
          // and continue draining the rest.
          queue = queue.filter((q) => q.id !== ev.id);
          notify();
          void persist();
          continue;
        }
        // Otherwise keep it queued and stop to preserve ordering; the next
        // reconnect/flush will retry from here.
        queue = queue.map((q) => (q.id === ev.id ? { ...q, attempts: nextAttempts } : q));
        notify();
        void persist();
        break;
      }
    }
    return acked;
  } finally {
    flushing = false;
  }
}

/**
 * POST a single event to /sync with its idempotency key. Returns true when the
 * server acknowledges it (2xx) or reports it as already-seen (409/duplicate).
 * Returns false for transient failures (network/5xx) so the caller re-queues.
 */
async function pushEvent(ev: QueuedMutation): Promise<boolean> {
  const body = {
    clientEventId: ev.key,
    kind: KIND_MAP[ev.type],
    type: ev.type,
    payload: ev.payload,
    clientTs: ev.ts,
  };
  try {
    await api.post(SYNC_PATH, body, {
      headers: { 'Idempotency-Key': ev.key ?? ev.id },
    });
    return true;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    // 409 (duplicate) → the event was already reconciled: treat as success.
    if (status === 409) return true;
    // Any other 4xx (except 408/429) is a permanent rejection for THIS event —
    // parking it would wedge the ordered queue, so ack-drop it to make progress.
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return true;
    }
    // Network error / 5xx / 408 / 429 → transient, keep queued.
    return false;
  }
}

// ── Connectivity controls (manual override preserved for tests/dev) ───────────

/**
 * Manually set the offline flag. Retained so the in-app connectivity toggle and
 * the OfflineBanner "Reconnect" button keep working, and so tests can force a
 * state deterministically. The override wins until NetInfo reports a real change.
 * Going online triggers a queue drain.
 */
export function setOffline(value: boolean) {
  const wasOffline = computeOffline();
  manualOverride = value;
  notify();
  if (wasOffline && !computeOffline()) void flushQueue(); // reconnect → drain
}

export function isOffline(): boolean {
  return computeOffline();
}

/** React hook: live offline flag + pending count for banners. */
export function useConnectivity() {
  const snap = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  const [off, pending] = snap.split(':');
  return { offline: off === 'true', pendingCount: Number(pending), setOffline };
}

// ── Test / dev helpers (non-breaking additions) ───────────────────────────────
/** Force-initialise persistence + connectivity (e.g. from a root effect). */
export async function initOfflineQueue(): Promise<void> {
  await ensureHydrated();
  ensureNetInfo();
}

/** Snapshot of the current queue (read-only copy) — handy for tests/telemetry. */
export function getQueue(): QueuedMutation[] {
  return [...queue];
}

/** Reset all in-memory + persisted state. Test-only. */
export async function _resetForTests(): Promise<void> {
  queue = [];
  hydrated = false;
  hydrating = null;
  manualOverride = null;
  netOnline = true;
  flushing = false;
  notify();
  if (AsyncStorage) {
    try { await AsyncStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}
