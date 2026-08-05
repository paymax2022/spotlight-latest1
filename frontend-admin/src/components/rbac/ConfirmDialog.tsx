'use client';

import { useEffect, useRef, useState } from 'react';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  level?: 'critical' | 'warning' | 'info';
  /** Consequence bullets shown to the operator before they confirm. */
  reasons?: string[];
  /** Optional body text above the bullets. */
  description?: string;
  /** Require the operator to type a justification (captured for the audit trail). */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  minReasonLength?: number;
  /**
   * Maker-checker: this action needs a second approver. The dialog reframes the CTA
   * as "submit for approval" and warns that the operator cannot self-approve. NOTE:
   * true dual-control is enforced by the backend (the approver is a different
   * authenticated user and the maker cannot approve their own request) — this flag
   * only drives the UI; the page must route onConfirm to the approval endpoint.
   */
  dualControl?: boolean;
  /** Disable the controls while the action is in flight. */
  busy?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Receives the typed reason (empty string when requireReason is false). */
  onConfirm: (reason: string) => void;
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
  description,
  requireReason = false,
  reasonLabel = 'Reason (recorded in the audit log)',
  reasonPlaceholder = 'Why are you taking this action?',
  minReasonLength = 4,
  dualControl = false,
  busy = false,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) {
      setReason('');
      return;
    }
    // Focus the reason field when it's required, otherwise the confirm button.
    (requireReason ? reasonRef.current : confirmRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, requireReason, busy]);

  if (!open) return null;

  const reasonOk = !requireReason || reason.trim().length >= minReasonLength;
  const canConfirm = reasonOk && !busy;
  const cta = confirmLabel ?? (dualControl ? 'Submit for approval' : 'Confirm');

  const submit = () => {
    if (!canConfirm) return;
    onConfirm(reason.trim());
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={busy ? undefined : onCancel}
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

        {description ? (
          <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>{description}</p>
        ) : null}

        {reasons.length > 0 ? (
          <ul style={{ margin: '0 0 14px 0', paddingLeft: 18, fontSize: 13, color: '#cbd5e1', display: 'grid', gap: 6 }}>
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : null}

        {dualControl ? (
          <div
            style={{
              margin: '0 0 14px 0',
              padding: '8px 10px',
              borderRadius: 6,
              background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.4)',
              fontSize: 12.5,
              color: '#fbbf24',
            }}
          >
            Dual-control: a second operator must approve this. You are submitting a request — you cannot approve your own.
          </div>
        ) : null}

        {requireReason ? (
          <label style={{ display: 'block', margin: '0 0 14px 0' }}>
            <span style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 5 }}>{reasonLabel}</span>
            <textarea
              ref={reasonRef}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              style={{
                width: '100%',
                resize: 'vertical',
                background: '#0b1220',
                border: '1px solid #374151',
                borderRadius: 6,
                color: '#e5e7eb',
                fontSize: 13,
                padding: '8px 10px',
                fontFamily: 'inherit',
              }}
            />
          </label>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{ background: 'transparent', border: '1px solid #374151', color: '#e5e7eb', borderRadius: 6, padding: '6px 14px', cursor: busy ? 'not-allowed' : 'pointer', fontSize: 13, opacity: busy ? 0.6 : 1 }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={submit}
            disabled={!canConfirm}
            style={{
              background: accent[level],
              border: 'none',
              color: '#0b0b0b',
              borderRadius: 6,
              padding: '6px 14px',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: 700,
              opacity: canConfirm ? 1 : 0.5,
            }}
          >
            {busy ? 'Working…' : cta}
          </button>
        </div>
      </div>
    </div>
  );
}
