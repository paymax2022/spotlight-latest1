'use client';

// A2 — Screening review queue. RBAC: arena.reviewer.screen (Reviewer, own scope).
// Reviewer opens an application, reviews payload + docs (signed-URL refs), and
// decides Approve / Request info / Reject (reason required) → guarded transition
// APPLIED → SCREENED | NEEDS_MORE_INFO | REJECTED.

import { useCallback, useEffect, useState } from 'react';
import { listCompetitions, listScreening, decideScreening } from '@/services/arenaAdminService';
import type { Competition, ScreeningItem, ScreeningDecision } from '@/types/arenaAdmin';
import {
  PageHeader, Card, btn, btnPrimary, btnDisabled, th, td, inputStyle, selectStyle, mono,
  timeAgo, AuditNote, PermissionBanner, Pill, ARENA_PERMS, useArenaPermission,
} from '../_ui';

const DECISIONS: { value: ScreeningDecision; label: string; color: string }[] = [
  { value: 'APPROVE', label: 'Approve', color: '#15803d' },
  { value: 'REQUEST_INFO', label: 'Request info', color: '#9a3412' },
  { value: 'REJECT', label: 'Reject', color: '#b91c1c' },
];

export default function ArenaScreeningPage() {
  const { allowed } = useArenaPermission(ARENA_PERMS.reviewer);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [rows, setRows] = useState<ScreeningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ScreeningItem | null>(null);
  const [decision, setDecision] = useState<ScreeningDecision>('APPROVE');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void listCompetitions().then((c) => { setCompetitions(c); if (c[0]) setCompetitionId(c[0].id); }).catch((e) => setError(String(e)));
  }, []);

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoading(true); setError(null);
    try { setRows(await listScreening(competitionId)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [competitionId]);

  useEffect(() => { void load(); }, [load]);

  const submit = useCallback(async () => {
    if (!open || !reason.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await decideScreening(competitionId, open.contestant_id, decision, reason.trim());
      setNotice(`${open.full_name ?? open.contestant_id}: ${decision} recorded (transition applied, audited).`);
      setOpen(null); setReason(''); setDecision('APPROVE');
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [open, reason, decision, competitionId, load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Arena — Screening Review Queue (A2)"
        subtitle="Applications in your reviewer scope. Approve / Request info / Reject (reason required) → guarded transition. RBAC: arena.reviewer.screen."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)} style={selectStyle()}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => void load()} style={btn()}>Refresh</button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.reviewer} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {notice && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#166534', marginBottom: '1.25rem' }}>{notice}</div>}

      <Card title="Queue">
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading queue…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No applications awaiting screening in your scope.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Applicant</th>
                  <th style={th()}>Home state</th>
                  <th style={th()}>Flags</th>
                  <th style={th()}>Rubric</th>
                  <th style={th()}>Submitted</th>
                  <th style={th()}>Review</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.contestant_id}>
                    <td style={td()}>
                      {r.full_name ?? '—'}
                      <div style={{ ...mono(), color: '#9ca3af' }}>{r.user_id}</div>
                    </td>
                    <td style={td()}>{r.home_state}</td>
                    <td style={td()}>
                      {(r.flags ?? []).length === 0 ? <span style={{ color: '#9ca3af' }}>—</span> : (r.flags ?? []).map((f) => <Pill key={f} fg="#9a3412" bg="#ffedd5">{f}</Pill>)}
                    </td>
                    <td style={{ ...td(), ...mono() }}>{r.rubric_version ?? '—'}</td>
                    <td style={td()}>{timeAgo(r.submitted_at)}</td>
                    <td style={td()}>
                      <button onClick={() => { setOpen(r); setNotice(null); }} style={btn()} disabled={!allowed}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <Card title={`Application — ${open.full_name ?? open.contestant_id}`} right={<button onClick={() => setOpen(null)} style={btn()}>Close</button>}>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: '0.75rem' }}>
            <Field label="Contestant" value={open.contestant_id} mono />
            <Field label="User" value={open.user_id} mono />
            <Field label="Home state" value={open.home_state} />
            <Field label="Rubric version" value={open.rubric_version ?? '—'} mono />
          </div>

          <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0.5rem 0 0.25rem', fontWeight: 600 }}>Documents (signed-URL refs — access logged)</p>
          <div style={{ display: 'grid', gap: 6, marginBottom: '0.75rem' }}>
            {(open.document_refs ?? []).length === 0 ? <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>No documents.</span> : (open.document_refs ?? []).map((d) => (
              <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
                <Pill fg="#374151" bg="#f3f4f6">{d.kind}</Pill>
                <span>{d.label ?? d.kind}</span>
                <span style={{ ...mono(), color: '#9ca3af' }}>{d.id}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: '#6b7280' }}>
              Decision
              <select value={decision} onChange={(e) => setDecision(e.target.value as ScreeningDecision)} style={selectStyle()} disabled={!allowed}>
                {DECISIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: '#6b7280', flex: 1, minWidth: 260 }}>
              Reason (required)
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Basis for the decision…" style={inputStyle()} disabled={!allowed} />
            </label>
            <button
              onClick={() => void submit()}
              style={allowed && reason.trim() && !busy ? btnPrimary(DECISIONS.find((d) => d.value === decision)?.color) : btnDisabled()}
              disabled={!allowed || !reason.trim() || busy}
            >
              {busy ? 'Submitting…' : 'Submit decision'}
            </button>
          </div>
          <AuditNote>Decisions are guarded transitions with atomic side effects (Approve → SCREENED / TRAINED-eligible, notify) and are audited.</AuditNote>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value, mono: isMono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: '#374151', fontFamily: isMono ? 'monospace' : undefined }}>{value}</div>
    </div>
  );
}
