'use client';

import { useEffect, useState } from 'react';
import { getPendingSettlements, runSettlement } from '@/services/investAdminService';
import type { AdminOrder } from '@/types/investAdmin';
import { InvestTabs, Kpi, naira } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  if (status === 'Settled' || status === 'Filled') return colors.success;
  if (status === 'PendingSettlement') return colors.warning;
  if (status === 'Accepted' || status === 'Submitted') return colors.info;
  if (status === 'Failed' || status === 'Rejected') return colors.danger;
  return colors.secondary;
}

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
    <Page>
      <PageHeader
        title="Settlement"
        subtitle="Buy: shares credited at T+N. Sell: cash released to available after T+N."
        actions={
          <>
            <Button variant="outline" onClick={load}>Refresh</Button>
            <Button variant="primary" onClick={onRun} disabled={running}>{running ? 'Running…' : 'Run due settlements'}</Button>
          </>
        }
      />
      <InvestTabs />

      {msg && <p style={{ color: colors.success }}>{msg}</p>}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Pending settlement" value={String(pending.length)} accent={pending.length ? colors.warning : colors.success} />
        <Kpi label="Due now (T+N reached)" value={String(due.length)} accent={due.length ? colors.danger : colors.success} sub="Eligible to settle" />
      </div>

      <Card title="Pending settlement queue">
        {loading ? (
          <p style={{ color: colors.muted, marginTop: 10 }}>Loading…</p>
        ) : pending.length === 0 ? (
          <p style={{ color: colors.muted, marginTop: 10 }}>Nothing awaiting settlement.</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thCell}>Symbol</th>
                <th style={thCell}>User</th>
                <th style={thCell}>Side</th>
                <th style={thCell}>Qty</th>
                <th style={thCell}>Amount</th>
                <th style={thCell}>Status</th>
                <th style={thCell}>Provider ref</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((o) => (
                <tr key={o.id}>
                  <td style={tdCell}><strong>{o.symbol}</strong></td>
                  <td style={tdCell} title={o.user_id}>{o.user_id.slice(0, 10)}…</td>
                  <td style={tdCell}>{o.side}</td>
                  <td style={tdCell}>{o.filled_quantity || o.quantity}</td>
                  <td style={tdCell}>{naira(o.total_amount_kobo)}</td>
                  <td style={tdCell}><Badge text={o.status} color={statusColor(o.status)} /></td>
                  <td style={tdCell}>{o.provider_reference || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
