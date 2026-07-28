'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getReviewCampaign, decideCampaign } from '@/services/crowdfundingAdminService';
import type { CfReviewCampaign, CfReviewDecision, CfRiskLevel } from '@/types/crowdfunding';

const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: '#16a34a', MEDIUM: '#d97706', HIGH: '#dc2626' };
const STATUS_BADGE: Record<string, string> = {
  PENDING_REVIEW: '#d97706', CHANGES_REQUESTED: '#7c3aed', ACTIVE: '#16a34a',
  COMPLETED: '#1d4ed8', FROZEN: '#dc2626', REJECTED: '#6b7280',
};

function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG')}`;
}

const DECISIONS: { value: CfReviewDecision; label: string; color: string; requiresNote: boolean }[] = [
  { value: 'APPROVE', label: 'Approve & publish', color: '#16a34a', requiresNote: false },
  { value: 'REQUEST_CHANGES', label: 'Request changes', color: '#7c3aed', requiresNote: true },
  { value: 'REJECT', label: 'Reject', color: '#dc2626', requiresNote: true },
  { value: 'FREEZE', label: 'Freeze', color: '#b91c1c', requiresNote: true },
];

export default function CampaignReviewDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<CfReviewCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{ decision: CfReviewDecision; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setC(await getReviewCampaign(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function confirm() {
    if (!modal) return;
    const meta = DECISIONS.find((d) => d.value === modal.decision);
    if (meta?.requiresNote && !modal.note.trim()) { setError('A note is required for this decision.'); return; }
    setBusy(true); setError(null);
    try {
      await decideCampaign(id, modal.decision, modal.note);
      setModal(null);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  if (loading) return <div style={{ padding: '1rem' }}><p style={{ color: '#6b7280' }}>Loading campaign…</p></div>;
  if (error && !c) return <div style={{ padding: '1rem' }}><p style={{ color: '#dc2626' }}>{error}</p></div>;
  if (!c) return null;

  const budgetTotal = c.budget.reduce((s, b) => s + b.amountKobo, 0);
  const decidable = c.status === 'PENDING_REVIEW' || c.status === 'CHANGES_REQUESTED' || c.status === 'ACTIVE';

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem', maxWidth: 980 }}>
      <button onClick={() => router.push('/admin/crowdfunding/review')} style={{ ...btn(), marginBottom: '1rem' }}>← Back to queue</button>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div style={{ width: 120, height: 90, borderRadius: '0.5rem', background: '#f3f4f6', overflow: 'hidden', flexShrink: 0 }}>
          {c.coverImage ? <img src={c.coverImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={badge(STATUS_BADGE[c.status])}>{c.status.replace('_', ' ')}</span>
            <span style={{ ...badge('#fff'), color: RISK_COLOR[c.riskLevel], border: `1px solid ${RISK_COLOR[c.riskLevel]}` }}>RISK {c.riskLevel} · {c.riskScore}</span>
            <span style={{ fontSize: '0.72rem', color: '#6b7280', background: '#f3f4f6', padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{c.category} · {c.type}</span>
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>{c.title}</h1>
          <p style={{ color: '#374151', margin: '0.35rem 0 0', fontSize: '0.9rem' }}>{c.summary}</p>
        </div>
      </div>

      {/* Admin note from prior decision */}
      {c.adminNote && (
        <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#5b21b6' }}>
          <strong>Reviewer note:</strong> {c.adminNote}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* Creator & beneficiary */}
        <section style={card()}>
          <h2 style={h2()}>Creator & beneficiary</h2>
          <Row k="Creator" v={`${c.creatorName} (${c.creatorType})`} />
          <Row k="Verification" v={c.creatorVerification} highlight={c.creatorVerification === 'EMAIL' || c.creatorVerification === 'UNVERIFIED'} />
          <Row k="Email" v={c.creatorEmail} />
          <Row k="Beneficiary" v={`${c.beneficiaryName} (${c.beneficiaryRelationship})`} />
          <Row k="Bank" v={c.bankLabel} />
          <Row k="Location" v={c.location} />
        </section>

        {/* Funding */}
        <section style={card()}>
          <h2 style={h2()}>Funding</h2>
          <Row k="Goal" v={naira(c.goalKobo)} />
          <Row k="Disbursement" v={c.disbursementModel} />
          <Row k="Budget total" v={naira(budgetTotal)} highlight={budgetTotal !== c.goalKobo} />
          <Row k="Refund policy" v={c.refundPolicy} />
          <Row k="Submitted" v={new Date(c.submittedAt).toLocaleString()} />
        </section>
      </div>

      {/* Budget breakdown */}
      <section style={{ ...card(), marginTop: '1rem' }}>
        <h2 style={h2()}>Use of funds</h2>
        {c.budget.map((b) => (
          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem' }}>
            <span style={{ color: '#374151' }}>{b.label}</span>
            <strong>{naira(b.amountKobo)}</strong>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', fontSize: '0.9rem' }}>
          <strong>Total</strong><strong style={{ color: budgetTotal === c.goalKobo ? '#16a34a' : '#d97706' }}>{naira(budgetTotal)}</strong>
        </div>
      </section>

      {/* Documents */}
      <section style={{ ...card(), marginTop: '1rem' }}>
        <h2 style={h2()}>Documents</h2>
        {c.documents.length === 0 ? (
          <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: 0 }}>⚠ No documents uploaded.</p>
        ) : c.documents.map((d) => (
          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', fontSize: '0.85rem' }}>
            <span>{d.label} <span style={{ color: '#9ca3af' }}>({d.type})</span></span>
            <span style={{ color: d.verified ? '#16a34a' : '#d97706', fontWeight: 600 }}>{d.verified ? '✓ Verified' : 'Unverified'}</span>
          </div>
        ))}
      </section>

      {/* Risk signals */}
      <section style={{ ...card(), marginTop: '1rem', borderColor: c.riskLevel === 'HIGH' ? '#fecaca' : '#e5e7eb' }}>
        <h2 style={h2()}>Risk assessment — score {c.riskScore}/100</h2>
        {c.riskSignals.map((s) => (
          <div key={s.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.3rem 0', fontSize: '0.85rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: RISK_COLOR[s.severity], flexShrink: 0 }} />
            <span style={{ color: '#374151' }}>{s.label}</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: RISK_COLOR[s.severity], fontWeight: 700 }}>{s.severity}</span>
          </div>
        ))}
      </section>

      {/* Story */}
      <section style={{ ...card(), marginTop: '1rem' }}>
        <h2 style={h2()}>Story</h2>
        <p style={{ color: '#374151', fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>{c.story}</p>
      </section>

      {error && <p style={{ color: '#dc2626', marginTop: '1rem' }}>{error}</p>}

      {/* Decision bar */}
      {decidable ? (
        <div style={{ position: 'sticky', bottom: 0, marginTop: '1.5rem', background: '#fff', borderTop: '1px solid #e5e7eb', padding: '0.9rem 0', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {DECISIONS.filter((d) => !(c.status === 'ACTIVE' && d.value !== 'FREEZE')).map((d) => (
            <button key={d.value} onClick={() => { setModal({ decision: d.value, note: '' }); setError(null); }} style={{ padding: '0.55rem 1rem', borderRadius: '0.5rem', border: 'none', background: d.color, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>
              {d.label}
            </button>
          ))}
        </div>
      ) : (
        <p style={{ marginTop: '1.5rem', color: '#6b7280', fontSize: '0.85rem' }}>This campaign is {c.status.replace('_', ' ').toLowerCase()} — no further review action available.</p>
      )}

      {/* Decision modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '30rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontWeight: 700, marginTop: 0, marginBottom: '0.75rem' }}>{DECISIONS.find((d) => d.value === modal.decision)?.label}</h2>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 0 }}>
              {modal.decision === 'APPROVE' ? 'This campaign will go live and accept contributions.' : 'The creator will be notified with your note.'}
            </p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              Admin note{DECISIONS.find((d) => d.value === modal.decision)?.requiresNote ? ' (required)' : ' (optional)'}
              <textarea value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} rows={4} placeholder="Explain your decision…"
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' }} />
            </label>
            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button onClick={() => { setModal(null); setError(null); }} style={btn()}>Cancel</button>
              <button onClick={confirm} disabled={busy} style={{ padding: '0.45rem 1rem', borderRadius: '0.375rem', border: 'none', background: DECISIONS.find((d) => d.value === modal.decision)?.color, color: '#fff', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
                {busy ? 'Submitting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.3rem 0', fontSize: '0.85rem' }}>
      <span style={{ color: '#6b7280' }}>{k}</span>
      <span style={{ color: highlight ? '#d97706' : '#111827', fontWeight: highlight ? 700 : 500, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

const card = (): React.CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
const btn = (): React.CSSProperties => ({ padding: '0.4rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
const h2 = (): React.CSSProperties => ({ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.6rem' });
function badge(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
}
