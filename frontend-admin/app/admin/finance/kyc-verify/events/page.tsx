'use client';

// AK11 — Webhook / event monitor.
// RBAC: finance.admin.kyc. Wired to GET /api/finance/admin/kyc/events. Shows
// delivery, retries, dedupe and signature failures per provider. (Analytics such
// as per-provider delivery rate are a follow-up; this is the live event feed.)

import { useCallback, useEffect, useState } from 'react';
import { listEvents } from '@/services/kycAdminService';
import type { KycEvent } from '@/types/kycAdmin';
import { PageHeader, Card, btn, th, td, timeAgo, ScaffoldNotice } from '../_ui';

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  delivered:        { fg: '#15803d', bg: '#dcfce7' },
  retried:          { fg: '#9a3412', bg: '#ffedd5' },
  deduped:          { fg: '#1d4ed8', bg: '#dbeafe' },
  signature_failed: { fg: '#b91c1c', bg: '#fee2e2' },
};

function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
  return (
    <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function KycEventsPage() {
  const [rows, setRows] = useState<KycEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listEvents()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="KYC Webhook / Event Monitor (AK11)"
        subtitle="Provider webhook delivery, retries, dedupe and signature failures. RBAC: finance.admin.kyc (Compliance / Admin)."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />

      <ScaffoldNotice>
        Live event feed is wired to <code>GET /kyc/events</code>. Per-provider delivery-rate charts and retry drill-downs are follow-ups.
      </ScaffoldNotice>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card>
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading events…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No webhook events recorded.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Received</th>
                  <th style={th()}>Provider</th>
                  <th style={th()}>Event</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Attempts</th>
                  <th style={th()}>Signature</th>
                  <th style={th()}>Session</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td style={td()}>{timeAgo(e.received_at)}</td>
                    <td style={{ ...td(), textTransform: 'capitalize' }}>{e.provider}</td>
                    <td style={{ ...td(), fontFamily: 'monospace', fontSize: '0.8rem' }}>{e.event_type}</td>
                    <td style={td()}><StatusPill status={e.status} /></td>
                    <td style={td()}>{e.attempts ?? '—'}</td>
                    <td style={td()}>
                      {e.signature_valid === false
                        ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>Invalid</span>
                        : e.signature_valid
                          ? <span style={{ color: '#15803d' }}>Valid</span>
                          : '—'}
                    </td>
                    <td style={{ ...td(), fontFamily: 'monospace', fontSize: '0.8rem' }}>{e.session_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
