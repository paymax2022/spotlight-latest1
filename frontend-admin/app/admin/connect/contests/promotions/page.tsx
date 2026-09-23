'use client';

// Contest Promotions — maker-checker review queue. A promotion is REQUESTED
// (from a child contest's "Promote top N to parent" panel, see
// app/admin/competitions/create/page.tsx) and must be APPROVED by a SECOND,
// different admin before contestants actually move (ApprovePromotion 403s
// with ErrPromotionSelfApproval when the caller is the same admin who
// requested it — verified live).
//
// Self-approval UI convention (matches app/admin/voting/approvals/page.tsx and
// app/admin/payments-finance/adjustments/page.tsx, both documented the same
// way): this page does NOT try to hide/disable Approve for "you requested
// this one" — there is no "current admin id" accessor anywhere in this admin
// console to compare against reliably, so every promotion submits normally
// and a same-admin 403 is caught and shown via its own error message, exactly
// like any other rejection.

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  listPromotions, approvePromotion, rejectPromotion, ContestPromotionError,
  type ContestPromotion, type PromotionStatus,
} from '@/services/contestPromotionService';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../../_ui';
import { Page, colors, Button } from '@/components/ui/vuexy';

const STATUSES: (PromotionStatus | 'all')[] = ['pending', 'approved', 'executed', 'rejected', 'all'];

const STATUS_BADGE: Record<string, string> = {
  pending: 'open', approved: 'investigating', executed: 'resolved', rejected: 'closed',
};

function ContestPromotionsContent() {
  const searchParams = useSearchParams();
  const childFilter = searchParams.get('childId') || '';

  const [status, setStatus] = useState<PromotionStatus | 'all'>('pending');
  const [rows, setRows] = useState<ContestPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flagOff, setFlagOff] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rejectDraft, setRejectDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFlagOff(false);
    try {
      setRows(await listPromotions(status === 'all' ? undefined : status));
    } catch (e) {
      if (e instanceof ContestPromotionError && e.status === 404) setFlagOff(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const visible = childFilter ? rows.filter((r) => r.child_contest_id === childFilter) : rows;

  const approve = useCallback(async (id: string) => {
    setBusyId(id);
    setRowError((e) => ({ ...e, [id]: '' }));
    try {
      const updated = await approvePromotion(id);
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (e) {
      const msg = e instanceof ContestPromotionError && e.status === 403
        ? (e.message.includes('different admin') ? 'Blocked: you requested this promotion — a different admin must approve it.' : e.message)
        : e instanceof Error ? e.message : 'Failed to approve';
      setRowError((prev) => ({ ...prev, [id]: msg }));
    } finally {
      setBusyId(null);
    }
  }, []);

  const reject = useCallback(async (id: string) => {
    const reason = (rejectDraft[id] || '').trim();
    if (!reason) { setRowError((e) => ({ ...e, [id]: 'A rejection reason is required.' })); return; }
    setBusyId(id);
    setRowError((e) => ({ ...e, [id]: '' }));
    try {
      const updated = await rejectPromotion(id, reason);
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (e) {
      setRowError((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : 'Failed to reject' }));
    } finally {
      setBusyId(null);
    }
  }, [rejectDraft]);

  return (
    <Page>
      <PageHeader
        title="Pending Promotions"
        subtitle="Maker-checker review for child-contest -> parent-contest contestant promotions. Approve/reject requires a different admin than the one who requested it (enforced server-side)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />

      {flagOff && (
        <Card>
          <p style={{ color: colors.warning, margin: 0, fontSize: 13 }}>
            Contest promotion is not enabled on this backend (FEATURE_CONTEST_PROMOTION_ENABLED is off).
          </p>
        </Card>
      )}
      {error && <Card><p style={{ color: colors.danger, margin: 0 }}>{error}</p></Card>}
      {childFilter && (
        <Card>
          <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>
            Filtered to child contest <code>{childFilter}</code>.
          </p>
        </Card>
      )}

      <Card>
        <label style={{ fontSize: '0.8rem', color: colors.muted, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as PromotionStatus | 'all')} style={{ padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </Card>

      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : visible.length === 0 ? (
          <p style={{ color: colors.muted }}>No promotions in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Contestant', 'Rank', 'Requested by', 'Requested', 'Status', 'Decision', ''].map((h) => <th key={h} style={th()}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td style={td()}><code style={{ fontSize: 11 }}>{p.contestant_id.slice(0, 8)}…</code></td>
                  <td style={td()}>#{p.rank_in_child}</td>
                  <td style={td()}><code style={{ fontSize: 11 }}>{p.requested_by.slice(0, 8)}…</code></td>
                  <td style={td()}>{timeAgo(p.requested_at)}</td>
                  <td style={td()}><Badge status={STATUS_BADGE[p.status] ?? 'normal'} label={p.status} /></td>
                  <td style={{ ...td(), maxWidth: 220 }}>
                    {p.status === 'rejected' && p.rejection_reason && <span style={{ fontSize: 11, color: colors.muted }}>{p.rejection_reason}</span>}
                    {p.status === 'executed' && p.new_contestant_id && <span style={{ fontSize: 11, color: colors.success }}>new contestant {p.new_contestant_id.slice(0, 8)}…</span>}
                  </td>
                  <td style={{ ...td(), textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {p.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          placeholder="reason (for reject)"
                          value={rejectDraft[p.id] || ''}
                          onChange={(e) => setRejectDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                          style={{ width: 140, padding: '0.3rem 0.4rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.35rem', fontSize: 11 }}
                        />
                        <Button sm variant="primary" disabled={busyId === p.id} onClick={() => void approve(p.id)}>
                          {busyId === p.id ? '…' : 'Approve'}
                        </Button>
                        <Button sm variant="danger" disabled={busyId === p.id} onClick={() => void reject(p.id)}>
                          Reject
                        </Button>
                      </div>
                    )}
                    {rowError[p.id] && <div style={{ color: colors.danger, fontSize: 11, marginTop: 4 }}>{rowError[p.id]}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

export default function ContestPromotionsPage() {
  return (
    <Suspense fallback={<Page><p style={{ color: colors.muted }}>Loading…</p></Page>}>
      <ContestPromotionsContent />
    </Suspense>
  );
}
