'use client';

import { useEffect, useState } from 'react';
import {
  listDoctorVerificationQueue,
  getDoctorVerification,
  getDoctorVerificationDocUrl,
  decideDoctorVerification,
} from '@/services/healthDoctorVerificationService';
import type {
  MdcnQueueItem,
  MdcnReviewRecord,
  MdcnDecisionInput,
  MdcnDiscipline,
  MdcnFieldMatch,
} from '@/types/healthDoctorVerification';
import {
  PageHeader, Card, Badge, DisclosureNote, AuditNote, StateBlock,
  btn, btnPrimary, btnDanger, th, td, input, select, label, fmtDate,
} from '../../_ui';

// Advisory identity cross-check badge — green=match / red=mismatch / grey=unverifiable.
const MATCH_COLORS: Record<MdcnFieldMatch, { fg: string; bg: string }> = {
  match: { fg: '#15803d', bg: '#dcfce7' },
  mismatch: { fg: '#b91c1c', bg: '#fee2e2' },
  unverifiable: { fg: '#6b7280', bg: '#f3f4f6' },
};
function MatchBadge({ value }: { value: MdcnFieldMatch }) {
  const c = MATCH_COLORS[value] ?? MATCH_COLORS.unverifiable;
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{value}</span>;
}

const DISCIPLINE_LABEL: Record<MdcnDiscipline, string> = { medical: 'Medical', dental: 'Dental' };

export default function MdcnVerificationPage() {
  const [items, setItems] = useState<MdcnQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<MdcnReviewRecord | null>(null);
  const [licenceExpiry, setLicenceExpiry] = useState('');
  const [discipline, setDiscipline] = useState<'' | MdcnDiscipline>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<MdcnReviewRecord | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setItems(await listDoctorVerificationQueue()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function review(item: MdcnQueueItem) {
    setMsg(null); setResult(null);
    try {
      const rec = await getDoctorVerification(item.verificationId);
      setOpen(rec);
      setLicenceExpiry(rec.licenceExpiry ?? '');
      setDiscipline(rec.discipline ?? '');
      setNotes('');
    } catch (e) { setMsg(String(e)); }
  }

  async function viewDoc(docId: string) {
    setMsg(null);
    try {
      const { url } = await getDoctorVerificationDocUrl(docId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) { setMsg(String(e)); }
  }

  async function decide(action: MdcnDecisionInput['action']) {
    if (!open) return;
    if (action === 'approve' && (!licenceExpiry || !discipline)) {
      setMsg('Approval requires both a licence expiry date and a discipline.');
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const input: MdcnDecisionInput = {
        action,
        ...(action === 'approve' ? { licence_expiry: licenceExpiry, discipline: discipline as MdcnDiscipline } : {}),
        ...(notes ? { notes } : {}),
      };
      const r = await decideDoctorVerification(open.verificationId, input);
      setResult(r);
      setMsg(`Decision recorded — status ${r.status}.`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  const rec = open;
  const matchKeys = rec ? Object.keys(rec.matchedFields) : [];
  const canApprove = !!licenceExpiry && !!discipline && !busy;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="MDCN verification review"
        subtitle="Mode B (assisted) review of doctor-submitted MDCN registrations. The doctor never sees the MDCN portal — ops confirms the credential out-of-band and records a decision here. HL-2 discoverability (the idempotent capability grant that makes the doctor discoverable) is granted only on approval, with a licence-expiry auto-suspend scheduled; every action is written to the immutable audit log (HL-12)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />

      <DisclosureNote>
        Documents are access-logged server-side on every view (HL-8 / NDPA). The identity cross-check
        (doctor name vs the doctor&apos;s Paymax KYC) is <strong>advisory</strong> — it flags, it never auto-decides.
        A doctor can never self-approve: only this RBAC-gated console (<code>health.doctor.review</code>) records the decision.
      </DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card title="Verification queue">
        <StateBlock loading={loading} error={error} empty={items.length === 0} emptyText="No verification records in the queue.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Doctor</th>
              <th style={th()}>MDCN no</th>
              <th style={th()}>Discipline</th>
              <th style={th()}>Status</th>
              <th style={th()}>Identity flag</th>
              <th style={th()}>Submitted</th>
              <th style={th()}></th>
            </tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.verificationId}>
                  <td style={td()}>
                    <strong>{it.doctorName}</strong>
                    <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{it.verificationId}</div>
                  </td>
                  <td style={td()}><code>{it.mdcnNumber}</code></td>
                  <td style={td()}>{it.discipline ? DISCIPLINE_LABEL[it.discipline] : '—'}</td>
                  <td style={td()}><Badge status={it.status.toLowerCase()} label={it.status} /></td>
                  <td style={td()}>{it.identityFlag ? <Badge status="rejected" label="Identity flag" /> : '—'}</td>
                  <td style={td()}>{fmtDate(it.submittedAt)}</td>
                  <td style={td()}><button style={btn()} onClick={() => review(it)}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {rec && (
        <Card title={`Review — ${rec.doctorName}`} right={<button style={btn()} onClick={() => setOpen(null)}>Close</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <div><span style={{ color: '#6b7280' }}>MDCN reg number:</span> <code>{rec.mdcnNumber}</code></div>
            <div><span style={{ color: '#6b7280' }}>Source / method:</span> {rec.source} · {rec.method}</div>
            <div><span style={{ color: '#6b7280' }}>Discipline:</span> {rec.discipline ? DISCIPLINE_LABEL[rec.discipline] : '—'}</div>
            <div><span style={{ color: '#6b7280' }}>Status:</span> <Badge status={rec.status.toLowerCase()} label={rec.status} /></div>
            <div><span style={{ color: '#6b7280' }}>Submitted:</span> {fmtDate(rec.submittedAt)}</div>
            <div><span style={{ color: '#6b7280' }}>Decided:</span> {fmtDate(rec.decidedAt)}</div>
          </div>

          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Identity cross-check (advisory)</h3>
          {matchKeys.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No cross-check fields recorded.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
              <thead><tr><th style={th()}>Field</th><th style={th()}>Result</th></tr></thead>
              <tbody>
                {matchKeys.map((k) => (
                  <tr key={k}>
                    <td style={td()}>{k === 'kyc' ? 'KYC' : k === 'name' ? 'Name' : k}</td>
                    <td style={td()}><MatchBadge value={rec.matchedFields[k] ?? 'unverifiable'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Evidence documents</h3>
          {rec.documents.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No documents attached.</p>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {rec.documents.map((doc) => (
                <button key={doc.id} style={btn()} onClick={() => viewDoc(doc.id)}>
                  View document <span style={{ color: '#9ca3af' }}>({doc.label ?? doc.fileName ?? doc.docType})</span>
                </button>
              ))}
            </div>
          )}
          <AuditNote>Opening a document is access-logged server-side (HL-8 / NDPA).</AuditNote>

          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '1.25rem 0 0.5rem' }}>Decision</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={label()} htmlFor="licence_expiry">Licence expiry (required to approve)</label>
              <input id="licence_expiry" type="date" style={input()} value={licenceExpiry} onChange={(e) => setLicenceExpiry(e.target.value)} />
            </div>
            <div>
              <label style={label()} htmlFor="discipline">Discipline (required to approve)</label>
              <select id="discipline" style={select()} value={discipline} onChange={(e) => setDiscipline(e.target.value as '' | MdcnDiscipline)}>
                <option value="">Select discipline…</option>
                <option value="medical">Medical</option>
                <option value="dental">Dental</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={label()} htmlFor="notes">Notes (optional)</label>
            <textarea id="notes" style={{ ...input(), minHeight: 70, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reviewer notes — recorded on the decision (HL-12)." />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button disabled={!canApprove} style={{ ...btnPrimary(), opacity: canApprove ? 1 : 0.5, cursor: canApprove ? 'pointer' : 'not-allowed' }} onClick={() => decide('approve')}>Approve &amp; grant discoverability</button>
            <button disabled={busy} style={btn()} onClick={() => decide('need_info')}>Needs info</button>
            <button disabled={busy} style={btnDanger()} onClick={() => decide('reject')}>Reject</button>
          </div>
          {!canApprove && !busy && <p style={{ color: '#9a3412', fontSize: '0.72rem', marginTop: '0.4rem' }}>Set both a licence expiry date and a discipline to enable approval (HL-2 discoverability grant + auto-suspend on expiry).</p>}

          {result && <AuditNote>Verification {result.verificationId}: status {result.status}. {result.status === 'approved' ? 'Doctor discoverability granted via idempotent capability grant and licence-expiry auto-suspend scheduled (HL-2). ' : ''}Recorded to the immutable audit log (HL-12).</AuditNote>}
        </Card>
      )}
    </div>
  );
}
