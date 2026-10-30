'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { decideKyc, getKycQueue } from '@/services/fxAdminService';
import type { FxKycDecision, FxKycSubmission } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge } from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

// Live queue behind GET /api/finance/admin/fx/verifications. Reads the same rows
// the customer's KYC submission writes, so a submission appears here immediately
// instead of only in the (sample-data) Customers table.

const FILTERS: { key: 'all' | FxKycSubmission['status']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'review', label: 'In review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

function statusTone(status: FxKycSubmission['status']): string {
  if (status === 'approved') return 'successful';
  if (status === 'rejected') return 'failed';
  if (status === 'review') return 'processing';
  return 'pending';
}

function when(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function FxKycQueuePage() {
  const [rows, setRows] = useState<FxKycSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | FxKycSubmission['status']>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getKycQueue());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );
  const awaiting = rows.filter((r) => r.status === 'pending' || r.status === 'review').length;

  async function decide(row: FxKycSubmission, decision: FxKycDecision) {
    let reason = '';
    if (decision === 'rejected') {
      // The customer is shown this text, so it cannot be blank.
      const entered = window.prompt(`Reject the KYC submission for ${row.email || row.customerId}? Enter the reason the customer will see:`);
      if (entered === null) return;
      reason = entered.trim();
      if (!reason) { setMsg('A rejection needs a reason.'); return; }
    } else if (!window.confirm(`Approve KYC for ${row.email || row.customerId}? This lifts their FX tier.`)) {
      return;
    }
    setBusy(row.customerId);
    setMsg(null);
    try {
      await decideKyc(row.customerId, decision, reason);
      setMsg(`${decision === 'approved' ? 'Approved' : 'Rejected'} ${row.email || row.customerId}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="KYC review queue"
        subtitle={`${awaiting} FX application${awaiting === 1 ? '' : 's'} awaiting review — these are live customer submissions.`}
        action={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <FxTabs active="kyc" />

      <Card>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <Button key={f.key} variant={filter === f.key ? 'primary' : 'outline'} onClick={() => setFilter(f.key)}>{f.label}</Button>
          ))}
        </div>
      </Card>

      {msg ? <Card><span style={{ fontSize: '0.85rem' }}>{msg}</span></Card> : null}

      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading…</p>
          : error ? <p style={{ color: colors.danger }}>{error}</p>
          : shown.length === 0 ? <p style={{ color: colors.muted }}>No submissions match this filter.</p>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                  <th style={thCell}>Customer</th><th style={thCell}>Type</th><th style={thCell}>Document</th>
                  <th style={thCell}>Submitted</th><th style={thCell}>Status</th><th style={thCell}>Reason</th><th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const decidable = r.status === 'pending' || r.status === 'review';
                  return (
                    <tr key={r.customerId} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={tdCell}>
                        <strong>{r.email || '(no email on file)'}</strong>
                        <div style={{ color: colors.muted, fontSize: '0.75rem' }}>{r.customerId}</div>
                      </td>
                      <td style={{ ...tdCell, textTransform: 'capitalize' }}>{r.accountType}</td>
                      <td style={tdCell}>
                        {r.legalName ? <div>{r.legalName}</div> : null}
                        <div style={{ color: colors.muted, fontSize: '0.78rem' }}>
                          {[r.docType?.replace(/_/g, ' '), r.idNumber].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </td>
                      <td style={tdCell}>{when(r.submittedAt)}</td>
                      <td style={tdCell}><Badge status={statusTone(r.status)} label={r.status} /></td>
                      <td style={{ ...tdCell, color: colors.muted, maxWidth: 240 }}>{r.rejectionReason || '—'}</td>
                      <td style={{ ...tdCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {decidable ? (
                          <>
                            <Button variant="primary" disabled={busy === r.customerId} onClick={() => decide(r, 'approved')}>Approve</Button>{' '}
                            <Button variant="outline" disabled={busy === r.customerId} onClick={() => decide(r, 'rejected')}>Reject</Button>
                          </>
                        ) : (
                          <span style={{ color: colors.muted, fontSize: '0.78rem' }}>Reviewed {when(r.reviewedAt)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </Card>
    </div>
  );
}
