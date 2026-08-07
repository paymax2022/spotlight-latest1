// ── Cross-platform confirm / alert ───────────────────────────────────────────
// React Native's `Alert.alert` is a silent no-op on react-native-web: no dialog
// renders and button `onPress` handlers never fire, so any confirmation gate
// (cast vote, log out, delete account…) silently blocks the action on the web
// build used for preview/testing.
//
// This module exposes promise-based helpers that work on both platforms:
//   • native → wraps `Alert.alert` (resolves true on confirm, false on cancel)
//   • web    → renders an in-app modal via <ConfirmHost/> (mounted at the app
//              root). If the host isn't mounted yet, it falls back to the
//              browser's window.confirm/window.alert so a call is never lost.
//
// Prefer these over raw `Alert.alert(...)` for any multi-button confirmation.

import { Alert, Platform } from 'react-native';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm action as destructive (red on native, danger on web). */
  destructive?: boolean;
}

export interface AlertOptions {
  title: string;
  message?: string;
  /** Label for the single dismiss button (default "OK"). */
  buttonLabel?: string;
}

/** An in-flight request rendered by the web <ConfirmHost/>. */
export interface ConfirmRequest {
  id: number;
  mode: 'confirm' | 'alert';
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
  resolve: (value: boolean) => void;
}

// ── Web request store ─────────────────────────────────────────────────────────
// A tiny module-level store so `confirmAsync`/`alertAsync` can be called from
// anywhere (not just React components) while <ConfirmHost/> renders the UI.

let listener: ((queue: ConfirmRequest[]) => void) | null = null;
let queue: ConfirmRequest[] = [];
let seq = 0;

/** Subscribe the host to pending requests. Returns an unsubscribe function. */
export function subscribeConfirm(fn: (queue: ConfirmRequest[]) => void): () => void {
  listener = fn;
  fn(queue);
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Called by the host when the user picks a button (or dismisses the backdrop). */
export function resolveConfirm(id: number, value: boolean): void {
  const req = queue.find((r) => r.id === id);
  queue = queue.filter((r) => r.id !== id);
  listener?.(queue);
  req?.resolve(value);
}

function enqueue(req: Omit<ConfirmRequest, 'id'>): boolean {
  if (!listener) return false; // host not mounted — caller should fall back
  const id = ++seq;
  queue = [...queue, { ...req, id }];
  listener(queue);
  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ask the user to confirm an action. Resolves `true` if they confirm, `false`
 * if they cancel or dismiss. Safe to `await` on both native and web.
 */
export function confirmAsync(opts: ConfirmOptions): Promise<boolean> {
  const confirmLabel = opts.confirmLabel ?? 'Confirm';
  const cancelLabel = opts.cancelLabel ?? 'Cancel';

  if (Platform.OS !== 'web') {
    return new Promise<boolean>((resolve) => {
      Alert.alert(
        opts.title,
        opts.message,
        [
          { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
          {
            text: confirmLabel,
            style: opts.destructive ? 'destructive' : 'default',
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }

  return new Promise<boolean>((resolve) => {
    const queued = enqueue({
      mode: 'confirm',
      title: opts.title,
      message: opts.message,
      confirmLabel,
      cancelLabel,
      destructive: !!opts.destructive,
      resolve,
    });
    if (!queued) {
      // Minimal fallback if the host isn't available (SSR / early boot).
      const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(opts.message ? `${opts.title}\n\n${opts.message}` : opts.title)
        : true;
      resolve(ok);
    }
  });
}

/**
 * Show a single-button informational alert. Resolves once dismissed. Safe to
 * `await` on both native and web.
 */
export function alertAsync(opts: AlertOptions): Promise<void> {
  const buttonLabel = opts.buttonLabel ?? 'OK';

  if (Platform.OS !== 'web') {
    return new Promise<void>((resolve) => {
      Alert.alert(
        opts.title,
        opts.message,
        [{ text: buttonLabel, onPress: () => resolve() }],
        { cancelable: true, onDismiss: () => resolve() },
      );
    });
  }

  return new Promise<void>((resolve) => {
    const queued = enqueue({
      mode: 'alert',
      title: opts.title,
      message: opts.message,
      confirmLabel: buttonLabel,
      cancelLabel: buttonLabel,
      destructive: false,
      resolve: () => resolve(),
    });
    if (!queued) {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(opts.message ? `${opts.title}\n\n${opts.message}` : opts.title);
      }
      resolve();
    }
  });
}
