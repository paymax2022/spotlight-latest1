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
import { DisclosureNote, AuditNote, StateBlock, fmtDate } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

// Advisory identity cross-check badge — green=match / red=mismatch / grey=unverifiable.
const MATCH_COLORS: Record<MdcnFieldMatch, string> = {
  match: colors.success,
  mismatch: colors.danger,
  unverifiable: colors.secondary,
};
function MatchBadge({ value }: { value: MdcnFieldMatch }) {
  return <Badge text={value} color={MATCH_COLORS[value] ?? colors.secondary} />;
}

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (/(reject|fail|block)/.test(v)) return colors.danger;
  if (/(pending|need_info|need info|warn|flag)/.test(v)) return colors.warning;
  if (/(approve|verified|active|complete|ok)/.test(v)) return colors.success;
  return colors.secondary;
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
    <Page>
      <PageHeader
        title="MDCN verification review"
        subtitle="Mode B (assisted) review of doctor-submitted MDCN registrations. The doctor never sees the MDCN portal — ops confirms the credential out-of-band and records a decision here. HL-2 discoverability (the idempotent capability grant that makes the doctor discoverable) is granted only on approval, with a licence-expiry auto-suspend scheduled; every action is written to the immutable audit log (HL-12)."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
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
              <th style={thCell}>Doctor</th>
              <th style={thCell}>MDCN no</th>
              <th style={thCell}>Discipline</th>
              <th style={thCell}>Status</th>
              <th style={thCell}>Identity flag</th>
              <th style={thCell}>Submitted</th>
              <th style={thCell}></th>
            </tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.verificationId}>
                  <td style={tdCell}>
                    <strong>{it.doctorName}</strong>
                    <div style={{ fontSize: '0.72rem', color: colors.muted }}>{it.verificationId}</div>
                  </td>
                  <td style={tdCell}><code>{it.mdcnNumber}</code></td>
                  <td style={tdCell}>{it.discipline ? DISCIPLINE_LABEL[it.discipline] : '—'}</td>
                  <td style={tdCell}><Badge text={it.status} color={statusColor(it.status)} /></td>
                  <td style={tdCell}>{it.identityFlag ? <Badge text="Identity flag" color={colors.danger} /> : '—'}</td>
                  <td style={tdCell}>{fmtDate(it.submittedAt)}</td>
                  <td style={tdCell}><Button variant="outline" sm onClick={() => review(it)}>Review</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {rec && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: colors.text }}>Review — {rec.doctorName}</h2>
            <Button variant="outline" sm onClick={() => setOpen(null)}>Close</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <div><span style={{ color: colors.muted }}>MDCN reg number:</span> <code>{rec.mdcnNumber}</code></div>
            <div><span style={{ color: colors.muted }}>Source / method:</span> {rec.source} · {rec.method}</div>
            <div><span style={{ color: colors.muted }}>Discipline:</span> {rec.discipline ? DISCIPLINE_LABEL[rec.discipline] : '—'}</div>
            <div><span style={{ color: colors.muted }}>Status:</span> <Badge text={rec.status} color={statusColor(rec.status)} /></div>
            <div><span style={{ color: colors.muted }}>Submitted:</span> {fmtDate(rec.submittedAt)}</div>
            <div><span style={{ color: colors.muted }}>Decided:</span> {fmtDate(rec.decidedAt)}</div>
          </div>

          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Identity cross-check (advisory)</h3>
          {matchKeys.length === 0 ? (
            <p style={{ color: colors.muted, fontSize: '0.85rem' }}>No cross-check fields recorded.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
              <thead><tr><th style={thCell}>Field</th><th style={thCell}>Result</th></tr></thead>
              <tbody>
                {matchKeys.map((k) => (
                  <tr key={k}>
                    <td style={tdCell}>{k === 'kyc' ? 'KYC' : k === 'name' ? 'Name' : k}</td>
                    <td style={tdCell}><MatchBadge value={rec.matchedFields[k] ?? 'unverifiable'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Evidence documents</h3>
          {rec.documents.length === 0 ? (
            <p style={{ color: colors.muted, fontSize: '0.85rem' }}>No documents attached.</p>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {rec.documents.map((doc) => (
                <Button key={doc.id} variant="outline" sm onClick={() => viewDoc(doc.id)}>
                  View document <span style={{ color: colors.muted }}>({doc.label ?? doc.fileName ?? doc.docType})</span>
                </Button>
              ))}
            </div>
          )}
          <AuditNote>Opening a document is access-logged server-side (HL-8 / NDPA).</AuditNote>

          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '1.25rem 0 0.5rem' }}>Decision</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label htmlFor="licence_expiry">Licence expiry (required to approve)</label>
              <Input id="licence_expiry" type="date" value={licenceExpiry} onChange={(e) => setLicenceExpiry(e.target.value)} />
            </div>
            <div>
              <label htmlFor="discipline">Discipline (required to approve)</label>
              <select id="discipline" value={discipline} onChange={(e) => setDiscipline(e.target.value as '' | MdcnDiscipline)}>
                <option value="">Select discipline…</option>
                <option value="medical">Medical</option>
                <option value="dental">Dental</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label htmlFor="notes">Notes (optional)</label>
            <textarea id="notes" style={{ minHeight: 70, resize: 'vertical', width: '100%', boxSizing: 'border-box' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reviewer notes — recorded on the decision (HL-12)." />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button variant="primary" disabled={!canApprove} onClick={() => decide('approve')}>Approve &amp; grant discoverability</Button>
            <Button variant="outline" disabled={busy} onClick={() => decide('need_info')}>Needs info</Button>
            <Button variant="danger" disabled={busy} onClick={() => decide('reject')}>Reject</Button>
          </div>
          {!canApprove && !busy && <p style={{ color: colors.warning, fontSize: '0.72rem', marginTop: '0.4rem' }}>Set both a licence expiry date and a discipline to enable approval (HL-2 discoverability grant + auto-suspend on expiry).</p>}

          {result && <AuditNote>Verification {result.verificationId}: status {result.status}. {result.status === 'approved' ? 'Doctor discoverability granted via idempotent capability grant and licence-expiry auto-suspend scheduled (HL-2). ' : ''}Recorded to the immutable audit log (HL-12).</AuditNote>}
        </Card>
      )}
    </Page>
  );
}
