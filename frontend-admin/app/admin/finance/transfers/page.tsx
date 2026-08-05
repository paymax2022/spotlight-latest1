'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  listTransfers,
  getProviderHealth,
  formatKobo,
} from '@/services/transfersAdminService';
import type {
  Transfer,
  ProviderHealth,
  TransferStatus,
  TransferProvider,
} from '@/types/transfersAdmin';
import { PageHeader, Card, btn, th, td, timeAgo, selectStyle } from './_ui';
import { StatusBadge, ProviderBadge } from './statusBadge';
import { Page, colors } from '@/components/ui/vuexy';

const STATUSES: Array<'' | TransferStatus> = ['', 'funds_reserved', 'awaiting_funding', 'funded', 'provider_initiated', 'successful', 'failed', 'reversed'];
const PROVIDERS: Array<'' | TransferProvider> = ['', 'paystack', 'monnify'];
const TYPES = ['', 'wallet_to_wallet', 'wallet_to_bank', 'bank_to_bank'] as const;

function HealthStrip({ health }: { health: ProviderHealth[] }) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
      {health.map((h) => (
        <div key={h.provider} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.5rem 0.9rem', background: colors.card }}>
          <span style={{ width: 9, height: 9, borderRadius: 9999, background: h.healthy ? colors.success : colors.danger, display: 'inline-block' }} />
          <strong style={{ textTransform: 'capitalize', fontSize: '0.9rem' }}>{h.provider}</strong>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: h.healthy ? '#15803d' : '#b91c1c', background: h.healthy ? '#dcfce7' : '#fee2e2', borderRadius: 9999, padding: '0.1rem 0.5rem' }}>
            {h.healthy ? 'Healthy' : 'Degraded'}
          </span>
          <span style={{ fontSize: '0.72rem', color: colors.muted }}>checked {timeAgo(h.last_checked)}</span>
        </div>
      ))}
    </div>
  );
}

export default function TransfersAdminPage() {
  const [rows, setRows] = useState<Transfer[]>([]);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | TransferStatus>('');
  const [provider, setProvider] = useState<'' | TransferProvider>('');
  const [type, setType] = useState<(typeof TYPES)[number]>('');

  const filters = useMemo(
    () => ({ status: status || undefined, provider: provider || undefined }),
    [status, provider],
  );

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [t, h] = await Promise.all([listTransfers(filters), getProviderHealth()]);
      setRows(t);
      setHealth(h);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  // Type filter is applied client-side (backend filters status/provider/source_type).
  const visible = useMemo(() => (type ? rows.filter((r) => r.type === type) : rows), [rows, type]);

  return (
    <Page style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Transfers"
        subtitle="Outbound transfers across Paystack / Monnify (wallet→bank, bank→bank, wallet→wallet). Amounts in kobo → Naira. RBAC: finance.admin.transfers."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />

      <HealthStrip health={health} />

      <Card>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as '' | TransferStatus)} style={selectStyle()}>
              {STATUSES.map((s) => <option key={s || 'all'} value={s}>{s ? s.replace(/_/g, ' ') : 'All'}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value as '' | TransferProvider)} style={selectStyle()}>
              {PROVIDERS.map((p) => <option key={p || 'all'} value={p}>{p || 'All'}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])} style={selectStyle()}>
              {TYPES.map((t) => <option key={t || 'all'} value={t}>{t ? t.replace(/_/g, ' ') : 'All'}</option>)}
            </select>
          </label>
        </div>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card>
        {loading ? (
          <p style={{ color: colors.muted }}>Loading transfers…</p>
        ) : visible.length === 0 ? (
          <p style={{ color: colors.muted }}>No transfers in this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Date</th>
                  <th style={th()}>Type</th>
                  <th style={th()}>Provider</th>
                  <th style={th()}>Destination</th>
                  <th style={th()}>Amount</th>
                  <th style={th()}>Fee</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Reference</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.id} style={{ cursor: 'pointer' }}>
                    <td style={td()}>{timeAgo(t.created_at)}</td>
                    <td style={td()}>{t.type.replace(/_/g, ' ')}</td>
                    <td style={td()}><ProviderBadge provider={t.provider} failoverFrom={t.failover_from} /></td>
                    <td style={td()}>
                      <div style={{ fontWeight: 600 }}>{t.bank_name} ••{t.account_number_last4}</div>
                      <div style={{ fontSize: '0.75rem', color: colors.muted }}>{t.account_name}</div>
                    </td>
                    <td style={td()}>{formatKobo(t.amount_kobo)}</td>
                    <td style={td()}>{formatKobo(t.fee_kobo)}</td>
                    <td style={td()}><StatusBadge status={t.status} /></td>
                    <td style={td()}>
                      <Link href={`/admin/finance/transfers/${t.id}`} style={{ color: colors.primary, textDecoration: 'none', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {t.reference} →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
