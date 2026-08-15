'use client';

import { useEffect, useState } from 'react';
import { getPayments, getEscrow } from '@/services/realtorAdminService';
import type { AdminPayment, EscrowAccount } from '@/types/realtorAdmin';
import { PageHeader, RealtorTabs, Card, Badge, btn, th, td, money, timeAgo } from '../_ui';

export default function PaymentsPage() {
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [escrow, setEscrow] = useState<EscrowAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { const [p, e] = await Promise.all([getPayments(), getEscrow()]); setPayments(p); setEscrow(e); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const escrowTotal = escrow.reduce((s, e) => s + e.amountKobo, 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Payments & escrow" subtitle="Transaction ledger, owner payouts, refunds and escrow accounts." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <RealtorTabs active="payments" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
        <>
          <Card title="Transactions">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Reference</th><th style={th()}>Type</th><th style={th()}>Payer</th><th style={th()}>Amount</th><th style={th()}>Escrow</th><th style={th()}>Status</th><th style={th()}>When</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td style={td()}><code>{p.reference}</code></td>
                    <td style={td()}><Badge status={p.kind} /></td>
                    <td style={td()}>{p.payer}</td>
                    <td style={td()}>{money(p.amountKobo)}</td>
                    <td style={td()}>{p.escrowHeldKobo ? money(p.escrowHeldKobo) : '—'}</td>
                    <td style={td()}><Badge status={p.status} /></td>
                    <td style={td()}>{timeAgo(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title={`Escrow accounts — ${money(escrowTotal)} held`}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Lease / booking</th><th style={th()}>Amount</th><th style={th()}>Status</th><th style={th()}>Held since</th></tr></thead>
              <tbody>
                {escrow.map((e) => (
                  <tr key={e.id}>
                    <td style={td()}>{e.leaseOrBooking}</td>
                    <td style={td()}>{money(e.amountKobo)}</td>
                    <td style={td()}><Badge status={e.status} /></td>
                    <td style={td()}>{timeAgo(e.heldSince)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
