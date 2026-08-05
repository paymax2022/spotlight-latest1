'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  getTransfer,
  retryTransfer,
  reverseTransfer,
  formatKobo,
} from '@/services/transfersAdminService';
import type { Transfer } from '@/types/transfersAdmin';
import { RETRYABLE_STATUSES, REVERSIBLE_STATUSES } from '@/types/transfersAdmin';
import { PageHeader, Card, BackLink, btn, btnPrimary, btnDisabled, useTransfersPermissions } from '../_ui';
import { StatusBadge, ProviderBadge } from '../statusBadge';
import { Page, colors } from '@/components/ui/vuexy';

type ActionKind = 'retry' | 'reverse';

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: colors.text, fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{children}</div>
    </div>
  );
}

function LedgerList({ title, ids }: { title: string; ids?: string[] }) {
  if (!ids || ids.length === 0) return null;
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{title}</div>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {ids.map((id) => (
          <span key={id} style={{ fontFamily: 'monospace', fontSize: '0.78rem', background: '#f3f4f6', border: `1px solid ${colors.border}`, borderRadius: '0.375rem', padding: '0.15rem 0.5rem' }}>{id}</span>
        ))}
      </div>
    </div>
  );
}

export default function TransferDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { canManage } = useTransfersPermissions();

  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try { setTransfer(await getTransfer(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const canRetry = !!transfer && RETRYABLE_STATUSES.includes(transfer.status);
  const canReverse = !!transfer && REVERSIBLE_STATUSES.includes(transfer.status);

  async function runAction() {
    if (!transfer || !action) return;
    if (action === 'reverse' && !reason.trim()) { setError('A reversal reason is required.'); return; }
    setBusy(true); setError(null);
    try {
      if (action === 'retry') await retryTransfer(transfer.id);
      else await reverseTransfer(transfer.id, reason.trim());
      setAction(null);
      setReason('');
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Page style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <div style={{ marginBottom: '0.75rem' }}><BackLink /></div>

      {loading ? (
        <p style={{ color: colors.muted }}>Loading transfer…</p>
      ) : !transfer ? (
        <p style={{ color: colors.danger }}>{error ?? 'Transfer not found.'}</p>
      ) : (
        <>
          <PageHeader
            title={transfer.reference}
            subtitle={`${transfer.type.replace(/_/g, ' ')} · ${transfer.id}`}
            action={<StatusBadge status={transfer.status} />}
          />

          {error && <p style={{ color: colors.danger }}>{error}</p>}

          <Card title="Transfer">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <Field label="Amount">{formatKobo(transfer.amount_kobo)}</Field>
              <Field label="Fee">{formatKobo(transfer.fee_kobo)}</Field>
              <Field label="Provider"><ProviderBadge provider={transfer.provider} failoverFrom={transfer.failover_from} /></Field>
              <Field label="Source type">{transfer.source_type}</Field>
              <Field label="User ID" mono>{transfer.user_id}</Field>
              <Field label="Narration">{transfer.narration}</Field>
              <Field label="Created">{new Date(transfer.created_at).toLocaleString()}</Field>
              <Field label="Updated">{new Date(transfer.updated_at).toLocaleString()}</Field>
            </div>
          </Card>

          <Card title="Destination">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <Field label="Bank">{transfer.bank_name}</Field>
              <Field label="Account name">{transfer.account_name}</Field>
              <Field label="Account (last 4)" mono>••{transfer.account_number_last4}</Field>
            </div>
          </Card>

          {transfer.type === 'bank_to_bank' && (
            <Card title="Settlement legs (bank → bank)">
              <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 0 }}>
                A bank-to-bank transfer settles in two ledger legs: the inbound funding leg, then the outbound payout leg.
              </p>
              <LedgerList title="Funding leg" ids={transfer.funding_ledger_entry_ids} />
              <LedgerList title="Payout leg" ids={transfer.payout_ledger_entry_ids} />
            </Card>
          )}

          <Card title="Ledger entries">
            <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 0 }}>
              Inspect these in Wallet Lookup. Balances are projections of these immutable entries.
            </p>
            <LedgerList title="Entry IDs" ids={transfer.ledger_entry_ids} />
          </Card>

          <Card title="Provider response">
            <Field label="Provider transfer ref" mono>{transfer.provider_transfer_ref || '—'}</Field>
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Raw response</div>
              <pre style={{ background: '#0f172a', color: '#e2e8f0', borderRadius: '0.5rem', padding: '0.75rem', fontSize: '0.78rem', overflowX: 'auto', margin: 0 }}>
                {transfer.provider_response ? JSON.stringify(JSON.parse(transfer.provider_response), null, 2) : '— no provider response yet —'}
              </pre>
            </div>
          </Card>

          <Card title="Actions">
            <div style={{ ...{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#9a3412', marginBottom: '1rem' } }}>
              ⚠️ These are sensitive money operations. <strong>Retry</strong> re-attempts the payout (may fail over to the
              other provider). <strong>Reverse</strong> posts a balanced reversing ledger entry — it moves money back and
              is only permitted pre-settlement.
            </div>

            {!canManage && (
              <p style={{ fontSize: '0.8rem', color: colors.danger, marginTop: 0 }}>
                You lack <code>finance.admin.transfers</code> — actions are disabled.
              </p>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                disabled={!canManage || !canRetry || busy}
                title={!canManage ? 'Requires finance.admin.transfers' : !canRetry ? `Retry not allowed in status "${transfer.status}"` : 'Re-attempt this transfer'}
                onClick={() => { setAction('retry'); setError(null); }}
                style={!canManage || !canRetry || busy ? btnDisabled() : btnPrimary('#1d4ed8')}
              >
                Retry
              </button>
              <button
                disabled={!canManage || !canReverse || busy}
                title={!canManage ? 'Requires finance.admin.transfers' : !canReverse ? `Reverse not allowed in status "${transfer.status}" (post-settlement)` : 'Reverse this transfer (pre-settlement only)'}
                onClick={() => { setAction('reverse'); setError(null); }}
                style={!canManage || !canReverse || busy ? btnDisabled() : btnPrimary('#b91c1c')}
              >
                Reverse
              </button>
            </div>
          </Card>
        </>
      )}

      {/* Confirm modal */}
      {action && transfer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '30rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontWeight: 700, marginTop: 0, marginBottom: '0.75rem' }}>
              {action === 'retry' ? 'Retry transfer' : 'Reverse transfer'}
            </h2>
            <p style={{ fontSize: '0.85rem', color: colors.text, marginTop: 0 }}>
              {action === 'retry' ? (
                <>You are about to <strong>re-attempt</strong> transfer <code>{transfer.reference}</code> for{' '}
                  <strong>{formatKobo(transfer.amount_kobo)}</strong>. This moves money — the provider may fail over to
                  the alternate rail.</>
              ) : (
                <>You are about to <strong>reverse</strong> transfer <code>{transfer.reference}</code> for{' '}
                  <strong>{formatKobo(transfer.amount_kobo)}</strong>. This posts a balanced reversing ledger entry and
                  returns the funds. Reversal is only valid pre-settlement.</>
              )}
            </p>

            {action === 'reverse' && (
              <label style={{ display: 'block', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600 }}>
                Reversal reason (required)
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. provider returned account-name mismatch; reversing to wallet"
                  style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' }}
                />
              </label>
            )}

            {error && <p style={{ color: colors.danger, fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => { setAction(null); setReason(''); setError(null); }} style={btn()}>Cancel</button>
              <button onClick={() => void runAction()} disabled={busy} style={busy ? btnDisabled() : btnPrimary(action === 'reverse' ? '#b91c1c' : '#1d4ed8')}>
                {busy ? 'Processing…' : action === 'retry' ? 'Confirm retry' : 'Confirm reversal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
