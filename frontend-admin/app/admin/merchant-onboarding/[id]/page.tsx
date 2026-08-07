'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import type { OnboardingApplication } from '@/types/onboarding';
import {
  getApplication,
  approveApplication,
  rejectApplication,
  requestMoreInfo,
  escalateApplication,
  ageFromNow,
} from '@/services/onboardingService';
import { StatusBadge } from '../statusBadge';

const card = { border: '1px solid #2a2a2a', padding: 12, borderRadius: 6 } as const;

const CHECK_COLORS: Record<string, string> = {
  pass: '#a7f3d0',
  fail: '#fca5a5',
  pending: '#fde68a',
  manual: '#bfdbfe',
};
const DOC_COLORS: Record<string, string> = {
  verified: '#a7f3d0',
  pending: '#fde68a',
  rejected: '#fca5a5',
  expired: '#fca5a5',
};

export default function MerchantOnboardingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [app, setApp] = useState<OnboardingApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // decision inputs
  const [rejectReason, setRejectReason] = useState('');
  const [checklistText, setChecklistText] = useState('');
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setApp(await getApplication(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const runAction = async (fn: () => Promise<OnboardingApplication>, label: string) => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const updated = await fn();
      setApp(updated);
      setMessage(`${label} succeeded.`);
    } catch (e) {
      setError(`${label} failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onApprove = () => {
    if (!confirm('Approve this merchant application?')) return;
    void runAction(() => approveApplication(id), 'Approve');
  };
  const onReject = () => {
    if (!rejectReason.trim()) {
      setError('A rejection reason is required.');
      return;
    }
    void runAction(() => rejectApplication(id, rejectReason.trim()), 'Reject');
  };
  const onRequestInfo = () => {
    const checklist = checklistText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (checklist.length === 0) {
      setError('Add at least one checklist item.');
      return;
    }
    void runAction(() => requestMoreInfo(id, checklist), 'Request info');
  };
  const onEscalate = () => void runAction(() => escalateApplication(id), 'Escalate');

  const addNote = () => {
    if (!note.trim()) return;
    setNotes((n) => [...n, note.trim()]);
    setNote('');
  };

  if (loading) return <p>Loading application…</p>;
  if (!app) return <p style={{ color: 'salmon' }}>{error || 'Application not found.'}</p>;

  return (
    <div>
      <p><Link href="/admin/merchant-onboarding">← Back to review queue</Link></p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{app.applicantName}</h1>
        <StatusBadge status={app.status} />
      </div>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        {app.moduleName} · {app.merchantTypeName} · schema {app.formSchemaId}@{app.formSchemaVersion} ·
        submitted {ageFromNow(app.submittedAt)} ago
      </p>

      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 12 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Form data */}
          <section style={card}>
            <h2 style={{ marginTop: 0 }}>Submitted Form Data</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {Object.entries(app.data).map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: '1px solid #1c1c1c' }}>
                    <td style={{ padding: '6px 8px', opacity: 0.7, width: '40%' }}>{k}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Documents */}
          <section style={card}>
            <h2 style={{ marginTop: 0 }}>Uploaded Documents</h2>
            {(app.documents ?? []).length === 0 ? <p style={{ opacity: 0.6 }}>No documents.</p> : null}
            <div style={{ display: 'grid', gap: 8 }}>
              {(app.documents ?? []).map((d) => (
                <div key={d.type} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, border: '1px solid #1c1c1c', padding: 8, borderRadius: 4 }}>
                  <div>
                    <strong>{d.label}</strong>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>{d.fileName}</div>
                    {d.expiryDate ? (
                      <div style={{ fontSize: 12, opacity: 0.6 }}>Expires: {new Date(d.expiryDate).toLocaleDateString()}</div>
                    ) : null}
                  </div>
                  <span style={{ color: DOC_COLORS[d.verificationStatus] ?? '#d1d5db', fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>
                    {d.verificationStatus}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Automated checks */}
          <section style={card}>
            <h2 style={{ marginTop: 0 }}>Automated Checks</h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {app.checks.map((c) => (
                <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, border: '1px solid #1c1c1c', padding: 8, borderRadius: 4 }}>
                  <div>
                    <strong>{c.label}</strong>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>{c.detail}</div>
                  </div>
                  <span style={{ color: CHECK_COLORS[c.status] ?? '#d1d5db', fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right column */}
        <div style={{ display: 'grid', gap: 16 }}>
          {/* History */}
          <section style={card}>
            <h2 style={{ marginTop: 0 }}>Applicant History</h2>
            <ul style={{ fontSize: 13, paddingLeft: 18, margin: 0, display: 'grid', gap: 4 }}>
              <li>Created: {new Date(app.createdAt).toLocaleString()}</li>
              {app.submittedAt ? <li>Submitted: {new Date(app.submittedAt).toLocaleString()}</li> : null}
              <li>Last updated: {new Date(app.updatedAt).toLocaleString()}</li>
              {app.decidedAt ? <li>Decided: {new Date(app.decidedAt).toLocaleString()}</li> : null}
              {app.decisionReason ? <li>Decision reason: {app.decisionReason}</li> : null}
              {app.infoChecklist.length > 0 ? (
                <li>Outstanding info: {app.infoChecklist.join('; ')}</li>
              ) : null}
              <li style={{ fontSize: 12, opacity: 0.6 }}>User ID: {app.userId}</li>
            </ul>
          </section>

          {/* Internal notes */}
          <section style={card}>
            <h2 style={{ marginTop: 0 }}>Internal Notes</h2>
            {notes.length === 0 ? <p style={{ opacity: 0.6, fontSize: 13 }}>No notes yet (local only).</p> : (
              <ul style={{ fontSize: 13, paddingLeft: 18, display: 'grid', gap: 4 }}>
                {notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add an internal note…"
              rows={2}
              style={{ width: '100%', marginTop: 8 }}
            />
            <button onClick={addNote} style={{ marginTop: 6 }}>Add Note</button>
          </section>

          {/* Decision actions */}
          <section style={card}>
            <h2 style={{ marginTop: 0 }}>Decision</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <button onClick={onApprove} disabled={busy}>{busy ? '…' : 'Approve'}</button>

              <div style={{ display: 'grid', gap: 6 }}>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Rejection reason (required)"
                  rows={2}
                  style={{ width: '100%' }}
                />
                <button onClick={onReject} disabled={busy}>Reject</button>
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <textarea
                  value={checklistText}
                  onChange={(e) => setChecklistText(e.target.value)}
                  placeholder="Request more info — one checklist item per line"
                  rows={3}
                  style={{ width: '100%' }}
                />
                <button onClick={onRequestInfo} disabled={busy}>Request More Info</button>
              </div>

              <button onClick={onEscalate} disabled={busy}>Escalate</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
