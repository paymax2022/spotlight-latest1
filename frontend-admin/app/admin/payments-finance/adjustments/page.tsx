'use client';

// Finance adjustment approvals — ADR-005 maker-checker (WAL-004).
//
// WHY THIS EXISTS
// Manual wallet credit/debit adjustments >= ₦100,000 are queued as
// 'pending_approval' by POST /api/v1/admin/adjustments (see
// frontend-web/src/server/admin/fintech/service.ts's initiateAdjustment())
// instead of executing immediately — requiring a DIFFERENT admin with
// finance:adjust:approve to approve or reject before any money moves. That
// server-side flow already existed and was already tested; this page is the
// missing checker-side UI that makes it usable (previously a large
// adjustment queued with no way to ever approve or reject it).
//
// Mirrors app/admin/voting/approvals/page.tsx's exact pattern — the
// established maker-checker UI convention in this codebase: list with a
// status filter, per-row Approve/Reject buttons, a mandatory-note reject
// flow, busy-state handling, self-approval 403 surfaced as-is, and a 409
// (already decided by someone else) treated as an expected race — refresh
// and show a plain notice, not an alarming error toast.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { formatNaira } from '@/services/paymentsFinanceAdminService';
import {
  listAdjustments, approveAdjustment, rejectAdjustment, ApprovalActionError,
  type Adjustment, type AdjustmentStatus,
} from '@/services/financeAdjustmentsService';

const STATUS_BADGE: Record<AdjustmentStatus, string> = {
  pending_approval: colors.warning,
  executed: colors.success,
  rejected: colors.danger,
  cancelled: colors.muted,
};

const STATUS_LABEL: Record<AdjustmentStatus, string> = {
  pending_approval: 'Pending approval',
  executed: 'Executed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function fmtDate(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('en-NG') : '—';
}

const FILTERS: Array<{ value: AdjustmentStatus | ''; label: string }> = [
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'executed', label: 'Executed' },
  { value: 'rejected', label: 'Rejected' },
  { value: '', label: 'All history' },
];

const textareaStyle: CSSProperties = {
  width: '100%', minHeight: 70, padding: '8px 10px', fontSize: 13,
  borderRadius: 6, border: `1px solid ${colors.border}`, fontFamily: 'inherit', resize: 'vertical',
};

export default function FinanceAdjustmentsApprovalsPage() {
  const [statusFilter, setStatusFilter] = useState<AdjustmentStatus | ''>('pending_approval');
  const [rows, setRows] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Reject decision drawer.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await listAdjustments(statusFilter ? { status: statusFilter } : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load adjustments');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4000);
  }, []);

  async function handleConflict(e: unknown, fallbackLabel: string) {
    if (e instanceof ApprovalActionError && e.status === 409) {
      setError(null);
      flash('This adjustment was already decided by another admin. The list has been refreshed.');
      await load();
      return true;
    }
    setError(e instanceof Error ? e.message : fallbackLabel);
    return false;
  }

  async function approve(a: Adjustment) {
    setBusy(a.id); setError(null);
    try {
      await approveAdjustment(a.id);
      flash(`${a.type === 'CREDIT' ? 'Credit' : 'Debit'} of ${formatNaira(a.amountKobo)} approved and executed.`);
      await load();
    } catch (e) {
      await handleConflict(e, 'Failed to approve adjustment');
    } finally {
      setBusy(null);
    }
  }

  function openReject(id: string) {
    setRejectingId(id); setNote(''); setError(null); setNotice('');
  }

  async function confirmReject() {
    if (!rejectingId) return;
    const trimmed = note.trim();
    if (trimmed.length < 5) { setError('A rejection note of at least 5 characters is required.'); return; }
    setBusy(rejectingId); setError(null);
    try {
      const target = rows.find((r) => r.id === rejectingId);
      await rejectAdjustment(rejectingId, trimmed);
      flash(`${target ? `${target.type === 'CREDIT' ? 'Credit' : 'Debit'} of ${formatNaira(target.amountKobo)}` : 'Adjustment'} rejected.`);
      setRejectingId(null);
      await load();
    } catch (e) {
      await handleConflict(e, 'Failed to reject adjustment');
    } finally {
      setBusy(null);
    }
  }

  const rejectTarget = rejectingId ? rows.find((r) => r.id === rejectingId) : null;

  return (
    <Page>
      <PageHeader
        title="Finance Adjustment Approvals"
        subtitle="Second-approver queue for wallet adjustments at or above the ₦100,000 auto-execute threshold (ADR-005). An initiator can never approve their own proposal."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/admin/payments-finance"><Button variant="outline">Back to Payments &amp; Finance</Button></Link>
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ padding: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: colors.muted }}>Status</span>
          {FILTERS.map((f) => (
            <Button
              key={f.value || 'all'}
              sm
              variant={statusFilter === f.value ? 'primary' : 'outline'}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {notice && <p style={{ color: colors.success, fontSize: 13 }}>{notice}</p>}

      {rejectTarget && (
        <Card title={`Reject ${rejectTarget.type === 'CREDIT' ? 'credit' : 'debit'} of ${formatNaira(rejectTarget.amountKobo)}`} style={{ marginBottom: 16 }}>
          <div style={{ padding: 4 }}>
            <p style={{ fontSize: 13, color: colors.text, marginTop: 0 }}>{rejectTarget.reason}</p>
            <label style={{ fontSize: 12, color: colors.muted, display: 'block', marginBottom: 6 }}>
              Rejection note (required, min 5 characters)
            </label>
            <textarea
              style={textareaStyle}
              placeholder="Why is this adjustment being rejected?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Button variant="danger" disabled={busy === rejectingId} onClick={() => void confirmReject()}>
                {busy === rejectingId ? 'Rejecting…' : 'Confirm reject'}
              </Button>
              <Button variant="outline" onClick={() => setRejectingId(null)}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <p style={{ color: colors.muted, padding: 16, margin: 0 }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted, padding: 16, margin: 0 }}>No adjustments match this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Type</th>
                  <th style={thCell}>Amount</th>
                  <th style={thCell}>Target user</th>
                  <th style={thCell}>Reason</th>
                  <th style={thCell}>Initiator</th>
                  <th style={thCell}>Created</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Checker</th>
                  <th style={thCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td style={tdCell}><Badge text={a.type} color={a.type === 'CREDIT' ? colors.success : colors.danger} /></td>
                    <td style={tdCell}><strong>{formatNaira(a.amountKobo)}</strong></td>
                    <td style={tdCell}>{a.targetUserId.slice(0, 8)}</td>
                    <td style={tdCell}>{a.reason || '—'}</td>
                    <td style={tdCell}>{a.initiatorRole || a.initiatorId}</td>
                    <td style={tdCell}>{fmtDate(a.createdAt)}</td>
                    <td style={tdCell}><Badge text={STATUS_LABEL[a.status]} color={STATUS_BADGE[a.status] ?? colors.muted} /></td>
                    <td style={tdCell}>
                      {a.checkerId ? (
                        <div>
                          <div>{a.checkerRole || a.checkerId}</div>
                          {a.checkerNote && <div style={{ fontSize: 11, color: colors.muted }}>{a.checkerNote}</div>}
                        </div>
                      ) : '—'}
                    </td>
                    <td style={tdCell}>
                      {a.status === 'pending_approval' ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button sm variant="primary" disabled={busy === a.id} onClick={() => void approve(a)}>
                            {busy === a.id ? '…' : 'Approve'}
                          </Button>
                          <Button sm variant="danger" disabled={busy === a.id} onClick={() => openReject(a.id)}>
                            Reject
                          </Button>
                        </div>
                      ) : <span style={{ color: colors.muted }}>—</span>}
                    </td>
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
