'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getTransactions } from '@/services/fxAdminService';
import type { FxTxSummary, FxTxFilter, FxTxType, FxTxStatus, Provider } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, th, td, money } from '../_ui';

const TYPES: (FxTxType | 'all')[] = ['all', 'conversion', 'transfer', 'collection'];
const STATUSES: (FxTxStatus | 'all')[] = ['all', 'successful', 'processing', 'pending', 'failed', 'reversed'];
const PROVIDERS: (Provider | 'all')[] = ['all', 'eversend', 'maplerad'];

export default function FxTransactionsPage() {
  const [rows, setRows] = useState<FxTxSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<FxTxType | 'all'>('all');
  const [status, setStatus] = useState<FxTxStatus | 'all'>('all');
  const [provider, setProvider] = useState<Provider | 'all'>('all');
  const [search, setSearch] = useState('');

  const filter: FxTxFilter = useMemo(() => ({
    type: type === 'all' ? undefined : type,
    status: status === 'all' ? undefined : status,
    provider: provider === 'all' ? undefined : provider,
    search: search.trim() || undefined,
  }), [type, status, provider, search]);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getTransactions(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Transactions & Orders" subtitle="Unified explorer across customers, providers and corridors." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="transactions" />

      <Card>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Select label="Type" value={type} options={TYPES} onChange={(v) => setType(v as FxTxType | 'all')} />
          <Select label="Status" value={status} options={STATUSES} onChange={(v) => setStatus(v as FxTxStatus | 'all')} />
          <Select label="Provider" value={provider} options={PROVIDERS} onChange={(v) => setProvider(v as Provider | 'all')} />
          <input
            placeholder="Search reference or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' }}
          />
        </div>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading transactions…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No transactions match these filters.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Reference</th><th style={th()}>Type</th><th style={th()}>Customer</th><th style={th()}>Corridor</th><th style={th()}>Provider</th><th style={th()}>Amount</th><th style={th()}>Status</th><th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}><strong>{t.reference}</strong></td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{t.type}</td>
                  <td style={td()}>{t.customer}</td>
                  <td style={td()}>{t.corridor}</td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{t.provider}</td>
                  <td style={td()}>{money(t.source.amountMinor, t.source.currency)} → {money(t.destination.amountMinor, t.destination.currency)}</td>
                  <td style={td()}><Badge status={t.status} /></td>
                  <td style={{ ...td(), textAlign: 'right' }}><Link href={`/admin/fx/transactions/${t.id}`} style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
