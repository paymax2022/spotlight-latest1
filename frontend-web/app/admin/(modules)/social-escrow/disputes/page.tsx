'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listDisputes, formatNaira } from '@/services/escrowAdminService';
import type { DisputeListItem } from '@/types/escrowAdmin';
import { PageHeader, EscrowTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, timeAgo } from '../../creators/_ui';
import { colors } from '@/components/ui/vuexy';

export default function DisputesPage() {
  const [rows, setRows] = useState<DisputeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('open');
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listDisputes({ status: status || undefined, reason: reason || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, reason]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Escrow dispute queue" subtitle="P2P disputes awaiting arbitration. Open a dispute to review evidence and decide release (to seller) or refund (to buyer)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EscrowTabs active="disputes" />
      <DisclosureNote>Dispute state machine: <strong>HELD → DISPUTED → (RELEASED | REFUNDED)</strong>. Arbitration is subject to separation-of-duties — the arbitrator must differ from the underlying release approver. Every decision posts an immutable audit event (NL-12).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Listing, party, dispute or escrow id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="in_review">In review</option>
            <option value="awaiting_evidence">Awaiting evidence</option>
            <option value="resolved_release">Resolved — release</option>
            <option value="resolved_refund">Resolved — refund</option>
          </select>
        </div>
        <div>
          <label style={label()}>Reason</label>
          <select style={select()} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">All</option>
            <option value="not_delivered">Not delivered</option>
            <option value="not_as_described">Not as described</option>
            <option value="unauthorized">Unauthorized</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No disputes in this queue.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Dispute</th><th style={th()}>Buyer</th><th style={th()}>Seller</th><th style={th()}>Amount</th>
              <th style={th()}>Reason</th><th style={th()}>Evidence</th><th style={th()}>Assigned</th><th style={th()}>SLA</th><th style={th()}>Status</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>
                    <Link href={`/admin/social-escrow/disputes/${r.id}`} style={{ color: '#340075', fontWeight: 600, textDecoration: 'none' }}>{r.listing_title}</Link>
                    <div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id} · escrow {r.escrow_id} · <Badge status={r.escrow_state} /></div>
                  </td>
                  <td style={td()}>{r.buyer_masked}</td>
                  <td style={td()}>{r.seller_masked}</td>
                  <td style={td()}><strong>{formatNaira(r.amount_kobo)}</strong></td>
                  <td style={td()}>{r.reason.replace(/_/g, ' ')}</td>
                  <td style={td()}>{r.evidence_count}</td>
                  <td style={td()}>{r.assigned_to_masked ?? <span style={{ color: colors.muted }}>unassigned</span>}</td>
                  <td style={td()}>{timeAgo(r.sla_due_at)}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}><Link href={`/admin/social-escrow/disputes/${r.id}`} style={btn()}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
