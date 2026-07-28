'use client';

import { useEffect, useState } from 'react';
import { getAssociationFinance, listOfflinePayments, decideOfflinePayment, formatNaira, type AssociationFinance, type OfflinePayment } from '@/services/associationAdminService';
import { PageHeader, AssociationTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, label, select, fmtDate } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Dues & finance" subtitle="Dues collection summary and offline (bank-transfer / cash) payment review." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AssociationTabs active="dues" />
      <DisclosureNote>Approving an offline payment posts a balanced double-entry ledger entry (NL-8). Every decision is recorded to the immutable audit log (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={error} empty={!fin} emptyText="No finance data available.">
        {fin && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Dues outstanding" value={formatNaira(fin.dues_outstanding_kobo)} accent={fin.dues_outstanding_kobo > 0 ? '#9a3412' : undefined} />
            <Kpi label="Dues collected (30d)" value={formatNaira(fin.dues_collected_30d_kobo)} accent="#340075" />
            <Kpi label="Offline pending" value={formatNaira(fin.offline_pending_kobo)} />
            <Kpi label="Online collected (30d)" value={formatNaira(fin.online_collected_30d_kobo)} />
          </div>
        )}
      </StateBlock>

      <FilterBar>
        <div>
          <label style={label()}>Offline status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </FilterBar>

      <Card title="Offline payments">
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No offline payments match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Payment</th><th style={th()}>Association</th><th style={th()}>Member</th><th style={th()}>Amount</th>
              <th style={th()}>Method</th><th style={th()}>Reference</th><th style={th()}>Status</th><th style={th()}>Submitted</th><th style={th()}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{o.id}</code></td>
                  <td style={td()}>{o.association_name}</td>
                  <td style={td()}>{o.member_masked}</td>
                  <td style={td()}>{formatNaira(o.amount_kobo)}</td>
                  <td style={td()}>{o.method.replace(/_/g, ' ')}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{o.reference}</code></td>
                  <td style={td()}><Badge status={o.status} /></td>
                  <td style={td()}>{fmtDate(o.submitted_at)}</td>
                  <td style={td()}>
                    {o.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button style={btnPrimary()} disabled={busy === o.id} onClick={() => decide(o, 'approve')}>{busy === o.id ? '…' : 'Approve'}</button>
                        <button style={btnDanger()} disabled={busy === o.id} onClick={() => decide(o, 'reject')}>Reject</button>
                      </div>
                    ) : <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
