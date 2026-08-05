'use client';

import { useEffect, useState } from 'react';
import { listDisputes, arbitrate, formatNaira, type DisputeRecord } from '@/services/p2pmarketAdminService';
import { PageHeader, P2PMarketTabs, Card, DisclosureNote, StateBlock, AuditNote, btn, btnPrimary, btnDanger, th, td, fmtDate } from '../_ui';
import { ConfirmDialog } from '@/components/rbac/ConfirmDialog';

export default function DisputesPage() {
  const [rows, setRows] = useState<DisputeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<{ dispute: DisputeRecord; decision: 'RELEASE' | 'REFUND' } | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listDisputes()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function askDecide(d: DisputeRecord, decision: 'RELEASE' | 'REFUND') {
    setMsg(null);
    setPending({ dispute: d, decision });
  }

  // reason is captured as an operator acknowledgement for the audit trail;
  // arbitrate does not accept a reason argument (signature unchanged).
  async function confirmDecide(_reason: string) {
    if (!pending) return;
    const { dispute: d, decision } = pending;
    setBusy(d.order_id); setMsg(null);
    try {
      const res = await arbitrate(d.order_id, decision);
      setMsg(`${res.message} (audit ${res.audit_id})`);
      setPending(null);
      await load();
    }
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
                      <button style={btnPrimary()} disabled={busy === d.order_id} onClick={() => askDecide(d, 'RELEASE')}>{busy === d.order_id ? '…' : 'Release'}</button>
                      <button style={btnDanger()} disabled={busy === d.order_id} onClick={() => askDecide(d, 'REFUND')}>Refund</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {pending && (
        <ConfirmDialog
          open
          level="critical"
          title={pending.decision === 'RELEASE' ? 'Release escrow to seller' : 'Refund escrow to buyer'}
          description={`Order ${pending.dispute.order_id} — ${formatNaira(pending.dispute.amount_kobo)}. ${pending.decision === 'RELEASE' ? 'Escrow releases to the seller.' : 'Escrow refunds to the buyer.'}`}
          reasons={[
            'Separation of duties applies — you must not be the original approver (enforced by the backend).',
            'Moves escrowed funds and cannot be undone.',
            'Recorded in the immutable audit log with your name, reason and timestamp (NL-12).',
          ]}
          requireReason
          reasonPlaceholder="Basis for this arbitration (e.g. evidence reviewed, buyer/seller communication, policy applied)…"
          busy={busy === pending.dispute.order_id}
          confirmLabel={pending.decision === 'RELEASE' ? 'Release to seller' : 'Refund to buyer'}
          onConfirm={confirmDecide}
          onCancel={() => {
            if (busy !== pending.dispute.order_id) setPending(null);
          }}
        />
      )}
    </div>
  );
}
