'use client';

// SC-32 · Bulk Onboarding — CSV import preview + approval queue.
// CSV is parsed client-side into a preview (valid / error rows); real batches
// route to a human approval queue before students/guardians are created.

import { useEffect, useState } from 'react';
import {
  listOnboardingBatches, parseOnboardingCsv, approveOnboardingBatch,
} from '@/services/academyFeesService';
import type { OnboardingBatch, OnboardingRow } from '@/types/academyFees';
import {
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote,
  btn, btnPrimary, btnDanger, th, td, input, fmtDate,
} from '../../_ui';
import { FeesTabs, FeesGuard } from '../_ui';

const SAMPLE_CSV = `student_name,guardian_email,class_name,admission_no
Chidera Obi,obi.parent@example.com,JSS 1A,BS-2601
Amina Yusuf,a.yusuf@example.com,JSS 1A,BS-2602
Tunde Bello,not-an-email,JSS 1A,BS-2603`;

export default function FeesOnboardingPage() {
  const [batches, setBatches] = useState<OnboardingBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<OnboardingRow[]>([]);

  async function load() {
    setLoading(true); setError(null);
    try { setBatches(await listOnboardingBatches()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function doPreview(text: string) { setPreview(parseOnboardingCsv(text)); }

  async function decide(b: OnboardingBatch, decision: 'approve' | 'reject') {
    setBusy(b.id); setNotice(null);
    try { const u = await approveOnboardingBatch({ batch_id: b.id, decision }); setNotice(`Batch ${u.filename} → ${u.status}.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const previewValid = preview.filter((r) => r.status === 'valid').length;
  const previewErrors = preview.length - previewValid;
  const pendingBatches = batches.filter((b) => b.status === 'pending_review').length;

  return (
    <FeesGuard permission="academy.fees.onboarding">
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Bulk Onboarding" subtitle="Import a student roster by CSV, preview validation results, and route each batch to a human approval queue before guardians and invoices are created." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FeesTabs active="onboarding" />
      <DisclosureNote>Requires <code>academy.fees.onboarding</code>. CSV columns: <code>student_name, guardian_email, class_name, admission_no</code>. Rows are validated on preview; a batch is only committed after a human approves it in the queue.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Batches awaiting review" value={pendingBatches.toString()} accent={pendingBatches > 0 ? '#9a3412' : undefined} />
          <Kpi label="Preview rows" value={preview.length.toString()} />
          <Kpi label="Preview valid" value={previewValid.toString()} accent="#15803d" />
          <Kpi label="Preview errors" value={previewErrors.toString()} accent={previewErrors > 0 ? '#b91c1c' : undefined} />
        </div>

        <Card title="1 · CSV import & preview">
          <textarea
            style={{ ...input(), fontFamily: 'monospace', minHeight: 110 }}
            placeholder="Paste CSV rows here…"
            value={csv}
            onChange={(e) => { setCsv(e.target.value); doPreview(e.target.value); }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => { setCsv(SAMPLE_CSV); doPreview(SAMPLE_CSV); }} style={btn()}>Load sample</button>
            <button onClick={() => doPreview(csv)} style={btnPrimary()}>Re-validate preview</button>
            <button onClick={() => { setCsv(''); setPreview([]); }} style={btn()}>Clear</button>
          </div>

          {preview.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.75rem' }}>
              <thead><tr><th style={th()}>Line</th><th style={th()}>Student</th><th style={th()}>Guardian email</th><th style={th()}>Class</th><th style={th()}>Admission #</th><th style={th()}>Result</th></tr></thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.line}>
                    <td style={td()}>{r.line}</td>
                    <td style={td()}>{r.student_name || <span style={{ color: '#b91c1c' }}>—</span>}</td>
                    <td style={td()}>{r.guardian_email || <span style={{ color: '#b91c1c' }}>—</span>}</td>
                    <td style={td()}>{r.class_name || <span style={{ color: '#b91c1c' }}>—</span>}</td>
                    <td style={td()}>{r.admission_no || '—'}</td>
                    <td style={td()}><Badge status={r.status === 'valid' ? 'verified' : 'rejected'} label={r.status === 'valid' ? 'valid' : (r.message ?? 'error')} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem' }}>Preview only — nothing is persisted until a batch is created server-side and approved in the queue below.</p>
        </Card>

        <Card title="2 · Approval queue">
          {batches.length === 0 ? <p style={{ color: '#6b7280' }}>No import batches yet.</p> : batches.map((b) => (
            <div key={b.id} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <strong>{b.filename}</strong>
                  <span style={{ marginLeft: '0.6rem', fontSize: '0.8rem', color: '#6b7280' }}>by {b.uploaded_by} · {fmtDate(b.uploaded_at)}</span>
                  <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.25rem' }}>{b.total} rows · <span style={{ color: '#15803d' }}>{b.valid} valid</span> · <span style={{ color: '#b91c1c' }}>{b.errors} error(s)</span></div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <Badge status={b.status === 'pending_review' ? 'pending' : b.status === 'approved' ? 'approved' : 'rejected'} label={b.status.replace(/_/g, ' ')} />
                  {b.status === 'pending_review' && (
                    <>
                      <button onClick={() => decide(b, 'approve')} disabled={busy === b.id || b.errors > 0} style={btnPrimary()} title={b.errors > 0 ? 'Resolve error rows before approving' : ''}>Approve</button>
                      <button onClick={() => decide(b, 'reject')} disabled={busy === b.id} style={btnDanger()}>Reject</button>
                    </>
                  )}
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.6rem' }}>
                <thead><tr><th style={th()}>Student</th><th style={th()}>Guardian</th><th style={th()}>Class</th><th style={th()}>Result</th></tr></thead>
                <tbody>{b.rows.map((r) => <tr key={r.line}><td style={td()}>{r.student_name}</td><td style={td()}>{r.guardian_email}</td><td style={td()}>{r.class_name}</td><td style={td()}><Badge status={r.status === 'valid' ? 'verified' : 'rejected'} label={r.status === 'valid' ? 'valid' : (r.message ?? 'error')} /></td></tr>)}</tbody>
              </table>
            </div>
          ))}
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Batch approvals/rejections and the resulting student/guardian records are written to the immutable audit log (module <code>academy.fees</code>). Invoices for onboarded students appear in the Collections dashboard.</AuditNote>
        </Card>
      </StateBlock>
    </div>
    </FeesGuard>
  );
}
