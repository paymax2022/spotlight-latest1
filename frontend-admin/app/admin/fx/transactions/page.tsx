'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getTransactions } from '@/services/fxAdminService';
import type { FxTxSummary, FxTxFilter, FxTxType, FxTxStatus, Provider } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, money } from '../_ui';
import { Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
      <PageHeader title="Transactions & Orders" subtitle="Unified explorer across customers, providers and corridors." action={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <FxTabs active="transactions" />

      <Card>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Select label="Type" value={type} options={TYPES} onChange={(v) => setType(v as FxTxType | 'all')} />
          <Select label="Status" value={status} options={STATUSES} onChange={(v) => setStatus(v as FxTxStatus | 'all')} />
          <Select label="Provider" value={provider} options={PROVIDERS} onChange={(v) => setProvider(v as Provider | 'all')} />
          <Input
            placeholder="Search reference or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card>
        {loading ? (
          <p style={{ color: colors.muted }}>Loading transactions…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No transactions match these filters.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Reference</th><th style={thCell}>Type</th><th style={thCell}>Customer</th><th style={thCell}>Corridor</th><th style={thCell}>Provider</th><th style={thCell}>Amount</th><th style={thCell}>Status</th><th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}><strong>{t.reference}</strong></td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{t.type}</td>
                  <td style={tdCell}>{t.customer}</td>
                  <td style={tdCell}>{t.corridor}</td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{t.provider}</td>
                  <td style={tdCell}>{money(t.source.amountMinor, t.source.currency)} → {money(t.destination.amountMinor, t.destination.currency)}</td>
                  <td style={tdCell}><Badge status={t.status} /></td>
                  <td style={{ ...tdCell, textAlign: 'right' }}><Link href={`/admin/fx/transactions/${t.id}`} style={{ color: colors.info, textDecoration: 'none', fontWeight: 600 }}>Open →</Link></td>
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
    <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
