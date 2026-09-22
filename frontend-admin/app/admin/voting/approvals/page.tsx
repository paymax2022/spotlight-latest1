'use client';

// Contest maker-checker approvals — SEC-005/G-MC.
//
// WHY THIS EXISTS
// Vote reversal, vote count adjustment, and results publish/lock moved from
// "execute immediately" to "propose, then a second approver executes"
// (mirrors the existing Finance maker-checker feature — see
// docs/adr/ADR-005-maker-checker.md and app/admin/association/approvals/
// page.tsx for the list+Approve/Reject pattern reused here). The reject
// note input mirrors app/admin/crypto/withdrawals/page.tsx's inline
// mandatory-textarea decision card, the established convention for "action
// requires a text reason" in this codebase.
//
// Self-approval (the current admin IS the proposer) is blocked server-side
// (403) — this page does not attempt to hide buttons for that case since
// there's no established "current admin user id" accessor pattern in this
// codebase; the server's error message is shown as-is. A 409 (item already
// decided by someone else since the list loaded) is treated as an expected
// race in a multi-admin console: the list is refreshed and a plain notice
// is shown, not an alarming error toast.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import {
  listApprovals, approveItem, rejectItem, ApprovalActionError, ACTION_TYPE_LABEL,
  type ContestApproval, type ContestApprovalStatus,
} from '@/services/contestApprovalsService';

const STATUS_BADGE: Record<ContestApprovalStatus, string> = {
  pending_approval: colors.warning,
  executed: colors.success,
  rejected: colors.danger,
  cancelled: colors.muted,
};

const STATUS_LABEL: Record<ContestApprovalStatus, string> = {
  pending_approval: 'Pending approval',
  executed: 'Executed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function fmtDate(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('en-NG') : '—';
}

const FILTERS: Array<{ value: ContestApprovalStatus | ''; label: string }> = [
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'executed', label: 'Executed' },
  { value: 'rejected', label: 'Rejected' },
  { value: '', label: 'All history' },
];

const textareaStyle: CSSProperties = {
  width: '100%', minHeight: 70, padding: '8px 10px', fontSize: 13,
  borderRadius: 6, border: `1px solid ${colors.border}`, fontFamily: 'inherit', resize: 'vertical',
};

export default function ContestApprovalsPage() {
  const [statusFilter, setStatusFilter] = useState<ContestApprovalStatus | ''>('pending_approval');
  const [rows, setRows] = useState<ContestApproval[]>([]);
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
      setRows(await listApprovals(statusFilter ? { status: statusFilter } : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load approvals');
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
      flash('This item was already decided by another admin. The list has been refreshed.');
      await load();
      return true;
    }
    setError(e instanceof Error ? e.message : fallbackLabel);
    return false;
  }

  async function approve(a: ContestApproval) {
    setBusy(a.id); setError(null);
    try {
      await approveItem(a.id);
      flash(`${ACTION_TYPE_LABEL[a.actionType]} approved and executed.`);
      await load();
    } catch (e) {
      await handleConflict(e, 'Failed to approve item');
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
      await rejectItem(rejectingId, trimmed);
      flash(`${target ? ACTION_TYPE_LABEL[target.actionType] : 'Item'} rejected.`);
      setRejectingId(null);
      await load();
    } catch (e) {
      await handleConflict(e, 'Failed to reject item');
    } finally {
      setBusy(null);
    }
  }

  const rejectTarget = rejectingId ? rows.find((r) => r.id === rejectingId) : null;

  return (
    <Page>
      <PageHeader
        title="Contest Approvals"
        subtitle="Second-approver queue for sensitive vote actions — vote reversal, vote count adjustment, and results publish/lock. A proposer can never approve their own proposal."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
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
        <Card title={`Reject ${ACTION_TYPE_LABEL[rejectTarget.actionType]}`} style={{ marginBottom: 16 }}>
          <div style={{ padding: 4 }}>
            <p style={{ fontSize: 13, color: colors.text, marginTop: 0 }}>{rejectTarget.summary}</p>
            <label style={{ fontSize: 12, color: colors.muted, display: 'block', marginBottom: 6 }}>
              Rejection note (required, min 5 characters)
            </label>
            <textarea
              style={textareaStyle}
              placeholder="Why is this proposal being rejected?"
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
          <p style={{ color: colors.muted, padding: 16, margin: 0 }}>No approvals match this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Action</th>
                  <th style={thCell}>Summary</th>
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
                    <td style={tdCell}><strong>{ACTION_TYPE_LABEL[a.actionType]}</strong></td>
                    <td style={tdCell}>{a.summary || '—'}</td>
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
