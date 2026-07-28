'use client';

// 9.C.1-4 — Round detail: setup fields, live monitor (raised/target/time),
// actions extend/close/refund (maker-checker), allocate → cap table.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getRound, extendRound, closeRound, refundRound, allocateRound } from '@/services/fractionalreAdminService';
import type { AdminRound } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Kpi, Badge, SodNote, btn, btnPrimary, input, label, money, timeAgo } from '../../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Round" /><FractionalReTabs active="rounds" />
      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : <p style={{ color: '#6b7280' }}>Loading round…</p>}
    </div>
  );

  const pct = round.targetKobo ? Math.round((round.raisedKobo / round.targetKobo) * 100) : 0;
  const minMet = round.raisedKobo >= round.minThresholdKobo;
  const canClose = round.status === 'Open' || round.status === 'MinMet';
  const canRefund = round.status === 'Open' || round.status === 'Closing' || round.status === 'Closed';
  const canAllocate = minMet && (round.status === 'Closed' || round.status === 'Closing');

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title={round.assetName} subtitle={`Round ${round.id}`} action={<Link href="/admin/fractionalre/rounds" style={{ ...btn(), textDecoration: 'none' }}>← All rounds</Link>} />
      <FractionalReTabs active="rounds" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <p style={{ color: '#15803d' }}>{msg}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Raised" value={money(round.raisedKobo)} accent="#16a34a" sub={`${pct}% of ${money(round.targetKobo)}`} />
        <Kpi label="Min threshold" value={money(round.minThresholdKobo)} accent={minMet ? '#16a34a' : '#dc2626'} sub={minMet ? 'met' : 'not met'} />
        <Kpi label="Investors" value={round.investorCount.toLocaleString('en-NG')} accent="#1d4ed8" sub={`${round.watchers} watchers`} />
        <Kpi label="Closes" value={timeAgo(round.closesAt)} accent="#d97706" sub={`${round.extensionsUsed} extension(s)`} />
      </div>

      <Card title="Setup" right={<Badge status={round.status} />}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.5rem', fontSize: '0.85rem' }}>
          <div><span style={{ color: '#6b7280' }}>Unit price:</span> {money(round.unitPriceKobo)}</div>
          <div><span style={{ color: '#6b7280' }}>Escrow account:</span> {round.escrowAccountRef}</div>
          <div><span style={{ color: '#6b7280' }}>Ticket min:</span> {money(round.ticketMinKobo)}</div>
          <div><span style={{ color: '#6b7280' }}>Ticket max:</span> {money(round.ticketMaxKobo)}</div>
          <div><span style={{ color: '#6b7280' }}>Opens:</span> {timeAgo(round.opensAt)}</div>
          <div><span style={{ color: '#6b7280' }}>Closes:</span> {timeAgo(round.closesAt)}</div>
        </div>
      </Card>

      <SodNote>Close and refund are <strong>maker-checker</strong> money actions: this submits the request; a different authorised user (Finance / Distribution Approver) must release it. Each carries an Idempotency-Key.</SodNote>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <Card title="Extend (≤30 days)">
          <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 360 }}>
            <div><label style={label()}>New close date</label><input type="date" value={newClose} onChange={(e) => setNewClose(e.target.value)} style={input()} /></div>
            <div><label style={label()}>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} style={input()} /></div>
            <button disabled={!newClose || !reason || working} onClick={() => run(() => extendRound(round.id, { newClosesAt: new Date(newClose).toISOString(), reason }), 'Round extended.')} style={{ ...btnPrimary(), opacity: !newClose || !reason || working ? 0.6 : 1 }}>Extend round</button>
          </div>
        </Card>

        <Card title="Round actions">
          <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 360 }}>
            <div><label style={label()}>Reason (logged)</label><input value={reason} onChange={(e) => setReason(e.target.value)} style={input()} /></div>
            <button disabled={!canClose || !reason || working} onClick={() => run(() => closeRound(round.id, reason), 'Close submitted — awaiting checker approval.')} style={{ ...btnPrimary('#d97706'), opacity: !canClose || !reason || working ? 0.6 : 1 }}>Close round (maker)</button>
            <button disabled={!canRefund || !reason || working} onClick={() => run(() => refundRound(round.id, reason), 'Refund submitted — awaiting checker approval.')} style={{ ...btnPrimary('#dc2626'), opacity: !canRefund || !reason || working ? 0.6 : 1 }}>Trigger refunds (maker)</button>
            <button disabled={!canAllocate || working} onClick={() => run(() => allocateRound(round.id), 'Allocation finalised — written to cap table.')} style={{ ...btnPrimary('#16a34a'), opacity: !canAllocate || working ? 0.6 : 1 }}>Allocate → cap table</button>
            {!minMet && <p style={{ fontSize: '0.75rem', color: '#dc2626', margin: 0 }}>Min threshold not met — allocation disabled; refund path applies.</p>}
            <Link href={`/admin/fractionalre/cap-table?asset=${round.assetId}`} style={{ fontSize: '0.82rem', color: '#1d4ed8' }}>View cap table →</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
