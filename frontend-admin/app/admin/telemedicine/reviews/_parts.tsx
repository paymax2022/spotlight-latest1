'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { colors } from '@/components/ui/vuexy';
import { btn, btnDanger, btnPrimary, input, label } from '../_ui';
import type { ModerationEvent } from '@/services/telemedAdminReviewsService';
import { ACTION_LABEL } from '@/services/telemedAdminReviewsService';

export function ReviewsTabs({ active }: { active: 'reviews' | 'disputes' }) {
  const tabs = [
    { href: '/admin/telemedicine/reviews', label: 'All reviews', key: 'reviews' },
    { href: '/admin/telemedicine/reviews/disputes', label: 'Disputes & reports', key: 'disputes' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          style={{
            textDecoration: 'none',
            padding: '0.3rem 0.7rem',
            borderRadius: '0.375rem',
            fontSize: '0.82rem',
            fontWeight: 600,
            color: active === t.key ? colors.primary : colors.muted,
            border: `1px solid ${active === t.key ? colors.primary : colors.border}`,
            background: colors.card,
          }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function Stars({ rating }: { rating: number | null }) {
  if (rating === null) return <span style={{ color: colors.muted }}>—</span>;
  return (
    <span title={`${rating} / 5`} aria-label={`${rating} out of 5`} style={{ color: rating <= 2 ? colors.danger : colors.warning, letterSpacing: 1 }}>
      {'★'.repeat(rating)}
      <span style={{ color: colors.border }}>{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-label={title}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: '0.5rem',
        background: colors.card,
        padding: '1rem',
        marginBottom: '1.25rem',
        boxShadow: '0 2px 8px rgba(47,43,61,0.08)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: colors.text }}>{title}</h2>
        <button style={btn()} onClick={onClose}>Close</button>
      </div>
      {children}
    </div>
  );
}

export function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{name}</div>
      <div style={{ fontSize: '0.88rem', color: colors.text, whiteSpace: 'pre-wrap' }}>{children}</div>
    </div>
  );
}

export function History({ events }: { events: ModerationEvent[] }) {
  if (events.length === 0) return <p style={{ color: colors.muted, fontSize: '0.82rem' }}>No moderation history.</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem', color: colors.text }}>
      {events.map((e, i) => (
        <li key={i} style={{ marginBottom: '0.2rem' }}>
          <strong>{ACTION_LABEL[e.action] ?? e.action}</strong> — {e.reason || 'no reason recorded'}{' '}
          <span style={{ color: colors.muted }}>
            · {new Date(e.at).toLocaleString('en-NG')} · by {e.actor.slice(0, 8)}…
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Reason form shared by hide/unhide/resolve. The backend requires 5-500
 * characters; the button stays disabled until that is met so the operator never
 * sends a request that is certain to be refused.
 */
export function ReasonForm({
  actions,
  busy,
  error,
  placeholder = 'Why? This is stored in the audit trail.',
}: {
  actions: { label: string; tone?: 'primary' | 'danger' | 'plain'; run: (reason: string) => void }[];
  busy: boolean;
  error: string | null;
  placeholder?: string;
}) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const valid = trimmed.length >= 5 && trimmed.length <= 500;
  return (
    <div style={{ marginTop: '0.75rem' }}>
      <label style={label()} htmlFor="mod-reason">Reason</label>
      <textarea
        id="mod-reason"
        style={{ ...input(), minHeight: 64, fontFamily: 'inherit' }}
        value={reason}
        maxLength={500}
        placeholder={placeholder}
        onChange={(e) => setReason(e.target.value)}
      />
      <div style={{ fontSize: '0.72rem', color: colors.muted, margin: '0.2rem 0 0.5rem' }}>
        {trimmed.length}/500 · at least 5 characters
      </div>
      {error ? <p style={{ color: colors.danger, fontSize: '0.82rem', margin: '0 0 0.5rem' }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {actions.map((a) => (
          <button
            key={a.label}
            disabled={!valid || busy}
            style={{ ...(a.tone === 'danger' ? btnDanger() : a.tone === 'primary' ? btnPrimary() : btn()), opacity: !valid || busy ? 0.55 : 1 }}
            onClick={() => a.run(trimmed)}
          >
            {busy ? 'Working…' : a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
