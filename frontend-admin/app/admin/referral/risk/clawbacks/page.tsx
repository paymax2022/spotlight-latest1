'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listClawbacks, executeClawbackOps, formatNaira } from '@/services/referralAdminOpsService';
import type { ClawbackRecord } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, btnDanger, input, label, th, td, timeAgo, StateBlock } from '../../_ui';

const STATUSES = ['all', 'pending', 'executing', 'recovered', 'failed'];

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Risk — Clawback execution & history"
        subtitle="Trigger and track reward recoveries (A-RSK-05). Clawbacks post reversing ledger entries (never edits) with an audit event."
        action={<Link href="/admin/referral/risk" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Dashboard</Link>}
      />

      <Card title="Execute clawback">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem', alignItems: 'end' }}>
          <div>
            <label style={label()}>Reward ID</label>
            <input style={input()} value={rewardId} onChange={(e) => setRewardId(e.target.value)} placeholder="rwd_10044" />
          </div>
          <div>
            <label style={label()}>Reason</label>
            <input style={input()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Duplicate KYC identity" />
          </div>
          <button disabled={busy} onClick={execute} style={btnDanger()}>{busy ? '…' : 'Execute clawback'}</button>
        </div>
        {msg && <p style={{ color: msg.startsWith('Clawback') ? '#15803d' : '#b91c1c', fontSize: '0.8rem', marginTop: '0.5rem' }}>{msg}</p>}
      </Card>

      <Card title="Clawback history" right={
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
        </select>
      }>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No clawbacks.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Reward</th><th style={th()}>Beneficiary</th><th style={th()}>Amount</th>
              <th style={th()}>Recovered</th><th style={th()}>Reason</th><th style={th()}>Status</th><th style={th()}>When</th>
            </tr></thead>
            <tbody>
              {(rows ?? []).map((c) => (
                <tr key={c.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{c.reward_id}</code></td>
                  <td style={td()}>{c.beneficiary_id}</td>
                  <td style={td()}>{formatNaira(c.amount_kobo)}</td>
                  <td style={td()}>{formatNaira(c.recovered_kobo)}</td>
                  <td style={td()}>{c.reason}</td>
                  <td style={td()}><Badge status={c.status === 'recovered' ? 'resolved' : c.status === 'failed' ? 'rejected' : c.status === 'executing' ? 'high' : 'pending'} label={c.status} /></td>
                  <td style={td()}>{timeAgo(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
