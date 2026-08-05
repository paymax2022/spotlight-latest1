'use client';

// A2 — Screening review queue. RBAC: arena.reviewer.screen (Reviewer, own scope).
// Reviewer opens an application, reviews payload + docs (signed-URL refs), and
// decides Approve / Request info / Reject (reason required) → guarded transition
// APPLIED → SCREENED | NEEDS_MORE_INFO | REJECTED.

import { useCallback, useEffect, useState } from 'react';
import { listCompetitions, listScreening, decideScreening } from '@/services/arenaAdminService';
import type { Competition, ScreeningItem, ScreeningDecision } from '@/types/arenaAdmin';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import {
  mono, timeAgo, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission,
} from '../_ui';

const DECISIONS: { value: ScreeningDecision; label: string; variant: 'primary' | 'danger' | 'outline'; color: string }[] = [
  { value: 'APPROVE', label: 'Approve', variant: 'primary', color: colors.success },
  { value: 'REQUEST_INFO', label: 'Request info', variant: 'outline', color: colors.warning },
  { value: 'REJECT', label: 'Reject', variant: 'danger', color: colors.danger },
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
    <Page>
      <PageHeader
        title="Arena — Screening Review Queue (A2)"
        subtitle="Applications in your reviewer scope. Approve / Request info / Reject (reason required) → guarded transition. RBAC: arena.reviewer.screen."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.reviewer} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {notice && <div style={{ background: tint(colors.success, 0.12), border: `1px solid ${tint(colors.success, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.success, marginBottom: '1.25rem' }}>{notice}</div>}

      <Card title="Queue" style={{ marginBottom: 20 }}>
        {loading ? (
          <p style={{ color: colors.muted }}>Loading queue…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No applications awaiting screening in your scope.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Applicant</th>
                  <th style={thCell}>Home state</th>
                  <th style={thCell}>Flags</th>
                  <th style={thCell}>Rubric</th>
                  <th style={thCell}>Submitted</th>
                  <th style={thCell}>Review</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.contestant_id}>
                    <td style={tdCell}>
                      {r.full_name ?? '—'}
                      <div style={{ ...mono(), color: colors.muted }}>{r.user_id}</div>
                    </td>
                    <td style={tdCell}>{r.home_state}</td>
                    <td style={tdCell}>
                      {(r.flags ?? []).length === 0 ? <span style={{ color: colors.muted }}>—</span> : (r.flags ?? []).map((f) => <Badge key={f} text={f} color={colors.warning} />)}
                    </td>
                    <td style={{ ...tdCell, ...mono() }}>{r.rubric_version ?? '—'}</td>
                    <td style={tdCell}>{timeAgo(r.submitted_at)}</td>
                    <td style={tdCell}>
                      <Button variant="outline" onClick={() => { setOpen(r); setNotice(null); }} disabled={!allowed}>Open</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Application — {open.full_name ?? open.contestant_id}</h2>
            <Button variant="outline" onClick={() => setOpen(null)}>Close</Button>
          </div>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: '0.75rem' }}>
            <Field label="Contestant" value={open.contestant_id} mono />
            <Field label="User" value={open.user_id} mono />
            <Field label="Home state" value={open.home_state} />
            <Field label="Rubric version" value={open.rubric_version ?? '—'} mono />
          </div>

          <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0.5rem 0 0.25rem', fontWeight: 600 }}>Documents (signed-URL refs — access logged)</p>
          <div style={{ display: 'grid', gap: 6, marginBottom: '0.75rem' }}>
            {(open.document_refs ?? []).length === 0 ? <span style={{ color: colors.muted, fontSize: '0.85rem' }}>No documents.</span> : (open.document_refs ?? []).map((d) => (
              <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
                <Badge text={d.kind} color={colors.secondary} />
                <span>{d.label ?? d.kind}</span>
                <span style={{ ...mono(), color: colors.muted }}>{d.id}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: colors.muted }}>
              Decision
              <select value={decision} onChange={(e) => setDecision(e.target.value as ScreeningDecision)} disabled={!allowed}>
                {DECISIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: colors.muted, flex: 1, minWidth: 260 }}>
              Reason (required)
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Basis for the decision…" disabled={!allowed} />
            </label>
            <Button
              variant={DECISIONS.find((d) => d.value === decision)?.variant ?? 'primary'}
              onClick={() => void submit()}
              disabled={!allowed || !reason.trim() || busy}
            >
              {busy ? 'Submitting…' : 'Submit decision'}
            </Button>
          </div>
          <AuditNote>Decisions are guarded transitions with atomic side effects (Approve → SCREENED / TRAINED-eligible, notify) and are audited.</AuditNote>
        </Card>
      )}
    </Page>
  );
}

function Field({ label, value, mono: isMono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: colors.text, fontFamily: isMono ? 'monospace' : undefined }}>{value}</div>
    </div>
  );
}
