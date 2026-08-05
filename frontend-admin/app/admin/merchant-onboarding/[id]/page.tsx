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
import { Page, Card, Button, colors } from '@/components/ui/vuexy';

const CHECK_COLORS: Record<string, string> = {
  pass: colors.success,
  fail: colors.danger,
  pending: colors.warning,
  manual: colors.info,
};
const DOC_COLORS: Record<string, string> = {
  verified: colors.success,
  pending: colors.warning,
  rejected: colors.danger,
  expired: colors.danger,
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

  if (loading) return <Page><p style={{ color: colors.muted }}>Loading application…</p></Page>;
  if (!app) return <Page><p style={{ color: colors.danger }}>{error || 'Application not found.'}</p></Page>;

  return (
    <Page>
      <p><Link href="/admin/merchant-onboarding">← Back to review queue</Link></p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{app.applicantName}</h1>
        <StatusBadge status={app.status} />
      </div>
      <p style={{ fontSize: 13, color: colors.muted }}>
        {app.moduleName} · {app.merchantTypeName} · schema {app.formSchemaId}@{app.formSchemaVersion} ·
        submitted {ageFromNow(app.submittedAt)} ago
      </p>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 12 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Form data */}
          <Card title="Submitted Form Data">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
              <tbody>
                {Object.entries(app.data).map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ padding: '6px 8px', color: colors.muted, width: '40%' }}>{k}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Documents */}
          <Card title="Uploaded Documents">
            {(app.documents ?? []).length === 0 ? <p style={{ color: colors.muted }}>No documents.</p> : null}
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {(app.documents ?? []).map((d) => (
                <div key={d.type} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, border: `1px solid ${colors.border}`, padding: 8, borderRadius: 4 }}>
                  <div>
                    <strong>{d.label}</strong>
                    <div style={{ fontSize: 12, color: colors.muted }}>{d.fileName}</div>
                    {d.expiryDate ? (
                      <div style={{ fontSize: 12, color: colors.muted }}>Expires: {new Date(d.expiryDate).toLocaleDateString()}</div>
                    ) : null}
                  </div>
                  <span style={{ color: DOC_COLORS[d.verificationStatus] ?? colors.muted, fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>
                    {d.verificationStatus}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Automated checks */}
          <Card title="Automated Checks">
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {app.checks.map((c) => (
                <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, border: `1px solid ${colors.border}`, padding: 8, borderRadius: 4 }}>
                  <div>
                    <strong>{c.label}</strong>
                    <div style={{ fontSize: 12, color: colors.muted }}>{c.detail}</div>
                  </div>
                  <span style={{ color: CHECK_COLORS[c.status] ?? colors.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div style={{ display: 'grid', gap: 16 }}>
          {/* History */}
          <Card title="Applicant History">
            <ul style={{ fontSize: 13, paddingLeft: 18, margin: '12px 0 0', display: 'grid', gap: 4 }}>
              <li>Created: {new Date(app.createdAt).toLocaleString()}</li>
              {app.submittedAt ? <li>Submitted: {new Date(app.submittedAt).toLocaleString()}</li> : null}
              <li>Last updated: {new Date(app.updatedAt).toLocaleString()}</li>
              {app.decidedAt ? <li>Decided: {new Date(app.decidedAt).toLocaleString()}</li> : null}
              {app.decisionReason ? <li>Decision reason: {app.decisionReason}</li> : null}
              {app.infoChecklist.length > 0 ? (
                <li>Outstanding info: {app.infoChecklist.join('; ')}</li>
              ) : null}
              <li style={{ fontSize: 12, color: colors.muted }}>User ID: {app.userId}</li>
            </ul>
          </Card>

          {/* Internal notes */}
          <Card title="Internal Notes">
            {notes.length === 0 ? <p style={{ color: colors.muted, fontSize: 13, marginTop: 12 }}>No notes yet (local only).</p> : (
              <ul style={{ fontSize: 13, paddingLeft: 18, marginTop: 12, display: 'grid', gap: 4 }}>
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
            <Button variant="outline" sm style={{ marginTop: 6 }} onClick={addNote}>Add Note</Button>
          </Card>

          {/* Decision actions */}
          <Card title="Decision">
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <Button variant="primary" onClick={onApprove} disabled={busy}>{busy ? '…' : 'Approve'}</Button>

              <div style={{ display: 'grid', gap: 6 }}>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Rejection reason (required)"
                  rows={2}
                  style={{ width: '100%' }}
                />
                <Button variant="danger" onClick={onReject} disabled={busy}>Reject</Button>
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <textarea
                  value={checklistText}
                  onChange={(e) => setChecklistText(e.target.value)}
                  placeholder="Request more info — one checklist item per line"
                  rows={3}
                  style={{ width: '100%' }}
                />
                <Button variant="outline" onClick={onRequestInfo} disabled={busy}>Request More Info</Button>
              </div>

              <Button variant="secondary" onClick={onEscalate} disabled={busy}>Escalate</Button>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
