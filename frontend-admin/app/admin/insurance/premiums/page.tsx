'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listPremiums, formatNaira } from '@/services/insuranceAdminService';
import type { PremiumTransaction } from '@/types/insuranceAdmin';
import {
  PageHeader, InsuranceTabs, Card, Badge, DisclosureNote, StateBlock,
  btn, th, td, input, label, select, fmtDate,
} from '../_ui';

const PROVIDERS = ['all', 'mycover', 'octamile'];
const STATUSES = ['all', 'settled', 'pending', 'reversed', 'failed'];
const RECONCILED = ['all', 'reconciled', 'unreconciled'];

export default function InsurancePremiumsPage() {
  const [rows, setRows] = useState<PremiumTransaction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState('all');
  const [status, setStatus] = useState('all');
  const [reconciled, setReconciled] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await listPremiums({
        provider: provider === 'all' ? undefined : provider,
        status: status === 'all' ? undefined : status,
        reconciled: reconciled === 'all' ? undefined : reconciled === 'reconciled',
      }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider, status, reconciled]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Insurance — Premium transactions"
        subtitle="Every premium debit/credit on the money-path, with idempotency key and provider remittance reference."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="finance" />

      <DisclosureNote>
        Premium is a <strong>pass-through liability</strong> remitted to the underwriter — it is <strong>not Paymax revenue</strong>.
        Only commission (separate ledger account) is recognised as income.
      </DisclosureNote>

      <Card title="Premiums" right={
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label style={label()}>Provider</label>
            <select style={select()} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p === 'all' ? 'All providers' : p}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Status</label>
            <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Reconciled</label>
            <select style={select()} value={reconciled} onChange={(e) => setReconciled(e.target.value)}>
              {RECONCILED.map((r) => <option key={r} value={r}>{r === 'all' ? 'All' : r}</option>)}
            </select>
          </div>
        </div>
      }>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No premium transactions.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>Reference</th><th style={th()}>Policy</th><th style={th()}>Provider</th>
                <th style={th()}>Amount</th><th style={th()}>Direction</th><th style={th()}>Status</th>
                <th style={th()}>Idempotency key</th><th style={th()}>Remittance ref</th>
                <th style={th()}>Reconciled</th><th style={th()}>Created</th>
              </tr></thead>
              <tbody>
                {(rows ?? []).map((p) => (
                  <tr key={p.id}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{p.reference}</code></td>
                    <td style={td()}>
                      <Link href={`/admin/insurance/policies/${p.policy_id}`} style={{ color: '#340075', textDecoration: 'none' }}>{p.policy_id}</Link>
                    </td>
                    <td style={td()}><Badge status={p.provider} /></td>
                    <td style={td()}>{formatNaira(p.amount_kobo)}</td>
                    <td style={td()}><Badge status={p.direction === 'CREDIT' ? 'active' : 'normal'} label={p.direction} /></td>
                    <td style={td()}><Badge status={p.status} /></td>
                    <td style={td()}><code style={{ fontSize: '0.72rem', color: '#6b7280' }}>{p.idempotency_key}</code></td>
                    <td style={td()}>{p.provider_remittance_ref ? <code style={{ fontSize: '0.72rem' }}>{p.provider_remittance_ref}</code> : '—'}</td>
                    <td style={td()}><Badge status={p.reconciled ? 'reconciled' : 'unmatched'} label={p.reconciled ? 'reconciled' : 'unmatched'} /></td>
                    <td style={td()}>{fmtDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
