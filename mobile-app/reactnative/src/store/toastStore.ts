import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  message?: string;
  /** ms before auto-dismiss; 0 keeps it up until tapped. */
  duration: number;
}

interface ToastState {
  toast: Toast | null;
  show: (input: {
    variant?: ToastVariant;
    title: string;
    message?: string;
    duration?: number;
  }) => void;
  dismiss: (id?: number) => void;
}

// Monotonic id so the host can re-run its enter animation for back-to-back
// toasts that happen to carry identical copy.
let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toast: null,

  show: ({ variant = 'info', title, message, duration = 4000 }) =>
    set({ toast: { id: nextId++, variant, title, message, duration } }),

  // Ignore stale dismissals: a timer from a superseded toast must not close
  // the one that replaced it.
  dismiss: (id) => {
    const current = get().toast;
    if (!current) return;
    if (id !== undefined && id !== current.id) return;
    set({ toast: null });
  },
}));

/** Imperative helper so non-React code (mutation callbacks) can raise a toast. */
export const showToast = (input: Parameters<ToastState['show']>[0]) =>
  useToastStore.getState().show(input);
