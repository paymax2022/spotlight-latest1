'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listUtilityTransactions, reverseUtilityTransaction, formatNaira,
  type UtilityTransactionRow,
} from '@/services/utilityPaymentsAdminService';
import { Page, PageHeader, Card, Button, colors } from '@/components/ui/vuexy';

const STATUS_COLOR: Record<string, string> = {
  failed: colors.danger,
  disputed: colors.warning,
  reversed: colors.secondary,
  provider_pending: colors.warning,
  successful: colors.success,
};

const STATUS_FILTERS = ['failed', 'disputed', 'provider_pending', ''];

function fmtDate(v: string) {
  return new Date(v).toLocaleString('en-NG');
}

export default function UtilityPaymentsAdminPage() {
  const [rows, setRows] = useState<UtilityTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('failed');
  const [closing, setClosing] = useState<{ row: UtilityTransactionRow; reason: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listUtilityTransactions(filterStatus || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load utility transactions');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { void load(); }, [load]);

  async function handleClose() {
    if (!closing) return;
    if (!closing.reason.trim()) { setError('A reason is required.'); return; }
    setBusy(closing.row.id);
    setError(null);
    try {
      await reverseUtilityTransaction(closing.row.id, closing.reason.trim());
      setClosing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close out this transaction');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Utility Payments"
        subtitle="Failed / disputed utility bill payments (airtime, data, electricity, cable TV…). A Paystack-funded failure here was already charged to the customer — closing it out records the decision, it does not itself refund Paystack (that's issued out-of-band)."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {STATUS_FILTERS.map((s) => (
          <Button key={s || 'all'} variant={filterStatus === s ? 'primary' : 'outline'} sm onClick={() => setFilterStatus(s)}>
            {s || 'All'}
          </Button>
        ))}
      </div>

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading ? (
        <p style={{ color: colors.muted }}>Loading utility transactions…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: colors.muted }}>No utility transactions in this filter.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {rows.map((tx) => (
            <Card key={tx.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: colors.muted, fontFamily: 'monospace' }}>{tx.receipt_number ?? tx.id.slice(0, 8)}</span>
                  <span style={{
                    marginLeft: '0.5rem', background: STATUS_COLOR[tx.status] ?? colors.secondary, color: '#fff',
                    padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
                  }}>{tx.status}</span>
                  <span style={{
                    marginLeft: '0.5rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
                    color: tx.payment_source === 'paystack' ? colors.warning : colors.text,
                  }}>{tx.payment_source}</span>
                </div>
                <span style={{ fontSize: '0.75rem', color: colors.muted }}>{fmtDate(tx.created_at)}</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: colors.text, marginBottom: '0.25rem' }}>
                <strong>{tx.category}</strong> · {tx.customer_reference} · {formatNaira(tx.retail_amount_kobo)}
              </p>
              {tx.failure_reason && (
                <p style={{ fontSize: '0.8rem', color: colors.danger, marginBottom: '0.5rem' }}>{tx.failure_reason}</p>
              )}
              {tx.payment_source === 'paystack' && tx.status === 'failed' && (
                <p style={{ fontSize: '0.75rem', color: colors.warning, marginBottom: '0.5rem' }}>
                  Customer was charged via Paystack but not serviced — needs a manual Paystack refund before closing out.
                </p>
              )}
              {(tx.status === 'failed' || tx.status === 'disputed' || tx.status === 'provider_pending') && (
                <Button
                  variant="primary"
                  sm
                  disabled={busy === tx.id}
                  onClick={() => setClosing({ row: tx, reason: '' })}
                  style={{ marginTop: '0.5rem' }}
                >
                  {busy === tx.id ? 'Processing…' : 'Close out'}
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {closing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: colors.card, borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '28rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontWeight: 700, marginBottom: '1rem' }}>Close out {closing.row.receipt_number ?? closing.row.id.slice(0, 8)}</h2>
            {closing.row.payment_source === 'paystack' && (
              <p style={{ fontSize: '0.8rem', color: colors.warning, marginBottom: '0.75rem' }}>
                Paystack-funded — this will mark the transaction reversed/closed but will NOT credit the wallet
                (there was nothing debited from it). Issue the customer&apos;s refund via the Paystack dashboard separately.
              </p>
            )}
            <label style={{ display: 'block', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600 }}>
              Reason (required)
              <textarea
                value={closing.reason}
                onChange={(e) => setClosing({ ...closing, reason: e.target.value })}
                rows={3}
                placeholder="Explain the resolution — e.g. confirmed sandbox test data, or Paystack refund issued manually on 2026-09-17…"
                style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </label>
            {error && <p style={{ color: colors.danger, marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => { setClosing(null); setError(null); }}>Cancel</Button>
              <Button variant="primary" onClick={() => void handleClose()} disabled={!!busy}>
                {busy ? 'Closing…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
