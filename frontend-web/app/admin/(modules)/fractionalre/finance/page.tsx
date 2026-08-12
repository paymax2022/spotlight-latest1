'use client';

// 9.J — Finance / Treasury: escrow & funds-flow recon, refunds, fees & revenue.

import { useEffect, useState } from 'react';
import { getEscrow, getFees, refund } from '@/services/fractionalreAdminService';
import type { EscrowAccount, FeeRevenue } from '@/types/fractionalreAdmin';
import { FractionalReTabs, Kpi, SodNote, money, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const labelStyle = { fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'block', marginBottom: 4 } as const;

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
    <Page>
      <PageHeader title="Finance & Treasury" subtitle="Escrow reconciliation, refunds and fee revenue." actions={<Button onClick={load}>Refresh</Button>} />
      <FractionalReTabs active="finance" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <p style={{ color: colors.success }}>{msg}</p>}

      {loading || !fees ? <p style={{ color: colors.muted }}>Loading finance…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Total fees" value={money(fees.totalFeesKobo)} accent={colors.success} sub={fees.period} />
            <Kpi label="Management" value={money(fees.managementFeesKobo)} accent={colors.info} />
            <Kpi label="Listing" value={money(fees.listingFeesKobo)} accent={colors.info} />
            <Kpi label="Secondary" value={money(fees.secondaryFeesKobo)} accent={colors.secondary} />
            <Kpi label="Performance" value={money(fees.performanceFeesKobo)} accent={colors.warning} />
            <Kpi label="FX" value={money(fees.fxFeesKobo)} accent={colors.secondary} />
          </div>

          <Card title="Escrow & funds-flow reconciliation">
            {escrows.length === 0 ? <p style={{ color: colors.muted }}>No escrow accounts.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Asset</th><th style={thCell}>Escrow ref</th><th style={thCell}>Inflows</th><th style={thCell}>Outflows</th><th style={thCell}>Balance</th><th style={thCell}>Reconciled</th><th style={thCell}>As of</th></tr></thead>
                <tbody>{escrows.map((e) => (
                  <tr key={e.roundId}>
                    <td style={tdCell}>{e.assetName}</td><td style={tdCell}>{e.escrowAccountRef}</td>
                    <td style={tdCell}>{money(e.inflowsKobo)}</td><td style={tdCell}>{money(e.outflowsKobo)}</td>
                    <td style={{ ...tdCell, fontWeight: 600 }}>{money(e.balanceKobo)}</td>
                    <td style={tdCell}>{e.reconciled ? <Badge text="reconciled" color={colors.success} /> : <Badge text="unreconciled" color={colors.danger} />}</td>
                    <td style={tdCell}>{timeAgo(e.asOf)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>

          <SodNote>Refund processing is a <strong>dual-control</strong> money action: it returns escrowed funds to investor wallets for a failed-threshold round and requires checker approval. Each carries an Idempotency-Key.</SodNote>
          <Card title="Refund processing (failed-round / threshold)">
            <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ width: 200 }}><label style={labelStyle}>Round ID</label><Input value={roundId} onChange={(e) => setRoundId(e.target.value)} placeholder="rnd-2" /></div>
              <div style={{ width: 280 }}><label style={labelStyle}>Reason (logged)</label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
              <Button variant="danger" onClick={doRefund} disabled={working || !roundId || !reason}>{working ? 'Submitting…' : 'Submit refund (maker)'}</Button>
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
