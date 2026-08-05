'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getTransaction, retryTransaction, forceReverseTransaction } from '@/services/fxAdminService';
import type { FxTxDetail } from '@/types/fxAdmin';
import { PageHeader, Card, Badge, moneyFull } from '../../_ui';
import { Button, colors, thCell, tdCell, tint } from '@/components/ui/vuexy';

const FEE_LABEL: Record<string, string> = { provider_fee: 'Provider fee', rail_fee: 'Network fee', paymax_spread: 'Paymax spread' };

export default function FxTransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tx, setTx] = useState<FxTxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setTx(await getTransaction(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function act(fn: (id: string) => Promise<unknown>) {
    setBusy(true);
    try { await fn(id); await load(); } finally { setBusy(false); }
  }

  if (loading) return <div style={{ padding: '0.5rem' }}><p style={{ color: colors.muted }}>Loading…</p></div>;
  if (error || !tx) return <div style={{ padding: '0.5rem' }}><p style={{ color: colors.danger }}>{error ?? 'Not found'}</p><Link href="/admin/fx/transactions" style={{ color: colors.info }}>← Back</Link></div>;

  const canRetry = tx.status === 'failed';
  const canReverse = tx.status === 'successful';

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <Link href="/admin/fx/transactions" style={{ color: colors.info, textDecoration: 'none', fontSize: '0.85rem' }}>← Transactions</Link>
      <div style={{ height: 8 }} />
      <PageHeader
        title={tx.reference}
        subtitle={`${tx.type} · ${tx.corridor} · ${tx.customer}`}
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {canRetry ? <Button variant="primary" style={{ background: colors.warning, borderColor: colors.warning }} disabled={busy} onClick={() => act(retryTransaction)}>Manual retry / failover</Button> : null}
            {canReverse ? <Button variant="danger" disabled={busy} onClick={() => act(forceReverseTransaction)}>Force reverse</Button> : null}
            <Button variant="outline" onClick={load}>Refresh</Button>
          </div>
        }
      />

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
        <Badge status={tx.status} />
        {tx.failureReason ? <span style={{ color: colors.danger, fontSize: '0.85rem' }}>{tx.failureReason}</span> : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <Card title="Money & rates">
          <KV k="You sent" v={moneyFull(tx.source.amountMinor, tx.source.currency)} />
          <KV k="Recipient" v={moneyFull(tx.destination.amountMinor, tx.destination.currency)} />
          <KV k="Quoted rate" v={tx.quotedRate ? String(tx.quotedRate) : '—'} />
          <KV k="Executed rate" v={tx.executedRate ? String(tx.executedRate) : '—'} />
          {tx.fees.map((f) => <KV key={f.type} k={FEE_LABEL[f.type] ?? f.type} v={moneyFull(f.amount.amountMinor, f.amount.currency)} />)}
        </Card>

        <Card title="Route & references">
          <KV k="Provider" v={tx.provider} cap />
          <KV k="Corridor" v={tx.corridor} />
          <KV k="Rail" v={tx.rail.replace(/_/g, ' ')} cap />
          <KV k="Provider ref" v={tx.providerRef ?? '—'} />
          <KV k="Customer" v={`${tx.customer} · ${tx.customerEmail}`} />
          {tx.narration ? <KV k="Narration" v={tx.narration} /> : null}
          <KV k="Created" v={new Date(tx.createdAt).toLocaleString('en-NG')} />
        </Card>
      </div>

      <Card title="Routing decision (scoring snapshot)">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
              <th style={thCell}>Provider</th><th style={thCell}>Score</th><th style={thCell}>Cost</th><th style={thCell}>Coverage</th><th style={thCell}>Liquidity</th><th style={thCell}>Reliability</th><th style={thCell}>Chosen</th>
            </tr>
          </thead>
          <tbody>
            {tx.scoring.map((s) => (
              <tr key={s.provider} style={{ borderBottom: `1px solid ${colors.border}`, background: s.chosen ? tint(colors.info, 0.08) : undefined }}>
                <td style={{ ...tdCell, textTransform: 'capitalize' }}><strong>{s.provider}</strong></td>
                <td style={tdCell}>{s.score.toFixed(2)}</td>
                <td style={tdCell}>{s.cost.toFixed(2)}</td>
                <td style={tdCell}>{s.coverage.toFixed(2)}</td>
                <td style={tdCell}>{s.liquidity.toFixed(2)}</td>
                <td style={tdCell}>{s.reliability.toFixed(2)}</td>
                <td style={tdCell}>{s.chosen ? <Badge status="successful" label="Chosen" /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Status history">
        {tx.statusHistory.map((s, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: i < tx.statusHistory.length - 1 ? `1px solid ${colors.border}` : 'none', fontSize: '0.85rem' }}>
            <span style={{ textTransform: 'capitalize' }}>{s.status}</span>
            <span style={{ color: colors.muted }}>{new Date(s.at).toLocaleString('en-NG')}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function KV({ k, v, cap }: { k: string; v: string; cap?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: `1px solid ${colors.border}`, fontSize: '0.85rem' }}>
      <span style={{ color: colors.muted }}>{k}</span>
      <span style={{ fontWeight: 600, textTransform: cap ? 'capitalize' : 'none' }}>{v}</span>
    </div>
  );
}
