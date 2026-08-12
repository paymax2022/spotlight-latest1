'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell, type ButtonVariant } from '@/components/ui/vuexy';
import {
  listRegistrations,
  getRegistration,
  updateRegistrationStatus,
  participantName,
  participantEmail,
  PROMOTABLE_STATUSES,
  type AdminRegistration,
  type RegistrationStatus,
  type RegistrationStatusEvent,
} from '@/services/participantsService';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';

const statusColor: Record<string, string> = {
  draft: colors.muted,
  submitted: colors.warning,
  awaiting_payment: colors.warning,
  under_review: colors.info,
  more_information_requested: colors.info,
  shortlisted: colors.info,
  callback_invited: colors.info,
  approved: colors.success,
  selected_for_public_voting: colors.success,
  selected_for_bootcamp: colors.success,
  winner: colors.success,
  rejected: colors.danger,
  disqualified: colors.danger,
  eliminated: colors.danger,
  waitlisted: colors.muted,
  audition_scheduled: colors.info,
  withdrawn: colors.muted,
};

const FILTER_STATUSES: RegistrationStatus[] = [
  'draft', 'submitted', 'awaiting_payment', 'under_review',
  'more_information_requested', 'shortlisted', 'callback_invited',
  'approved', 'selected_for_public_voting', 'selected_for_bootcamp',
  'rejected', 'disqualified', 'eliminated', 'waitlisted',
  'audition_scheduled', 'winner', 'withdrawn',
];

/** Actions offered in the review drawer, in the order a reviewer works through them. */
const REVIEW_ACTIONS: { status: RegistrationStatus; label: string; tone: ButtonVariant }[] = [
  { status: 'under_review', label: 'Start review', tone: 'outline' },
  { status: 'more_information_requested', label: 'Request info', tone: 'outline' },
  { status: 'shortlisted', label: 'Shortlist', tone: 'outline' },
  { status: 'approved', label: 'Approve → roster', tone: 'primary' },
  { status: 'selected_for_public_voting', label: 'Send to public voting', tone: 'primary' },
  { status: 'rejected', label: 'Reject', tone: 'danger' },
  { status: 'disqualified', label: 'Disqualify', tone: 'danger' },
];

function label(status: string): string {
  return status.replace(/_/g, ' ');
}

export default function ParticipantsPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [rows, setRows] = useState<AdminRegistration[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // Review drawer state
  const [selected, setSelected] = useState<AdminRegistration | null>(null);
  const [events, setEvents] = useState<RegistrationStatusEvent[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setLoading(true);
    try {
      const { items, total: t } = await listRegistrations({
        status: filterStatus || undefined,
        search: search.trim() || undefined,
        limit: 200,
      });
      setRows(items);
      setTotal(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load participants');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, search]);

  // Debounced so typing in the search box doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Live updates: a mobile entry submitted or another reviewer's decision shows
  // up without a refresh. Quiet reload so the table doesn't flash a spinner.
  useRealtimeTable('registrations', () => {
    setLive(true);
    void load({ quiet: true });
  });

  const openReview = useCallback(async (reg: AdminRegistration) => {
    setSelected(reg);
    setNote('');
    setActionError(null);
    setEvents([]);
    try {
      const detail = await getRegistration(reg.id);
      setSelected(detail.registration);
      setEvents(detail.statusEvents);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to load review history');
    }
  }, []);

  const applyStatus = useCallback(async (status: RegistrationStatus) => {
    if (!selected) return;
    setSaving(true);
    setActionError(null);
    try {
      const result = await updateRegistrationStatus(selected.id, status, note.trim());
      setFlash(
        result.promoted
          ? `${participantName(result.registration)} is on the voting roster.`
          : result.removed
            ? `${participantName(result.registration)} was removed from the roster.`
            : `Status set to ${label(status)}.`,
      );
      setSelected(null);
      setNote('');
      await load({ quiet: true });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update status');
    } finally {
      setSaving(false);
    }
  }, [selected, note, load]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const onRoster = useMemo(() => rows.filter((r) => r.contestantId).length, [rows]);

  return (
    <Page>
      <PageHeader
        title="Participants & Entries"
        subtitle="Review submissions and publish approved entries to the voting roster."
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {live && (
              <span style={{ fontSize: '0.75rem', color: colors.success, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors.success, display: 'inline-block' }} />
                Live
              </span>
            )}
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      {flash && (
        <Card style={{ marginBottom: 16, borderLeft: `3px solid ${colors.success}`, color: colors.success, fontSize: '0.88rem' }}>
          {flash}
        </Card>
      )}

      {error && (
        <Card style={{ marginBottom: 16, borderLeft: `3px solid ${colors.danger}` }}>
          <strong style={{ color: colors.danger }}>Could not load participants:</strong>
          <div style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 6 }}>{error}</div>
          <div style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 10 }}>
            Check that the API is reachable and that your admin role has the <code>contestant.view</code> permission.
          </div>
        </Card>
      )}

      <Card title="Search & Filter" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
          <Input
            placeholder="Search by name, email, or reference..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{
              padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
              fontSize: '0.85rem', background: colors.card, cursor: 'pointer', color: colors.text,
              textTransform: 'capitalize',
            }}
          >
            <option value="">All Status</option>
            {FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>{label(s)}</option>
            ))}
          </select>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: colors.muted }}>Loading participants...</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Reference</th>
                    <th style={thCell}>Name</th>
                    <th style={thCell}>Email</th>
                    <th style={thCell}>Competition</th>
                    <th style={thCell}>Status</th>
                    <th style={thCell}>Roster</th>
                    <th style={thCell}>Progress</th>
                    <th style={thCell}>Submitted</th>
                    <th style={thCell}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td style={{ ...tdCell, color: colors.muted, textAlign: 'center' }} colSpan={9}>
                        {search || filterStatus ? 'No participants match your search.' : 'No participants yet.'}
                      </td>
                    </tr>
                  ) : (
                    rows.map((p) => (
                      <tr key={p.id}>
                        <td style={{ ...tdCell, fontSize: '0.8rem', fontFamily: 'monospace', color: colors.muted }}>{p.reference}</td>
                        <td style={tdCell}><strong>{participantName(p)}</strong></td>
                        <td style={{ ...tdCell, color: colors.muted, fontSize: '0.8rem' }}>{participantEmail(p) || '—'}</td>
                        <td style={tdCell}>{p.contestSlug}</td>
                        <td style={tdCell}>
                          <Badge text={label(p.status)} color={statusColor[p.status] || colors.muted} />
                        </td>
                        <td style={tdCell}>
                          {p.contestantId
                            ? <Badge text="on roster" color={colors.success} />
                            : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>}
                        </td>
                        <td style={tdCell}>{p.completionPercent}%</td>
                        <td style={{ ...tdCell, color: colors.muted, fontSize: '0.85rem' }}>
                          {p.submittedAt ? new Date(p.submittedAt).toLocaleDateString('en-NG') : '—'}
                        </td>
                        <td style={tdCell}>
                          <Button variant="outline" sm onClick={() => void openReview(p)}>Review</Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 14px', borderTop: `1px solid ${colors.border}`, fontSize: '0.85rem', color: colors.muted }}>
              Showing {rows.length} of {total} participants · {onRoster} on the voting roster
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
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '1rem',
          }}
          onClick={() => !saving && setSelected(null)}
        >
          <div
            style={{ maxWidth: 620, width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
          <Card style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: colors.text }}>Review entry</h2>
              <button
                onClick={() => setSelected(null)}
                disabled={saving}
                aria-label="Close"
                style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: colors.muted }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gap: '0.6rem', fontSize: '0.85rem' }}>
              <div><span style={{ color: colors.muted }}>Reference:</span> <strong style={{ fontFamily: 'monospace' }}>{selected.reference}</strong></div>
              <div><span style={{ color: colors.muted }}>Name:</span> <strong>{participantName(selected)}</strong></div>
              <div><span style={{ color: colors.muted }}>Email:</span> {participantEmail(selected) || '—'}</div>
              <div><span style={{ color: colors.muted }}>Competition:</span> {selected.contestSlug}</div>
              <div>
                <span style={{ color: colors.muted }}>Status:</span>{' '}
                <Badge text={label(selected.status)} color={statusColor[selected.status] || colors.muted} />
              </div>
              <div><span style={{ color: colors.muted }}>Progress:</span> <strong>{selected.completionPercent}%</strong></div>
              <div>
                <span style={{ color: colors.muted }}>Voting roster:</span>{' '}
                {selected.contestantId
                  ? <Badge text="published" color={colors.success} />
                  : <span style={{ color: colors.muted }}>not published</span>}
              </div>
            </div>

            {events.length > 0 && (
              <div style={{ marginTop: '1.1rem' }}>
                <div style={{ fontSize: '0.8rem', color: colors.muted, marginBottom: 6 }}>Review history</div>
                <div style={{ display: 'grid', gap: 4, fontSize: '0.8rem' }}>
                  {events.map((ev) => (
                    <div key={ev.id} style={{ color: colors.muted }}>
                      {new Date(ev.createdAt).toLocaleString('en-NG')} ·{' '}
                      {ev.oldStatus ? `${label(ev.oldStatus)} → ` : ''}
                      <strong style={{ color: colors.text }}>{label(ev.newStatus)}</strong>
                      {ev.actorRole ? ` · ${ev.actorRole}` : ''}
                      {ev.note ? ` · "${ev.note}"` : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: '1.1rem' }}>
              <label style={{ fontSize: '0.8rem', color: colors.muted, display: 'block', marginBottom: 6 }}>
                Note (recorded in the review trail)
              </label>
              <Input
                placeholder="Optional note explaining this decision..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {actionError && (
              <div style={{ marginTop: '0.9rem', color: colors.danger, fontSize: '0.83rem' }}>{actionError}</div>
            )}

            <div style={{ marginTop: '1.1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {REVIEW_ACTIONS.filter((a) => a.status !== selected.status).map((a) => (
                <Button
                  key={a.status}
                  sm
                  variant={a.tone}
                  disabled={saving}
                  onClick={() => void applyStatus(a.status)}
                >
                  {a.label}
                </Button>
              ))}
            </div>

            <div style={{ marginTop: '0.8rem', fontSize: '0.75rem', color: colors.muted }}>
              {PROMOTABLE_STATUSES.includes(selected.status)
                ? 'This entry is on the voting roster. Rejecting removes it from voting but keeps votes already cast.'
                : 'Approving publishes this entry to the voting roster so it appears in the mobile app.'}
            </div>

            <div style={{ marginTop: '1rem' }}>
              <Button variant="outline" disabled={saving} onClick={() => setSelected(null)}>Close</Button>
            </div>
          </Card>
          </div>
        </div>
      )}
    </Page>
  );
}
