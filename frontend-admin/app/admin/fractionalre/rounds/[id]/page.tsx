'use client';

// 9.C.1-4 — Round detail: setup fields, live monitor (raised/target/time),
// actions extend/close/refund (maker-checker), allocate → cap table.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getRound, extendRound, closeRound, refundRound, allocateRound } from '@/services/fractionalreAdminService';
import type { AdminRound } from '@/types/fractionalreAdmin';
import { FractionalReTabs, Kpi, SodNote, money, timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors } from '@/components/ui/vuexy';

const STATUS_COLOR: Record<string, string> = {
  fundingopen: colors.info, funded: colors.success, closing: colors.warning, distributing: colors.warning,
  refunding: colors.warning, closed: colors.secondary, cancelled: colors.danger,
  open: colors.info, minmet: colors.success,
};

const labelStyle = { fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'block', marginBottom: 4 } as const;

export default function RoundDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [round, setRound] = useState<AdminRound | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [newClose, setNewClose] = useState('');
  const [reason, setReason] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRound(await getRound(id)); } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function run(fn: () => Promise<unknown>, label: string) {
    setWorking(true); setError(null); setMsg(null);
    try { await fn(); setMsg(label); await load(); } catch (e) { setError(String(e)); } finally { setWorking(false); }
  }

  if (loading || !round) return (
    <Page>
      <PageHeader title="Round" /><FractionalReTabs active="rounds" />
      {error ? <p style={{ color: colors.danger }}>{error}</p> : <p style={{ color: colors.muted }}>Loading round…</p>}
    </Page>
  );

  const pct = round.targetKobo ? Math.round((round.raisedKobo / round.targetKobo) * 100) : 0;
  const minMet = round.raisedKobo >= round.minThresholdKobo;
  const canClose = round.status === 'Open' || round.status === 'MinMet';
  const canRefund = round.status === 'Open' || round.status === 'Closing' || round.status === 'Closed';
  const canAllocate = minMet && (round.status === 'Closed' || round.status === 'Closing');

  return (
    <Page>
      <PageHeader title={round.assetName} subtitle={`Round ${round.id}`} actions={<Link href="/admin/fractionalre/rounds"><Button>← All rounds</Button></Link>} />
      <FractionalReTabs active="rounds" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <p style={{ color: colors.success }}>{msg}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Raised" value={money(round.raisedKobo)} accent={colors.success} sub={`${pct}% of ${money(round.targetKobo)}`} />
        <Kpi label="Min threshold" value={money(round.minThresholdKobo)} accent={minMet ? colors.success : colors.danger} sub={minMet ? 'met' : 'not met'} />
        <Kpi label="Investors" value={round.investorCount.toLocaleString('en-NG')} accent={colors.info} sub={`${round.watchers} watchers`} />
        <Kpi label="Closes" value={timeAgo(round.closesAt)} accent={colors.warning} sub={`${round.extensionsUsed} extension(s)`} />
      </div>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Setup</h2>
          <Badge text={round.status.replace(/_/g, ' ')} color={STATUS_COLOR[round.status.toLowerCase()] ?? colors.secondary} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.5rem', fontSize: '0.85rem' }}>
          <div><span style={{ color: colors.muted }}>Unit price:</span> {money(round.unitPriceKobo)}</div>
          <div><span style={{ color: colors.muted }}>Escrow account:</span> {round.escrowAccountRef}</div>
          <div><span style={{ color: colors.muted }}>Ticket min:</span> {money(round.ticketMinKobo)}</div>
          <div><span style={{ color: colors.muted }}>Ticket max:</span> {money(round.ticketMaxKobo)}</div>
          <div><span style={{ color: colors.muted }}>Opens:</span> {timeAgo(round.opensAt)}</div>
          <div><span style={{ color: colors.muted }}>Closes:</span> {timeAgo(round.closesAt)}</div>
        </div>
      </Card>

      <SodNote>Close and refund are <strong>maker-checker</strong> money actions: this submits the request; a different authorised user (Finance / Distribution Approver) must release it. Each carries an Idempotency-Key.</SodNote>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <Card title="Extend (≤30 days)">
          <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 360 }}>
            <div><label style={labelStyle}>New close date</label><input type="date" value={newClose} onChange={(e) => setNewClose(e.target.value)} className="vx-input" /></div>
            <div><label style={labelStyle}>Reason</label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <Button variant="primary" disabled={!newClose || !reason || working} onClick={() => run(() => extendRound(round.id, { newClosesAt: new Date(newClose).toISOString(), reason }), 'Round extended.')}>Extend round</Button>
          </div>
        </Card>

        <Card title="Round actions">
          <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 360 }}>
            <div><label style={labelStyle}>Reason (logged)</label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <Button disabled={!canClose || !reason || working} onClick={() => run(() => closeRound(round.id, reason), 'Close submitted — awaiting checker approval.')} style={{ background: colors.warning, borderColor: colors.warning, color: '#fff' }}>Close round (maker)</Button>
            <Button variant="danger" disabled={!canRefund || !reason || working} onClick={() => run(() => refundRound(round.id, reason), 'Refund submitted — awaiting checker approval.')}>Trigger refunds (maker)</Button>
            <Button variant="primary" disabled={!canAllocate || working} onClick={() => run(() => allocateRound(round.id), 'Allocation finalised — written to cap table.')}>Allocate → cap table</Button>
            {!minMet && <p style={{ fontSize: '0.75rem', color: colors.danger, margin: 0 }}>Min threshold not met — allocation disabled; refund path applies.</p>}
            <Link href={`/admin/fractionalre/cap-table?asset=${round.assetId}`} style={{ fontSize: '0.82rem', color: colors.info }}>View cap table →</Link>
          </div>
        </Card>
      </div>
    </Page>
  );
}
