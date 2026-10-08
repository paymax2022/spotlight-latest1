'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  level?: 'critical' | 'warning' | 'info';
  reasons?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

const accent: Record<NonNullable<ConfirmDialogProps['level']>, string> = {
  critical: colors.danger,
  warning: colors.warning,
  info: colors.info,
};

export function ConfirmDialog({
  open,
  title,
  level = 'warning',
  reasons = [],
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(47,43,61,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          border: `1px solid ${colors.border}`,
          borderTop: `3px solid ${accent[level]}`,
          borderRadius: 10,
          maxWidth: 460,
          width: '100%',
          padding: 20,
          boxShadow: '0 12px 44px rgba(47,43,61,0.24)',
        }}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: 16, color: accent[level] }}>{title}</h2>
        {reasons.length > 0 ? (
          <ul style={{ margin: '0 0 14px 0', paddingLeft: 18, fontSize: 13, color: colors.muted, display: 'grid', gap: 6, lineHeight: 1.5 }}>
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ background: '#fff', border: `1px solid ${colors.inputBorder}`, color: colors.text, borderRadius: 6, padding: '7px 15px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{ background: accent[level], border: 'none', color: '#fff', borderRadius: 6, padding: '7px 15px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
