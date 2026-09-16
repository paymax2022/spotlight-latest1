'use client';

// Contest prizes — admin UI to configure what each finishing position wins.
//
// WHY THIS EXISTS
// Organizers had no way to configure per-position prizes for a contest, and
// the results publish flow (see /admin/voting/results) assigns prizes to
// ranks by position, so it has nothing to assign without this screen.
//
// Mirrors the /admin/voting/templates page's contest-picker + list + CRUD
// pattern (same recent precedent) rather than adding a section to
// RegistrationContestManager-equivalent builders: this repo's contest
// builder (app/admin/competitions/create/page.tsx) is already a single large
// form managing a lot of state, and prizes are a separate per-contest
// resource with their own CRUD lifecycle (create/edit/delete independent of
// the contest record) — a standalone page keeps that state isolated and
// matches how templates/packages were already split out.

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { listVotingContests } from '@/services/competitionsService';
import {
  listContestPrizes, createContestPrize, updateContestPrize, deleteContestPrize,
  nairaToKobo, koboToNaira, formatNaira,
  type ContestPrize,
} from '@/services/contestPrizesService';
import type { VotingContest } from '@/types/competitions';

type NewDraft = { position: string; prizeDescription: string; prizeValueNgn: string };
const EMPTY_NEW: NewDraft = { position: '', prizeDescription: '', prizeValueNgn: '' };

type EditDraft = { prizeDescription: string; prizeValueNgn: string };

function ContestPrizesInner() {
  const params = useSearchParams();
  const initialContestId = params.get('contestId') ?? '';

  const [contests, setContests] = useState<VotingContest[]>([]);
  const [contestId, setContestId] = useState(initialContestId);
  const [prizes, setPrizes] = useState<ContestPrize[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newDraft, setNewDraft] = useState<NewDraft>(EMPTY_NEW);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ prizeDescription: '', prizeValueNgn: '' });

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

  const loadPrizes = useCallback(async () => {
    if (!contestId) return;
    setError(null);
    try {
      setPrizes(await listContestPrizes(contestId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load prizes');
    }
  }, [contestId]);

  useEffect(() => { void loadContests(); }, [loadContests]);
  useEffect(() => { void loadPrizes(); }, [loadPrizes]);

  async function addPrize() {
    const position = Number(newDraft.position);
    if (!position || position < 1) return setError('Position must be a positive number');
    if (!newDraft.prizeDescription.trim()) return setError('Prize description is required');
    if (!contestId) return setError('Select a contest first');

    setBusy(true); setError(null); setNotice(null);
    try {
      await createContestPrize({
        connectContestId: contestId,
        position,
        prizeDescription: newDraft.prizeDescription.trim(),
        prizeValueKobo: newDraft.prizeValueNgn ? nairaToKobo(Number(newDraft.prizeValueNgn)) : undefined,
      });
      setNotice(`Prize added for position ${position}.`);
      setNewDraft(EMPTY_NEW);
      await loadPrizes();
    } catch (e) {
      // 409: position already has a prize configured for this contest.
      setError(e instanceof Error ? e.message : 'Could not add prize');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(p: ContestPrize) {
    setEditingId(p.id);
    setEditDraft({ prizeDescription: p.prizeDescription, prizeValueNgn: p.prizeValueKobo ? String(koboToNaira(p.prizeValueKobo)) : '' });
    setError(null); setNotice(null);
  }

  async function saveEdit(p: ContestPrize) {
    if (!editDraft.prizeDescription.trim()) return setError('Prize description is required');
    setBusy(true); setError(null); setNotice(null);
    try {
      await updateContestPrize(p.id, {
        prizeDescription: editDraft.prizeDescription.trim(),
        prizeValueKobo: editDraft.prizeValueNgn ? nairaToKobo(Number(editDraft.prizeValueNgn)) : 0,
      });
      setNotice('Prize updated.');
      setEditingId(null);
      await loadPrizes();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update prize');
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: ContestPrize) {
    if (!window.confirm(`Delete the position ${p.position} prize ("${p.prizeDescription}")? This cannot be undone.`)) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await deleteContestPrize(p.id);
      setNotice(`Deleted position ${p.position} prize.`);
      if (editingId === p.id) setEditingId(null);
      await loadPrizes();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete prize');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Page><PageHeader title="Contest Prizes" /><Card><div style={{ padding: 24 }}>Loading…</div></Card></Page>;
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
        title="Contest Prizes"
        subtitle="Configure what each finishing position wins. Position is fixed after creation — delete and recreate to move it."
        actions={<Link href="/admin/competitions/list"><Button variant="outline">All contests</Button></Link>}
      />

      <Card>
        <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="contest" style={{ fontSize: 13, color: colors.muted }}>Contest</label>
          <select
            id="contest"
            value={contestId}
            onChange={(e) => { setContestId(e.target.value); setEditingId(null); }}
            style={{ padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.border}`, minWidth: 280 }}
          >
            {contests.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>

        {error && banner(error, 'danger')}
        {notice && banner(notice, 'success')}

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thCell}>Position</th>
              <th style={thCell}>Description</th>
              <th style={thCell}>Value</th>
              <th style={thCell} />
            </tr>
          </thead>
          <tbody>
            {prizes.length === 0 && (
              <tr><td style={tdCell} colSpan={4}>No prizes configured for this contest yet.</td></tr>
            )}
            {prizes.map((p) => (
              <tr key={p.id}>
                {editingId === p.id ? (
                  <>
                    <td style={tdCell}>{p.position}</td>
                    <td style={tdCell}>
                      <Input
                        value={editDraft.prizeDescription}
                        onChange={(e) => setEditDraft({ ...editDraft, prizeDescription: e.target.value })}
                        style={{ width: '100%' }}
                      />
                    </td>
                    <td style={tdCell}>
                      <Input
                        type="number" min={0} placeholder="Naira (optional)"
                        value={editDraft.prizeValueNgn}
                        onChange={(e) => setEditDraft({ ...editDraft, prizeValueNgn: e.target.value })}
                        style={{ width: 140 }}
                      />
                    </td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button variant="primary" sm disabled={busy} onClick={() => void saveEdit(p)}>
                          {busy ? 'Saving…' : 'Save'}
                        </Button>
                        <Button variant="outline" sm onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={tdCell}>{p.position}</td>
                    <td style={tdCell}>{p.prizeDescription}</td>
                    <td style={tdCell}>{p.prizeValueKobo ? formatNaira(p.prizeValueKobo) : '—'}</td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button variant="outline" sm onClick={() => startEdit(p)}>Edit</Button>
                        <Button variant="danger" sm disabled={busy} onClick={() => void remove(p)}>Delete</Button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Add prize" style={{ marginTop: 16 }}>
        <div style={{ padding: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div>
            <label htmlFor="pz-position" style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Position</label>
            <Input
              id="pz-position" type="number" min={1} placeholder="1"
              value={newDraft.position}
              onChange={(e) => setNewDraft({ ...newDraft, position: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="pz-desc" style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Prize description</label>
            <Input
              id="pz-desc" placeholder="₦500,000 cash + trophy"
              value={newDraft.prizeDescription}
              onChange={(e) => setNewDraft({ ...newDraft, prizeDescription: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="pz-value" style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Monetary value (₦, optional)</label>
            <Input
              id="pz-value" type="number" min={0} placeholder="500000"
              value={newDraft.prizeValueNgn}
              onChange={(e) => setNewDraft({ ...newDraft, prizeValueNgn: e.target.value })}
            />
          </div>
        </div>
        <div style={{ padding: '0 16px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <Button variant="primary" disabled={busy || !contestId} onClick={() => void addPrize()}>
            {busy ? 'Adding…' : 'Add prize'}
          </Button>
          {!contestId && <span style={{ fontSize: 12, color: colors.muted }}>Select a contest above first.</span>}
        </div>
      </Card>
    </Page>
  );
}

export default function ContestPrizesPage() {
  // useSearchParams needs a Suspense boundary under the app router.
  return (
    <Suspense fallback={<Page><PageHeader title="Contest Prizes" /><Card><div style={{ padding: 24 }}>Loading…</div></Card></Page>}>
      <ContestPrizesInner />
    </Suspense>
  );
}
