'use client';

// Vote packages — one console surface for both halves of the job.
//
// This page merges two implementations that were built concurrently:
//   · a per-contest package manager (what voters can actually buy), and
//   · a reusable template catalog (definitions authored once and attached).
// They are two halves of one workflow, and having them on separate screens
// meant an operator had to know which one they wanted before they could look.
//
// WHY EACH HALF EXISTS
// /api/admin/voting/packages has had full CRUD behind `votes:manage` for a long
// time and nothing in the console called it, so in practice contests shipped
// with no packages — and a paid contest with no active package CANNOT be voted
// in at all, because paid-vote.service.ts prices every purchase from one.
// Separately, vote_packages.contest_id is NOT NULL, so a package belongs to
// exactly one contest and there was no way to reuse a tier: every contest meant
// retyping the same ladder, and they drifted apart.
//
// ⚠️ UNITS: `amount` is NAIRA end to end — the column, the admin API, the
// templates and both forms here. Only /api/v1/contests/[id]/vote-packages
// converts to kobo for the app. Entering kobo would price everything at 100x.

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { listVotingContests } from '@/services/competitionsService';
import {
  listVotePackages, createVotePackage, updateVotePackage, deactivateVotePackage,
  listVotePackageTemplates, createVotePackageTemplate, updateVotePackageTemplate,
  deleteVotePackageTemplate, applyTemplatesToContest, formatNaira as naira,
  getContestVotingSettings, saveContestVotingSettings,
  type VotePackage, type VotePackageTemplate, type ContestVotingSettings,
} from '@/services/votePackagesService';
import type { VotingContest } from '@/types/competitions';

type Draft = {
  name: string;
  votes: string;
  amount: string;
  bonusVotes: string;
  isRecommended: boolean;
};
const EMPTY: Draft = { name: '', votes: '', amount: '', bonusVotes: '0', isRecommended: false };

type TplDraft = Draft & { description: string; promoLabel: string; displayOrder: string; isActive: boolean };
const EMPTY_TPL: TplDraft = { ...EMPTY, description: '', promoLabel: '', displayOrder: '0', isActive: true };

function VotePackagesInner() {
  const params = useSearchParams();
  // Deep link from the contests list ("nobody can vote in this — click to fix")
  // so the operator lands on the contest they were looking at.
  const initialContestId = params.get('contestId') ?? '';

  const [contests, setContests] = useState<VotingContest[]>([]);
  const [contestId, setContestId] = useState(initialContestId);
  const [packages, setPackages] = useState<VotePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [templates, setTemplates] = useState<VotePackageTemplate[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [tplDraft, setTplDraft] = useState<TplDraft>(EMPTY_TPL);
  const [tplEditingId, setTplEditingId] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  // Voting settings for the selected contest. /api/admin/voting/settings has had
  // read and write all along and nothing called it, so "what does a vote cost"
  // and "how many free votes" had no answer in the console at all.
  const [settings, setSettings] = useState<ContestVotingSettings | null>(null);
  const [vs, setVs] = useState({ votingEnabled: false, freeVotingEnabled: true, freeVotesPerDay: '1', paidVotingEnabled: false, pricePerVoteNgn: '' });

  const contest = useMemo(() => contests.find((c) => c.id === contestId), [contests, contestId]);

  // The per-vote price the contest itself advertises, so an admin pricing a tier
  // can see whether they are matching, discounting or marking it up.
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

  const loadTemplates = useCallback(async () => {
    try {
      setTemplates(await listVotePackageTemplates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    }
  }, []);

  const loadSettings = useCallback(async () => {
    if (!contestId) return;
    try {
      const row = await getContestVotingSettings(contestId);
      setSettings(row);
      if (row) {
        setVs({
          votingEnabled: row.votingEnabled,
          freeVotingEnabled: row.freeVotingEnabled,
          freeVotesPerDay: String(row.freeVotesPerDay ?? 0),
          paidVotingEnabled: row.paidVotingEnabled || row.votePriceNgn > 0,
          pricePerVoteNgn: row.votePriceNgn ? String(row.votePriceNgn) : '',
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load voting settings');
    }
  }, [contestId]);

  async function saveSettings() {
    const price = Number(vs.pricePerVoteNgn || 0);
    if (vs.paidVotingEnabled && (!Number.isFinite(price) || price <= 0)) {
      return setError('Paid voting needs a price above zero, in naira.');
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      await saveContestVotingSettings({
        contestId,
        votingEnabled: vs.votingEnabled,
        freeVotingEnabled: vs.freeVotingEnabled,
        freeVotesPerDay: Number(vs.freeVotesPerDay || 0),
        paidVotingEnabled: vs.paidVotingEnabled,
        pricePerVoteNgn: vs.paidVotingEnabled ? price : 0,
      });
      setNotice('Voting settings saved.');
      await Promise.all([loadSettings(), loadContests(), loadPackages()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save voting settings');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void loadContests(); }, [loadContests]);
  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { void loadPackages(); }, [loadPackages]);
  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const activeCount = packages.filter((p) => p.isActive).length;
  const votable = (contest?.free_votes_per_user ?? 0) > 0 || activeCount > 0;
  const attachedTemplateIds = useMemo(
    () => new Set(packages.map((p) => p.templateId).filter(Boolean) as string[]),
    [packages],
  );

  async function submit() {
    const votes = Number(draft.votes);
    const amount = Number(draft.amount);
    if (!draft.name.trim()) return setError('Name is required');
    if (!Number.isFinite(votes) || votes <= 0) return setError('Votes must be greater than 0');
    if (!Number.isFinite(amount) || amount < 0) return setError('Amount is required');

    setBusy(true); setError(null); setNotice(null);
    try {
      const payload = {
        name: draft.name.trim(),
        votes,
        amount,
        bonusVotes: Number(draft.bonusVotes) || 0,
        isRecommended: draft.isRecommended,
      };
      if (editingId) await updateVotePackage(editingId, payload);
      else await createVotePackage({ ...payload, contestId, displayOrder: packages.length + 1 });
      setDraft(EMPTY); setEditingId(null);
      await loadPackages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function retire(pkg: VotePackage) {
    setBusy(true); setError(null);
    try {
      await deactivateVotePackage(pkg.id);
      await loadPackages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not retire the package');
    } finally {
      setBusy(false);
    }
  }

  async function attach() {
    if (!contestId || picked.length === 0) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await applyTemplatesToContest(contestId, picked);
      const parts = [`Attached ${res.applied} package${res.applied === 1 ? '' : 's'}.`];
      if (res.skipped > 0) parts.push(`${res.skipped} already on this contest.`);
      if (res.missing.length > 0) parts.push(`${res.missing.length} template(s) no longer exist.`);
      setNotice(parts.join(' '));
      setPicked([]);
      await loadPackages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach the packages');
    } finally {
      setBusy(false);
    }
  }

  async function submitTemplate() {
    const votes = Number(tplDraft.votes);
    const amount = Number(tplDraft.amount);
    if (!tplDraft.name.trim()) return setError('Template name is required');
    if (!Number.isFinite(votes) || votes <= 0) return setError('Votes must be greater than 0');
    if (!Number.isFinite(amount) || amount < 0) return setError('Amount is required');

    setBusy(true); setError(null); setNotice(null);
    try {
      const input = {
        name: tplDraft.name.trim(),
        description: tplDraft.description.trim() || undefined,
        votes,
        amount,
        bonusVotes: Number(tplDraft.bonusVotes) || 0,
        promoLabel: tplDraft.promoLabel.trim() || undefined,
        displayOrder: Number(tplDraft.displayOrder) || 0,
        isRecommended: tplDraft.isRecommended,
        isActive: tplDraft.isActive,
      };
      if (tplEditingId) await updateVotePackageTemplate(tplEditingId, input);
      else await createVotePackageTemplate(input);
      setNotice(tplEditingId ? 'Template updated.' : 'Template created — it can now be attached to any contest.');
      setTplDraft(EMPTY_TPL); setTplEditingId(null);
      await loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the template');
    } finally {
      setBusy(false);
    }
  }

  async function removeTemplate(t: VotePackageTemplate) {
    if (!window.confirm(
      `Delete the "${t.name}" template?\n\nContests already using it keep their packages — only the reusable definition goes.`,
    )) return;
    setBusy(true); setError(null);
    try {
      await deleteVotePackageTemplate(t.id);
      setNotice(`Deleted "${t.name}". Contests already using it are unaffected.`);
      if (tplEditingId === t.id) { setTplEditingId(null); setTplDraft(EMPTY_TPL); }
      await loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the template');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Page><PageHeader title="Vote Packages" /><Card><div style={{ padding: 24 }}>Loading…</div></Card></Page>;
  }

  const banner = (text: string, tone: 'danger' | 'success') => (
    <div style={{
      margin: '0 16px 16px', padding: 12, borderRadius: 6, fontSize: 13,
      background: tone === 'danger' ? '#fdecea' : '#eaf7ee',
      color: tone === 'danger' ? colors.danger : colors.success,
    }}>{text}</div>
  );

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
            onChange={(e) => { setContestId(e.target.value); setDraft(EMPTY); setEditingId(null); setPicked([]); }}
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

        {contest && !votable && banner(
          'Nobody can vote in this contest. It grants no free votes and has no active package, so there is no price to charge and no allowance to spend. Attach a template or add a package below, or give the contest free votes.',
          'danger',
        )}
        {error && banner(error, 'danger')}
        {notice && banner(notice, 'success')}

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
                  {p.templateId && (
                    <span style={{ marginLeft: 6 }}><Badge text="from template" color={colors.info} /></span>
                  )}
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

      <Card title="Voting settings" style={{ marginTop: 16 }}>
        <div style={{ padding: 16 }}>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: colors.muted }}>
            What it takes to vote at all. Free votes are the allowance every user gets; paid voting sets
            the per-vote price the packages below are measured against. Price is in <strong>naira</strong>.
            {settings && !settings.configured && ' This contest has no voting configuration yet.'}
          </p>

          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={vs.votingEnabled}
                onChange={(e) => setVs({ ...vs, votingEnabled: e.target.checked })} />
              Voting enabled
            </label>

            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={vs.freeVotingEnabled}
                onChange={(e) => setVs({ ...vs, freeVotingEnabled: e.target.checked })} />
              Free votes
            </label>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Free votes / day</label>
              <Input type="number" min={0} style={{ width: 130 }} disabled={!vs.freeVotingEnabled}
                value={vs.freeVotesPerDay}
                onChange={(e) => setVs({ ...vs, freeVotesPerDay: e.target.value })} />
            </div>

            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={vs.paidVotingEnabled}
                onChange={(e) => setVs({ ...vs, paidVotingEnabled: e.target.checked })} />
              Paid voting
            </label>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Price per vote (₦)</label>
              <Input type="number" min={0} style={{ width: 150 }} disabled={!vs.paidVotingEnabled}
                value={vs.pricePerVoteNgn} placeholder="100"
                onChange={(e) => setVs({ ...vs, pricePerVoteNgn: e.target.value })} />
            </div>

            <Button variant="primary" disabled={busy || !contestId} onClick={() => void saveSettings()}>
              {busy ? 'Saving…' : 'Save voting settings'}
            </Button>
          </div>

          {vs.paidVotingEnabled && !vs.votingEnabled && (
            <p style={{ margin: '12px 0 0', fontSize: 12, color: colors.warning }}>
              Paid voting is on but voting itself is off — nobody can buy. Turn on “Voting enabled” too.
            </p>
          )}
        </div>
      </Card>

      <Card title="Attach from the catalog" style={{ marginTop: 16 }}>
        <div style={{ padding: 16 }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: colors.muted }}>
            Attaching copies a template onto this contest. Editing the template later does not change a
            contest that is already selling votes, and deleting it does not remove what is already sold.
          </p>

          {templates.filter((t) => t.isActive).length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: colors.muted }}>
              No active templates yet — create one in the catalog below.
            </p>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
                {templates.filter((t) => t.isActive).map((t) => {
                  const already = attachedTemplateIds.has(t.id);
                  const checked = picked.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, fontSize: 13,
                        border: `1px solid ${checked ? colors.primary : colors.border}`, borderRadius: 8,
                        opacity: already ? 0.55 : 1, cursor: already ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        disabled={already}
                        checked={checked}
                        onChange={(e) => setPicked((prev) =>
                          e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id))}
                      />
                      <span>
                        <strong>{t.name}</strong>
                        {already && <span style={{ color: colors.muted, fontSize: 11 }}> · already attached</span>}
                        <div style={{ color: colors.muted, fontSize: 12 }}>
                          {t.votes.toLocaleString('en-NG')}
                          {t.bonusVotes > 0 ? ` +${t.bonusVotes.toLocaleString('en-NG')} bonus` : ''} votes
                          {' · '}{naira(t.amount)}
                        </div>
                      </span>
                    </label>
                  );
                })}
              </div>
              <Button
                variant="primary"
                style={{ marginTop: 12 }}
                disabled={busy || !contestId || picked.length === 0}
                onClick={() => void attach()}
              >
                {busy ? 'Attaching…' : `Attach ${picked.length || ''} package${picked.length === 1 ? '' : 's'}`.trim()}
              </Button>
            </>
          )}
        </div>
      </Card>

      <Card title={editingId ? 'Edit package' : 'Add a one-off package'} style={{ marginTop: 16 }}>
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
              <input type="checkbox" checked={draft.isRecommended} onChange={(e) => setDraft({ ...draft, isRecommended: e.target.checked })} />
              Recommended
            </label>
          </div>
        </div>

        <div style={{ padding: '0 16px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="primary" disabled={busy || !contestId} onClick={() => void submit()}>
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

      <Card style={{ marginTop: 16 }}>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Reusable catalog ({templates.length})</h3>
            <span style={{ fontSize: 12, color: colors.muted }}>
              Definitions authored once and attached to any contest.
            </span>
            <Button
              variant="outline"
              sm
              style={{ marginLeft: 'auto' }}
              onClick={() => setShowCatalog((v) => !v)}
            >
              {showCatalog ? 'Hide' : 'Manage catalog'}
            </Button>
          </div>

          {showCatalog && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Name</label>
                  <Input value={tplDraft.name} onChange={(e) => setTplDraft({ ...tplDraft, name: e.target.value })} placeholder="Starter pack" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Votes</label>
                  <Input type="number" min={1} value={tplDraft.votes} onChange={(e) => setTplDraft({ ...tplDraft, votes: e.target.value })} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Bonus votes</label>
                  <Input type="number" min={0} value={tplDraft.bonusVotes} onChange={(e) => setTplDraft({ ...tplDraft, bonusVotes: e.target.value })} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Price (₦, not kobo)</label>
                  <Input type="number" min={0} value={tplDraft.amount} onChange={(e) => setTplDraft({ ...tplDraft, amount: e.target.value })} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Promo label</label>
                  <Input value={tplDraft.promoLabel} onChange={(e) => setTplDraft({ ...tplDraft, promoLabel: e.target.value })} placeholder="Best value" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Display order</label>
                  <Input type="number" value={tplDraft.displayOrder} onChange={(e) => setTplDraft({ ...tplDraft, displayOrder: e.target.value })} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 18, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={tplDraft.isRecommended} onChange={(e) => setTplDraft({ ...tplDraft, isRecommended: e.target.checked })} />
                  Recommended
                </label>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={tplDraft.isActive} onChange={(e) => setTplDraft({ ...tplDraft, isActive: e.target.checked })} />
                  Offered for new contests
                </label>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  {tplEditingId && (
                    <Button variant="outline" onClick={() => { setTplEditingId(null); setTplDraft(EMPTY_TPL); }}>Cancel</Button>
                  )}
                  <Button variant="primary" disabled={busy} onClick={() => void submitTemplate()}>
                    {tplEditingId ? 'Save template' : 'Create template'}
                  </Button>
                </div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
                <thead>
                  <tr>
                    <th style={thCell}>Template</th>
                    <th style={thCell}>Votes</th>
                    <th style={thCell}>Price</th>
                    <th style={thCell}>Status</th>
                    <th style={thCell} />
                  </tr>
                </thead>
                <tbody>
                  {templates.length === 0 && (
                    <tr><td style={tdCell} colSpan={5}>No templates yet.</td></tr>
                  )}
                  {templates.map((t) => (
                    <tr key={t.id} style={{ opacity: t.isActive ? 1 : 0.5 }}>
                      <td style={tdCell}>
                        {t.name}{' '}
                        {t.isRecommended && <Badge text="Recommended" color={colors.primary} />}
                        {t.promoLabel && <span style={{ marginLeft: 6 }}><Badge text={t.promoLabel} color={colors.warning} /></span>}
                      </td>
                      <td style={tdCell}>
                        {t.votes.toLocaleString('en-NG')}
                        {t.bonusVotes > 0 && <span style={{ color: colors.success, fontSize: 12 }}> +{t.bonusVotes}</span>}
                      </td>
                      <td style={tdCell}>{naira(t.amount)}</td>
                      <td style={tdCell}>
                        <Badge text={t.isActive ? 'Active' : 'Inactive'} color={t.isActive ? colors.success : colors.muted} />
                      </td>
                      <td style={tdCell}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Button
                            variant="outline"
                            sm
                            onClick={() => {
                              setTplEditingId(t.id);
                              setTplDraft({
                                name: t.name, votes: String(t.votes), amount: String(t.amount),
                                bonusVotes: String(t.bonusVotes), isRecommended: t.isRecommended,
                                description: t.description, promoLabel: t.promoLabel,
                                displayOrder: String(t.displayOrder), isActive: t.isActive,
                              });
                            }}
                          >
                            Edit
                          </Button>
                          <Button variant="danger" sm disabled={busy} onClick={() => void removeTemplate(t)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </Page>
  );
}

export default function VotePackagesPage() {
  // useSearchParams needs a Suspense boundary under the app router.
  return (
    <Suspense fallback={<Page><PageHeader title="Vote Packages" /><Card><div style={{ padding: 24 }}>Loading…</div></Card></Page>}>
      <VotePackagesInner />
    </Suspense>
  );
}
