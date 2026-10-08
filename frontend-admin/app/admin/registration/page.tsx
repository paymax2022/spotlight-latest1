'use client';

/**
 * Registration / Applicants — the fourth Path A console (admin consolidation
 * slice 5; see docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * Contest-scoped applicants list with review actions (shortlist / approve /
 * reject / request info / waitlist / disqualify), ported from frontend-web's
 * single applicants page plus the review API route that had no admin UI
 * calling it before this.
 */
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  listRegistrationApplications,
  reviewRegistrationApplication,
  type ApplicationStatus,
  type RegistrationDraft,
} from '@/services/registrationAdminService';
import { listRegistrationContests, type RegistrationContest } from '@/services/registrationAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_BADGE: Record<string, string> = {
  draft: colors.muted,
  submitted: colors.info,
  awaiting_payment: colors.warning,
  under_review: colors.info,
  more_information_requested: colors.warning,
  shortlisted: colors.primary,
  callback_invited: colors.primary,
  approved: colors.success,
  rejected: colors.danger,
  waitlisted: colors.secondary,
  disqualified: colors.danger,
  audition_scheduled: colors.info,
  selected_for_bootcamp: colors.success,
  selected_for_public_voting: colors.success,
  eliminated: colors.danger,
  winner: colors.success,
  withdrawn: colors.muted,
};

const REVIEW_ACTIONS: { label: string; status: ApplicationStatus; variant: 'primary' | 'outline' | 'danger' | 'secondary' }[] = [
  { label: 'Shortlist', status: 'shortlisted', variant: 'primary' },
  { label: 'Approve', status: 'approved', variant: 'primary' },
  { label: 'Waitlist', status: 'waitlisted', variant: 'secondary' },
  { label: 'Request info', status: 'more_information_requested', variant: 'outline' },
  { label: 'Reject', status: 'rejected', variant: 'danger' },
  { label: 'Disqualify', status: 'disqualified', variant: 'danger' },
];

const STATUS_FILTERS: ApplicationStatus[] = [
  'submitted', 'under_review', 'more_information_requested', 'shortlisted', 'approved', 'waitlisted', 'rejected', 'disqualified',
];

const humanize = (v: string): string => v.replace(/_/g, ' ');

function field(formData: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = formData?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
  }
  return '—';
}

export default function RegistrationApplicantsPage() {
  const [contests, setContests] = useState<RegistrationContest[]>([]);
  const [contestSlug, setContestSlug] = useState('');
  const [status, setStatus] = useState<ApplicationStatus | ''>('');
  const [applications, setApplications] = useState<RegistrationDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    // Honour ?status= so links like /admin/registration?status=submitted open
    // already filtered instead of silently showing everything.
    const fromUrl = new URLSearchParams(window.location.search).get('status');
    if (fromUrl && (STATUS_FILTERS as string[]).includes(fromUrl)) setStatus(fromUrl as ApplicationStatus);
  }, []);

  useEffect(() => {
    // No auto-select. This used to jump to the first contest in the list, so the
    // page opened pre-filtered to an arbitrary contest and usually reported
    // "0 applicants" — with the real ones one dropdown change away and no hint
    // operator narrow.
    listRegistrationContests()
      .then(setContests)
      .catch(() => { /* picker is a convenience; applicants still load unfiltered */ });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setApplications(await listRegistrationApplications({ contestSlug: contestSlug || undefined, status: status || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [contestSlug, status]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!query.trim()) return applications;
    const q = query.trim().toLowerCase();
    return applications.filter((a) => {
      const data = (a.formData ?? {}) as Record<string, unknown>;
      const haystack = [
        a.reference,
        field(data, 'personal.firstName', 'account.fullName'),
        field(data, 'personal.email', 'account.email'),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [applications, query]);

  const contestTitle = useCallback(
    (slug: string) => contests.find((c) => c.slug === slug)?.title ?? slug,
    [contests],
  );

  const act = useCallback(async (id: string, status: ApplicationStatus) => {
    setActing(id);
    setError(null);
    try {
      const updated = await reviewRegistrationApplication(id, { status, note: note.trim() || undefined });
      setApplications((prev) => prev.map((a) => (a.id === id ? updated : a)));
      setNote('');
      setExpanded(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(null);
    }
  }, [note]);

  return (
    <Page>
      <PageHeader
        title="Registration / Applicants"
        subtitle="Contest applicants, read and reviewed from the real Supabase registration store over the admin web proxy."
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={contestSlug}
            onChange={(e) => setContestSlug(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13, minWidth: 220 }}
          >
            <option value="">All contests</option>
            {contests.map((c) => (
              <option key={c.slug} value={c.slug}>{c.title}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ApplicationStatus | '')}
            style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13, minWidth: 160 }}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {STATUS_FILTERS.map((st) => (
              <option key={st} value={st}>{humanize(st).replace(/^./, (c) => c.toUpperCase())}</option>
            ))}
          </select>
          <Input
            placeholder="Search name, email, reference…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <Button onClick={load} variant="outline" sm>Refresh</Button>
          <span style={{ marginLeft: 'auto', color: colors.muted, fontSize: 13 }}>
            {filtered.length} applicant{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
      </Card>

      <p style={{ color: colors.muted, fontSize: 13, margin: '0 0 12px' }}>
        This list is contest applicants only. Role and module applications (restaurant owner, doctor,
        pharmacy, seller…) are reviewed in{' '}
        <Link href="/admin/merchant-onboarding" style={{ color: colors.primary }}>Merchant Onboarding</Link>.
      </p>

      <Card>
        {loading && <p style={{ color: colors.muted }}>Loading applicants…</p>}

        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
            <p style={{ color: colors.danger, margin: 0 }}>{error}</p>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <p style={{ color: colors.muted, margin: 0 }}>No applicants found.</p>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Reference', 'Applicant', 'Email', 'Module', 'Role', 'State', 'Status', 'Updated', ''].map((h) => (
                    <th key={h} style={thCell}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const data = (a.formData ?? {}) as Record<string, unknown>;
                  const isOpen = expanded === a.id;
                  return (
                    <Fragment key={a.id}>
                      <tr>
                        <td style={tdCell}>{a.reference}</td>
                        <td style={tdCell}>{field(data, 'personal.firstName', 'account.fullName')}</td>
                        <td style={tdCell}>{field(data, 'personal.email', 'account.email')}</td>
                        <td style={tdCell}>Contest · {contestTitle(a.contestSlug)}</td>
                        <td style={tdCell}>{a.role ? humanize(a.role) : '—'}</td>
                        <td style={tdCell}>{field(data, 'personal.state', 'audition.state')}</td>
                        <td style={tdCell}>
                          <Badge text={a.status.replace(/_/g, ' ')} color={STATUS_BADGE[a.status] ?? colors.muted} />
                        </td>
                        <td style={tdCell}>{a.updatedAt ? new Date(a.updatedAt).toLocaleString('en-NG') : '—'}</td>
                        <td style={tdCell}>
                          <Button variant="outline" sm onClick={() => setExpanded(isOpen ? null : a.id)}>
                            {isOpen ? 'Close' : 'Review'}
                          </Button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ ...tdCell, background: colors.headBg }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {a.fraudFlags && a.fraudFlags.length > 0 && (
                                <p style={{ margin: 0, color: colors.danger, fontSize: 12 }}>
                                  Fraud flags: {a.fraudFlags.join(', ')}
                                </p>
                              )}
                              <textarea
                                placeholder="Review note (optional)"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={2}
                                style={{ width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13, resize: 'vertical' }}
                              />
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {REVIEW_ACTIONS.map((btn) => (
                                  <Button
                                    key={btn.status}
                                    variant={btn.variant}
                                    sm
                                    disabled={acting === a.id}
                                    onClick={() => act(a.id, btn.status)}
                                  >
                                    {acting === a.id ? 'Saving…' : btn.label}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
