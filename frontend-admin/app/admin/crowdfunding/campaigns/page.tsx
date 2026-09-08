'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import {
  listCampaignDirectory, setCampaignFreeze, setCampaignFlags, getCategories,
} from '@/services/crowdfundingAdminService';
import type { CfDirectoryPage, CfDirectoryFilter, CfDirectoryRow, CfCategoryConfig } from '@/types/crowdfunding';

// Every campaign, with its category, status, funding and backers — the surface
// the console was missing. What existed was the REVIEW QUEUE
// (GET /admin/campaigns = AdminListPending), which shows only campaigns awaiting
// moderation, capped at 60, with no money on it at all. An operator could
// approve a campaign but could not then answer "how much has it raised, and who
// funded it".
//
// Actions here are the ones the backend already proves out — freeze/unfreeze and
// the feature/verify flags. Arbitrary status writes are NOT offered: campaign
// status transitions run through the guarded review decision endpoint
// (POST /campaigns/:id/decision), and inventing a second path into that column
// from a table row is how a moderation trail gets bypassed.

function naira(kobo: number): string {
  const n = kobo / 100;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString('en-NG')}`;
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'active': return colors.success;
    case 'funded': return colors.primary;
    case 'draft': return colors.muted;
    case 'paused': case 'frozen': return colors.warning;
    case 'rejected': case 'cancelled': return colors.danger;
    default: return colors.muted;
  }
}

const PAGE_SIZE = 25;

export default function CrowdfundingCampaignsPage() {
  const [data, setData] = useState<CfDirectoryPage | null>(null);
  const [categories, setCategories] = useState<CfCategoryConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [filter, setFilter] = useState<CfDirectoryFilter>({ page: 1, limit: PAGE_SIZE, sort: 'recent' });
  const [searchDraft, setSearchDraft] = useState('');

  const load = useCallback(async (f: CfDirectoryFilter) => {
    setLoading(true);
    setError(null);
    try {
      setData(await listCampaignDirectory(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load campaigns');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(filter); }, [filter, load]);

  // Categories drive the filter dropdown. Failing to load them must not break
  // the page — the directory is still usable without the category filter.
  useEffect(() => {
    (async () => {
      try { setCategories(await getCategories()); } catch { setCategories([]); }
    })();
  }, []);

  const patch = (p: Partial<CfDirectoryFilter>) => setFilter((f) => ({ ...f, ...p, page: p.page ?? 1 }));

  const onFreeze = async (row: CfDirectoryRow) => {
    const freeze = !row.frozen;
    const note = window.prompt(
      freeze
        ? `Freeze “${row.title}”? Contributions stop immediately. Reason (recorded in the audit log):`
        : `Unfreeze “${row.title}”? Reason:`,
    );
    if (note === null) return; // cancelled
    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      await setCampaignFreeze(row.id, freeze, note);
      setNotice(`${row.title} ${freeze ? 'frozen' : 'unfrozen'}.`);
      await load(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Freeze failed');
    } finally {
      setBusy(null);
    }
  };

  const onToggleFlag = async (row: CfDirectoryRow, flag: 'featured' | 'verified') => {
    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      await setCampaignFlags(row.id, { [flag]: !row[flag] });
      setNotice(`${row.title}: ${flag} ${row[flag] ? 'removed' : 'set'}.`);
      await load(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Flag update failed');
    } finally {
      setBusy(null);
    }
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / (filter.limit ?? PAGE_SIZE)));

  // Totals for the CURRENT page only — labelled as such, because summing a page
  // and calling it a platform total is exactly the kind of number that gets
  // quoted in a meeting and is wrong.
  const pageTotals = useMemo(() => ({
    raised: rows.reduce((s, r) => s + r.raisedKobo, 0),
    backers: rows.reduce((s, r) => s + r.backerCount, 0),
  }), [rows]);

  return (
    <Page>
      <PageHeader
        title="All campaigns"
        subtitle="Every campaign with its category, status, funding and backers. The review queue only shows those awaiting moderation."
        actions={
          <>
            <Link href="/admin/crowdfunding/review" style={{ textDecoration: 'none', marginRight: 8 }}>
              <Button variant="outline">Review queue</Button>
            </Link>
            <Button variant="outline" onClick={() => load(filter)}>Refresh</Button>
          </>
        }
      />

      {error && (
        <Card style={{ marginBottom: 16, borderColor: colors.danger }}>
          <div style={{ color: colors.danger, fontSize: 13 }}>{error}</div>
        </Card>
      )}
      {notice && (
        <Card style={{ marginBottom: 16, borderColor: colors.success }}>
          <div style={{ color: colors.success, fontSize: 13 }}>{notice}</div>
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 6 }}>
              Search title or creator id
            </label>
            <form onSubmit={(e) => { e.preventDefault(); patch({ q: searchDraft.trim() }); }}>
              <Input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="e.g. surgery" />
            </form>
          </div>
          <Filter label="Status" value={filter.status ?? ''} onChange={(v) => patch({ status: v })}
            options={[['', 'Any'], ['draft', 'Draft'], ['active', 'Active'], ['funded', 'Funded'], ['paused', 'Paused']]} />
          <Filter label="Review" value={filter.reviewStatus ?? ''} onChange={(v) => patch({ reviewStatus: v })}
            options={[['', 'Any'], ['DRAFT', 'Draft'], ['PENDING_REVIEW', 'Pending review'], ['ACTIVE', 'Approved (active)'], ['CHANGES_REQUESTED', 'Changes requested'], ['REJECTED', 'Rejected'], ['FROZEN', 'Frozen']]} />
          {/* campaigns.category stores the category SLUG — adminext/config.go counts
              with `c.category = cat.slug` — so the filter value is the slug. Using
              the row id here would silently match nothing. */}
          <Filter label="Category" value={filter.category ?? ''} onChange={(v) => patch({ category: v })}
            options={[['', 'Any'], ...categories.map((c) => [c.slug, c.label || c.slug] as [string, string])]} />
          <Filter label="Flag" value={filter.flag ?? ''} onChange={(v) => patch({ flag: v as CfDirectoryFilter['flag'] })}
            options={[['', 'Any'], ['featured', 'Featured'], ['verified', 'Verified'], ['trending', 'Trending'], ['urgent', 'Urgent'], ['frozen', 'Frozen']]} />
          <Filter label="Sort" value={filter.sort ?? 'recent'} onChange={(v) => patch({ sort: v as CfDirectoryFilter['sort'] })}
            options={[['recent', 'Newest'], ['raised', 'Most raised'], ['backers', 'Most backers'], ['goal', 'Largest goal'], ['deadline', 'Deadline']]} />
          <Button variant="outline" onClick={() => { setSearchDraft(''); setFilter({ page: 1, limit: PAGE_SIZE, sort: 'recent' }); }}>
            Clear
          </Button>
        </div>
      </Card>

      <Card
        title={loading ? 'Campaigns' : `Campaigns — ${total} match${total === 1 ? '' : 'es'}`}
      >
        {loading ? (
          <div style={{ padding: 16, color: colors.muted, fontSize: 13 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 16, color: colors.muted, fontSize: 13 }}>
            No campaigns match these filters.
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Campaign</th>
                    <th style={thCell}>Category</th>
                    <th style={thCell}>Status</th>
                    <th style={{ ...thCell, textAlign: 'right' }}>Raised / Goal</th>
                    <th style={{ ...thCell, textAlign: 'right' }}>Backers</th>
                    <th style={thCell}>Flags</th>
                    <th style={{ ...thCell, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const rowBusy = busy === r.id;
                    // The denormalised counter drifting from the real one is worth
                    // seeing, not hiding: it is what the public page shows.
                    const drift = r.storedContributorCount !== r.backerCount;
                    return (
                      <tr key={r.id} style={{ opacity: r.frozen ? 0.65 : 1 }}>
                        <td style={tdCell}>
                          <Link href={`/admin/crowdfunding/campaigns/${r.id}`} style={{ color: colors.primary, textDecoration: 'none', fontWeight: 600 }}>
                            {r.title || '(untitled)'}
                          </Link>
                          <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                            {r.creatorName || r.creatorId.slice(0, 8)}
                            {r.riskLevel ? ` · risk ${r.riskLevel.toLowerCase()}` : ''}
                          </div>
                        </td>
                        <td style={tdCell}>
                          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.category || '—'}</span>
                        </td>
                        <td style={tdCell}>
                          <Badge text={r.status || '—'} color={statusColor(r.status)} />
                          {/* The approved state is ACTIVE, not "APPROVED" — see
                              reviewTransition() in service_admin.go. Only states
                              that need an operator's attention are called out;
                              flagging ACTIVE and DRAFT would mark every row. */}
                          {['PENDING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'FROZEN'].includes(r.reviewStatus) && (
                            <div style={{ fontSize: 10, color: colors.warning, marginTop: 3 }}>{r.reviewStatus}</div>
                          )}
                          {/* Only when frozen WITHOUT review_status saying so —
                              i.e. the paused_at-only case. Otherwise the line
                              above already reads FROZEN and this duplicated it. */}
                          {r.frozen && r.reviewStatus !== 'FROZEN' && (
                            <div style={{ fontSize: 10, color: colors.danger, marginTop: 3 }}>PAUSED</div>
                          )}
                        </td>
                        <td style={{ ...tdCell, textAlign: 'right' }}>
                          <div style={{ fontWeight: 600 }}>{naira(r.raisedKobo)}</div>
                          <div style={{ fontSize: 11, color: colors.muted }}>
                            of {naira(r.goalKobo)} · {r.percentOfGoal.toFixed(0)}%
                          </div>
                        </td>
                        <td style={{ ...tdCell, textAlign: 'right' }}>
                          {r.backerCount}
                          <div style={{ fontSize: 11, color: drift ? colors.warning : colors.muted }}>
                            {r.contributionCount} contribution{r.contributionCount === 1 ? '' : 's'}
                            {drift ? ` · stored ${r.storedContributorCount}` : ''}
                          </div>
                        </td>
                        <td style={tdCell}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {r.featured && <Badge text="Featured" color={colors.primary} />}
                            {r.verified && <Badge text="Verified" color={colors.success} />}
                            {r.trending && <Badge text="Trending" color={colors.warning} />}
                            {r.urgent && <Badge text="Urgent" color={colors.danger} />}
                            {!r.featured && !r.verified && !r.trending && !r.urgent && (
                              <span style={{ color: colors.muted, fontSize: 12 }}>—</span>
                            )}
                          </div>
                        </td>
                        <td style={{ ...tdCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <Button variant="outline" onClick={() => onToggleFlag(r, 'featured')} disabled={rowBusy}>
                            {r.featured ? 'Unfeature' : 'Feature'}
                          </Button>{' '}
                          <Button variant="secondary" onClick={() => onToggleFlag(r, 'verified')} disabled={rowBusy}>
                            {r.verified ? 'Unverify' : 'Verify'}
                          </Button>{' '}
                          <Button variant={r.frozen ? 'primary' : 'danger'} onClick={() => onFreeze(r)} disabled={rowBusy}>
                            {r.frozen ? 'Unfreeze' : 'Freeze'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 12, color: colors.muted }}>
                This page: {naira(pageTotals.raised)} raised across {pageTotals.backers} backers.
                {' '}Platform-wide totals are on the{' '}
                <Link href="/admin/crowdfunding/finance" style={{ color: colors.primary }}>finance page</Link>.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button variant="outline" disabled={(filter.page ?? 1) <= 1}
                  onClick={() => setFilter((f) => ({ ...f, page: Math.max(1, (f.page ?? 1) - 1) }))}>
                  Previous
                </Button>
                <span style={{ fontSize: 12, color: colors.muted }}>
                  Page {filter.page ?? 1} of {pageCount}
                </span>
                <Button variant="outline" disabled={(filter.page ?? 1) >= pageCount}
                  onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </Page>
  );
}

function Filter({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 6 }}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '8px 10px', borderRadius: 8, border: `1px solid ${colors.border}`,
          background: '#fff', fontSize: 13, color: colors.text, minWidth: 130,
        }}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
