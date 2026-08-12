'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listPremiums, formatNaira } from '@/services/insuranceAdminService';
import type { PremiumTransaction } from '@/types/insuranceAdmin';
import { InsuranceTabs, StateBlock, DisclosureNote, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const PROVIDERS = ['all', 'mycover', 'octamile'];
const STATUSES = ['all', 'settled', 'pending', 'reversed', 'failed'];
const RECONCILED = ['all', 'reconciled', 'unreconciled'];

const fieldLabel = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 4 } as const;

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'settled' || s === 'reconciled') return colors.success;
  if (s === 'pending') return colors.warning;
  if (s === 'failed' || s === 'unmatched') return colors.danger;
  if (s === 'reversed') return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader
        title="Insurance — Premium transactions"
        subtitle="Every premium debit/credit on the money-path, with idempotency key and provider remittance reference."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InsuranceTabs active="finance" />

      <DisclosureNote>
        Premium is a <strong>pass-through liability</strong> remitted to the underwriter — it is <strong>not Paymax revenue</strong>.
        Only commission (separate ledger account) is recognised as income.
      </DisclosureNote>

      <Card title="Premiums">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 14 }}>
          <div>
            <label style={fieldLabel}>Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p === 'all' ? 'All providers' : p}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLabel}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLabel}>Reconciled</label>
            <select value={reconciled} onChange={(e) => setReconciled(e.target.value)}>
              {RECONCILED.map((r) => <option key={r} value={r}>{r === 'all' ? 'All' : r}</option>)}
            </select>
          </div>
        </div>

        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No premium transactions.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Reference</th><th style={thCell}>Policy</th><th style={thCell}>Provider</th>
                <th style={thCell}>Amount</th><th style={thCell}>Direction</th><th style={thCell}>Status</th>
                <th style={thCell}>Idempotency key</th><th style={thCell}>Remittance ref</th>
                <th style={thCell}>Reconciled</th><th style={thCell}>Created</th>
              </tr></thead>
              <tbody>
                {(rows ?? []).map((p) => (
                  <tr key={p.id}>
                    <td style={tdCell}><code style={{ fontSize: 12 }}>{p.reference}</code></td>
                    <td style={tdCell}>
                      <Link href={`/admin/insurance/policies/${p.policy_id}`} style={{ color: colors.primary, textDecoration: 'none' }}>{p.policy_id}</Link>
                    </td>
                    <td style={tdCell}><Badge text={p.provider} color={statusColor(p.provider)} /></td>
                    <td style={tdCell}>{formatNaira(p.amount_kobo)}</td>
                    <td style={tdCell}><Badge text={p.direction} color={p.direction === 'CREDIT' ? colors.success : colors.secondary} /></td>
                    <td style={tdCell}><Badge text={p.status} color={statusColor(p.status)} /></td>
                    <td style={tdCell}><code style={{ fontSize: 11, color: colors.muted }}>{p.idempotency_key}</code></td>
                    <td style={tdCell}>{p.provider_remittance_ref ? <code style={{ fontSize: 11 }}>{p.provider_remittance_ref}</code> : '—'}</td>
                    <td style={tdCell}><Badge text={p.reconciled ? 'reconciled' : 'unmatched'} color={p.reconciled ? colors.success : colors.danger} /></td>
                    <td style={tdCell}>{fmtDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </Page>
  );
}
