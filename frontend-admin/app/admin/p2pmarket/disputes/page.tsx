'use client';

import { useEffect, useState } from 'react';
import { listDisputes, arbitrate, formatNaira, type DisputeRecord } from '@/services/p2pmarketAdminService';
import { P2PMarketTabs, DisclosureNote, StateBlock, AuditNote, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, thCell, tdCell } from '@/components/ui/vuexy';

export default function DisputesPage() {
  const [rows, setRows] = useState<DisputeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listDisputes()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function decide(d: DisputeRecord, decision: 'RELEASE' | 'REFUND') {
    const ok = window.confirm(`Arbitrate order ${d.order_id}: ${decision}?\n\n${decision === 'RELEASE' ? 'Escrow releases to the seller.' : 'Escrow refunds to the buyer.'}\n\nSeparation-of-duties is enforced — you must not be the original release approver.`);
    if (!ok) return;
    setBusy(d.order_id); setMsg(null);
    try { const res = await arbitrate(d.order_id, decision); setMsg(`${res.message} (audit ${res.audit_id})`); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Dispute arbitration" subtitle="Resolve escrow disputes — RELEASE to seller or REFUND to buyer." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <P2PMarketTabs active="disputes" />
      <DisclosureNote>Arbitration posts to <code>/api/p2p/admin/p2p/orders/:id/arbitrate</code> (RBAC <code>p2p.dispute.arbitrate</code>). The arbiter must differ from the release approver; every decision is recorded to the immutable audit log (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No open disputes.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Order</th><th style={thCell}>Listing</th><th style={thCell}>Buyer</th><th style={thCell}>Seller</th>
              <th style={thCell}>Amount</th><th style={thCell}>Evidence</th><th style={thCell}>Raised</th><th style={thCell}>Decision</th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.order_id}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{d.order_id}</code></td>
                  <td style={tdCell}>{d.listing_title}</td>
                  <td style={tdCell}>{d.buyer_masked}</td>
                  <td style={tdCell}>{d.seller_masked}</td>
                  <td style={tdCell}>{formatNaira(d.amount_kobo)}</td>
                  <td style={tdCell}><span style={{ fontSize: '0.8rem' }}>{d.evidence}</span></td>
                  <td style={tdCell}>{fmtDate(d.raised_at)}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <Button sm variant="primary" disabled={busy === d.order_id} onClick={() => decide(d, 'RELEASE')}>{busy === d.order_id ? '…' : 'Release'}</Button>
                      <Button sm variant="danger" disabled={busy === d.order_id} onClick={() => decide(d, 'REFUND')}>Refund</Button>
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
