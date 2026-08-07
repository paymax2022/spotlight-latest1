'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listRefunds, decideRefund, formatNaira } from '@/services/insuranceAdminService';
import type { RefundRequest } from '@/types/insuranceAdmin';
import { InsuranceTabs, DisclosureNote, StateBlock, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'pending', 'approved', 'rejected', 'paid'];
const PROVIDERS = ['all', 'mycover', 'octamile'];

const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 4 };

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'approved' || s === 'paid') return colors.success;
  if (s === 'pending') return colors.warning;
  if (s === 'rejected') return colors.danger;
  if (s === 'mycover' || s === 'octamile') return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader
        title="Insurance — Refund & cancellation queue"
        subtitle="Cooling-off, cancellation, bind-failed and duplicate refunds. Approve or reject pending requests."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InsuranceTabs active="finance" />

      <DisclosureNote>
        Refunds route back to the policyholder wallet via <strong>reversing ledger entries</strong> — balances are never edited directly.
      </DisclosureNote>

      <Card title="Refund requests">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 14 }}>
          <div>
            <label style={fieldLabel}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLabel}>Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p === 'all' ? 'All providers' : p}</option>)}
            </select>
          </div>
        </div>

        <StateBlock loading={loading} error={error} empty={list.length === 0} emptyText="No refund requests.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Reference</th><th style={thCell}>Policy</th><th style={thCell}>Provider</th>
                <th style={thCell}>Reason</th><th style={thCell}>Amount</th><th style={thCell}>Policyholder</th>
                <th style={thCell}>Status</th><th style={thCell}>Requested</th><th style={thCell}>Actions</th>
              </tr></thead>
              <tbody>
                {list.map((r) => {
                  const busy = submittingId === r.id;
                  return (
                    <tr key={r.id}>
                      <td style={tdCell}><code style={{ fontSize: 12 }}>{r.reference}</code></td>
                      <td style={tdCell}>
                        <Link href={`/admin/insurance/policies/${r.policy_id}`} style={{ color: colors.primary, textDecoration: 'none' }}>{r.policy_id}</Link>
                      </td>
                      <td style={tdCell}><Badge text={r.provider} color={statusColor(r.provider)} /></td>
                      <td style={tdCell}><Badge text={r.reason.replace(/_/g, ' ')} color={colors.info} /></td>
                      <td style={tdCell}>{formatNaira(r.amount_kobo)}</td>
                      <td style={tdCell}>{r.policyholder_masked}</td>
                      <td style={tdCell}><Badge text={r.status} color={statusColor(r.status)} /></td>
                      <td style={tdCell}>{fmtDate(r.requested_at)}</td>
                      <td style={tdCell}>
                        {r.status === 'pending' ? (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <Button variant="primary" sm disabled={busy} onClick={() => decide(r.id, 'approved')}>{busy ? '…' : 'Approve'}</Button>
                            <Button variant="danger" sm disabled={busy} onClick={() => decide(r.id, 'rejected')}>{busy ? '…' : 'Reject'}</Button>
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
    </Page>
  );
}
