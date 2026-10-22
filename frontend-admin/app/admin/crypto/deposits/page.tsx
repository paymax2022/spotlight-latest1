'use client';

import { useCallback, useEffect, useState } from 'react';
import { listDeposits } from '@/services/cryptoOpsService';
import type { CryptoDepositRow, CryptoDepositStatus } from '@/types/cryptoAdmin';
import { CryptoTabs, StateBlock, DisclosureNote, FilterBar, StatusBadge, fmtDate, label as lbl, select as selectStyle, mono } from '../_ui';
import { Page, PageHeader, Button, Card, colors, thCell, tdCell } from '@/components/ui/vuexy';

// Inbound crypto deposits on the provider rail. The provider credits each user's own
// sub-account; these rows are the platform's record, written only from a provider re-query
// (ADR-PR855). Read-only: a deposit is never edited from the console.

const short = (s: string, n = 10) => (s.length > n ? `${s.slice(0, n)}…` : s);

export default function CryptoDepositsPage() {
  const [status, setStatus] = useState<CryptoDepositStatus | ''>('');
  const [rows, setRows] = useState<CryptoDepositRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: CryptoDepositStatus | '') => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listDeposits(s));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(status); }, [load, status]);

  return (
    <Page>
      <PageHeader title="Crypto — Deposits" subtitle="Crypto customers sent to their Paymax deposit addresses, newest first (up to 200)."
        actions={<Button variant="outline" onClick={() => void load(status)}>Refresh</Button>} />
      <CryptoTabs active="deposits" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/deposits</code>. Each row is what the provider confirmed when re-queried, never a
        webhook payload. The provider credits the customer&apos;s own crypto account, so a deposit posts no ledger entries here.
      </DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={lbl()} htmlFor="dep-status">Status</label>
          <select id="dep-status" style={selectStyle()} value={status} onChange={(e) => setStatus(e.target.value as CryptoDepositStatus | '')}>
            <option value="">All</option>
            <option value="pending">Pending (confirming)</option>
            <option value="accepted">Credited</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0}
          emptyText={rows === null ? 'Deposits are unavailable: the swap pipeline is not running on this environment.' : 'No deposits match this filter.'}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr>
                <th style={thCell}>Received</th><th style={thCell}>Customer</th><th style={thCell}>Amount</th><th style={thCell}>Network</th>
                <th style={thCell}>Status</th><th style={thCell}>Confirmations</th><th style={thCell}>Transaction</th>
              </tr></thead>
              <tbody>
                {(rows ?? []).map((d) => (
                  <tr key={d.id}>
                    <td style={tdCell}>{fmtDate(d.created_at)}</td>
                    <td style={{ ...tdCell, ...mono() }} title={d.user_id}>{short(d.user_id)}</td>
                    <td style={{ ...tdCell, fontWeight: 600 }}>{d.amount} {d.asset}</td>
                    <td style={tdCell}>{d.network || '—'}</td>
                    <td style={tdCell}><StatusBadge status={d.status === 'accepted' ? 'confirmed' : d.status} /></td>
                    <td style={tdCell}>{d.required_confirmations ? `${d.confirmations} / ${d.required_confirmations}` : d.confirmations}</td>
                    <td style={{ ...tdCell, ...mono(), color: d.txid ? colors.text : colors.muted }} title={d.txid}>{d.txid ? short(d.txid, 14) : '—'}</td>
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
