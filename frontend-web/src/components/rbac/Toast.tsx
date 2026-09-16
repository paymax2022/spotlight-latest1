'use client';

import { useCallback, useRef, useState } from 'react';
import { colors } from '@/components/ui/vuexy';

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

const kindStyles: Record<ToastKind, { accent: string; label: string }> = {
  success: { accent: colors.success, label: 'Success' },
  error: { accent: colors.danger, label: 'Error' },
  info: { accent: colors.info, label: 'Info' },
  warning: { accent: colors.warning, label: 'Warning' },
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
              background: '#fff',
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderLeft: `3px solid ${s.accent}`,
              borderRadius: 8,
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              boxShadow: '0 4px 16px rgba(47,43,61,0.16)',
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.5, paddingTop: 2, color: s.accent }}>
              {s.label}
            </span>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(t.id)}
              style={{ background: 'transparent', color: colors.muted, border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
