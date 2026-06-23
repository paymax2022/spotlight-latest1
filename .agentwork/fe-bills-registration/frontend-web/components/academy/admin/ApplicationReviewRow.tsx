'use client';

import { useState } from 'react';
import Link from 'next/link';
import { adminAuthHeaders } from '@/src/lib/auth/client';

const STATUS_COLORS: Record<string, string> = {
  pending:   'rgba(245,158,11,0.15)',
  approved:  'rgba(16,185,129,0.15)',
  rejected:  'rgba(239,68,68,0.15)',
  waitlisted:'rgba(99,102,241,0.15)',
};
const STATUS_TEXT: Record<string, string> = {
  pending:   '#f59e0b',
  approved:  '#10b981',
  rejected:  '#ef4444',
  waitlisted:'#6366f1',
};

export default function ApplicationReviewRow({
  application, batchId,
}: {
  application: {
    id: string; full_name: string; email: string; phone?: string;
    status: string; payment_status: string; application_fee_paid?: number;
    areas_of_interest?: string[]; created_at: string;
  };
  batchId: string;
}) {
  const [status, setStatus] = useState(application.status);
  const [busy, setBusy] = useState(false);

  async function update(newStatus: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/academy/applications/${application.id}`, {
        method: 'PATCH',
        headers: await adminAuthHeaders(true),
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) setStatus(newStatus);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '14px 20px', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{application.full_name}</p>
        <p style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 0 }}>
          {application.email} · {application.phone ?? ''}
        </p>
        {(application.areas_of_interest ?? []).length > 0 && (
          <p style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 3 }}>
            {(application.areas_of_interest ?? []).join(', ')}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Status badge */}
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
          background: STATUS_COLORS[status] ?? 'rgba(100,116,139,0.15)',
          color: STATUS_TEXT[status] ?? '#64748b',
        }}>{status}</span>

        {/* Payment status */}
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
          background: application.payment_status === 'paid' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
          color: application.payment_status === 'paid' ? '#10b981' : '#ef4444',
        }}>
          {application.payment_status === 'paid' ? '✓ Fee Paid' : 'Fee Pending'}
        </span>

        {/* Review actions */}
        {status === 'pending' && (
          <>
            <button
              onClick={() => update('approved')}
              disabled={busy}
              style={{ fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 7, border: 'none',
                background: 'rgba(16,185,129,0.15)', color: '#10b981', cursor: busy ? 'not-allowed' : 'pointer' }}
            >Approve</button>
            <button
              onClick={() => update('rejected')}
              disabled={busy}
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 7, border: 'none',
                background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: busy ? 'not-allowed' : 'pointer' }}
            >Reject</button>
          </>
        )}

        {status === 'approved' && (
          <button
            onClick={() => update('rejected')}
            disabled={busy}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--foreground-muted)', cursor: busy ? 'not-allowed' : 'pointer' }}
          >Revoke</button>
        )}

        <Link href={`/admin/film-academy/applications/${application.id}`}
          style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7,
            border: '1px solid var(--border)', color: 'var(--foreground-muted)', textDecoration: 'none' }}>
          View
        </Link>
      </div>

      <p style={{ fontSize: 11, color: 'var(--foreground-muted)', flexShrink: 0 }}>
        {new Date(application.created_at).toLocaleDateString('en-NG')}
      </p>
    </div>
  );
}
