'use client';

import { useCallback, useEffect, useState } from 'react';
import { listDisputes, resolveDispute } from '@/services/restaurantAdminService';
import type { OrderDispute, DisputeStatus, DisputeResolution } from '@/types/restaurantAdmin';
import {
  PageHeader,
  Card,
  Kpi,
  Badge,
  btn,
  th,
  td,
  naira,
  RESTAURANT_PERMS,
  useRestaurantPermissions,
  AccessNotice,
} from '../_ui';

const STATUSES: (DisputeStatus | '')[] = ['', 'open', 'in_review', 'resolved', 'closed'];

const STATUS_BADGE: Record<DisputeStatus, string> = {
  open: 'no_rider',
  in_review: 'preparing',
  resolved: 'delivered',
  closed: 'cancelled',
};

const RESOLUTIONS: DisputeResolution[] = ['refunded', 'settled', 'dismissed'];

export default function DisputesPage() {
  const { can } = useRestaurantPermissions();
  const canView = can(RESTAURANT_PERMS.manage) || can(RESTAURANT_PERMS.disputes);
  const canResolve = can(RESTAURANT_PERMS.disputes);

  const [disputes, setDisputes] = useState<OrderDispute[]>([]);
  const [status, setStatus] = useState<DisputeStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [selected, setSelected] = useState<OrderDispute | null>(null);
  const [resolution, setResolution] = useState<DisputeResolution>('refunded');
  const [note, setNote] = useState('');
  const [refundNaira, setRefundNaira] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (s: DisputeStatus | '') => {
    setLoading(true);
    setError(null);
    try {
      setDisputes(await listDisputes(s));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status, load]);

  function openReview(d: OrderDispute) {
    setSelected(d);
    setResolution('refunded');
    setNote('');
    setRefundNaira((d.refundable_kobo / 100).toString());
    setError(null);
  }

  async function submit() {
    if (!selected) return;
    if (!note.trim()) {
      setError('A reviewer note is required to resolve a dispute.');
      return;
    }
    // Convert naira → integer kobo for the refund path.
    const refundKobo = resolution === 'refunded' ? Math.round(Number(refundNaira) * 100) : undefined;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await resolveDispute(selected.id, { resolution, admin_note: note, refund_kobo: refundKobo });
      setMessage(`Dispute ${selected.id} resolved as "${resolution}".`);
      setSelected(null);
      setNote('');
      await load(status);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const open = disputes.filter((d) => d.status === 'open').length;
  const inReview = disputes.filter((d) => d.status === 'in_review').length;
  const exposure = disputes.filter((d) => d.status === 'open' || d.status === 'in_review').reduce((s, d) => s + d.refundable_kobo, 0);

  if (!canView) {
    return (
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Refunds & Disputes" />
        <AccessNotice perm="restaurant.manage / restaurant.admin.disputes" />
      </div>
    );
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Refunds & Disputes"
        subtitle="Order disputes and refund approval. Resolving is a money mutation — a reviewer note is required."
        action={<button onClick={() => void load(status)} style={btn()}>Refresh</button>}
      />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {message && <p style={{ color: '#16a34a' }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Open" value={String(open)} accent={open ? '#dc2626' : '#16a34a'} />
        <Kpi label="In review" value={String(inReview)} accent="#d97706" />
        <Kpi label="Refund exposure" value={naira(exposure)} sub="max refundable, unresolved" />
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '0 0 1rem', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            style={{ ...btn(), ...(status === s ? { background: '#340075', color: '#fff', borderColor: '#340075' } : {}) }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <Card title="Disputes">
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading…</p>
        ) : disputes.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No disputes for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>Dispute</th>
                  <th style={th()}>Order</th>
                  <th style={th()}>Restaurant</th>
                  <th style={th()}>Type</th>
                  <th style={th()}>Order total</th>
                  <th style={th()}>Refundable</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Resolution</th>
                  <th style={th()}></th>
                </tr>
              </thead>
              <tbody>
                {disputes.map((d) => (
                  <tr key={d.id}>
                    <td style={td()} title={d.id}>{d.id}</td>
                    <td style={td()}>{d.order_id}</td>
                    <td style={td()}>{d.restaurant_name || d.restaurant_id || '—'}</td>
                    <td style={td()}>{d.type.replace('_', ' ')}</td>
                    <td style={td()}>{naira(d.order_total_kobo)}</td>
                    <td style={td()}>{naira(d.refundable_kobo)}</td>
                    <td style={td()}><Badge status={STATUS_BADGE[d.status]} label={d.status} /></td>
                    <td style={td()}>{d.resolution ? <Badge status={d.resolution === 'refunded' ? 'refunded' : 'delivered'} label={d.resolution} /> : '—'}</td>
                    <td style={td()}>
                      {d.status === 'open' || d.status === 'in_review' ? (
                        <button onClick={() => openReview(d)} style={btn()}>Resolve</button>
                      ) : (
                        <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <div style={{ marginTop: '1.25rem' }}>
          <Card
            title={`Resolve dispute — ${selected.id}`}
            right={<button onClick={() => setSelected(null)} style={btn()}>Close</button>}
          >
            <div style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              <div style={{ color: '#6b7280' }}>Customer {selected.customer_id} · order {selected.order_id} · ref {selected.reference}</div>
              <p style={{ marginTop: 6 }}>{selected.description}</p>
              {selected.evidence_urls?.length ? (
                <div style={{ marginTop: 4 }}>
                  Evidence: {selected.evidence_urls.map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>file {i + 1}</a>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ fontSize: '0.85rem' }}>
                <div>Resolution</div>
                <select value={resolution} onChange={(e) => setResolution(e.target.value as DisputeResolution)} style={{ ...btn(), padding: '0.35rem' }}>
                  {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>

              {resolution === 'refunded' && (
                <label style={{ fontSize: '0.85rem' }}>
                  <div>Refund amount (₦)</div>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={refundNaira}
                    onChange={(e) => setRefundNaira(e.target.value)}
                    style={{ padding: '0.35rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', width: 140 }}
                  />
                  <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                    max {naira(selected.refundable_kobo)} · posts a balanced reversing ledger entry
                  </div>
                </label>
              )}
            </div>

            <label style={{ display: 'block', fontSize: '0.85rem', margin: '0.75rem 0 4px' }}>Reviewer note (required)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Decision rationale — recorded in the immutable audit trail…"
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' }}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem', alignItems: 'center' }}>
              <button
                disabled={!canResolve || busy || !note.trim()}
                title={!canResolve ? 'Requires restaurant.admin.disputes' : !note.trim() ? 'A reviewer note is required' : 'Resolve dispute'}
                onClick={() => void submit()}
                style={{ ...btn(), background: '#340075', color: '#fff', borderColor: '#340075' }}
              >
                {busy ? '…' : 'Resolve dispute'}
              </button>
              {!canResolve && <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>You lack <code>restaurant.admin.disputes</code> — resolve is disabled. Server still enforces.</span>}
            </div>
          </Card>
        </div>
      )}

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: '#9ca3af' }}>
        Consumes the live dispute rails: <code>GET /api/finance/disputes</code> (filtered to{' '}
        <code>module_type=food</code>) and <code>POST /api/finance/admin/disputes/:id/resolve</code>{' '}
        (<code>&#123; resolution, admin_note &#125;</code>; the server binds the admin ID from the
        JWT and posts the reversing ledger entry on a refund). Money path — <code>Idempotency-Key</code>{' '}
        sent on resolve.
      </p>
    </div>
  );
}
