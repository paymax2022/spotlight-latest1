'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listClawbacks, executeClawbackOps, formatNaira } from '@/services/referralAdminOpsService';
import type { ClawbackRecord } from '@/types/referralAdminOps';
import { timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'pending', 'executing', 'recovered', 'failed'];

function badgeColor(status: string): string {
  switch (status) {
    case 'recovered':
      return colors.success;
    case 'failed':
      return colors.danger;
    case 'executing':
      return colors.warning;
    default:
      return colors.secondary;
  }
}

export default function ClawbacksPage() {
  const [rows, setRows] = useState<ClawbackRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [rewardId, setRewardId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listClawbacks(status)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function execute() {
    if (!rewardId.trim() || !reason.trim()) { setMsg('Reward ID and reason are required.'); return; }
    setBusy(true); setMsg(null);
    try {
      await executeClawbackOps(rewardId.trim(), reason.trim());
      setMsg('Clawback queued — reversing entries + audit event will post on the money-path.');
      setRewardId(''); setReason('');
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <PageHeader
        title="Risk — Clawback execution & history"
        subtitle="Trigger and track reward recoveries (A-RSK-05). Clawbacks post reversing ledger entries (never edits) with an audit event."
        actions={<Link href="/admin/referral/risk" className="vx-btn vx-btn--outline" style={{ textDecoration: 'none' }}>← Dashboard</Link>}
      />

      <Card title="Execute clawback" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12, alignItems: 'end', marginTop: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Reward ID</label>
            <Input value={rewardId} onChange={(e) => setRewardId(e.target.value)} placeholder="rwd_10044" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Reason</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Duplicate KYC identity" />
          </div>
          <Button variant="danger" disabled={busy} onClick={execute}>{busy ? '…' : 'Execute clawback'}</Button>
        </div>
        {msg && <p style={{ color: msg.startsWith('Clawback') ? colors.success : colors.danger, fontSize: 13, marginTop: 8 }}>{msg}</p>}
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Clawback history</h2>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
        </div>
        <div style={{ padding: 14 }}>
          {loading ? <p style={{ color: colors.muted }}>Loading…</p>
            : error ? <p style={{ color: colors.danger }}>{error}</p>
            : (!rows || rows.length === 0) ? <p style={{ color: colors.muted }}>No clawbacks.</p>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>Reward</th><th style={thCell}>Beneficiary</th><th style={thCell}>Amount</th>
                    <th style={thCell}>Recovered</th><th style={thCell}>Reason</th><th style={thCell}>Status</th><th style={thCell}>When</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <td style={tdCell}><code style={{ fontSize: 13 }}>{c.reward_id}</code></td>
                        <td style={tdCell}>{c.beneficiary_id}</td>
                        <td style={tdCell}>{formatNaira(c.amount_kobo)}</td>
                        <td style={tdCell}>{formatNaira(c.recovered_kobo)}</td>
                        <td style={tdCell}>{c.reason}</td>
                        <td style={tdCell}><Badge text={c.status} color={badgeColor(c.status)} /></td>
                        <td style={tdCell}>{timeAgo(c.created_at)}</td>
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
