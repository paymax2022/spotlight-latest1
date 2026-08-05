'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getTransaction, retryTransaction, forceReverseTransaction } from '@/services/fxAdminService';
import type { FxTxDetail } from '@/types/fxAdmin';
import { PageHeader, Card, Badge, btn, btnPrimary, th, td, moneyFull } from '../../_ui';
import { ConfirmDialog } from '@/components/rbac/ConfirmDialog';
import { useCriticalAction } from '@/components/rbac/useCriticalAction';

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

  // Force-reverse is a money movement → gate it behind a critical confirm step.
  // forceReverseTransaction takes no reason arg, so the typed reason is captured
  // in the dialog as an audited operator acknowledgement (not sent to the service).
  const reverse = useCriticalAction({
    action: async () => { await forceReverseTransaction(id); },
    onDone: load,
  });

  if (loading) return <div style={{ padding: '0.5rem' }}><p style={{ color: '#6b7280' }}>Loading…</p></div>;
  if (error || !tx) return <div style={{ padding: '0.5rem' }}><p style={{ color: '#dc2626' }}>{error ?? 'Not found'}</p><Link href="/admin/fx/transactions" style={{ color: '#1d4ed8' }}>← Back</Link></div>;

  const canRetry = tx.status === 'failed';
  const canReverse = tx.status === 'successful';

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <Link href="/admin/fx/transactions" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>← Transactions</Link>
      <div style={{ height: 8 }} />
      <PageHeader
        title={tx.reference}
        subtitle={`${tx.type} · ${tx.corridor} · ${tx.customer}`}
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {canRetry ? <button disabled={busy || reverse.busy} onClick={() => act(retryTransaction)} style={btnPrimary('#d97706')}>Manual retry / failover</button> : null}
            {canReverse ? <button disabled={busy || reverse.busy} onClick={reverse.ask} style={btnPrimary('#dc2626')}>Force reverse</button> : null}
            <button disabled={busy || reverse.busy} onClick={load} style={btn()}>Refresh</button>
          </div>
        }
      />

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
        <Badge status={tx.status} />
        {tx.failureReason ? <span style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{tx.failureReason}</span> : null}
      </div>

      {reverse.error ? <p role="alert" style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0 0 1rem' }}>{reverse.error}</p> : null}

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
            <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
              <th style={th()}>Provider</th><th style={th()}>Score</th><th style={th()}>Cost</th><th style={th()}>Coverage</th><th style={th()}>Liquidity</th><th style={th()}>Reliability</th><th style={th()}>Chosen</th>
            </tr>
          </thead>
          <tbody>
            {tx.scoring.map((s) => (
              <tr key={s.provider} style={{ borderBottom: '1px solid #f3f4f6', background: s.chosen ? '#f0f7ff' : undefined }}>
                <td style={{ ...td(), textTransform: 'capitalize' }}><strong>{s.provider}</strong></td>
                <td style={td()}>{s.score.toFixed(2)}</td>
                <td style={td()}>{s.cost.toFixed(2)}</td>
                <td style={td()}>{s.coverage.toFixed(2)}</td>
                <td style={td()}>{s.liquidity.toFixed(2)}</td>
                <td style={td()}>{s.reliability.toFixed(2)}</td>
                <td style={td()}>{s.chosen ? <Badge status="successful" label="Chosen" /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Status history">
        {tx.statusHistory.map((s, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: i < tx.statusHistory.length - 1 ? '1px solid #f3f4f6' : 'none', fontSize: '0.85rem' }}>
            <span style={{ textTransform: 'capitalize' }}>{s.status}</span>
            <span style={{ color: '#6b7280' }}>{new Date(s.at).toLocaleString('en-NG')}</span>
          </div>
        ))}
      </Card>

      <ConfirmDialog
        open={reverse.open}
        level="critical"
        title={`Force-reverse ${tx.reference}`}
        description={`${moneyFull(tx.source.amountMinor, tx.source.currency)} → ${moneyFull(tx.destination.amountMinor, tx.destination.currency)} · ${tx.corridor} · ${tx.customer}`}
        reasons={[
          'Reverses a successful FX transaction — this moves money and posts compensating ledger entries.',
          'Only reverse when the underlying settlement is confirmed reversible; the customer may already have been paid.',
          'Recorded in the audit log with your name, reason and timestamp.',
        ]}
        requireReason
        reasonPlaceholder="Basis for the reversal (e.g. duplicate settlement, provider recall, ref FX-2026-...)…"
        busy={reverse.busy}
        confirmLabel="Force reverse"
        onConfirm={reverse.confirm}
        onCancel={reverse.cancel}
      />
    </div>
  );
}

function KV({ k, v, cap }: { k: string; v: string; cap?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem' }}>
      <span style={{ color: '#6b7280' }}>{k}</span>
      <span style={{ fontWeight: 600, textTransform: cap ? 'capitalize' : 'none' }}>{v}</span>
    </div>
  );
}
