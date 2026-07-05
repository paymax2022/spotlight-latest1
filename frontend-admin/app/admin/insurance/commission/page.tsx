'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listCommission, formatNaira } from '@/services/insuranceAdminService';
import type { CommissionEntry } from '@/types/insuranceAdmin';
import {
  PageHeader, InsuranceTabs, Card, Kpi, Badge, DisclosureNote, StateBlock,
  btn, th, td, label, select, fmtDate,
} from '../_ui';

const PROVIDERS = ['all', 'mycover', 'octamile'];
const RECONCILED = ['all', 'reconciled', 'unreconciled'];

export default function InsuranceCommissionPage() {
  const [rows, setRows] = useState<CommissionEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState('all');
  const [reconciled, setReconciled] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await listCommission({
        provider: provider === 'all' ? undefined : provider,
        reconciled: reconciled === 'all' ? undefined : reconciled === 'reconciled',
      }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider, reconciled]);

  const list = rows ?? [];
  const totalCommission = list.reduce((sum, c) => sum + c.commission_amount_kobo, 0);
  const reconciledCount = list.filter((c) => c.reconciled).length;
  const reversedCount = list.filter((c) => c.reversed).length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Insurance — Commission ledger"
        subtitle="Paymax commission revenue recognised per policy bind, with reconciliation and reversal state."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="finance" />

      <DisclosureNote>
        Commission lives on a <strong>separate ledger account</strong> from premium — premium is a pass-through liability,
        commission is recognised Paymax income.
      </DisclosureNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total commission" value={formatNaira(totalCommission)} accent="#340075" />
        <Kpi label="Reconciled" value={String(reconciledCount)} sub={`of ${list.length} entries`} accent="#15803d" />
        <Kpi label="Reversed" value={String(reversedCount)} accent={reversedCount > 0 ? '#7c3aed' : undefined} />
      </div>

      <Card title="Commission entries" right={
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label style={label()}>Provider</label>
            <select style={select()} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p === 'all' ? 'All providers' : p}</option>)}
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
        <StateBlock loading={loading} error={error} empty={list.length === 0} emptyText="No commission entries.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>ID</th><th style={th()}>Policy</th><th style={th()}>Premium tx</th>
                <th style={th()}>Provider</th><th style={th()}>Commission</th><th style={th()}>Basis</th>
                <th style={th()}>Revenue ledger</th><th style={th()}>Reconciled</th>
                <th style={th()}>Reversed</th><th style={th()}>Created</th>
              </tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{c.id}</code></td>
                    <td style={td()}>
                      <Link href={`/admin/insurance/policies/${c.policy_id}`} style={{ color: '#340075', textDecoration: 'none' }}>{c.policy_id}</Link>
                    </td>
                    <td style={td()}><code style={{ fontSize: '0.72rem', color: '#6b7280' }}>{c.premium_transaction_id}</code></td>
                    <td style={td()}><Badge status={c.provider} /></td>
                    <td style={td()}>{formatNaira(c.commission_amount_kobo)}</td>
                    <td style={td()}>{c.commission_basis}</td>
                    <td style={td()}><code style={{ fontSize: '0.72rem' }}>{c.revenue_ledger_ref}</code></td>
                    <td style={td()}><Badge status={c.reconciled ? 'reconciled' : 'unmatched'} label={c.reconciled ? 'reconciled' : 'unmatched'} /></td>
                    <td style={td()}>{c.reversed ? <Badge status="reversed" label="reversed" /> : '—'}</td>
                    <td style={td()}>{fmtDate(c.created_at)}</td>
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
