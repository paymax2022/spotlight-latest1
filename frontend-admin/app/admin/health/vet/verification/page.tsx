'use client';

import { useEffect, useState } from 'react';
import {
  listVerificationQueue,
  getVerificationDocUrl,
  decideVerification,
} from '@/services/healthVetVerificationService';
import type {
  VcnQueueItem,
  VcnVerificationRecord,
  VcnDecisionInput,
  VcnFieldMatch,
} from '@/types/healthVetVerification';
import {
  PageHeader, VetTabs, Card, Badge, DisclosureNote, AuditNote, StateBlock,
  btn, btnPrimary, btnDanger, th, td, input, label, fmtDate,
} from '../../_ui';

// Advisory identity cross-check badge — green=match / red=mismatch / grey=unverifiable.
const MATCH_COLORS: Record<VcnFieldMatch, { fg: string; bg: string }> = {
  match: { fg: '#15803d', bg: '#dcfce7' },
  mismatch: { fg: '#b91c1c', bg: '#fee2e2' },
  unverifiable: { fg: '#6b7280', bg: '#f3f4f6' },
};
function MatchBadge({ value }: { value: VcnFieldMatch }) {
  const c = MATCH_COLORS[value] ?? MATCH_COLORS.unverifiable;
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{value}</span>;
}

const MATCH_KEYS = ['name', 'dob', 'kyc'] as const;

export default function VcnVerificationPage() {
  const [items, setItems] = useState<VcnQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<VcnQueueItem | null>(null);
  const [licenceExpiry, setLicenceExpiry] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<VcnVerificationRecord | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setItems(await listVerificationQueue()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function review(item: VcnQueueItem) {
    setOpen(item);
    setLicenceExpiry(item.record.licence_expiry ?? '');
    setNotes('');
    setResult(null);
    setMsg(null);
  }

  async function viewDoc(docId: string) {
    setMsg(null);
    try {
      const { url } = await getVerificationDocUrl(docId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) { setMsg(String(e)); }
  }

  async function decide(action: VcnDecisionInput['action']) {
    if (!open) return;
    if (action === 'approve' && !licenceExpiry) { setMsg('A licence expiry date is required to approve.'); return; }
    setBusy(true); setMsg(null);
    try {
      const input: VcnDecisionInput = {
        action,
        ...(action === 'approve' ? { licence_expiry: licenceExpiry } : {}),
        ...(notes ? { notes } : {}),
      };
      const r = await decideVerification(open.record.id, input);
      setResult(r);
      setMsg(`Decision recorded — status ${r.status}.`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  const rec = open?.record;
  const canApprove = !!licenceExpiry && !busy;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="VCN verification review"
        subtitle="Mode B (assisted) review of vet-submitted VCN registrations. The vet never touches the VCN portal — ops confirms the credential out-of-band and records a decision here. The HL-2 provider capability is granted only on approval (idempotently), with a licence-expiry auto-suspend scheduled; every action is written to the immutable audit log (HL-12)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <VetTabs active="verification" />

      <DisclosureNote>
        Documents are access-logged server-side on every view (HL-8 / NDPA). The identity cross-check
        (name / DOB vs the vet&apos;s Paymax KYC) is <strong>advisory</strong> — it flags, it never auto-decides.
        A vet can never self-approve: only this RBAC-gated console (<code>health.vet.review</code>) records the decision.
      </DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card title="Verification queue">
        <StateBlock loading={loading} error={error} empty={items.length === 0} emptyText="No verification records in the queue.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Applicant</th>
              <th style={th()}>Status</th>
              <th style={th()}>Identity flag</th>
              <th style={th()}>Submitted</th>
              <th style={th()}></th>
            </tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.record.id}>
                  <td style={td()}>
                    <strong>{it.display_name}</strong>
                    <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{it.record.reg_number} · {it.record.id}</div>
                  </td>
                  <td style={td()}><Badge status={it.record.status.toLowerCase()} label={it.record.status} /></td>
                  <td style={td()}>{it.identity_flag ? <Badge status="rejected" label="Identity flag" /> : '—'}</td>
                  <td style={td()}>{fmtDate(it.record.created_at)}</td>
                  <td style={td()}><button style={btn()} onClick={() => review(it)}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {open && rec && (
        <Card title={`Review — ${open.display_name}`} right={<button style={btn()} onClick={() => setOpen(null)}>Close</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <div><span style={{ color: '#6b7280' }}>VCN reg number:</span> <code>{rec.reg_number}</code></div>
            <div><span style={{ color: '#6b7280' }}>Source / method:</span> {rec.source} · {rec.method}</div>
            <div><span style={{ color: '#6b7280' }}>Application state:</span> {open.application_state}</div>
            <div><span style={{ color: '#6b7280' }}>Status:</span> <Badge status={rec.status.toLowerCase()} label={rec.status} /></div>
            <div><span style={{ color: '#6b7280' }}>Created:</span> {fmtDate(rec.created_at)}</div>
            <div><span style={{ color: '#6b7280' }}>Decided:</span> {fmtDate(rec.decided_at)}</div>
            <div><span style={{ color: '#6b7280' }}>Consent on file:</span> {fmtDate(rec.consent_at)}</div>
          </div>

          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Identity cross-check (advisory)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
            <thead><tr><th style={th()}>Field</th><th style={th()}>Result</th></tr></thead>
            <tbody>
              {MATCH_KEYS.map((k) => (
                <tr key={k}>
                  <td style={td()} >{k === 'dob' ? 'DOB' : k === 'kyc' ? 'KYC' : 'Name'}</td>
                  <td style={td()}><MatchBadge value={rec.matched_fields[k] ?? 'unverifiable'} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Evidence documents</h3>
          {rec.evidence_doc_ids.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No documents attached.</p>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {rec.evidence_doc_ids.map((docId) => (
                <button key={docId} style={btn()} onClick={() => viewDoc(docId)}>View document <span style={{ color: '#9ca3af' }}>({docId})</span></button>
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
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={label()} htmlFor="notes">Notes (optional)</label>
            <textarea id="notes" style={{ ...input(), minHeight: 70, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reviewer notes — recorded on the decision (HL-12)." />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button disabled={!canApprove} style={{ ...btnPrimary(), opacity: canApprove ? 1 : 0.5, cursor: canApprove ? 'pointer' : 'not-allowed' }} onClick={() => decide('approve')}>Approve &amp; grant capability</button>
            <button disabled={busy} style={btn()} onClick={() => decide('need_info')}>Needs info</button>
            <button disabled={busy} style={btnDanger()} onClick={() => decide('reject')}>Reject</button>
          </div>
          {!licenceExpiry && <p style={{ color: '#9a3412', fontSize: '0.72rem', marginTop: '0.4rem' }}>Set a licence expiry date to enable approval (HL-2 auto-suspend on expiry).</p>}

          {result && <AuditNote>Application {result.id}: status {result.status}. {result.status === 'VERIFIED' ? 'Provider vet capability granted idempotently and licence-expiry auto-suspend scheduled (HL-2). ' : ''}Recorded to the immutable audit log (HL-12).</AuditNote>}
        </Card>
      )}
    </div>
  );
}
