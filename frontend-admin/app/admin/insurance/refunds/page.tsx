'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listRefunds, decideRefund, formatNaira } from '@/services/insuranceAdminService';
import type { RefundRequest } from '@/types/insuranceAdmin';
import {
  PageHeader, InsuranceTabs, Card, Badge, DisclosureNote, StateBlock,
  btn, btnPrimary, btnDanger, th, td, label, select, fmtDate,
} from '../_ui';

const STATUSES = ['all', 'pending', 'approved', 'rejected', 'paid'];
const PROVIDERS = ['all', 'mycover', 'octamile'];

export default function InsuranceRefundsPage() {
  const [rows, setRows] = useState<RefundRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [provider, setProvider] = useState('all');
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await listRefunds({
        status: status === 'all' ? undefined : status,
        provider: provider === 'all' ? undefined : provider,
      }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, provider]);

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setSubmittingId(id); setError(null);
    try {
      await decideRefund(id, { decision });
      await load();
    } catch (e) { setError(String(e)); }
    finally { setSubmittingId(null); }
  }

  const list = rows ?? [];

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Insurance — Refund & cancellation queue"
        subtitle="Cooling-off, cancellation, bind-failed and duplicate refunds. Approve or reject pending requests."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="finance" />

      <DisclosureNote>
        Refunds route back to the policyholder wallet via <strong>reversing ledger entries</strong> — balances are never edited directly.
      </DisclosureNote>

      <Card title="Refund requests" right={
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label style={label()}>Status</label>
            <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Provider</label>
            <select style={select()} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p === 'all' ? 'All providers' : p}</option>)}
            </select>
          </div>
        </div>
      }>
        <StateBlock loading={loading} error={error} empty={list.length === 0} emptyText="No refund requests.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>Reference</th><th style={th()}>Policy</th><th style={th()}>Provider</th>
                <th style={th()}>Reason</th><th style={th()}>Amount</th><th style={th()}>Policyholder</th>
                <th style={th()}>Status</th><th style={th()}>Requested</th><th style={th()}>Actions</th>
              </tr></thead>
              <tbody>
                {list.map((r) => {
                  const busy = submittingId === r.id;
                  return (
                    <tr key={r.id}>
                      <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.reference}</code></td>
                      <td style={td()}>
                        <Link href={`/admin/insurance/policies/${r.policy_id}`} style={{ color: '#340075', textDecoration: 'none' }}>{r.policy_id}</Link>
                      </td>
                      <td style={td()}><Badge status={r.provider} /></td>
                      <td style={td()}><Badge status="normal" label={r.reason.replace(/_/g, ' ')} /></td>
                      <td style={td()}>{formatNaira(r.amount_kobo)}</td>
                      <td style={td()}>{r.policyholder_masked}</td>
                      <td style={td()}><Badge status={r.status} /></td>
                      <td style={td()}>{fmtDate(r.requested_at)}</td>
                      <td style={td()}>
                        {r.status === 'pending' ? (
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button disabled={busy} onClick={() => decide(r.id, 'approved')} style={btnPrimary()}>{busy ? '…' : 'Approve'}</button>
                            <button disabled={busy} onClick={() => decide(r.id, 'rejected')} style={btnDanger()}>{busy ? '…' : 'Reject'}</button>
                          </div>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
