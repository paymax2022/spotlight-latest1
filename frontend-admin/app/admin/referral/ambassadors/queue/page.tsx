'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import {
  listAmbassadorQueue,
  setAmbassadorStatus,
  type AmbassadorQueueRow,
  type AmbassadorDecision,
} from '@/services/referralAdminOpsService';

// A-AMB-Q — Ambassador approval queue.
//
// Applications land at status 'applied' and stay there until an admin decides.
// Nothing else in the product drives that transition, so without this screen
// every application accumulates unactioned.

const STATUSES = ['applied', 'approved', 'suspended', 'rejected', 'all'] as const;

const statusColor: Record<string, string> = {
  applied: colors.warning,
  approved: colors.success,
  suspended: colors.danger,
  rejected: colors.muted,
};

/** Decisions offered per current status — an approved ambassador is not re-approved. */
function decisionsFor(status: string): { value: AmbassadorDecision; label: string; variant: 'primary' | 'danger' }[] {
  switch (status) {
    case 'applied':
      return [
        { value: 'approved', label: 'Approve', variant: 'primary' },
        { value: 'rejected', label: 'Reject', variant: 'danger' },
      ];
    case 'approved':
      return [{ value: 'suspended', label: 'Suspend', variant: 'danger' }];
    case 'suspended':
      return [
        { value: 'approved', label: 'Reinstate', variant: 'primary' },
        { value: 'rejected', label: 'Reject', variant: 'danger' },
      ];
    case 'rejected':
      return [{ value: 'approved', label: 'Approve', variant: 'primary' }];
    default:
      return [];
  }
}

export default function AmbassadorQueuePage() {
  const [rows, setRows] = useState<AmbassadorQueueRow[]>([]);
  const [status, setStatus] = useState<string>('applied');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [selected, setSelected] = useState<AmbassadorQueueRow | null>(null);

  const load = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setLoading(true);
    try {
      setRows(await listAmbassadorQueue(status));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applications');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const decide = useCallback(async (row: AmbassadorQueueRow, decision: AmbassadorDecision) => {
    setBusyId(row.id);
    setError(null);
    try {
      await setAmbassadorStatus(row.id, decision);
      setFlash(`Application ${decision}.`);
      setSelected(null);
      await load({ quiet: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update the application');
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.userId.toLowerCase().includes(q) || r.tier.toLowerCase().includes(q));
  }, [rows, search]);

  const pending = useMemo(() => rows.filter((r) => r.status === 'applied').length, [rows]);

  return (
    <Page>
      <PageHeader
        title="Ambassador applications"
        subtitle="Review and decide ambassador programme applications."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />

      {flash && (
        <Card style={{ marginBottom: 16, borderLeft: `3px solid ${colors.success}`, color: colors.success, fontSize: '0.88rem' }}>
          {flash}
        </Card>
      )}

      {error && (
        <Card style={{ marginBottom: 16, borderLeft: `3px solid ${colors.danger}` }}>
          <strong style={{ color: colors.danger }}>Something went wrong:</strong>
          <div style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 6 }}>{error}</div>
          <div style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 10 }}>
            Deciding needs the <code>referral.amb.manage</code> permission; viewing needs <code>referral.amb.view</code>.
          </div>
        </Card>
      )}

      <Card title="Filter" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
          <Input placeholder="Search by user id or tier..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{
              padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
              fontSize: '0.85rem', background: colors.card, cursor: 'pointer', color: colors.text,
              textTransform: 'capitalize',
            }}
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: colors.muted }}>Loading applications...</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Applicant</th>
                    <th style={thCell}>Tier</th>
                    <th style={thCell}>Status</th>
                    <th style={thCell}>Disclosure</th>
                    <th style={thCell}>Applied</th>
                    <th style={thCell}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td style={{ ...tdCell, color: colors.muted, textAlign: 'center' }} colSpan={6}>
                        {status === 'applied' ? 'No applications waiting for review.' : 'Nothing matches this filter.'}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r) => (
                      <tr key={r.id}>
                        <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: '0.78rem', color: colors.muted }}>{r.userId}</td>
                        <td style={{ ...tdCell, textTransform: 'capitalize' }}>{r.tier}</td>
                        <td style={tdCell}><Badge text={r.status} color={statusColor[r.status] || colors.muted} /></td>
                        <td style={tdCell}>
                          {r.disclosureAcceptedAt
                            ? <Button variant="outline" sm onClick={() => setSelected(r)}>View</Button>
                            : <span style={{ color: colors.danger, fontSize: '0.8rem' }}>missing</span>}
                        </td>
                        <td style={{ ...tdCell, color: colors.muted, fontSize: '0.85rem' }}>
                          {r.appliedAt ? new Date(r.appliedAt).toLocaleDateString('en-NG') : '—'}
                        </td>
                        <td style={tdCell}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {decisionsFor(r.status).map((d) => (
                              <Button
                                key={d.value}
                                sm
                                variant={d.variant}
                                disabled={busyId === r.id}
                                onClick={() => void decide(r, d.value)}
                              >
                                {d.label}
                              </Button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 14px', borderTop: `1px solid ${colors.border}`, fontSize: '0.85rem', color: colors.muted }}>
              Showing {filtered.length} of {rows.length} · {pending} awaiting review
            </div>
          </>
        )}
      </Card>

      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem',
          }}
          onClick={() => setSelected(null)}
        >
          <div style={{ maxWidth: 560, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <Card style={{ maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem', color: colors.text }}>Accepted disclosure</h2>
                <button
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                  style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: colors.muted }}
                >
                  ✕
                </button>
              </div>
              <div style={{ fontSize: '0.85rem', color: colors.muted, marginBottom: 10 }}>
                Accepted {selected.disclosureAcceptedAt ? new Date(selected.disclosureAcceptedAt).toLocaleString('en-NG') : '—'}
              </div>
              {/* The stored text is the compliance record — show it verbatim, not a summary. */}
              <div style={{
                background: colors.inputBorder + '20', padding: '0.9rem', borderRadius: '0.375rem',
                fontSize: '0.85rem', lineHeight: 1.6, color: colors.text, whiteSpace: 'pre-wrap',
              }}>
                {selected.disclosureText || 'No disclosure text was stored with this application.'}
              </div>
              <div style={{ marginTop: '1rem', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {decisionsFor(selected.status).map((d) => (
                  <Button
                    key={d.value}
                    sm
                    variant={d.variant}
                    disabled={busyId === selected.id}
                    onClick={() => void decide(selected, d.value)}
                  >
                    {d.label}
                  </Button>
                ))}
                <Button variant="outline" sm onClick={() => setSelected(null)}>Close</Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </Page>
  );
}
