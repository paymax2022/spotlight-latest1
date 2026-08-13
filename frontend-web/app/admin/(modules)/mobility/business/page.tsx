'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getBusinessAccounts, setBusinessAccountStatus,
  getBusinessDeliveries, setBusinessDeliveryStatus,
  getBusinessInvoices, issueBusinessInvoice, markBusinessInvoicePaid,
} from '@/services/mobilityLogisticsAdminService';
import type {
  BusinessAccountRow, BusinessAccountStatus,
  BusinessDeliveryRow, DeliveryStatus,
  BusinessInvoiceRow,
} from '@/types/mobilityModes';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice, Kpi,
  btn, btnPrimary, btnDisabled, input, nairaFull,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';
import { colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const DELIVERY_FILTER: Array<DeliveryStatus | ''> = ['', 'created', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled'];
const DELIVERY_OPTIONS: DeliveryStatus[] = ['created', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled'];
// Sensitive delivery transitions that always require an audited reason.
const DELIVERY_SENSITIVE: DeliveryStatus[] = ['failed', 'cancelled'];
// Account statuses requiring an audited reason (suspend / close).
const ACCOUNT_OPTIONS: BusinessAccountStatus[] = ['active', 'suspended', 'closed'];
const ACCOUNT_SENSITIVE: BusinessAccountStatus[] = ['suspended', 'closed'];

export default function MobilityBusinessPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.businessManage);

  const [accounts, setAccounts] = useState<BusinessAccountRow[]>([]);
  const [deliveries, setDeliveries] = useState<BusinessDeliveryRow[]>([]);
  const [invoices, setInvoices] = useState<BusinessInvoiceRow[]>([]);
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  // account status modal
  const [acct, setAcct] = useState<BusinessAccountRow | null>(null);
  const [acctForm, setAcctForm] = useState<{ status: BusinessAccountStatus; reason: string }>({ status: 'active', reason: '' });

  // delivery status modal
  const [delivery, setDelivery] = useState<BusinessDeliveryRow | null>(null);
  const [delForm, setDelForm] = useState<{ status: DeliveryStatus; reason: string }>({ status: 'created', reason: '' });

  // invoice action modal
  const [invoiceAction, setInvoiceAction] = useState<{ inv: BusinessInvoiceRow; kind: 'issue' | 'paid' } | null>(null);
  const [invReason, setInvReason] = useState('');

  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [a, d, i] = await Promise.all([
        getBusinessAccounts(),
        getBusinessDeliveries(deliveryFilter),
        getBusinessInvoices(),
      ]);
      setAccounts(a); setDeliveries(d); setInvoices(i);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [deliveryFilter]);

  useEffect(() => { void load(); }, [load]);

  const openAcct = (a: BusinessAccountRow) => { setAcct(a); setAcctForm({ status: a.status, reason: '' }); };
  const openDelivery = (d: BusinessDeliveryRow) => { setDelivery(d); setDelForm({ status: d.status, reason: '' }); };

  const submitAcct = async () => {
    if (!acct) return;
    if (ACCOUNT_SENSITIVE.includes(acctForm.status) && !acctForm.reason.trim()) { setError('A reason is required to suspend or close an account.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await setBusinessAccountStatus(acct.id, { status: acctForm.status, reason: acctForm.reason.trim() || undefined });
      setMessage(`Account ${acct.id} → ${acctForm.status} (audited).`);
      setAcct(null); await load();
    } catch (e) { setError(`Update failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const submitDelivery = async () => {
    if (!delivery) return;
    if (DELIVERY_SENSITIVE.includes(delForm.status) && !delForm.reason.trim()) { setError('A reason is required to fail or cancel a delivery.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await setBusinessDeliveryStatus(delivery.id, { status: delForm.status, reason: delForm.reason.trim() || undefined });
      setMessage(`Delivery ${delivery.id} → ${delForm.status} (audited).`);
      setDelivery(null); await load();
    } catch (e) { setError(`Update failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const submitInvoice = async () => {
    if (!invoiceAction) return;
    if (!invReason.trim()) { setError('A reason is required for this invoice action.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      if (invoiceAction.kind === 'issue') await issueBusinessInvoice(invoiceAction.inv.id, invReason.trim());
      else await markBusinessInvoicePaid(invoiceAction.inv.id, invReason.trim());
      setMessage(`Invoice ${invoiceAction.inv.id} ${invoiceAction.kind === 'issue' ? 'issued' : 'marked paid'} (audited).`);
      setInvoiceAction(null); setInvReason(''); await load();
    } catch (e) { setError(`Invoice action failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const activeAccounts = accounts.filter((a) => a.status === 'active').length;
  const inFlight = deliveries.filter((d) => !['delivered', 'failed', 'cancelled'].includes(d.status)).length;
  const unpaidInvoices = invoices.filter((i) => i.status !== 'paid').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Business Logistics"
        subtitle="Business accounts, bulk deliveries, escrow and monthly invoices."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="business" />
      <AuditedNotice text="Account status, delivery resolution and invoicing require the mobility.business.manage role." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Active accounts" value={String(activeAccounts)} accent={colors.success} />
        <Kpi label="In-flight deliveries" value={String(inFlight)} accent={colors.info} />
        <Kpi label="Unpaid invoices" value={String(unpaidInvoices)} accent={unpaidInvoices ? colors.danger : colors.success} />
      </div>

      {/* ── Accounts ── */}
      <Card title="Business accounts">
        {!canManage && <StateNote kind="restricted">You have read-only access — account status actions are disabled for your role.</StateNote>}
        {loading ? <StateNote kind="loading">Loading accounts…</StateNote>
          : accounts.length === 0 ? <StateNote kind="empty">No business accounts.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Account</th><th style={thCell}>Billing</th><th style={thCell}>COD</th><th style={thCell}>Status</th><th style={thCell}>Wallet</th><th style={thCell}>Vol/mo</th><th style={thCell}></th>
              </tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={tdCell}><strong>{a.name}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{a.ownerName} · {a.accountType}</div></td>
                    <td style={tdCell}><Badge status={a.billingMode === 'prepaid' ? 'active' : 'pending'} label={a.billingMode} /></td>
                    <td style={tdCell}>{a.codEnabled ? 'Yes' : 'No'}</td>
                    <td style={tdCell}><Badge status={a.status} /></td>
                    <td style={tdCell}>{a.billingMode === 'prepaid' ? nairaFull(a.walletBalanceKobo) : <span style={{ color: colors.muted }}>invoice</span>}</td>
                    <td style={tdCell}>{a.monthlyVolume.toLocaleString()}</td>
                    <td style={tdCell}><button style={btn()} onClick={() => openAcct(a)}>{canManage ? 'Manage' : 'View'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {/* ── Deliveries ── */}
      <Card
        title="Deliveries"
        right={
          <select value={deliveryFilter} onChange={(e) => setDeliveryFilter(e.target.value as DeliveryStatus | '')} style={{ ...input(), width: 'auto' }}>
            {DELIVERY_FILTER.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        }
      >
        {!canManage && <StateNote kind="restricted">You have read-only access — delivery actions are disabled for your role.</StateNote>}
        {loading ? <StateNote kind="loading">Loading deliveries…</StateNote>
          : deliveries.length === 0 ? <StateNote kind="empty">No deliveries match this filter.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Delivery</th><th style={thCell}>Route</th><th style={thCell}>Status</th><th style={thCell}>Courier</th><th style={thCell}>Fare / COD</th><th style={thCell}>Escrow</th><th style={thCell}></th>
              </tr></thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} style={{ borderBottom: `1px solid ${colors.border}`, background: d.status === 'failed' ? tint(colors.danger, 0.08) : undefined }}>
                    <td style={tdCell}><strong>{d.id}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{d.accountName} · {d.size}{d.batchId ? ` · batch ${d.batchId}` : ''}</div></td>
                    <td style={tdCell}>{d.pickupAddress}<div style={{ fontSize: '0.72rem', color: colors.muted }}>→ {d.dropoffAddress} · {d.receiverName}</div></td>
                    <td style={tdCell}><Badge status={d.status} /></td>
                    <td style={tdCell}>{d.courierName ?? <span style={{ color: colors.muted }}>unassigned</span>}</td>
                    <td style={tdCell}>{nairaFull(d.fareKobo)}{d.codKobo > 0 ? <div style={{ fontSize: '0.72rem', color: colors.muted }}>COD {nairaFull(d.codKobo)}</div> : null}</td>
                    <td style={tdCell}><Badge status={d.escrowStatus} /></td>
                    <td style={tdCell}><button style={btn()} onClick={() => openDelivery(d)}>{canManage ? 'Manage' : 'View'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {/* ── Invoices ── */}
      <Card title="Invoices">
        {!canManage && <StateNote kind="restricted">You have read-only access — invoice actions are disabled for your role.</StateNote>}
        {loading ? <StateNote kind="loading">Loading invoices…</StateNote>
          : invoices.length === 0 ? <StateNote kind="empty">No invoices.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Invoice</th><th style={thCell}>Account</th><th style={thCell}>Period</th><th style={thCell}>Deliveries</th><th style={thCell}>Amount</th><th style={thCell}>Status</th><th style={thCell}></th>
              </tr></thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: `1px solid ${colors.border}`, background: inv.status === 'overdue' ? tint(colors.danger, 0.08) : undefined }}>
                    <td style={tdCell}><strong>{inv.id}</strong></td>
                    <td style={tdCell}>{inv.accountName}</td>
                    <td style={tdCell}>{inv.periodLabel}</td>
                    <td style={tdCell}>{inv.deliveryCount.toLocaleString()}</td>
                    <td style={tdCell}>{nairaFull(inv.amountKobo)}</td>
                    <td style={tdCell}><Badge status={inv.status} /></td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {inv.status === 'open' && (
                          <button disabled={!canManage} style={canManage ? btnPrimary() : btnDisabled()} onClick={() => { setInvoiceAction({ inv, kind: 'issue' }); setInvReason(''); }}>Issue</button>
                        )}
                        {(inv.status === 'issued' || inv.status === 'overdue') && (
                          <button disabled={!canManage} style={canManage ? btnPrimary(colors.success) : btnDisabled()} onClick={() => { setInvoiceAction({ inv, kind: 'paid' }); setInvReason(''); }}>Mark paid</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {/* Account status modal */}
      {acct && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setAcct(null)}>
          <div style={{ background: colors.card, borderRadius: '0.5rem', padding: '1.25rem', width: 'min(480px, 94vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{acct.name}</h2>
              <Badge status={acct.status} />
            </div>
            <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0 0 1rem' }}>{acct.ownerName} · {acct.accountType} · {acct.billingMode} · COD {acct.codEnabled ? 'on' : 'off'}</p>
            {!canManage ? (
              <StateNote kind="restricted">Read-only — your role cannot update accounts.</StateNote>
            ) : (
              <>
                <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Account status
                  <select value={acctForm.status} onChange={(e) => setAcctForm((f) => ({ ...f, status: e.target.value as BusinessAccountStatus }))} style={{ ...input(), marginTop: 4 }}>
                    {ACCOUNT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: '0.75rem' }}>
                  Reason {ACCOUNT_SENSITIVE.includes(acctForm.status) ? '(required)' : '(optional)'}
                  <textarea value={acctForm.reason} onChange={(e) => setAcctForm((f) => ({ ...f, reason: e.target.value }))} rows={2} style={{ ...input(), marginTop: 4, fontFamily: 'inherit' }} />
                </label>
              </>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setAcct(null)}>Close</button>
              {canManage && <button style={busy ? btnDisabled() : btnPrimary()} disabled={busy} onClick={submitAcct}>{busy ? 'Saving…' : 'Save status (audited)'}</button>}
            </div>
          </div>
        </div>
      )}

      {/* Delivery status modal */}
      {delivery && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setDelivery(null)}>
          <div style={{ background: colors.card, borderRadius: '0.5rem', padding: '1.25rem', width: 'min(560px, 94vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{delivery.id}</h2>
              <Badge status={delivery.status} /><Badge status={delivery.escrowStatus} />
            </div>
            <p style={{ fontSize: '0.82rem', color: colors.text, margin: '0 0 0.25rem' }}>{delivery.accountName} · {delivery.size} · {delivery.zone}</p>
            <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0 0 0.5rem' }}>{delivery.pickupAddress} → {delivery.dropoffAddress} · {delivery.receiverName}</p>
            <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0 0 1rem' }}>Fare {nairaFull(delivery.fareKobo)} · COD {nairaFull(delivery.codKobo)} · Courier {delivery.courierName ?? '—'}{delivery.failureReason ? ` · Failure: ${delivery.failureReason}` : ''}</p>
            {delivery.podProofUrl
              ? <p style={{ fontSize: '0.8rem', margin: '0 0 0.75rem' }}><a href={delivery.podProofUrl} target="_blank" rel="noreferrer">View POD proof →</a></p>
              : <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0 0 0.75rem' }}>No proof submitted yet.</p>}
            {!canManage ? (
              <StateNote kind="restricted">Read-only — your role cannot update deliveries.</StateNote>
            ) : (
              <>
                <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Update status
                  <select value={delForm.status} onChange={(e) => setDelForm((f) => ({ ...f, status: e.target.value as DeliveryStatus }))} style={{ ...input(), marginTop: 4 }}>
                    {DELIVERY_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: '0.75rem' }}>
                  Reason {DELIVERY_SENSITIVE.includes(delForm.status) ? '(required)' : '(optional)'}
                  <textarea value={delForm.reason} onChange={(e) => setDelForm((f) => ({ ...f, reason: e.target.value }))} rows={2} style={{ ...input(), marginTop: 4, fontFamily: 'inherit' }} />
                </label>
              </>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setDelivery(null)}>Close</button>
              {canManage && <button style={busy ? btnDisabled() : btnPrimary()} disabled={busy} onClick={submitDelivery}>{busy ? 'Saving…' : 'Save status (audited)'}</button>}
            </div>
          </div>
        </div>
      )}

      {/* Invoice action modal */}
      {invoiceAction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setInvoiceAction(null)}>
          <div style={{ background: colors.card, borderRadius: '0.5rem', padding: '1.25rem', width: 'min(440px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>{invoiceAction.kind === 'issue' ? 'Issue invoice' : 'Mark invoice paid'}</h2>
            <p style={{ fontSize: '0.85rem', color: colors.muted, margin: '0 0 0.75rem' }}>{invoiceAction.inv.accountName} · {invoiceAction.inv.periodLabel} · {nairaFull(invoiceAction.inv.amountKobo)}</p>
            <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Reason (required — written to audit log)</label>
            <textarea value={invReason} onChange={(e) => setInvReason(e.target.value)} rows={3} placeholder={invoiceAction.kind === 'issue' ? 'e.g. Period closed, charges reconciled.' : 'e.g. Bank transfer confirmed, ref #...'} style={{ ...input(), marginTop: 4, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setInvoiceAction(null)}>Cancel</button>
              <button style={busy || !invReason.trim() ? btnDisabled() : btnPrimary(invoiceAction.kind === 'paid' ? colors.success : colors.info)} disabled={busy || !invReason.trim()} onClick={submitInvoice}>{busy ? 'Saving…' : 'Confirm (audited)'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
