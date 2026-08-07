'use client';

import { useCallback, useEffect, useState } from 'react';
import { listDisputes, resolveDispute } from '@/services/restaurantAdminService';
import type { OrderDispute, DisputeStatus, DisputeResolution } from '@/types/restaurantAdmin';
import { naira, RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES: (DisputeStatus | '')[] = ['', 'open', 'in_review', 'resolved', 'closed'];

const STATUS_COLOR: Record<string, string> = {
  open: colors.danger,
  in_review: colors.warning,
  resolved: colors.success,
  closed: colors.secondary,
  refunded: colors.success,
  settled: colors.info,
  dismissed: colors.secondary,
};

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge text={label ?? status} color={STATUS_COLOR[status] ?? colors.secondary} />;
}

function KpiTile({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? colors.text, marginTop: 4 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </Card>
  );
}

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
      <Page>
        <PageHeader title="Refunds & Disputes" />
        <AccessNotice perm="restaurant.manage / restaurant.admin.disputes" />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Refunds & Disputes"
        subtitle="Order disputes and refund approval. Resolving is a money mutation — a reviewer note is required."
        actions={<Button variant="outline" onClick={() => void load(status)}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {message && <p style={{ color: colors.success }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <KpiTile label="Open" value={String(open)} accent={open ? colors.danger : colors.success} />
        <KpiTile label="In review" value={String(inReview)} accent={colors.warning} />
        <KpiTile label="Refund exposure" value={naira(exposure)} sub="max refundable, unresolved" />
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '0 0 1rem', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <Button
            key={s || 'all'}
            sm
            variant={status === s ? 'primary' : 'outline'}
            onClick={() => setStatus(s)}
          >
            {s || 'All'}
          </Button>
        ))}
      </div>

      <Card title="Disputes">
        {loading ? (
          <p style={{ color: colors.muted }}>Loading…</p>
        ) : disputes.length === 0 ? (
          <p style={{ color: colors.muted }}>No disputes for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={thCell}>Dispute</th>
                  <th style={thCell}>Order</th>
                  <th style={thCell}>Restaurant</th>
                  <th style={thCell}>Type</th>
                  <th style={thCell}>Order total</th>
                  <th style={thCell}>Refundable</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Resolution</th>
                  <th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {disputes.map((d) => (
                  <tr key={d.id}>
                    <td style={tdCell} title={d.id}>{d.id}</td>
                    <td style={tdCell}>{d.order_id}</td>
                    <td style={tdCell}>{d.restaurant_name || d.restaurant_id || '—'}</td>
                    <td style={tdCell}>{d.type.replace('_', ' ')}</td>
                    <td style={tdCell}>{naira(d.order_total_kobo)}</td>
                    <td style={tdCell}>{naira(d.refundable_kobo)}</td>
                    <td style={tdCell}><StatusBadge status={d.status} /></td>
                    <td style={tdCell}>{d.resolution ? <StatusBadge status={d.resolution} label={d.resolution} /> : '—'}</td>
                    <td style={tdCell}>
                      {d.status === 'open' || d.status === 'in_review' ? (
                        <Button sm variant="outline" onClick={() => openReview(d)}>Resolve</Button>
                      ) : (
                        <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>
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
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 16 }}>Resolve dispute — {selected.id}</strong>
              <Button sm variant="outline" onClick={() => setSelected(null)}>Close</Button>
            </div>
            <div style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              <div style={{ color: colors.muted }}>Customer {selected.customer_id} · order {selected.order_id} · ref {selected.reference}</div>
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
                <select value={resolution} onChange={(e) => setResolution(e.target.value as DisputeResolution)}>
                  {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>

              {resolution === 'refunded' && (
                <label style={{ fontSize: '0.85rem' }}>
                  <div>Refund amount (₦)</div>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={refundNaira}
                    onChange={(e) => setRefundNaira(e.target.value)}
                    style={{ width: 140 }}
                  />
                  <div style={{ fontSize: '0.72rem', color: colors.muted }}>
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
              style={{ width: '100%', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem' }}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem', alignItems: 'center' }}>
              <Button
                variant="primary"
                disabled={!canResolve || busy || !note.trim()}
                title={!canResolve ? 'Requires restaurant.admin.disputes' : !note.trim() ? 'A reviewer note is required' : 'Resolve dispute'}
                onClick={() => void submit()}
              >
                {busy ? '…' : 'Resolve dispute'}
              </Button>
              {!canResolve && <span style={{ fontSize: '0.78rem', color: colors.muted }}>You lack <code>restaurant.admin.disputes</code> — resolve is disabled. Server still enforces.</span>}
            </div>
          </Card>
        </div>
      )}

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: colors.muted }}>
        Consumes the live dispute rails: <code>GET /api/finance/disputes</code> (filtered to{' '}
        <code>module_type=food</code>) and <code>POST /api/finance/admin/disputes/:id/resolve</code>{' '}
        (<code>&#123; resolution, admin_note &#125;</code>; the server binds the admin ID from the
        JWT and posts the reversing ledger entry on a refund). Money path — <code>Idempotency-Key</code>{' '}
        sent on resolve.
      </p>
    </Page>
  );
}
