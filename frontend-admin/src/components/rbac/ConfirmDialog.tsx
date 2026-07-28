'use client';

import { useEffect, useRef } from 'react';

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
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
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
        background: 'rgba(0,0,0,0.55)',
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
          background: '#111827',
          border: `1px solid ${accent[level]}`,
          borderRadius: 10,
          maxWidth: 460,
          width: '100%',
          padding: 18,
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        }}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: 16, color: accent[level] }}>{title}</h2>
        {reasons.length > 0 ? (
          <ul style={{ margin: '0 0 14px 0', paddingLeft: 18, fontSize: 13, color: '#cbd5e1', display: 'grid', gap: 6 }}>
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ background: 'transparent', border: '1px solid #374151', color: '#e5e7eb', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{ background: accent[level], border: 'none', color: '#0b0b0b', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
