'use client';

import { useEffect, useState } from 'react';
import {
  listTutors, vetTutor, listTutorPayouts, listTutorDisputes, noteTutorDispute,
} from '@/services/academyAdminService';
import type { Tutor, TutorPayout, TutorDispute } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, Kpi, StateBlock, AuditNote, DisclosureNote, btn, btnPrimary, btnDanger, th, td, input, select, formatNaira, fmtDate } from '../_ui';

function Stars({ value }: { value: number }) {
  if (!value) return <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>—</span>;
  const full = Math.round(value);
  return <span style={{ fontSize: '0.85rem', color: '#374151' }} title={`${value.toFixed(1)} / 5`}>{'★'.repeat(full)}<span style={{ color: '#d1d5db' }}>{'★'.repeat(5 - full)}</span> {value.toFixed(1)}</span>;
}

export default function TutorOpsPage() {
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [payouts, setPayouts] = useState<TutorPayout[]>([]);
  const [disputes, setDisputes] = useState<TutorDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [noteForm, setNoteForm] = useState<Record<string, { status: TutorDispute['status']; note: string }>>({});

  async function load() {
    setLoading(true); setError(null);
    try {
      const [t, p, d] = await Promise.all([listTutors(), listTutorPayouts(), listTutorDisputes()]);
      setTutors(t); setPayouts(p); setDisputes(d);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function vet(t: Tutor, action: 'verify' | 'suspend' | 'reactivate' | 'reject') {
    setBusy(t.id); setNotice(null);
    try { const u = await vetTutor({ id: t.id, action }); setNotice(`${u.display_name} → ${u.vetting}.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function saveNote(d: TutorDispute) {
    const f = noteForm[d.id];
    if (!f?.note) { setNotice('A note is required to update a dispute.'); return; }
    setBusy(d.id); setNotice(null);
    try { const u = await noteTutorDispute({ id: d.id, status: f.status, note: f.note }); setNotice(`Dispute ${u.id} → ${u.status}.`); setNoteForm({ ...noteForm, [d.id]: { status: u.status, note: '' } }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const verified = tutors.filter((t) => t.vetting === 'verified').length;
  const pendingVet = tutors.filter((t) => t.vetting === 'applied' || t.vetting === 'in_review').length;
  const payoutsDue = payouts.filter((p) => p.status === 'requested' || p.status === 'processing').reduce((s, p) => s + p.amount_kobo, 0);
  const failedPayouts = payouts.filter((p) => p.status === 'failed').length;
  const openDisputes = disputes.filter((d) => d.status === 'open' || d.status === 'investigating').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Tutor & marketplace ops" subtitle="Tutor vetting (verify/suspend) with KYC state, payout runs (requested/paid/failed), ratings, and dispute handling." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="tutors" />
      <DisclosureNote>Requires <code>academy.tutor</code>. Vetting state machine: <strong>applied → in_review → verified | rejected</strong>; verified ↔ suspended. Payouts post to the finance ledger; all actions are audit-logged. Money in ₦ (kobo internally).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Verified tutors" value={verified.toString()} sub={`${tutors.length} total`} accent="#340075" />
          <Kpi label="Pending vetting" value={pendingVet.toString()} accent={pendingVet > 0 ? '#9a3412' : undefined} />
          <Kpi label="Payouts due" value={formatNaira(payoutsDue)} accent="#15803d" />
          <Kpi label="Failed payouts" value={failedPayouts.toString()} accent={failedPayouts > 0 ? '#b91c1c' : undefined} />
          <Kpi label="Open disputes" value={openDisputes.toString()} accent={openDisputes > 0 ? '#9a3412' : undefined} />
        </div>

        <Card title="Tutors — vetting & KYC">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Tutor</th><th style={th()}>Subjects</th><th style={th()}>KYC</th><th style={th()}>Rating</th><th style={th()}>Sessions</th><th style={th()}>Disputes</th><th style={th()}>Vetting</th><th style={th()}>Actions</th></tr></thead>
            <tbody>
              {tutors.map((t) => (
                <tr key={t.id}>
                  <td style={td()}><strong>{t.display_name}</strong><br /><span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{t.email}</span></td>
                  <td style={td()}>{t.subjects.join(', ')}</td>
                  <td style={td()}><Badge status={t.kyc} label={t.kyc.replace('tier', 'Tier ')} /></td>
                  <td style={td()}><Stars value={t.rating_avg} /> {t.ratings_count ? <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>({t.ratings_count})</span> : null}</td>
                  <td style={td()}>{t.sessions_delivered.toLocaleString('en-NG')}</td>
                  <td style={td()}>{t.open_disputes > 0 ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>{t.open_disputes}</span> : '0'}</td>
                  <td style={td()}><Badge status={t.vetting} label={t.vetting.replace(/_/g, ' ')} /></td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {t.vetting === 'verified'
                        ? <button onClick={() => vet(t, 'suspend')} disabled={busy === t.id} style={btnDanger()}>Suspend</button>
                        : t.vetting === 'suspended'
                          ? <button onClick={() => vet(t, 'reactivate')} disabled={busy === t.id} style={btnPrimary()}>Reactivate</button>
                          : (
                            <>
                              <button onClick={() => vet(t, 'verify')} disabled={busy === t.id} style={btnPrimary()}>Verify</button>
                              <button onClick={() => vet(t, 'reject')} disabled={busy === t.id} style={btnDanger()}>Reject</button>
                            </>
                          )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Payouts">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Tutor</th><th style={th()}>Period</th><th style={th()}>Amount</th><th style={th()}>Bank</th><th style={th()}>Requested</th><th style={th()}>Settled</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td style={td()}>{p.tutor_name}</td>
                  <td style={td()}>{p.period}</td>
                  <td style={td()}>{formatNaira(p.amount_kobo)}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{p.bank_account}</code></td>
                  <td style={td()}>{fmtDate(p.requested_at)}</td>
                  <td style={td()}>{p.settled_at ? fmtDate(p.settled_at) : '—'}</td>
                  <td style={td()}><Badge status={p.status} />{p.failure_reason ? <div style={{ color: '#b91c1c', fontSize: '0.72rem', marginTop: '0.2rem' }}>{p.failure_reason}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Ratings & disputes">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Tutor</th><th style={th()}>Learner</th><th style={th()}>Reason</th><th style={th()}>Detail</th><th style={th()}>Status</th><th style={th()}>Resolution note</th></tr></thead>
            <tbody>
              {disputes.map((d) => {
                const f = noteForm[d.id] ?? { status: d.status, note: '' };
                const terminal = d.status === 'resolved' || d.status === 'dismissed';
                return (
                  <tr key={d.id}>
                    <td style={td()}><strong>{d.tutor_name}</strong></td>
                    <td style={td()}>{d.learner_name}</td>
                    <td style={td()}><Badge status="medium" label={d.reason.replace(/_/g, ' ')} /></td>
                    <td style={td()}>{d.detail}{d.note ? <div style={{ color: '#6b7280', fontSize: '0.72rem', marginTop: '0.25rem' }}>Note: {d.note}</div> : null}</td>
                    <td style={td()}><Badge status={d.status} /></td>
                    <td style={td()}>
                      {terminal ? <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>closed</span> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 200 }}>
                          <select style={select()} value={f.status} onChange={(e) => setNoteForm({ ...noteForm, [d.id]: { ...f, status: e.target.value as TutorDispute['status'] } })}>
                            <option value="open">open</option>
                            <option value="investigating">investigating</option>
                            <option value="resolved">resolved</option>
                            <option value="dismissed">dismissed</option>
                          </select>
                          <input style={input()} placeholder="Add a note…" value={f.note} onChange={(e) => setNoteForm({ ...noteForm, [d.id]: { ...f, note: e.target.value } })} />
                          <button onClick={() => saveNote(d)} disabled={busy === d.id} style={btnPrimary()}>Save note</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Tutor vetting decisions, payout actions and dispute notes are recorded to the immutable audit log.</AuditNote>
        </Card>
      </StateBlock>
    </div>
  );
}
