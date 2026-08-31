'use client';

// Vote packages — the console surface that did not exist.
//
// /api/admin/voting/packages has always had full CRUD behind `votes:manage`,
// and nothing in the console called it. The consequence was not cosmetic: a
// contest with paid voting on and no packages CANNOT be voted in, because
// paid-vote.service.ts prices every purchase from a package. "September Open Mic
// Challenge" shipped open, with a contestant on the roster, and no way for
// anyone to vote.
//
// Migration 20270127000000 now seeds a default ladder from the contest's own
// per-vote price so that state cannot recur. This page is how a human curates
// it afterwards — and how the remaining unvotable contests get resolved.
//
// ⚠️ `amount` is NAIRA here, end to end: the column, the admin API and this
// form all use naira, and only /api/v1/contests/[id]/vote-packages converts to
// kobo for the app. Entering kobo would price every package at 100x.

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { listVotingContests } from '@/services/competitionsService';
import {
  listVotePackages, createVotePackage, updateVotePackage, deactivateVotePackage,
  type VotePackage,
} from '@/services/votePackagesService';
import type { VotingContest } from '@/types/competitions';

const naira = (n: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(n);

type Draft = {
  name: string;
  votes: string;
  amount: string;
  bonusVotes: string;
  isRecommended: boolean;
};

const EMPTY: Draft = { name: '', votes: '', amount: '', bonusVotes: '0', isRecommended: false };

export default function VotePackagesPage() {
  const [contests, setContests] = useState<VotingContest[]>([]);
  const [contestId, setContestId] = useState('');
  const [packages, setPackages] = useState<VotePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  const contest = useMemo(
    () => contests.find((c) => c.id === contestId),
    [contests, contestId],
  );

  // The per-vote price the contest itself advertises. Shown so an admin pricing
  // a tier can see whether they are matching, discounting or marking it up.
  const perVoteNaira = (contest?.paid_vote_kobo ?? 0) / 100;

  const loadContests = useCallback(async () => {
    try {
      const rows = await listVotingContests();
      setContests(rows);
      setContestId((current) => current || rows[0]?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contests');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPackages = useCallback(async () => {
    if (!contestId) return;
    setError(null);
    try {
      setPackages(await listVotePackages(contestId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load packages');
    }
  }, [contestId]);

  useEffect(() => { void loadContests(); }, [loadContests]);
  useEffect(() => { void loadPackages(); }, [loadPackages]);

  const activeCount = packages.filter((p) => p.isActive).length;
  const votable = (contest?.free_votes_per_user ?? 0) > 0 || activeCount > 0;

  async function submit() {
    const votes = Number(draft.votes);
    const amount = Number(draft.amount);
    if (!draft.name.trim()) return setError('Name is required');
    if (!Number.isFinite(votes) || votes <= 0) return setError('Votes must be greater than 0');
    if (!Number.isFinite(amount) || amount < 0) return setError('Amount is required');

    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await updateVotePackage(editingId, {
          name: draft.name.trim(),
          votes,
          amount,
          bonusVotes: Number(draft.bonusVotes) || 0,
          isRecommended: draft.isRecommended,
        });
      } else {
        await createVotePackage({
          contestId,
          name: draft.name.trim(),
          votes,
          amount,
          bonusVotes: Number(draft.bonusVotes) || 0,
          isRecommended: draft.isRecommended,
          displayOrder: packages.length + 1,
        });
      }
      setDraft(EMPTY);
      setEditingId(null);
      await loadPackages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function retire(pkg: VotePackage) {
    setBusy(true);
    setError(null);
    try {
      await deactivateVotePackage(pkg.id);
      await loadPackages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not retire the package');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Page><PageHeader title="Vote Packages" /><Card><div style={{ padding: 24 }}>Loading…</div></Card></Page>;

  return (
    <Page>
      <PageHeader
        title="Vote Packages"
        subtitle="What voters can buy. A paid contest with no active package cannot be voted in at all."
        actions={<Link href="/admin/competitions/list"><Button variant="outline">All contests</Button></Link>}
      />

      <Card>
        <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="contest" style={{ fontSize: 13, color: colors.muted }}>Contest</label>
          <select
            id="contest"
            value={contestId}
            onChange={(e) => { setContestId(e.target.value); setDraft(EMPTY); setEditingId(null); }}
            style={{ padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.border}`, minWidth: 280 }}
          >
            {contests.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>

          {contest && (
            <>
              <Badge text={votable ? 'Votable' : 'NOT VOTABLE'} color={votable ? colors.success : colors.danger} />
              <span style={{ fontSize: 12, color: colors.muted }}>
                {perVoteNaira > 0 ? `Contest price: ${naira(perVoteNaira)}/vote` : 'No per-vote price set'}
                {' · '}
                {(contest.free_votes_per_user ?? 0) > 0
                  ? `${contest.free_votes_per_user} free vote(s)/user`
                  : 'no free votes'}
              </span>
            </>
          )}
        </div>

        {contest && !votable && (
          <div style={{ margin: '0 16px 16px', padding: 12, borderRadius: 6, background: '#fdecea', color: colors.danger, fontSize: 13 }}>
            Nobody can vote in this contest. It grants no free votes and has no active package, so
            there is no price to charge and no allowance to spend. Add a package below, or give the
            contest free votes.
          </div>
        )}

        {error && (
          <div style={{ margin: '0 16px 16px', padding: 12, borderRadius: 6, background: '#fdecea', color: colors.danger, fontSize: 13 }}>
            {error}
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thCell}>Package</th>
              <th style={thCell}>Votes</th>
              <th style={thCell}>Bonus</th>
              <th style={thCell}>Price</th>
              <th style={thCell}>Per vote</th>
              <th style={thCell}>Status</th>
              <th style={thCell} />
            </tr>
          </thead>
          <tbody>
            {packages.length === 0 && (
              <tr><td style={tdCell} colSpan={7}>No packages yet for this contest.</td></tr>
            )}
            {packages.map((p) => (
              <tr key={p.id} style={{ opacity: p.isActive ? 1 : 0.5 }}>
                <td style={tdCell}>
                  {p.name}{' '}
                  {p.isRecommended && <Badge text="Recommended" color={colors.primary} />}
                </td>
                <td style={tdCell}>{p.votes}</td>
                <td style={tdCell}>{p.bonusVotes || '—'}</td>
                <td style={tdCell}>{naira(p.amount)}</td>
                <td style={tdCell}>{p.votes > 0 ? naira(p.amount / p.votes) : '—'}</td>
                <td style={tdCell}>
                  <Badge text={p.isActive ? 'Active' : 'Retired'} color={p.isActive ? colors.success : colors.muted} />
                </td>
                <td style={tdCell}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingId(p.id);
                        setDraft({
                          name: p.name,
                          votes: String(p.votes),
                          amount: String(p.amount),
                          bonusVotes: String(p.bonusVotes),
                          isRecommended: p.isRecommended,
                        });
                      }}
                    >
                      Edit
                    </Button>
                    {p.isActive && (
                      // Deactivate, never delete: purchased votes reference this row.
                      <Button variant="danger" disabled={busy} onClick={() => void retire(p)}>Retire</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title={editingId ? 'Edit package' : 'Add a package'}>
        <div style={{ padding: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div>
            <label htmlFor="pkg-name" style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Name</label>
            <Input id="pkg-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Starter Pack" />
          </div>
          <div>
            <label htmlFor="pkg-votes" style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Votes</label>
            <Input id="pkg-votes" type="number" min={1} value={draft.votes} onChange={(e) => setDraft({ ...draft, votes: e.target.value })} placeholder="10" />
          </div>
          <div>
            <label htmlFor="pkg-bonus" style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Bonus votes</label>
            <Input id="pkg-bonus" type="number" min={0} value={draft.bonusVotes} onChange={(e) => setDraft({ ...draft, bonusVotes: e.target.value })} />
          </div>
          <div>
            <label htmlFor="pkg-amount" style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>
              Price (₦, not kobo)
            </label>
            <Input id="pkg-amount" type="number" min={0} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="1000" />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={draft.isRecommended}
                onChange={(e) => setDraft({ ...draft, isRecommended: e.target.checked })}
              />
              Recommended
            </label>
          </div>
        </div>

        <div style={{ padding: '0 16px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <Button disabled={busy || !contestId} onClick={() => void submit()}>
            {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add package'}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={() => { setEditingId(null); setDraft(EMPTY); }}>Cancel</Button>
          )}
          {Number(draft.votes) > 0 && Number(draft.amount) >= 0 && draft.amount !== '' && (
            <span style={{ fontSize: 12, color: colors.muted }}>
              = {naira(Number(draft.amount) / Number(draft.votes))} per vote
              {perVoteNaira > 0 && ` (contest price ${naira(perVoteNaira)})`}
            </span>
          )}
        </div>
      </Card>
    </Page>
  );
}
