'use client';

import { useCallback, useEffect, useState } from 'react';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { ConfirmDialog } from '@/components/rbac';
import { readCurrentAdmin } from '@/components/rbac/currentAdmin';
import { hasPermission, type AuthUser } from '@/features/auth/rbac';
import {
  listRoles, approveRole, rejectRole, suspendRole, type RoleProfile,
} from '@/services/propertyRolesAdminService';

const PERMISSION = 'property.roles.review';
const STATUS_OPTIONS: Array<[string, string]> = [
  ['pending', 'Pending'],
  ['verified', 'Verified'],
  ['rejected', 'Rejected'],
  ['unverified', 'Unverified'],
];

type Pending = { kind: 'reject' | 'suspend'; profile: RoleProfile } | { kind: 'approve'; profile: RoleProfile };

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function PropertyRolesPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<RoleProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    setUser(readCurrentAdmin());
    setReady(true);
  }, []);

  const allowed = hasPermission(user, PERMISSION);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listRoles(status));
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    if (ready && allowed) void load();
  }, [ready, allowed, load]);

  const close = () => { setPending(null); setReason(''); };

  async function run() {
    if (!pending) return;
    setBusy(true);
    setActionError('');
    try {
      if (pending.kind === 'approve') await approveRole(pending.profile.id);
      else if (pending.kind === 'reject') await rejectRole(pending.profile.id, reason);
      else await suspendRole(pending.profile.id, reason);
      close();
      await load();
    } catch (e) {
      // Show the server's message verbatim (e.g. the 403 for reviewing your own profile).
      setActionError(e instanceof Error ? e.message : String(e));
      close();
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <Page><p style={{ color: colors.muted }}>Loading…</p></Page>;

  if (!allowed) {
    return (
      <Page>
        <PageHeader title="Property roles" />
        <p role="alert" style={{ color: colors.danger }}>
          You do not have access to this page. It requires the {PERMISSION} permission.
        </p>
      </Page>
    );
  }

  const needsReason = pending?.kind === 'reject';
  const reasonBlank = reason.trim() === '';

  return (
    <Page>
      <PageHeader
        title="Property roles"
        subtitle="Review realtor, agent and other property role registrations."
      />
      {error ? <p role="alert" style={{ color: colors.danger }}>{error}</p> : null}
      {actionError ? <p role="alert" style={{ color: colors.danger }}>{actionError}</p> : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: colors.muted }}>
          Status{' '}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <Button variant="outline" sm onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
        <span style={{ fontSize: 12, color: colors.muted }}>{rows.length} profile(s)</span>
      </div>

      {!loading && !error && rows.length === 0 ? (
        <p style={{ color: colors.muted, marginTop: 24 }}>No {status} role profiles.</p>
      ) : null}

      {rows.length > 0 ? (
        <Card style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Role', 'Display name', 'User ID', 'Submitted', 'Details', 'Documents', 'Status', ''].map((h) => (
                  <th key={h} style={thCell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><strong>{r.role}</strong></td>
                  <td style={tdCell}>{r.displayName || '—'}</td>
                  <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>{r.userId}</td>
                  <td style={tdCell}>{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
                  <td style={tdCell}>
                    {Object.entries(r.details ?? {}).map(([k, v]) => (
                      <div key={k} style={{ fontSize: 12 }}>
                        <span style={{ color: colors.muted }}>{k}:</span> {fmtValue(v)}
                      </div>
                    ))}
                  </td>
                  <td style={tdCell}>
                    {(r.documents ?? []).length === 0 ? '—' : (r.documents ?? []).map((d) => (
                      <div key={d.id} style={{ fontSize: 12 }}>
                        <strong>{d.kind}</strong>{' '}
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: colors.muted }}>{d.storageKey}</span>
                      </div>
                    ))}
                  </td>
                  <td style={tdCell}>
                    <Badge text={r.verificationStatus} />
                    {r.status && r.status !== r.verificationStatus ? <div style={{ fontSize: 11, color: colors.muted }}>{r.status}</div> : null}
                    {r.rejectionReason ? <div style={{ fontSize: 11, color: colors.muted }}>{r.rejectionReason}</div> : null}
                  </td>
                  <td style={{ ...tdCell, whiteSpace: 'nowrap' }}>
                    {r.verificationStatus === 'pending' ? (
                      <>
                        <Button variant="primary" sm disabled={busy} onClick={() => setPending({ kind: 'approve', profile: r })}>Approve</Button>{' '}
                        <Button variant="danger" sm disabled={busy} onClick={() => setPending({ kind: 'reject', profile: r })}>Reject</Button>{' '}
                      </>
                    ) : null}
                    <Button variant="outline" sm disabled={busy} onClick={() => setPending({ kind: 'suspend', profile: r })}>Suspend</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {pending && pending.kind === 'approve' ? (
        <ConfirmDialog
          open
          title={`Approve ${pending.profile.role} profile?`}
          level="info"
          reasons={[`${pending.profile.displayName || pending.profile.userId} will be verified for this role.`]}
          confirmLabel={busy ? 'Approving…' : 'Approve'}
          onConfirm={() => void run()}
          onCancel={close}
        />
      ) : null}

      {pending && pending.kind !== 'approve' ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={pending.kind === 'reject' ? 'Reject role profile' : 'Suspend role profile'}
          onClick={close}
          style={{ position: 'fixed', inset: 0, background: 'rgba(47,43,61,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', border: `1px solid ${colors.border}`, borderTop: `3px solid ${colors.danger}`, borderRadius: 10, maxWidth: 460, width: '100%', padding: 20 }}
          >
            <h2 style={{ margin: '0 0 8px 0', fontSize: 16, color: colors.danger }}>
              {pending.kind === 'reject' ? 'Reject' : 'Suspend'} {pending.profile.role} profile
            </h2>
            <label style={{ fontSize: 13, color: colors.muted }}>
              Reason{needsReason ? ' (required)' : ' (optional)'}
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                style={{ width: '100%', marginTop: 4 }}
                autoFocus
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <Button variant="secondary" sm onClick={close} disabled={busy}>Cancel</Button>
              <Button
                variant="danger"
                sm
                onClick={() => void run()}
                disabled={busy || (needsReason && reasonBlank)}
              >
                {busy ? 'Working…' : pending.kind === 'reject' ? 'Reject' : 'Suspend'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
