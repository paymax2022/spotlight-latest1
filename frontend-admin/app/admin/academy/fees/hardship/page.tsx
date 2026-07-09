'use client';

// SC-34 · Defaulters & Hardship Review Queue (SF-9).
// Hardship/freeze requests route to a HUMAN review queue — never auto-approved
// or auto-denied. Each decision requires an explicit reviewer action + note.

import { useEffect, useState } from 'react';
import { listHardshipRequests, decideHardship } from '@/services/academyFeesService';
import type { HardshipRequest } from '@/types/academyFees';
import {
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote,
  btn, btnPrimary, btnDanger, th, td, input, formatNaira, fmtDate, timeAgo,
} from '../../_ui';
import { FeesTabs } from '../_ui';

export default function FeesHardshipPage() {
  const [requests, setRequests] = useState<HardshipRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true); setError(null);
    try { setRequests(await listHardshipRequests()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function decide(r: HardshipRequest, decision: 'approve' | 'deny') {
    const note = notes[r.id] ?? '';
    if (!note.trim()) { setNotice('A reviewer note is required — hardship decisions are never automated (SF-9).'); return; }
    setBusy(r.id); setNotice(null);
    try { const u = await decideHardship({ request_id: r.id, decision, note }); setNotice(`Request for ${u.student_name} → ${u.status}.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const pending = requests.filter((r) => r.status === 'pending');
  const totalOutstanding = pending.reduce((s, r) => s + r.outstanding_kobo, 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Defaulters & Hardship Review" subtitle="Human review queue for hardship and freeze requests from guardians in arrears. Every decision is a deliberate human action." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FeesTabs active="hardship" />
      <DisclosureNote>Requires <code>academy.fees.hardship</code>. <strong>SF-9:</strong> hardship/freeze requests <strong>never auto-approve or auto-deny</strong> — a human reviewer must decide and record a note. No automated terminal transition exists.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Awaiting review" value={pending.length.toString()} accent={pending.length > 0 ? '#9a3412' : undefined} />
          <Kpi label="Outstanding (pending)" value={formatNaira(totalOutstanding)} />
          <Kpi label="Decided (this list)" value={requests.filter((r) => r.status !== 'pending').length.toString()} />
        </div>

        <Card title="Hardship & freeze requests">
          {requests.length === 0 ? <p style={{ color: '#6b7280' }}>No hardship requests.</p> : requests.map((r) => (
            <div key={r.id} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.85rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div><strong>{r.student_name}</strong> <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>· {r.class_name} · {r.guardian_email}</span></div>
                  <div style={{ fontSize: '0.85rem', color: '#374151', margin: '0.35rem 0' }}>{r.reason}</div>
                  <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>Invoice <code>{r.invoice_id}</code> · outstanding <strong>{formatNaira(r.outstanding_kobo)}</strong> · requested {timeAgo(r.requested_at)} ({fmtDate(r.requested_at)})</div>
                </div>
                <Badge status={r.status === 'pending' ? 'pending' : r.status === 'approved' ? 'approved' : 'rejected'} label={r.status} />
              </div>
              {r.status === 'pending' ? (
                <div style={{ marginTop: '0.6rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.6rem' }}>
                  <input style={input()} placeholder="Reviewer note (required — records the human rationale)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                    <button onClick={() => decide(r, 'approve')} disabled={busy === r.id} style={btnPrimary()}>Approve hardship (freeze)</button>
                    <button onClick={() => decide(r, 'deny')} disabled={busy === r.id} style={btnDanger()}>Deny</button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#374151' }}>Reviewer note: {r.reviewer_note || '—'} {r.reviewed_at ? `· ${fmtDate(r.reviewed_at)}` : ''}</div>
              )}
            </div>
          ))}
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Every hardship decision (approve/deny) and its reviewer note is written to the immutable audit log (module <code>academy.fees</code>).</AuditNote>
        </Card>
      </StateBlock>
    </div>
  );
}
