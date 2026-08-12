'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listReviewQueue, decideReview, formatNaira } from '@/services/referralAdminOpsService';
import type { ReviewItem } from '@/types/referralAdminOps';
import { timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function riskBadgeColor(score: number): string {
  if (score >= 70) return colors.danger;
  if (score >= 40) return colors.warning;
  return colors.info;
}

function statusColor(status: string): string {
  return status === 'approved' ? colors.success : colors.danger;
}

export default function ReviewQueuePage() {
  const [rows, setRows] = useState<ReviewItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listReviewQueue()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function decide(item: ReviewItem, decision: 'approved' | 'rejected') {
    setBusy(item.id);
    try {
      await decideReview(item.id, decision, `Manual review ${decision}`);
      setRows((cur) => (cur ?? []).map((r) => r.id === item.id ? { ...r, status: decision } : r));
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader
        title="Risk — Manual review queue"
        subtitle="Suspicious rewards held for manual review (A-RSK-07). Approve to release the payout, or reject to route to clawback."
        actions={<Link href="/admin/referral/risk" className="vx-btn vx-btn--outline" style={{ textDecoration: 'none' }}>← Dashboard</Link>}
      />

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 14px 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Held rewards</h2>
        </div>
        <div style={{ padding: 14 }}>
          {loading ? <p style={{ color: colors.muted }}>Loading…</p>
            : error ? <p style={{ color: colors.danger }}>{error}</p>
            : (!rows || rows.length === 0) ? <p style={{ color: colors.muted }}>Queue is empty.</p>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>Reward</th><th style={thCell}>Beneficiary</th><th style={thCell}>Amount</th>
                    <th style={thCell}>Risk</th><th style={thCell}>Hold reason</th><th style={thCell}>Rule</th><th style={thCell}>When</th><th style={thCell} />
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td style={tdCell}><code style={{ fontSize: 13 }}>{r.reward_id}</code></td>
                        <td style={tdCell}>{r.beneficiary_id}</td>
                        <td style={tdCell}>{formatNaira(r.amount_kobo)}</td>
                        <td style={tdCell}><Badge text={`${r.risk_score}`} color={riskBadgeColor(r.risk_score)} /></td>
                        <td style={tdCell}>{r.hold_reason}</td>
                        <td style={tdCell}>{r.flagged_by_rule ? <code style={{ fontSize: 13 }}>{r.flagged_by_rule}</code> : '—'}</td>
                        <td style={tdCell}>{timeAgo(r.created_at)}</td>
                        <td style={tdCell}>
                          {r.status === 'held' ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <Button variant="primary" sm disabled={busy === r.id} onClick={() => decide(r, 'approved')}>Release</Button>
                              <Button variant="danger" sm disabled={busy === r.id} onClick={() => decide(r, 'rejected')}>Reject</Button>
                            </div>
                          ) : <Badge text={r.status === 'approved' ? 'approved' : 'rejected'} color={statusColor(r.status === 'approved' ? 'approved' : 'rejected')} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </Card>
    </Page>
  );
}
