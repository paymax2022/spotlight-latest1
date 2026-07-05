'use client';

import { useEffect, useState } from 'react';
import { listDisputes, arbitrate, formatNaira, type DisputeRecord } from '@/services/p2pmarketAdminService';
import { PageHeader, P2PMarketTabs, Card, DisclosureNote, StateBlock, AuditNote, btn, btnPrimary, btnDanger, th, td, fmtDate } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Dispute arbitration" subtitle="Resolve escrow disputes — RELEASE to seller or REFUND to buyer." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <P2PMarketTabs active="disputes" />
      <DisclosureNote>Arbitration posts to <code>/api/p2p/admin/p2p/orders/:id/arbitrate</code> (RBAC <code>p2p.dispute.arbitrate</code>). The arbiter must differ from the release approver; every decision is recorded to the immutable audit log (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No open disputes.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Order</th><th style={th()}>Listing</th><th style={th()}>Buyer</th><th style={th()}>Seller</th>
              <th style={th()}>Amount</th><th style={th()}>Evidence</th><th style={th()}>Raised</th><th style={th()}>Decision</th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.order_id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{d.order_id}</code></td>
                  <td style={td()}>{d.listing_title}</td>
                  <td style={td()}>{d.buyer_masked}</td>
                  <td style={td()}>{d.seller_masked}</td>
                  <td style={td()}>{formatNaira(d.amount_kobo)}</td>
                  <td style={td()}><span style={{ fontSize: '0.8rem' }}>{d.evidence}</span></td>
                  <td style={td()}>{fmtDate(d.raised_at)}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button style={btnPrimary()} disabled={busy === d.order_id} onClick={() => decide(d, 'RELEASE')}>{busy === d.order_id ? '…' : 'Release'}</button>
                      <button style={btnDanger()} disabled={busy === d.order_id} onClick={() => decide(d, 'REFUND')}>Refund</button>
                    </div>
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
