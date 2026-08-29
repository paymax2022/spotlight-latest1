'use client';

import { useEffect, useState } from 'react';
import { getAssociationFinance, listOfflinePayments, decideOfflinePayment, formatNaira, type AssociationFinance, type OfflinePayment } from '@/services/associationAdminService';
import { AssociationTabs, Kpi, DisclosureNote, StateBlock, AuditNote, OrgPicker, useSelectedOrg, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function DuesPage() {
  const orgId = useSelectedOrg();
  const [fin, setFin] = useState<AssociationFinance | null>(null);
  const [rows, setRows] = useState<OfflinePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [f, o] = await Promise.all([getAssociationFinance(), listOfflinePayments()]);
      setFin(f); setRows(o);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId]);

  async function decide(o: OfflinePayment, decision: 'approve' | 'reject') {
    const ok = window.confirm(`${decision === 'approve' ? 'Approve' : 'Reject'} offline payment ${formatNaira(o.amountKobo)} from ${o.memberName}?`);
    if (!ok) return;
    setBusy(o.id); setMsg(null);
    try {
      await decideOfflinePayment(o.id, decision);
      setMsg(`Offline payment ${o.id}: ${decision}. ${decision === 'approve' ? 'Balanced ledger entry posted (NL-8).' : 'No funds moved.'} Recorded to audit (NL-12).`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Dues & finance" subtitle="Dues collection summary and offline (bank-transfer / cash) payment review." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <AssociationTabs active="dues" />
      <OrgPicker />
      <DisclosureNote>Approving an offline payment posts a balanced double-entry ledger entry (NL-8). Every decision is recorded to the immutable audit log (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={error} empty={!fin} emptyText="Select an organisation above to see its finance summary.">
        {fin && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Dues outstanding" value={formatNaira(fin.outstandingKobo)} accent={fin.outstandingKobo > 0 ? colors.warning : undefined} />
            <Kpi label="Dues collected" value={formatNaira(fin.collectedKobo)} accent={colors.primary} />
            <Kpi label="Paid members" value={fin.paidMembers.toLocaleString('en-NG')} />
            <Kpi label="Unpaid members" value={fin.unpaidMembers.toLocaleString('en-NG')} accent={fin.unpaidMembers > 0 ? colors.warning : undefined} />
            <Kpi label="Offline pending" value={fin.offlinePending.toLocaleString('en-NG')} />
          </div>
        )}
      </StateBlock>

      <Card title="Offline payments awaiting review">
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No offline payments pending review.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Payment</th><th style={thCell}>Member</th><th style={thCell}>Amount</th>
              <th style={thCell}>Method</th><th style={thCell}>Reference</th><th style={thCell}>For</th><th style={thCell}>Submitted</th><th style={thCell}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{o.id}</code></td>
                  <td style={tdCell}>{o.memberName} <span style={{ color: colors.muted, fontSize: '0.78rem' }}>({o.memberId})</span></td>
                  <td style={tdCell}>{formatNaira(o.amountKobo)}</td>
                  <td style={tdCell}>{o.method.replace(/_/g, ' ')}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{o.reference}</code></td>
                  <td style={tdCell}>{o.forItem}</td>
                  <td style={tdCell}>{fmtDate(o.submittedAt)}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <Button variant="primary" sm disabled={busy === o.id} onClick={() => decide(o, 'approve')}>{busy === o.id ? '…' : 'Approve'}</Button>
                      <Button variant="danger" sm disabled={busy === o.id} onClick={() => decide(o, 'reject')}>Reject</Button>
                    </div>
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
