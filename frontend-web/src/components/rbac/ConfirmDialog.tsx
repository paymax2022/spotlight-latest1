'use client';

import { useEffect, useRef } from 'react';
import { colors } from '@/components/ui/vuexy';

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
