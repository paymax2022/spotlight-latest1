'use client';

// SC-37 · Competition Registration — register a school team into cross-school
// competitions. Registration is only permitted while the competition is in
// `open_registration`. Competitions are engagement-only (no money path).

import { useEffect, useState } from 'react';
import {
  listCompetitions, listCompetitionRegistrations, registerForCompetition,
  listFeesSchools, COMPETITION_FLOW,
} from '@/services/academyFeesService';
import type { Competition, CompetitionRegistration, FeesSchool } from '@/types/academyFees';
import {
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote,
  btn, btnPrimary, th, td, input, label, select, fmtDate,
} from '../../_ui';
import { FeesTabs, FeesGuard } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function FeesCompetitionPage() {
  const [comps, setComps] = useState<Competition[]>([]);
  const [regs, setRegs] = useState<CompetitionRegistration[]>([]);
  const [schools, setSchools] = useState<FeesSchool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { school_id: string; team_name: string; students: string }>>({});

  async function load() {
    setLoading(true); setError(null);
    try { const [c, r, s] = await Promise.all([listCompetitions(), listCompetitionRegistrations(), listFeesSchools()]); setComps(c); setRegs(r); setSchools(s); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function schoolName(id: string) { return schools.find((s) => s.id === id)?.name ?? id; }
  function compName(id: string) { return comps.find((c) => c.id === id)?.name ?? id; }

  async function register(c: Competition) {
    const f = form[c.id] ?? { school_id: schools[0]?.id ?? '', team_name: '', students: '' };
    const students = Number(f.students);
    if (!f.school_id || !f.team_name || !students) { setNotice('School, team name and student count are required.'); return; }
    setBusy(c.id); setNotice(null);
    try { const u = await registerForCompetition({ competition_id: c.id, school_id: f.school_id, team_name: f.team_name, students }); setNotice(`Registered "${u.team_name}" into ${compName(c.id)} (${u.status}).`); setForm({ ...form, [c.id]: { school_id: f.school_id, team_name: '', students: '' } }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const openCount = comps.filter((c) => c.status === 'open_registration').length;

  return (
    <FeesGuard permission="academy.fees.competition.manage">
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Competition Registration" subtitle="Register school teams into cross-school competitions (class / school / city / state / national scope)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FeesTabs active="competition" />
      <DisclosureNote>Requires <code>academy.fees.competition.manage</code>. Registration is only allowed while a competition is in <code>open_registration</code>. Competitions are <strong>engagement-only</strong> — no money moves through this surface.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Open for registration" value={openCount.toString()} accent={openCount > 0 ? '#15803d' : undefined} />
          <Kpi label="Competitions" value={comps.length.toString()} />
          <Kpi label="Your registrations" value={regs.length.toString()} />
        </div>

        <Card title="Competition lifecycle">
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {COMPETITION_FLOW.map((st, i) => (
              <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <Badge status={st === 'completed' ? 'approved' : st === 'draft' ? 'draft' : 'pending'} label={st.replace(/_/g, ' ')} />
                {i < COMPETITION_FLOW.length - 1 ? <span style={{ color: colors.muted }}>→</span> : null}
              </span>
            ))}
          </div>
        </Card>

        <Card title="Competitions">
          {comps.map((c) => {
            const open = c.status === 'open_registration';
            const f = form[c.id] ?? { school_id: schools[0]?.id ?? '', team_name: '', students: '' };
            return (
              <div key={c.id} style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.85rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <strong>{c.name}</strong> <Badge status="core" label={c.scope} />
                    <div style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: '0.2rem' }}>{c.subject} · starts {fmtDate(c.starts_on)} · reg closes {fmtDate(c.registration_closes)} · {c.registered_schools} schools / {c.registered_students} students</div>
                  </div>
                  <Badge status={open ? 'open' : c.status === 'draft' ? 'draft' : 'pending'} label={c.status.replace(/_/g, ' ')} />
                </div>
                {open ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.6rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.6rem' }}>
                    <div><label style={label()}>School</label><select style={select()} value={f.school_id} onChange={(e) => setForm({ ...form, [c.id]: { ...f, school_id: e.target.value } })}>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                    <div><label style={label()}>Team name</label><input style={input()} value={f.team_name} onChange={(e) => setForm({ ...form, [c.id]: { ...f, team_name: e.target.value } })} /></div>
                    <div><label style={label()}>Students</label><input type="number" style={input()} value={f.students} onChange={(e) => setForm({ ...form, [c.id]: { ...f, students: e.target.value } })} /></div>
                    <div><button onClick={() => register(c)} disabled={busy === c.id} style={btnPrimary()}>Register team</button></div>
                  </div>
                ) : (
                  <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.5rem' }}>Registration is closed for this competition.</p>
                )}
              </div>
            );
          })}
        </Card>

        <Card title="Your registrations">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Competition</th><th style={th()}>School</th><th style={th()}>Team</th><th style={th()}>Students</th><th style={th()}>Status</th><th style={th()}>Registered</th></tr></thead>
            <tbody>
              {regs.map((r) => <tr key={r.id}><td style={td()}>{compName(r.competition_id)}</td><td style={td()}>{schoolName(r.school_id)}</td><td style={td()}><strong>{r.team_name}</strong></td><td style={td()}>{r.students}</td><td style={td()}><Badge status={r.status === 'confirmed' ? 'approved' : 'pending'} /></td><td style={td()}>{fmtDate(r.registered_at)}</td></tr>)}
              {regs.length === 0 && <tr><td style={td()} colSpan={6}><span style={{ color: '#6b7280' }}>No registrations yet.</span></td></tr>}
            </tbody>
          </table>
          {notice && <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Competition registrations are recorded to the immutable audit log (module <code>academy.fees</code>).</AuditNote>
        </Card>
      </StateBlock>
    </div>
    </FeesGuard>
  );
}
