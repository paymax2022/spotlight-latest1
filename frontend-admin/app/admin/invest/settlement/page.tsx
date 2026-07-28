'use client';

import { useEffect, useState } from 'react';
import { getPendingSettlements, runSettlement } from '@/services/investAdminService';
import type { AdminOrder } from '@/types/investAdmin';
import { PageHeader, InvestTabs, Card, Badge, Kpi, btn, btnPrimary, th, td, naira } from '../_ui';

export default function InvestSettlementPage() {
  const [pending, setPending] = useState<AdminOrder[]>([]);
  const [due, setDue] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { const r = await getPendingSettlements(); setPending(r.pending); setDue(r.due); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function onRun() {
    setRunning(true); setMsg(null);
    try {
      const n = await runSettlement();
      setMsg(`Processed ${n} due settlement${n === 1 ? '' : 's'}.`);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Settlement"
        subtitle="Buy: shares credited at T+N. Sell: cash released to available after T+N."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load} style={btn()}>Refresh</button>
            <button onClick={onRun} disabled={running} style={btnPrimary()}>{running ? 'Running…' : 'Run due settlements'}</button>
          </div>
        }
      />
      <InvestTabs />

      {msg && <p style={{ color: '#16a34a' }}>{msg}</p>}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Pending settlement" value={String(pending.length)} accent={pending.length ? '#d97706' : '#16a34a'} />
        <Kpi label="Due now (T+N reached)" value={String(due.length)} accent={due.length ? '#dc2626' : '#16a34a'} sub="Eligible to settle" />
      </div>

      <Card title="Pending settlement queue">
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading…</p>
        ) : pending.length === 0 ? (
          <p style={{ color: '#6b7280' }}>Nothing awaiting settlement.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>Symbol</th>
                  <th style={th()}>User</th>
                  <th style={th()}>Side</th>
                  <th style={th()}>Qty</th>
                  <th style={th()}>Amount</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Provider ref</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((o) => (
                  <tr key={o.id}>
                    <td style={td()}><strong>{o.symbol}</strong></td>
                    <td style={td()} title={o.user_id}>{o.user_id.slice(0, 10)}…</td>
                    <td style={td()}>{o.side}</td>
                    <td style={td()}>{o.filled_quantity || o.quantity}</td>
                    <td style={td()}>{naira(o.total_amount_kobo)}</td>
                    <td style={td()}><Badge status={o.status} /></td>
                    <td style={td()}>{o.provider_reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
