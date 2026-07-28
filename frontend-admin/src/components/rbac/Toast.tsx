'use client';

import { useCallback, useRef, useState } from 'react';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
};

let counter = 0;
function nextId(): string {
  counter += 1;
  return `t_${Date.now()}_${counter}`;
}

/**
 * Self-contained toast queue. Each page owns its own stack so we don't need a
 * global provider (avoids coordination with the shared admin layout).
 */
export function useToasts(autoDismissMs = 4500) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId();
      setToasts((list) => [...list, { id, kind, message }]);
      if (autoDismissMs > 0) {
        timers.current[id] = setTimeout(() => dismiss(id), autoDismissMs);
      }
      return id;
    },
    [autoDismissMs, dismiss],
  );

  const toast = {
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
    info: (m: string) => push('info', m),
    warning: (m: string) => push('warning', m),
  };

  return { toasts, toast, dismiss };
}

const kindStyles: Record<ToastKind, { bg: string; fg: string; border: string; label: string }> = {
  success: { bg: '#10331f', fg: '#7ee2a8', border: '#1f6b3f', label: 'Success' },
  error: { bg: '#3a1414', fg: '#ff9b9b', border: '#7a2222', label: 'Error' },
  info: { bg: '#13283d', fg: '#8fc4f5', border: '#235682', label: 'Info' },
  warning: { bg: '#3a2e10', fg: '#f3cd7a', border: '#7a611f', label: 'Warning' },
};

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="assertive"
      aria-atomic="false"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
      }}
    >
      {toasts.map((t) => {
        const s = kindStyles[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === 'error' || t.kind === 'warning' ? 'alert' : 'status'}
            style={{
              background: s.bg,
              color: s.fg,
              border: `1px solid ${s.border}`,
              borderRadius: 8,
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.5, paddingTop: 1 }}>
              {s.label}
            </span>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(t.id)}
              style={{ background: 'transparent', color: s.fg, border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
