'use client';

// ── Crowdfunding — Featured campaigns ────────────────────────────────────────
// Three jobs on one screen:
//   1. Queue      — action campaign owners' requests for the featured slot.
//   2. Management — flip the featured / trending / urgent placement flags.
//   3. Reporting  — how many campaigns carry each flag, how many requests are
//      waiting, and what the featured rail is actually raising.
//
// The request queue lives HERE rather than on its own page because approving a
// request sets the very `featured` flag the management list below owns: after an
// approval the campaign appears in that list on the same screen, under one refresh
// and one mental model. The pending count also sits in the stat row, so a queue
// cannot quietly accumulate.
//
// Placement rule (enforced by the backend, mirrored here): a flag may only be set
// TRUE on an ACTIVE campaign. Turning a flag OFF is legal at any status — that is
// how a frozen or completed campaign gets pulled off the home rail — so the UI
// gates the ON direction only, and says why in the row rather than presenting a
// dead control. The same rule gates approvals, since an approval is a promotion.
// Every write renders the SERVER's copy, so a refusal can never be mistaken for a
// success.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listFeaturedCampaigns,
  setCampaignFlags,
  getFeaturedReport,
  listFeatureRequests,
  decideFeatureRequest,
} from '@/services/crowdfundingAdminService';
import type {
  CfFeaturedCampaign,
  CfFeaturedReport,
  CfCampaignFlag,
  CfCampaignStatus,
  CfFeatureRequest,
} from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, Badge, Input, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import FeatureRequestQueue from './_FeatureRequestQueue';

const STATUS_BADGE: Record<CfCampaignStatus, string> = {
  ACTIVE: colors.success,
  PENDING_REVIEW: colors.warning,
  CHANGES_REQUESTED: colors.warning,
  COMPLETED: colors.info,
  FROZEN: colors.danger,
  REJECTED: colors.muted,
};

const FLAGS: Array<{ key: CfCampaignFlag; label: string; color: string }> = [
  { key: 'featured', label: 'Featured', color: colors.primary },
  { key: 'trending', label: 'Trending', color: colors.info },
  { key: 'urgent', label: 'Urgent', color: colors.danger },
];

// Money is integer kobo. Split with integer division/modulo — never float maths —
// so a large amount cannot drift a kobo in the formatting.
function naira(kobo: number): string {
  const sign = kobo < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(kobo));
  const major = Math.trunc(abs / 100);
  const minor = abs % 100;
  return `${sign}₦${major.toLocaleString('en-NG')}${minor ? `.${String(minor).padStart(2, '0')}` : ''}`;
}

/** Integer percentage of goal raised, clamped to 100. */
function pctOfGoal(raisedKobo: number, goalKobo: number): number {
  if (goalKobo <= 0) return 0;
  return Math.min(100, Math.trunc((raisedKobo * 100) / goalKobo));
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type FilterKey = 'ALL' | 'ACTIVE' | CfCampaignFlag;
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'ACTIVE', label: 'Active only' },
  { key: 'featured', label: 'Featured' },
  { key: 'trending', label: 'Trending' },
  { key: 'urgent', label: 'Urgent' },
];

/** `value` accepts a string so a stat whose figure is UNKNOWN can render '—' rather than a misleading 0. */
function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <Card style={{ flex: '1 1 10rem', minWidth: '9rem' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, marginTop: 4 }}>
        {typeof value === 'number' ? value.toLocaleString('en-NG') : value}
      </div>
    </Card>
  );
}

export default function FeaturedCampaignsAdminPage() {
  const [campaigns, setCampaigns] = useState<CfFeaturedCampaign[]>([]);
  const [report, setReport] = useState<CfFeaturedReport | null>(null);
  const [requests, setRequests] = useState<CfFeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [search, setSearch] = useState('');

  /**
   * The queue is loaded SEPARATELY from the campaign list and report, and its
   * failure is scoped to the queue.
   *
   * The feature-request endpoints are newer than the rest of this page: folding
   * them into the same Promise.all would mean a 404 (backend not yet deployed, flag
   * off, route renamed) blanks the whole screen and takes flag management down with
   * it. Campaign management must keep working when the queue cannot load.
   */
  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      setRequests(await listFeatureRequests());
      setRequestsError(null);
      setRequestErrors({});
    } catch (e) {
      setRequests([]);
      setRequestsError(errMsg(e));
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    void loadRequests();
    try {
      const [list, rep] = await Promise.all([listFeaturedCampaigns(), getFeaturedReport()]);
      setCampaigns(list);
      setReport(rep);
      setRowErrors({});
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [loadRequests]);
  useEffect(() => { void load(); }, [load]);

  /**
   * Approve or reject one feature request.
   *
   * An approval sets the campaign's `featured` flag server-side, so the campaign
   * list and the report are reloaded alongside the queue — otherwise the row below
   * would keep claiming the campaign is not featured. Nothing is rendered
   * optimistically: the returned request replaces the row, then everything is
   * refetched from the server.
   */
  const decide = useCallback(async (r: CfFeatureRequest, approve: boolean, note: string) => {
    const key = `${r.id}:${approve ? 'approve' : 'reject'}`;
    setRequestBusy(key);
    setRequestErrors((prev) => {
      if (!prev[r.id]) return prev;
      const rest = { ...prev };
      delete rest[r.id];
      return rest;
    });
    try {
      const updated = await decideFeatureRequest(r.id, approve, note);
      setRequests((prev) => prev.map((x) => (x.id === r.id ? updated : x)));
      const [list, rep] = await Promise.all([listFeaturedCampaigns(), getFeaturedReport()]);
      setCampaigns(list);
      setReport(rep);
      await loadRequests();
    } catch (e) {
      setRequestErrors((prev) => ({ ...prev, [r.id]: errMsg(e) }));
      // The write failed — re-read server truth so the row cannot be left showing a
      // decision that was never persisted. Deliberately NOT loadRequests(): that
      // clears the row errors, which would wipe the refusal we just recorded.
      try {
        setRequests(await listFeatureRequests());
      } catch { /* keep the row error visible */ }
    } finally {
      setRequestBusy(null);
    }
  }, [loadRequests]);

  async function toggle(c: CfFeaturedCampaign, flag: CfCampaignFlag) {
    const next = !c[flag];
    // Defence in depth: the control is already disabled for this case, but never
    // fire a write the backend is guaranteed to refuse.
    if (next && c.status !== 'ACTIVE') return;

    const key = `${c.id}:${flag}`;
    setBusy(key);
    setRowErrors((prev) => {
      if (!prev[c.id]) return prev;
      const rest = { ...prev };
      delete rest[c.id];
      return rest;
    });
    try {
      const updated = await setCampaignFlags(c.id, { [flag]: next });
      // Render what the server returned, not the optimistic flip.
      setCampaigns((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...updated } : x)));
      setReport(await getFeaturedReport());
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [c.id]: errMsg(e) }));
      // The write failed — re-read server truth so the row cannot be left showing
      // a state that was never persisted.
      try { setCampaigns(await listFeaturedCampaigns()); } catch { /* keep the row error visible */ }
    } finally {
      setBusy(null);
    }
  }

  // Prefer the server's own tally when the report carries one; otherwise count the
  // queue. The report endpoint predates the queue, so `pendingRequestCount` is
  // optional and the stat card must be right either way.
  const pendingRequestCount = useMemo(
    () => report?.pendingRequestCount ?? requests.filter((r) => r.status === 'PENDING').length,
    [report, requests],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (filter === 'ACTIVE' && c.status !== 'ACTIVE') return false;
      if (filter !== 'ALL' && filter !== 'ACTIVE' && !c[filter]) return false;
      if (q && !c.title.toLowerCase().includes(q) && !c.category.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [campaigns, filter, search]);

  return (
    <Page>
      <PageHeader
        title="Featured Campaigns"
        subtitle="Action owners' requests for the featured slot, promote campaigns onto the discovery rails, and report on what the featured slots are raising. Only ACTIVE campaigns can be promoted."
        actions={<Button variant="outline" sm onClick={() => void load()} disabled={loading}>Refresh</Button>}
      />

      {error && (
        <Card style={{ borderColor: tint(colors.danger, 0.4), marginBottom: '1rem' }}>
          <span style={{ color: colors.danger, fontSize: 13 }}>{error}</span>
        </Card>
      )}

      {/* ── Reporting ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <Stat label="Featured" value={report?.featuredCount ?? 0} color={colors.primary} />
        <Stat label="Trending" value={report?.trendingCount ?? 0} color={colors.info} />
        <Stat label="Urgent" value={report?.urgentCount ?? 0} color={colors.danger} />
        <Stat label="Active campaigns" value={report?.activeCount ?? 0} color={colors.success} />
        {/* When the queue could not be loaded the count is unknown, not zero — a
            "0" here would report "no work waiting" on no evidence. */}
        <Stat
          label="Pending requests"
          value={requestsError ? '—' : pendingRequestCount}
          color={requestsError ? colors.danger : pendingRequestCount > 0 ? colors.warning : colors.muted}
        />
      </div>

      {/* ── Owner feature requests ────────────────────────────────────────── */}
      <FeatureRequestQueue
        requests={requests}
        loading={requestsLoading}
        loadError={requestsError}
        busyKey={requestBusy}
        errors={requestErrors}
        onApprove={(r) => void decide(r, true, '')}
        onReject={(r, note) => void decide(r, false, note)}
        onRetry={() => void loadRequests()}
      />

      <Card title="Featured rail performance" style={{ marginBottom: '1.25rem' }}>
        {!report ? (
          <p style={{ color: colors.muted, fontSize: 13 }}>Loading…</p>
        ) : report.featured.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, margin: '0.5rem 0 0' }}>
            Nothing is featured right now — the discovery rail is empty.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '32rem' }}>
              <thead>
                <tr>
                  <th style={thCell}>Campaign</th>
                  <th style={{ ...thCell, textAlign: 'right' }}>Raised</th>
                  <th style={{ ...thCell, textAlign: 'right' }}>Backers</th>
                </tr>
              </thead>
              <tbody>
                {report.featured.map((f) => (
                  <tr key={f.id}>
                    <td style={tdCell}>{f.title}</td>
                    <td style={{ ...tdCell, textAlign: 'right', fontWeight: 700 }}>{naira(f.raisedKobo)}</td>
                    <td style={{ ...tdCell, textAlign: 'right' }}>{f.contributorCount.toLocaleString('en-NG')}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...tdCell, fontWeight: 700 }}>Total across {report.featured.length} featured</td>
                  <td style={{ ...tdCell, textAlign: 'right', fontWeight: 800 }}>
                    {naira(report.featured.reduce((s, f) => s + f.raisedKobo, 0))}
                  </td>
                  <td style={{ ...tdCell, textAlign: 'right', fontWeight: 700 }}>
                    {report.featured.reduce((s, f) => s + f.contributorCount, 0).toLocaleString('en-NG')}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Management ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTERS.map((f) => (
          <Button key={f.key} variant={filter === f.key ? 'primary' : 'outline'} sm onClick={() => setFilter(f.key)}>
            {f.label}
          </Button>
        ))}
        <Input
          placeholder="Search title or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginLeft: 'auto', maxWidth: '16rem' }}
        />
      </div>

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : visible.length === 0 ? (
        <p style={{ color: colors.muted }}>No campaigns match this filter.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {visible.map((c) => {
            const promotable = c.status === 'ACTIVE';
            const rowError = rowErrors[c.id];
            return (
              <Card key={c.id} style={{ borderColor: rowError ? tint(colors.danger, 0.5) : colors.border }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 20rem', minWidth: '16rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                      <Badge text={c.status} color={STATUS_BADGE[c.status] ?? colors.muted} />
                      <span style={{ fontSize: 12, color: colors.muted }}>{c.category}</span>
                      {c.verified && <Badge text="VERIFIED" color={colors.success} />}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{c.title}</div>
                    <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                      {naira(c.raisedKobo)} of {naira(c.goalKobo)} ({pctOfGoal(c.raisedKobo, c.goalKobo)}%) ·{' '}
                      {c.contributorCount.toLocaleString('en-NG')} backers · created {new Date(c.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {FLAGS.map((f) => {
                        const on = c[f.key];
                        // Turning a flag ON needs ACTIVE; turning it OFF is always allowed.
                        const blocked = !on && !promotable;
                        const key = `${c.id}:${f.key}`;
                        return (
                          <Button
                            key={f.key}
                            sm
                            variant={on ? 'primary' : 'outline'}
                            disabled={blocked || busy === key}
                            title={blocked ? `Only an ACTIVE campaign can be promoted — this one is ${c.status}.` : on ? `Remove the ${f.label.toLowerCase()} flag` : `Set the ${f.label.toLowerCase()} flag`}
                            aria-pressed={on}
                            style={blocked ? { opacity: 0.45, cursor: 'not-allowed' } : on ? { background: f.color, borderColor: f.color } : undefined}
                            onClick={() => void toggle(c, f.key)}
                          >
                            {busy === key ? '…' : `${on ? '✓ ' : ''}${f.label}`}
                          </Button>
                        );
                      })}
                    </div>
                    {!promotable && (
                      <span style={{ fontSize: 11, color: colors.muted, textAlign: 'right', maxWidth: '20rem' }}>
                        {c.featured || c.trending || c.urgent
                          ? `Status is ${c.status} — promotion flags can only be REMOVED, not added.`
                          : `Status is ${c.status} — only ACTIVE campaigns can be promoted.`}
                      </span>
                    )}
                  </div>
                </div>

                {rowError && (
                  <p style={{ color: colors.danger, fontSize: 12, margin: '0.6rem 0 0' }}>
                    Update rejected — nothing changed: {rowError}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
