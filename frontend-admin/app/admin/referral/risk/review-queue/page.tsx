'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listReviewQueue, decideReview, formatNaira } from '@/services/referralAdminOpsService';
import type { ReviewItem } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, btnPrimary, btnDanger, th, td, timeAgo, StateBlock } from '../../_ui';
import { ConfirmDialog } from '@/components/rbac/ConfirmDialog';

export default function ReviewQueuePage() {
  const [rows, setRows] = useState<ReviewItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ item: ReviewItem; decision: 'approved' | 'rejected' } | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listReviewQueue()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function askDecide(item: ReviewItem, decision: 'approved' | 'rejected') {
    setError(null);
    setPending({ item, decision });
  }

  async function confirmDecide(reason: string) {
    if (!pending) return;
    const { item, decision } = pending;
    setBusy(item.id);
    try {
      await decideReview(item.id, decision, reason);
      setRows((cur) => (cur ?? []).map((r) => r.id === item.id ? { ...r, status: decision } : r));
      setPending(null);
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Risk — Manual review queue"
        subtitle="Suspicious rewards held for manual review (A-RSK-07). Approve to release the payout, or reject to route to clawback."
        action={<Link href="/admin/referral/risk" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Dashboard</Link>}
      />

      <Card title="Held rewards">
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="Queue is empty.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Reward</th><th style={th()}>Beneficiary</th><th style={th()}>Amount</th>
              <th style={th()}>Risk</th><th style={th()}>Hold reason</th><th style={th()}>Rule</th><th style={th()}>When</th><th style={th()} />
            </tr></thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.reward_id}</code></td>
                  <td style={td()}>{r.beneficiary_id}</td>
                  <td style={td()}>{formatNaira(r.amount_kobo)}</td>
                  <td style={td()}><Badge status={r.risk_score >= 70 ? 'critical' : r.risk_score >= 40 ? 'high' : 'normal'} label={`${r.risk_score}`} /></td>
                  <td style={td()}>{r.hold_reason}</td>
                  <td style={td()}>{r.flagged_by_rule ? <code style={{ fontSize: '0.78rem' }}>{r.flagged_by_rule}</code> : '—'}</td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                  <td style={td()}>
                    {r.status === 'held' ? (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button disabled={busy === r.id} onClick={() => askDecide(r, 'approved')} style={btnPrimary()}>Release</button>
                        <button disabled={busy === r.id} onClick={() => askDecide(r, 'rejected')} style={btnDanger()}>Reject</button>
                      </div>
                    ) : <Badge status={r.status === 'approved' ? 'approved' : 'rejected'} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {pending ? (
        <ConfirmDialog
          open
          title={pending.decision === 'approved' ? 'Release held payout' : 'Reject held reward'}
          level="critical"
          description={
            pending.decision === 'approved'
              ? `Reward ${pending.item.reward_id} — releasing pays out ${formatNaira(pending.item.amount_kobo)} to ${pending.item.beneficiary_id}.`
              : `Reward ${pending.item.reward_id} — rejecting routes this held reward to clawback recovery.`
          }
          reasons={[
            pending.decision === 'approved'
              ? 'Releases the held reward for payout — money leaves the platform.'
              : 'Rejects the reward and routes it to clawback recovery.',
            'Separation of duties applies — enforced by the backend',
            'Recorded in the audit log with your name, reason and timestamp.',
          ]}
          requireReason
          reasonPlaceholder="Basis for this decision (recorded in the audit log)…"
          busy={busy === pending.item.id}
          confirmLabel={pending.decision === 'approved' ? 'Release payout' : 'Reject reward'}
          onConfirm={confirmDecide}
          onCancel={() => { if (!busy) setPending(null); }}
        />
      ) : null}
    </div>
  );
}
