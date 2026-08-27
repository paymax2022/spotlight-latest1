'use client';

/**
 * Payments & Finance — console page (admin consolidation; see
 * docs/adr/ADR-047-admin-console-consolidation-path-a.md and
 * paymentsFinanceAdminService.ts for the data-path and permission notes).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getPaymentsFinanceConsole, kycAction, adjustWallet, backfillWallets, formatNaira,
  type PaymentsFinanceConsole,
} from '@/services/paymentsFinanceAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const KYC_BADGE: Record<string, string> = {
  pending: colors.warning,
  verified: colors.success,
  failed: colors.danger,
  suspended: colors.danger,
};

const LEDGER_BADGE: Record<string, string> = {
  CREDIT: colors.success,
  DEBIT: colors.danger,
};

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{note}</div>
    </div>
  );
}

function fmtDate(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('en-NG') : '—';
}

export default function PaymentsFinanceAdminPage() {
  const [data, setData] = useState<PaymentsFinanceConsole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getPaymentsFinanceConsole());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payments & finance console');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const runKyc = useCallback(async (action: 'approve' | 'reject' | 'suspend', userId: string, tier?: number) => {
    setBusy(userId);
    setError(null);
    try {
      await kycAction(action, userId, {
        tier,
        reason: action === 'reject' ? 'Rejected by admin review.' : action === 'suspend' ? 'Suspended by admin review.' : undefined,
      });
      flash(`KYC ${action}d`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${action} KYC`);
    } finally {
      setBusy(null);
    }
  }, [flash, load]);

  const [adjustForms, setAdjustForms] = useState<Record<string, { credit: string; creditReason: string; debit: string; debitReason: string }>>({});

  function getForm(userId: string) {
    return adjustForms[userId] ?? { credit: '', creditReason: '', debit: '', debitReason: '' };
  }
  function setForm(userId: string, patch: Partial<ReturnType<typeof getForm>>) {
    setAdjustForms((f) => ({ ...f, [userId]: { ...getForm(userId), ...patch } }));
  }

  const runAdjust = useCallback(async (userId: string, direction: 'credit' | 'debit') => {
    const form = getForm(userId);
    const amount = Number(direction === 'credit' ? form.credit : form.debit);
    const reason = (direction === 'credit' ? form.creditReason : form.debitReason).trim();
    if (!amount || amount <= 0) { setError('Enter a valid amount greater than 0.'); return; }
    if (!reason) { setError('Reason is required for wallet adjustments.'); return; }
    setBusy(`${userId}:${direction}`);
    setError(null);
    try {
      const result = await adjustWallet(userId, direction, amount, reason);
      flash(result.alreadyProcessed ? 'Already processed (duplicate submission ignored)' : `Wallet ${direction}ed — ${result.reference}`);
      setForm(userId, direction === 'credit' ? { credit: '', creditReason: '' } : { debit: '', debitReason: '' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${direction} wallet`);
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustForms, flash, load]);

  const runBackfill = useCallback(async () => {
    setBusy('backfill');
    setError(null);
    try {
      const processed = await backfillWallets();
      flash(`Ensured wallet accounts for ${processed} profiles`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to backfill wallets');
    } finally {
      setBusy(null);
    }
  }, [flash, load]);

  if (loading && !data) return <Page><p style={{ color: colors.muted }}>Loading…</p></Page>;

  return (
    <Page>
      <PageHeader
        title="Payments & Finance"
        subtitle="Fintech operations console for wallet, ledger, virtual accounts and KYC. Served from the web app over the admin web proxy."
        actions={
          <Button variant="primary" disabled={busy === 'backfill'} onClick={() => void runBackfill()}>
            {busy === 'backfill' ? 'Backfilling…' : 'Backfill wallets'}
          </Button>
        }
      />

      {toast && <div style={{ marginBottom: 12, color: colors.success, fontSize: 13 }}>{toast}</div>}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <StatTile label="Wallet balance" value={formatNaira(data.stats.totalBalanceKobo)} note="Across listed wallet accounts" />
            <StatTile label="Credit volume" value={formatNaira(data.stats.creditVolumeKobo)} note="Recent ledger credits" />
            <StatTile label="Debit volume" value={formatNaira(data.stats.debitVolumeKobo)} note="Recent ledger debits" />
            <StatTile label="Pending KYC" value={String(data.stats.pendingKyc)} note="Manual review queue" />
          </div>

          <Card title={`KYC review queue (${data.stats.verifiedKyc} verified profiles listed)`} style={{ marginBottom: 20 }}>
            {data.kycProfiles.error ? (
              <p style={{ color: colors.muted, margin: 0 }}>{data.kycProfiles.error}</p>
            ) : data.kycProfiles.rows.length === 0 ? (
              <p style={{ color: colors.muted, margin: 0 }}>No KYC profiles found.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thCell}>User</th>
                      <th style={thCell}>Phone</th>
                      <th style={thCell}>Tier</th>
                      <th style={thCell}>Status</th>
                      <th style={thCell}>Submitted</th>
                      <th style={thCell}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.kycProfiles.rows.map((p) => (
                      <tr key={p.id}>
                        <td style={tdCell}><strong>{p.full_name || p.email || p.id}</strong><div style={{ fontSize: 12, color: colors.muted }}>{p.email || p.id}</div></td>
                        <td style={tdCell}>{p.phone || '—'}</td>
                        <td style={tdCell}>Tier {p.kyc_tier ?? 0}</td>
                        <td style={tdCell}><Badge text={p.kyc_status} color={KYC_BADGE[p.kyc_status] ?? colors.muted} /></td>
                        <td style={tdCell}>{fmtDate(p.kyc_submitted_at)}</td>
                        <td style={tdCell}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {p.kyc_status === 'pending' && (
                              <>
                                <Button sm variant="primary" disabled={busy === p.id} onClick={() => void runKyc('approve', p.id, 1)}>Approve (T1)</Button>
                                <Button sm variant="danger" disabled={busy === p.id} onClick={() => void runKyc('reject', p.id)}>Reject</Button>
                              </>
                            )}
                            {p.kyc_status === 'verified' && (
                              <Button sm variant="danger" disabled={busy === p.id} onClick={() => void runKyc('suspend', p.id)}>Suspend</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Wallet & ledger accounts" style={{ marginBottom: 20 }}>
            {data.wallets.length === 0 ? (
              <p style={{ color: colors.muted, margin: 0 }}>No wallet accounts found.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thCell}>User</th>
                      <th style={thCell}>Account</th>
                      <th style={thCell}>Balance</th>
                      <th style={thCell}>Last activity</th>
                      <th style={thCell}>Wallet adjustment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.wallets.map((w) => {
                      const form = getForm(w.user_id);
                      return (
                        <tr key={w.account_id}>
                          <td style={tdCell}><strong>{w.userName}</strong><div style={{ fontSize: 12, color: colors.muted }}>{w.userDetail}</div></td>
                          <td style={tdCell}>{w.account_id.slice(0, 8)} · {w.currency}</td>
                          <td style={tdCell}><strong>{formatNaira(w.available_kobo)}</strong></td>
                          <td style={tdCell}>{fmtDate(w.last_transaction_at)}</td>
                          <td style={tdCell}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 300 }}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <Input placeholder="NGN" type="number" min={1} style={{ width: 80 }}
                                  value={form.credit} onChange={(e) => setForm(w.user_id, { credit: e.target.value })} />
                                <Input placeholder="Reason" style={{ width: 130 }}
                                  value={form.creditReason} onChange={(e) => setForm(w.user_id, { creditReason: e.target.value })} />
                                <Button sm variant="primary" disabled={busy === `${w.user_id}:credit`} onClick={() => void runAdjust(w.user_id, 'credit')}>
                                  Top up
                                </Button>
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <Input placeholder="NGN" type="number" min={1} style={{ width: 80 }}
                                  value={form.debit} onChange={(e) => setForm(w.user_id, { debit: e.target.value })} />
                                <Input placeholder="Reason" style={{ width: 130 }}
                                  value={form.debitReason} onChange={(e) => setForm(w.user_id, { debitReason: e.target.value })} />
                                <Button sm variant="danger" disabled={busy === `${w.user_id}:debit`} onClick={() => void runAdjust(w.user_id, 'debit')}>
                                  Deduct
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <Card title="Virtual bank accounts">
              {data.virtualAccounts.rows.length === 0 ? (
                <p style={{ color: colors.muted, margin: 0 }}>{data.virtualAccounts.error || 'No virtual accounts provisioned yet.'}</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Account</th><th style={thCell}>Bank</th><th style={thCell}>Provider</th></tr></thead>
                    <tbody>
                      {data.virtualAccounts.rows.map((a) => (
                        <tr key={a.id}>
                          <td style={tdCell}><strong>{a.account_number}</strong><div style={{ fontSize: 12, color: colors.muted }}>{a.account_name}</div></td>
                          <td style={tdCell}>{a.bank_name}</td>
                          <td style={tdCell}>{a.provider}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Tier policy">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Tier</th><th style={thCell}>Wallet limit</th><th style={thCell}>Vote limit</th></tr></thead>
                  <tbody>
                    {data.tierPolicy.map((t) => (
                      <tr key={t.tier}>
                        <td style={tdCell}><strong>Tier {t.tier}</strong></td>
                        <td style={tdCell}>{t.walletLimitKobo === null ? 'Unlimited' : formatNaira(t.walletLimitKobo)}</td>
                        <td style={tdCell}>{t.voteLimit === null ? 'Default / unlimited' : t.voteLimit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card title="Recent ledger transactions" style={{ marginBottom: 20 }}>
            {data.ledgerEntries.rows.length === 0 ? (
              <p style={{ color: colors.muted, margin: 0 }}>{data.ledgerEntries.error || 'No ledger entries found.'}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thCell}>Created</th><th style={thCell}>Type</th><th style={thCell}>Reference</th>
                      <th style={thCell}>Amount</th><th style={thCell}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledgerEntries.rows.map((e) => (
                      <tr key={e.id}>
                        <td style={tdCell}>{fmtDate(e.created_at)}</td>
                        <td style={tdCell}><Badge text={e.type} color={LEDGER_BADGE[e.type] ?? colors.muted} /></td>
                        <td style={tdCell}><strong>{e.reference}</strong></td>
                        <td style={tdCell}>{formatNaira(e.amount_kobo)}</td>
                        <td style={tdCell}>{e.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="KYC audit events">
            {data.auditEvents.length === 0 ? (
              <p style={{ color: colors.muted, margin: 0 }}>No payments-finance audit events yet this session.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>When</th><th style={thCell}>Action</th><th style={thCell}>Entity</th><th style={thCell}>Reason</th></tr></thead>
                  <tbody>
                    {data.auditEvents.map((e) => (
                      <tr key={e.id}>
                        <td style={tdCell}>{fmtDate(e.timestamp)}</td>
                        <td style={tdCell}><strong>{e.action}</strong></td>
                        <td style={tdCell}>{(e.entityId || '').slice(0, 8) || '—'}</td>
                        <td style={tdCell}>{e.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
