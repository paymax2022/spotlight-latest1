'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import {
  getReviewCampaign, getCampaignFunding, listCampaignBackers,
  setCampaignFreeze, setCampaignFlags,
} from '@/services/crowdfundingAdminService';
import type { CfReviewCampaign, CfCampaignFunding, CfBackersPage } from '@/types/crowdfunding';

// One campaign, end to end: what it is, where its money stands, and who funded
// it. The console could previously open a campaign only from the review queue,
// which shows the submission — not the funding, and not the backers.
//
// Everything here is read from the campaign's own rows. Where the schema cannot
// attribute something to a campaign (refunds and settlements carry no
// campaign_id) the page says so rather than showing a plausible zero.

function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function when(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}

const BACKERS_PAGE = 25;

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [campaign, setCampaign] = useState<CfReviewCampaign | null>(null);
  const [funding, setFunding] = useState<CfCampaignFunding | null>(null);
  const [backers, setBackers] = useState<CfBackersPage | null>(null);
  const [backersPage, setBackersPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which parts failed. One dead endpoint must not blank the whole page — an
  // operator investigating a campaign still needs whatever did load.
  const [partial, setPartial] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const failed: string[] = [];

    const [c, f] = await Promise.all([
      getReviewCampaign(id).catch((e) => { failed.push(`campaign (${e instanceof Error ? e.message : 'failed'})`); return null; }),
      getCampaignFunding(id).catch((e) => { failed.push(`funding (${e instanceof Error ? e.message : 'failed'})`); return null; }),
    ]);
    setCampaign(c);
    setFunding(f);
    setPartial(failed);
    if (!c && !f) setError('Nothing could be loaded for this campaign.');
    setLoading(false);
  }, [id]);

  const loadBackers = useCallback(async (page: number) => {
    if (!id) return;
    try {
      setBackers(await listCampaignBackers(id, page, BACKERS_PAGE));
    } catch (e) {
      setPartial((p) => [...p, `backers (${e instanceof Error ? e.message : 'failed'})`]);
      setBackers(null);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadBackers(backersPage); }, [backersPage, loadBackers]);

  const onFreeze = async () => {
    if (!campaign) return;
    const frozen = campaign.status?.toLowerCase() === 'paused';
    const note = window.prompt(frozen ? 'Unfreeze this campaign? Reason:' : 'Freeze this campaign? Contributions stop immediately. Reason:');
    if (note === null) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await setCampaignFreeze(id, !frozen, note);
      setNotice(frozen ? 'Campaign unfrozen.' : 'Campaign frozen.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Freeze failed');
    } finally { setBusy(false); }
  };

  const onFlag = async (flag: 'featured' | 'verified') => {
    setBusy(true); setError(null); setNotice(null);
    try {
      // The detail payload does not carry the flags, so this sets rather than
      // toggles — the directory row is where a toggle knows the current value.
      await setCampaignFlags(id, { [flag]: true });
      setNotice(`${flag} set. Use the directory to remove it.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Flag update failed');
    } finally { setBusy(false); }
  };

  const backerPageCount = backers ? Math.max(1, Math.ceil(backers.total / BACKERS_PAGE)) : 1;

  return (
    <Page>
      <PageHeader
        title={campaign?.title || 'Campaign'}
        subtitle={campaign ? `${campaign.category || 'uncategorised'} · ${campaign.type || '—'} · created ${when(campaign.createdAt)}` : id}
        actions={
          <>
            <Link href="/admin/crowdfunding/campaigns" style={{ textDecoration: 'none', marginRight: 8 }}>
              <Button variant="outline">All campaigns</Button>
            </Link>
            <Button variant="outline" onClick={load} disabled={busy}>Refresh</Button>
          </>
        }
      />

      {error && <Card style={{ marginBottom: 16, borderColor: colors.danger }}><div style={{ color: colors.danger, fontSize: 13 }}>{error}</div></Card>}
      {notice && <Card style={{ marginBottom: 16, borderColor: colors.success }}><div style={{ color: colors.success, fontSize: 13 }}>{notice}</div></Card>}
      {partial.length > 0 && (
        <Card style={{ marginBottom: 16, borderColor: colors.warning }}>
          <div style={{ color: colors.warning, fontSize: 13 }}>
            Partly loaded — these sections are missing, the rest is real: {partial.join('; ')}
          </div>
        </Card>
      )}

      {loading ? (
        <Card><div style={{ padding: 16, color: colors.muted, fontSize: 13 }}>Loading…</div></Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Stat label="Raised" value={funding ? naira(funding.raisedKobo) : '—'}
              sub={funding && funding.goalKobo > 0 ? `${((funding.raisedKobo / funding.goalKobo) * 100).toFixed(1)}% of ${naira(funding.goalKobo)}` : 'no goal set'} />
            <Stat label="Backers" value={funding ? String(funding.backerCount) : '—'}
              sub={funding ? `${funding.contributionCount} contribution${funding.contributionCount === 1 ? '' : 's'}` : ''} />
            <Stat label="Average contribution" value={funding ? naira(funding.averageContributionKobo) : '—'}
              sub={funding ? `largest ${naira(funding.largestContributionKobo)}` : ''} />
            <Stat label="Paid out" value={funding ? naira(funding.withdrawnKobo) : '—'}
              sub={funding && funding.pendingWithdrawalKobo > 0 ? `${naira(funding.pendingWithdrawalKobo)} awaiting approval` : `${funding?.withdrawalCount ?? 0} withdrawal request(s)`} />
            <Stat label="Milestones" value={funding ? `${funding.milestonesReleased}/${funding.milestoneCount}` : '—'} sub="released" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
            <div>
              <Card title={`Backers${backers ? ` — ${backers.total}` : ''}`}>
                {!backers ? (
                  <div style={{ padding: 16, color: colors.muted, fontSize: 13 }}>Backers could not be loaded.</div>
                ) : backers.backers.length === 0 ? (
                  <div style={{ padding: 16, color: colors.muted, fontSize: 13 }}>
                    No contributions yet. Nothing has been raised for this campaign.
                  </div>
                ) : (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={thCell}>Backer</th>
                            <th style={{ ...thCell, textAlign: 'right' }}>Amount</th>
                            <th style={thCell}>Status</th>
                            <th style={thCell}>When</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backers.backers.map((b) => (
                            <tr key={b.contributionId}>
                              <td style={tdCell}>
                                <div>{b.contributorName || '(no name on profile)'}</div>
                                <div style={{ fontSize: 11, color: colors.muted }}>
                                  {b.contributorEmail || b.contributorId.slice(0, 8)}
                                </div>
                              </td>
                              <td style={{ ...tdCell, textAlign: 'right', fontWeight: 600 }}>{naira(b.amountKobo)}</td>
                              <td style={tdCell}><Badge text={b.status || '—'} color={colors.muted} /></td>
                              <td style={{ ...tdCell, fontSize: 12, color: colors.muted }}>{when(b.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {backerPageCount > 1 && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 12 }}>
                        <Button variant="outline" disabled={backersPage <= 1} onClick={() => setBackersPage((p) => p - 1)}>Previous</Button>
                        <span style={{ fontSize: 12, color: colors.muted }}>Page {backersPage} of {backerPageCount}</span>
                        <Button variant="outline" disabled={backersPage >= backerPageCount} onClick={() => setBackersPage((p) => p + 1)}>Next</Button>
                      </div>
                    )}
                  </>
                )}
              </Card>

              {funding && funding.byStatus.length > 0 && (
                <Card title="Contributions by status" style={{ marginTop: 16 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thCell}>Status</th>
                        <th style={{ ...thCell, textAlign: 'right' }}>Count</th>
                        <th style={{ ...thCell, textAlign: 'right' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funding.byStatus.map((b) => (
                        <tr key={b.status || 'unknown'}>
                          <td style={tdCell}>{b.status || '(none)'}</td>
                          <td style={{ ...tdCell, textAlign: 'right' }}>{b.count}</td>
                          <td style={{ ...tdCell, textAlign: 'right' }}>{naira(b.amountKobo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>

            <div>
              <Card title="Manage">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Button variant="danger" onClick={onFreeze} disabled={busy || !campaign}>
                    {campaign?.status?.toLowerCase() === 'paused' ? 'Unfreeze campaign' : 'Freeze campaign'}
                  </Button>
                  <Button variant="outline" onClick={() => onFlag('featured')} disabled={busy}>Mark featured</Button>
                  <Button variant="outline" onClick={() => onFlag('verified')} disabled={busy}>Mark verified</Button>
                  <Link href={`/admin/crowdfunding/review/${id}`} style={{ textDecoration: 'none' }}>
                    <Button variant="secondary" style={{ width: '100%' }}>Open in review queue</Button>
                  </Link>
                </div>
                <div style={{ fontSize: 11, color: colors.muted, marginTop: 12, lineHeight: 1.6 }}>
                  Approving, rejecting or requesting changes happens in the review queue, which records the
                  decision and the reviewer. This page deliberately offers no direct write to campaign status.
                </div>
              </Card>

              <Card title="Campaign" style={{ marginTop: 16 }}>
                <Row k="Status" v={campaign?.status || '—'} />
                <Row k="Category" v={campaign?.category || '—'} />
                <Row k="Type" v={campaign?.type || '—'} />
                <Row k="Creator" v={campaign?.creatorName || '—'} />
                <Row k="Created" v={when(campaign?.createdAt ?? '')} />
                <Row k="Submitted" v={when(campaign?.submittedAt ?? '')} />
                <Row k="First contribution" v={when(funding?.firstContributionAt ?? '')} />
                <Row k="Latest contribution" v={when(funding?.lastContributionAt ?? '')} />
              </Card>

              <div style={{ fontSize: 11, color: colors.muted, marginTop: 12, lineHeight: 1.6 }}>
                Refunds and settlements are not shown per campaign: neither table records a campaign id in this
                schema, so attributing them here would be a guess. They are on the{' '}
                <Link href="/admin/crowdfunding/finance" style={{ color: colors.primary }}>finance</Link> and{' '}
                <Link href="/admin/crowdfunding/withdrawals" style={{ color: colors.primary }}>withdrawals</Link> pages.
              </div>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: colors.text, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ fontSize: 12, color: colors.muted }}>{k}</span>
      <span style={{ fontSize: 12, color: colors.text, textAlign: 'right' }}>{v}</span>
    </div>
  );
}
