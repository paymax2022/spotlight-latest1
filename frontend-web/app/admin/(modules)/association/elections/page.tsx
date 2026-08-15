'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  listElections, createElection,
  type AdminElectionSummary, type ElectionRole,
} from '@/services/associationAdminService';
import { PageHeader, AssociationTabs, Card, Badge, DisclosureNote, StateBlock, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select, fmtDate } from '../_ui';

type DraftPosition = { title: string; seats: number; role: ElectionRole };
const ROLE_OPTIONS: { v: ElectionRole; l: string }[] = [
  { v: '', l: 'Ceremonial (no role)' },
  { v: 'NATIONAL_ADMIN', l: 'National Admin' },
  { v: 'CHAPTER_ADMIN', l: 'Chapter Admin' },
  { v: 'FINANCE_ADMIN', l: 'Finance Admin (Treasurer)' },
  { v: 'SECRETARY', l: 'Secretary' },
];

export default function ElectionsPage() {
  const [rows, setRows] = useState<AdminElectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [goodStanding, setGoodStanding] = useState(true);
  const [positions, setPositions] = useState<DraftPosition[]>([{ title: '', seats: 1, role: '' }]);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listElections()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function setPos(i: number, patch: Partial<DraftPosition>) {
    setPositions((p) => p.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  const toIso = (v: string) => (v ? new Date(v).toISOString() : null);

  async function submit() {
    const cleanPositions = positions.filter((p) => p.title.trim());
    if (!title.trim() || cleanPositions.length === 0) { setMsg('A title and at least one named position are required.'); return; }
    setCreating(true); setMsg(null);
    try {
      const res = await createElection({
        title: title.trim(), description: description.trim() || undefined,
        votingOpensAt: toIso(opensAt), votingClosesAt: toIso(closesAt),
        requireGoodStanding: goodStanding,
        positions: cleanPositions.map((p) => ({ title: p.title.trim(), seats: Number(p.seats) || 1, role: p.role })),
      });
      setMsg(`Election created (${res.id}) as DRAFT. Add candidates, then open voting from its page.`);
      setTitle(''); setDescription(''); setOpensAt(''); setClosesAt(''); setGoodStanding(true);
      setPositions([{ title: '', seats: 1, role: '' }]);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setCreating(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Elections" subtitle="Set up and run association elections. Ballots are secret; results stay sealed until published." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AssociationTabs active="elections" />
      <DisclosureNote>Officer actions post to <code>/api/finance/associations/elections</code>. One-member-one-vote, eligibility and tally are enforced server-side; the immutable audit log records every lifecycle change (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      {/* Create */}
      <Card>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <strong style={{ fontSize: '0.95rem' }}>New election</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={label()}>Title</label>
              <input style={input()} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="2026 National Executive Election" />
            </div>
            <div>
              <label style={label()}>Description</label>
              <input style={input()} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label style={label()}>Voting opens</label>
              <input style={input()} type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
            </div>
            <div>
              <label style={label()}>Voting closes</label>
              <input style={input()} type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#374151' }}>
            <input type="checkbox" checked={goodStanding} onChange={(e) => setGoodStanding(e.target.checked)} />
            Require good standing (exclude members in arrears from voting)
          </label>

          <div>
            <label style={label()}>Positions</label>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Title</th><th style={th()}>Seats</th><th style={th()}>Confers role (on winner)</th><th style={th()}></th></tr></thead>
              <tbody>
                {positions.map((p, i) => (
                  <tr key={i}>
                    <td style={td()}><input style={input()} value={p.title} onChange={(e) => setPos(i, { title: e.target.value })} placeholder="President" /></td>
                    <td style={td()}><input style={{ ...input(), width: 70 }} type="number" min={1} value={p.seats} onChange={(e) => setPos(i, { seats: Number(e.target.value) })} /></td>
                    <td style={td()}>
                      <select style={select()} value={p.role} onChange={(e) => setPos(i, { role: e.target.value as ElectionRole })}>
                        {ROLE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    </td>
                    <td style={td()}>{positions.length > 1 && <button style={btnDanger()} onClick={() => setPositions((ps) => ps.filter((_, idx) => idx !== i))}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button style={{ ...btn(), marginTop: '0.5rem' }} onClick={() => setPositions((ps) => [...ps, { title: '', seats: 1, role: '' }])}>+ Add position</button>
          </div>

          <div>
            <button style={btnPrimary()} disabled={creating} onClick={submit}>{creating ? 'Creating…' : 'Create election (draft)'}</button>
          </div>
        </div>
      </Card>

      {/* List */}
      <div style={{ marginTop: '1.25rem' }}>
        <Card>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No elections yet.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>Election</th><th style={th()}>Status</th><th style={th()}>Positions</th>
                <th style={th()}>Opens</th><th style={th()}>Closes</th><th style={th()}></th>
              </tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td style={td()}>{e.title}</td>
                    <td style={td()}><Badge status={e.status} /></td>
                    <td style={td()}>{e.positionCount}</td>
                    <td style={td()}>{e.votingOpensAt ? fmtDate(e.votingOpensAt) : '—'}</td>
                    <td style={td()}>{e.votingClosesAt ? fmtDate(e.votingClosesAt) : '—'}</td>
                    <td style={td()}><Link href={`/admin/association/elections/${e.id}`} style={{ ...btnPrimary(), textDecoration: 'none' }}>Manage</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StateBlock>
        </Card>
      </div>
    </div>
  );
}
