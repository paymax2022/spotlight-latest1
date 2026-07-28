'use client';

// SU-06 — Competition & Tournament Ops (E12). Schedule/approve cross-school
// tournaments; Spotlight Schools Cup production pipeline. RBAC: platform_edtech_admin.
// State machine: draft → open_registration → registration_closed → in_progress →
// results_pending → completed → archived. Scoring locks at results_pending (SF §3.4).

import { useEffect, useState } from 'react';
import { listCompetitions, transitionCompetition } from '@/services/platformEdtechAdminService';
import type { Competition, CompetitionStatus } from '@/types/platformEdtechAdmin';
import { COMPETITION_FLOW } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, fmtDate,
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote, btn, btnPrimary, th, td, input, select, label,
} from '../_ui';

function nextStatuses(cur: CompetitionStatus): CompetitionStatus[] {
  const i = COMPETITION_FLOW.indexOf(cur);
  return i >= 0 && i < COMPETITION_FLOW.length - 1 ? [COMPETITION_FLOW[i + 1]] : [];
}

export default function CompetitionsPage() {
  const [comps, setComps] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true); setError(null);
    try { setComps(await listCompetitions()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function advance(c: Competition, to: CompetitionStatus) {
    const n = note[c.id] ?? '';
    if (!n.trim()) { setNotice('A production note is required to advance a competition (audited).'); return; }
    setBusy(c.id); setNotice(null);
    try { const u = await transitionCompetition({ id: c.id, to, note: n }); setNotice(`${c.name} → ${u.status}.`); setNote({ ...note, [c.id]: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Competition & Tournament Ops" subtitle="Cross-school tournament scheduling and the Spotlight Schools Cup production pipeline (E12). Advance each competition through its guarded state machine." action={<button onClick={load} style={btn()}>Refresh</button>} />
        <PlatformTabs active="competitions" />
        <DisclosureNote>Requires <code>platform_edtech_admin</code>. Scoring writes lock the instant a competition enters <strong>results_pending</strong> — no leaderboard entry may be created/edited from that state onward (SF §3.4). Rewards flow through the money-free gamification → rewards path, never the leaderboard.</DisclosureNote>
        {notice ? <div style={{ marginBottom: '1rem', color: '#5b21b6' }}>{notice}</div> : null}

        <StateBlock loading={loading} error={error} empty={false}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Active competitions" value={comps.filter((c) => c.status !== 'archived' && c.status !== 'completed').length.toString()} accent="#340075" />
            <Kpi label="In progress" value={comps.filter((c) => c.status === 'in_progress').length.toString()} accent="#15803d" />
            <Kpi label="Broadcast ready" value={comps.filter((c) => c.broadcast_ready).length.toString()} />
            <Kpi label="Schools engaged" value={comps.reduce((s, c) => s + c.participating_schools, 0).toString()} />
          </div>

          <Card title="Schools Cup pipeline">
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
              {COMPETITION_FLOW.map((st, i) => (
                <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Badge status={st} label={st.replace(/_/g, ' ')} />
                  {i < COMPETITION_FLOW.length - 1 ? <span style={{ color: '#9ca3af' }}>→</span> : null}
                </span>
              ))}
            </div>
          </Card>

          {comps.map((c) => {
            const nexts = nextStatuses(c.status);
            return (
              <Card key={c.id} title={c.name} right={<span style={{ display: 'flex', gap: '0.4rem' }}><Badge status={c.scope} label={c.scope} /><Badge status={c.status} label={c.status.replace(/_/g, ' ')} />{c.broadcast_ready ? <Badge status="ready" label="broadcast" /> : null}</span>}>
                <div style={{ fontSize: '0.82rem', color: '#6b7280' }}>{c.participating_schools} schools · {c.sponsor ? `sponsor: ${c.sponsor} · ` : ''}{fmtDate(c.start_date)} → {fmtDate(c.end_date)}</div>
                {nexts.length ? (
                  <div style={{ borderTop: '1px solid #f3f4f6', marginTop: '0.75rem', paddingTop: '0.75rem', display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.6rem', alignItems: 'end' }}>
                    <div><span style={label()}>Production note (required, audited)</span><input style={input()} value={note[c.id] ?? ''} onChange={(e) => setNote({ ...note, [c.id]: e.target.value })} /></div>
                    <button onClick={() => advance(c, nexts[0])} disabled={busy === c.id} style={btnPrimary()}>Advance → {nexts[0].replace(/_/g, ' ')}</button>
                  </div>
                ) : <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#9ca3af' }}>Terminal state — no further transition.</div>}
                <AuditNote>State transitions are guarded and audited; no step may be skipped.</AuditNote>
              </Card>
            );
          })}
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
