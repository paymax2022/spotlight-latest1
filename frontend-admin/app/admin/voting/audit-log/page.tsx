'use client';

// ── Admin — Voting Audit Log ─────────────────────────────────────────────────
// Read-only explorer for the immutable `vote_audit_logs` trail: settings
// changes, vote adjustments/reversals, and freeze/unfreeze, all written via
// appendAuditLog (frontend-web/src/server/voting/audit.service.ts — brownfield-
// protected, never edited here). Backed by
// GET /api/admin/voting/{contestId}/audit-log, gated on `votes:manage`.
//
// This is a DIFFERENT trail from `frontend-admin/audit-logs` (a generic
// in-memory admin event log) and the Go backend's own `audit_logs` — neither
// of those ever recorded a voting admin action. This is the only screen that
// can answer "what happened to this contest's votes/settings, and who did it."

import { useCallback, useEffect, useState } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { listVoteAuditLog, type VoteAuditEntry } from '@/services/voteAuditLogService';

const REQUIRED_PERMS = ['votes:manage'];
const PAGE_SIZE = 50;

function timeAgo(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return iso;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fieldLabel(): React.CSSProperties {
  return { fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, display: 'block' };
}

function ValueDiff({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  if (!value) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <span style={{ fontSize: '0.68rem', color: colors.muted, fontWeight: 600 }}>{label}</span>
      <pre style={{
        margin: '2px 0 0', fontSize: '0.72rem', background: colors.bg,
        padding: '4px 6px', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {JSON.stringify(value)}
      </pre>
    </div>
  );
}

export default function VotingAuditLogPage() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [permsLoaded, setPermsLoaded] = useState(false);

  const [contestIdInput, setContestIdInput] = useState('');
  const [contestId, setContestId] = useState<string | null>(null);

  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [offset, setOffset] = useState(0);

  const [entries, setEntries] = useState<VoteAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setAuthUser(JSON.parse(raw) as AuthUser);
    } catch { /* ignore */ }
    setPermsLoaded(true);
  }, []);

  const canView = hasAnyPermission(authUser, REQUIRED_PERMS);

  const load = useCallback(async (id: string, opts: { entityType?: string; entityId?: string; offset?: number }) => {
    setLoading(true); setError(null);
    try {
      const rows = await listVoteAuditLog(id, {
        entityType: opts.entityType || undefined,
        entityId: opts.entityId || undefined,
        limit: PAGE_SIZE,
        offset: opts.offset ?? 0,
      });
      setEntries(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleLoad() {
    const id = contestIdInput.trim();
    if (!id) { setError('Enter a contest ID.'); return; }
    setOffset(0);
    setContestId(id);
    void load(id, { entityType, entityId, offset: 0 });
  }

  function applyFilters() {
    if (!contestId) return;
    setOffset(0);
    void load(contestId, { entityType, entityId, offset: 0 });
  }

  function goPage(delta: number) {
    if (!contestId) return;
    const next = Math.max(0, offset + delta * PAGE_SIZE);
    setOffset(next);
    void load(contestId, { entityType, entityId, offset: next });
  }

  const hasNextPage = entries.length === PAGE_SIZE;

  if (permsLoaded && !canView) {
    return (
      <Page>
        <PageHeader title="Voting Audit Log" />
        <p style={{ color: colors.danger, marginTop: '1rem' }}>
          You do not have the <code>votes:manage</code> permission required to access this page.
        </p>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Voting Audit Log"
        subtitle="Immutable record of voting admin actions — settings changes, vote adjustments/reversals, freeze/unfreeze — from vote_audit_logs."
      />

      <Card>
        <span style={fieldLabel()}>Contest ID</span>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            style={{ minWidth: 320 }}
            placeholder="Enter a contest ID and click Load"
            value={contestIdInput}
            onChange={(e) => setContestIdInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLoad(); }}
          />
          <Button variant="primary" onClick={handleLoad} disabled={loading}>{loading ? 'Loading…' : 'Load'}</Button>
          {contestId ? (
            <Button onClick={() => void load(contestId, { entityType, entityId, offset })} disabled={loading}>
              Refresh
            </Button>
          ) : null}
        </div>
      </Card>

      {error ? <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p> : null}

      {!contestId && !loading ? (
        <p style={{ color: colors.muted }}>Load a contest to view its voting audit trail.</p>
      ) : null}

      {contestId ? (
        <>
          <Card>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <span style={fieldLabel()}>Entity type</span>
                <Input
                  style={{ minWidth: 200 }}
                  placeholder="e.g. voting_settings, vote"
                  value={entityType}
                  onChange={(e) => setEntityType(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
                />
              </div>
              <div>
                <span style={fieldLabel()}>Entity ID</span>
                <Input
                  style={{ minWidth: 220 }}
                  placeholder="Exact entity id"
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
                />
              </div>
              <Button onClick={applyFilters} disabled={loading}>Apply filters</Button>
              {(entityType || entityId) ? (
                <Button onClick={() => { setEntityType(''); setEntityId(''); setOffset(0); void load(contestId, { offset: 0 }); }} disabled={loading}>
                  Clear
                </Button>
              ) : null}
            </div>
          </Card>

          <Card style={{ padding: 0, overflow: 'auto' }}>
            {loading ? (
              <p style={{ color: colors.muted, padding: 14 }}>Loading audit log…</p>
            ) : entries.length === 0 ? (
              <p style={{ color: colors.muted, padding: 14 }}>No audit entries for this contest{entityType || entityId ? ' with the current filters' : ''}.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thCell}>When</th>
                    <th style={thCell}>Action</th>
                    <th style={thCell}>Actor</th>
                    <th style={thCell}>Entity</th>
                    <th style={thCell}>Reason</th>
                    <th style={thCell}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td style={{ ...tdCell, whiteSpace: 'nowrap' }} title={e.createdAt}>{timeAgo(e.createdAt)}</td>
                      <td style={tdCell}><code style={{ fontSize: '0.8rem' }}>{e.action}</code></td>
                      <td style={tdCell}>
                        {e.actorId ?? 'system'}
                        {e.actorRole ? <span style={{ color: colors.muted }}> ({e.actorRole})</span> : null}
                      </td>
                      <td style={tdCell}>
                        {e.entityType}
                        {e.entityId ? <span style={{ color: colors.muted }}>{`:${e.entityId}`}</span> : null}
                      </td>
                      <td style={tdCell}>{e.reason ?? '—'}</td>
                      <td style={{ ...tdCell, minWidth: 220 }}>
                        <ValueDiff label="Old" value={e.oldValue} />
                        <ValueDiff label="New" value={e.newValue} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={() => goPage(-1)} disabled={loading || offset === 0}>Previous</Button>
            <Button onClick={() => goPage(1)} disabled={loading || !hasNextPage}>Next</Button>
          </div>
        </>
      ) : null}
    </Page>
  );
}
