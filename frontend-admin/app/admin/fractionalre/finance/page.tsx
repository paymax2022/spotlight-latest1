'use client';

// 9.J — Finance / Treasury: escrow & funds-flow recon, refunds, fees & revenue.

import { useEffect, useState } from 'react';
import { getEscrow, getFees, refund } from '@/services/fractionalreAdminService';
import type { EscrowAccount, FeeRevenue } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Kpi, Badge, SodNote, btn, btnPrimary, th, td, input, label, money, timeAgo } from '../_ui';

export default function FinancePage() {
  const [escrows, setEscrows] = useState<EscrowAccount[]>([]);
  const [fees, setFees] = useState<FeeRevenue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [roundId, setRoundId] = useState('');
  const [reason, setReason] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { const [e, f] = await Promise.all([getEscrow(), getFees()]); setEscrows(e); setFees(f); }
    catch (err) { setError(String(err)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function doRefund() {
    if (!roundId || !reason) return;
    setWorking(true); setError(null); setMsg(null);
    try { const r = await refund(roundId, reason); setMsg(`Refund submitted (${r.status}) — ${money(r.refundedKobo)} to ${r.investorCount} investors, awaiting approval.`); setRoundId(''); setReason(''); }
    catch (e) { setError(String(e)); } finally { setWorking(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Finance & Treasury" subtitle="Escrow reconciliation, refunds and fee revenue." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FractionalReTabs active="finance" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <p style={{ color: '#15803d' }}>{msg}</p>}

      {loading || !fees ? <p style={{ color: '#6b7280' }}>Loading finance…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Total fees" value={money(fees.totalFeesKobo)} accent="#16a34a" sub={fees.period} />
            <Kpi label="Management" value={money(fees.managementFeesKobo)} accent="#1d4ed8" />
            <Kpi label="Listing" value={money(fees.listingFeesKobo)} accent="#1d4ed8" />
            <Kpi label="Secondary" value={money(fees.secondaryFeesKobo)} accent="#6b21a8" />
            <Kpi label="Performance" value={money(fees.performanceFeesKobo)} accent="#d97706" />
            <Kpi label="FX" value={money(fees.fxFeesKobo)} accent="#6b21a8" />
          </div>

          <Card title="Escrow & funds-flow reconciliation">
            {escrows.length === 0 ? <p style={{ color: '#6b7280' }}>No escrow accounts.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Asset</th><th style={th()}>Escrow ref</th><th style={th()}>Inflows</th><th style={th()}>Outflows</th><th style={th()}>Balance</th><th style={th()}>Reconciled</th><th style={th()}>As of</th></tr></thead>
                <tbody>{escrows.map((e) => (
                  <tr key={e.roundId}>
                    <td style={td()}>{e.assetName}</td><td style={td()}>{e.escrowAccountRef}</td>
                    <td style={td()}>{money(e.inflowsKobo)}</td><td style={td()}>{money(e.outflowsKobo)}</td>
                    <td style={{ ...td(), fontWeight: 600 }}>{money(e.balanceKobo)}</td>
                    <td style={td()}>{e.reconciled ? <Badge status="verified" label="reconciled" /> : <Badge status="high" label="unreconciled" />}</td>
                    <td style={td()}>{timeAgo(e.asOf)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>

          <SodNote>Refund processing is a <strong>dual-control</strong> money action: it returns escrowed funds to investor wallets for a failed-threshold round and requires checker approval. Each carries an Idempotency-Key.</SodNote>
          <Card title="Refund processing (failed-round / threshold)">
            <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ width: 200 }}><label style={label()}>Round ID</label><input value={roundId} onChange={(e) => setRoundId(e.target.value)} placeholder="rnd-2" style={input()} /></div>
              <div style={{ width: 280 }}><label style={label()}>Reason (logged)</label><input value={reason} onChange={(e) => setReason(e.target.value)} style={input()} /></div>
              <button onClick={doRefund} disabled={working || !roundId || !reason} style={{ ...btnPrimary('#dc2626'), opacity: working || !roundId || !reason ? 0.6 : 1 }}>{working ? 'Submitting…' : 'Submit refund (maker)'}</button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
