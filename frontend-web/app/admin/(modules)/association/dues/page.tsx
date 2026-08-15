'use client';

import { useEffect, useState } from 'react';
import { getAssociationFinance, listOfflinePayments, decideOfflinePayment, formatNaira, type AssociationFinance, type OfflinePayment } from '@/services/associationAdminService';
import { AssociationTabs, Kpi, DisclosureNote, StateBlock, FilterBar, AuditNote, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string) {
  if (status === 'approved') return colors.success;
  if (status === 'rejected') return colors.danger;
  return colors.warning;
}

export default function DuesPage() {
  const [fin, setFin] = useState<AssociationFinance | null>(null);
  const [rows, setRows] = useState<OfflinePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [f, o] = await Promise.all([getAssociationFinance(), listOfflinePayments({ status: status || undefined })]);
      setFin(f); setRows(o);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(o: OfflinePayment, decision: 'approve' | 'reject') {
    const note = window.prompt(`${decision === 'approve' ? 'Approve' : 'Reject'} offline payment ${formatNaira(o.amount_kobo)} from ${o.member_masked}? Optional note:`) ?? undefined;
    setBusy(o.id); setMsg(null);
    try { const res = await decideOfflinePayment(o.id, decision, note); setMsg(`${res.message} (audit ${res.audit_id})`); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Dues & finance" subtitle="Dues collection summary and offline (bank-transfer / cash) payment review." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <AssociationTabs active="dues" />
      <DisclosureNote>Approving an offline payment posts a balanced double-entry ledger entry (NL-8). Every decision is recorded to the immutable audit log (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={error} empty={!fin} emptyText="No finance data available.">
        {fin && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Dues outstanding" value={formatNaira(fin.dues_outstanding_kobo)} accent={fin.dues_outstanding_kobo > 0 ? colors.warning : undefined} />
            <Kpi label="Dues collected (30d)" value={formatNaira(fin.dues_collected_30d_kobo)} accent={colors.primary} />
            <Kpi label="Offline pending" value={formatNaira(fin.offline_pending_kobo)} />
            <Kpi label="Online collected (30d)" value={formatNaira(fin.online_collected_30d_kobo)} />
          </div>
        )}
      </StateBlock>

      <FilterBar>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Offline status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </FilterBar>

      <Card title="Offline payments">
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No offline payments match.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Payment</th><th style={thCell}>Association</th><th style={thCell}>Member</th><th style={thCell}>Amount</th>
              <th style={thCell}>Method</th><th style={thCell}>Reference</th><th style={thCell}>Status</th><th style={thCell}>Submitted</th><th style={thCell}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{o.id}</code></td>
                  <td style={tdCell}>{o.association_name}</td>
                  <td style={tdCell}>{o.member_masked}</td>
                  <td style={tdCell}>{formatNaira(o.amount_kobo)}</td>
                  <td style={tdCell}>{o.method.replace(/_/g, ' ')}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{o.reference}</code></td>
                  <td style={tdCell}><Badge text={o.status} color={statusColor(o.status)} /></td>
                  <td style={tdCell}>{fmtDate(o.submitted_at)}</td>
                  <td style={tdCell}>
                    {o.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <Button variant="primary" sm disabled={busy === o.id} onClick={() => decide(o, 'approve')}>{busy === o.id ? '…' : 'Approve'}</Button>
                        <Button variant="danger" sm disabled={busy === o.id} onClick={() => decide(o, 'reject')}>Reject</Button>
                      </div>
                    ) : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
