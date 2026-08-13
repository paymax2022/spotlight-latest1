'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getReviewCampaign, decideCampaign } from '@/services/crowdfundingAdminService';
import type { CfReviewCampaign, CfReviewDecision, CfRiskLevel } from '@/types/crowdfunding';
import { Page, Card, Button, Badge, colors, tint } from '@/components/ui/vuexy';

const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: colors.success, MEDIUM: colors.warning, HIGH: colors.danger };
const STATUS_BADGE: Record<string, string> = {
  PENDING_REVIEW: colors.warning, CHANGES_REQUESTED: colors.primary, ACTIVE: colors.success,
  COMPLETED: colors.info, FROZEN: colors.danger, REJECTED: colors.muted,
};

function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG')}`;
}

const DECISIONS: { value: CfReviewDecision; label: string; color: string; variant: 'primary' | 'danger' | 'secondary'; requiresNote: boolean }[] = [
  { value: 'APPROVE', label: 'Approve & publish', color: colors.success, variant: 'primary', requiresNote: false },
  { value: 'REQUEST_CHANGES', label: 'Request changes', color: colors.primary, variant: 'secondary', requiresNote: true },
  { value: 'REJECT', label: 'Reject', color: colors.danger, variant: 'danger', requiresNote: true },
  { value: 'FREEZE', label: 'Freeze', color: colors.danger, variant: 'danger', requiresNote: true },
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

  if (loading) return <div style={{ padding: '1rem' }}><p style={{ color: colors.muted }}>Loading campaign…</p></div>;
  if (error && !c) return <div style={{ padding: '1rem' }}><p style={{ color: colors.danger }}>{error}</p></div>;
  if (!c) return null;

  const budgetTotal = c.budget.reduce((s, b) => s + b.amountKobo, 0);
  const decidable = c.status === 'PENDING_REVIEW' || c.status === 'CHANGES_REQUESTED' || c.status === 'ACTIVE';

  return (
    <Page style={{ maxWidth: 980 }}>
      <Button variant="outline" sm style={{ marginBottom: '1rem' }} onClick={() => router.push('/admin/crowdfunding/review')}>← Back to queue</Button>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div style={{ width: 120, height: 90, borderRadius: '0.5rem', background: colors.headBg, overflow: 'hidden', flexShrink: 0 }}>
          {c.coverImage ? <img src={c.coverImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <Badge text={c.status.replace('_', ' ')} color={STATUS_BADGE[c.status]} />
            <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, padding: '0.1rem 0.5rem', borderRadius: '9999px', color: RISK_COLOR[c.riskLevel], border: `1px solid ${RISK_COLOR[c.riskLevel]}` }}>RISK {c.riskLevel} · {c.riskScore}</span>
            <span style={{ fontSize: '0.72rem', color: colors.muted, background: colors.headBg, padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{c.category} · {c.type}</span>
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>{c.title}</h1>
          <p style={{ color: colors.text, margin: '0.35rem 0 0', fontSize: '0.9rem' }}>{c.summary}</p>
        </div>
      </div>

      {/* Admin note from prior decision */}
      {c.adminNote && (
        <div style={{ background: tint(colors.primary, 0.08), border: `1px solid ${tint(colors.primary, 0.3)}`, borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: colors.primary }}>
          <strong>Reviewer note:</strong> {c.adminNote}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* Creator & beneficiary */}
        <Card title="Creator & beneficiary">
          <div style={{ marginTop: 10 }}>
            <Row k="Creator" v={`${c.creatorName} (${c.creatorType})`} />
            <Row k="Verification" v={c.creatorVerification} highlight={c.creatorVerification === 'EMAIL' || c.creatorVerification === 'UNVERIFIED'} />
            <Row k="Email" v={c.creatorEmail} />
            <Row k="Beneficiary" v={`${c.beneficiaryName} (${c.beneficiaryRelationship})`} />
            <Row k="Bank" v={c.bankLabel} />
            <Row k="Location" v={c.location} />
          </div>
        </Card>

        {/* Funding */}
        <Card title="Funding">
          <div style={{ marginTop: 10 }}>
            <Row k="Goal" v={naira(c.goalKobo)} />
            <Row k="Disbursement" v={c.disbursementModel} />
            <Row k="Budget total" v={naira(budgetTotal)} highlight={budgetTotal !== c.goalKobo} />
            <Row k="Refund policy" v={c.refundPolicy} />
            <Row k="Submitted" v={new Date(c.submittedAt).toLocaleString()} />
          </div>
        </Card>
      </div>

      {/* Budget breakdown */}
      <Card title="Use of funds" style={{ marginTop: '1rem' }}>
        <div style={{ marginTop: 10 }}>
          {c.budget.map((b) => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: `1px solid ${colors.border}`, fontSize: '0.85rem' }}>
              <span style={{ color: colors.text }}>{b.label}</span>
              <strong>{naira(b.amountKobo)}</strong>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', fontSize: '0.9rem' }}>
            <strong>Total</strong><strong style={{ color: budgetTotal === c.goalKobo ? colors.success : colors.warning }}>{naira(budgetTotal)}</strong>
          </div>
        </div>
      </Card>

      {/* Documents */}
      <Card title="Documents" style={{ marginTop: '1rem' }}>
        <div style={{ marginTop: 10 }}>
          {c.documents.length === 0 ? (
            <p style={{ color: colors.danger, fontSize: '0.85rem', margin: 0 }}>⚠ No documents uploaded.</p>
          ) : c.documents.map((d) => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', fontSize: '0.85rem' }}>
              <span>{d.label} <span style={{ color: colors.muted }}>({d.type})</span></span>
              <span style={{ color: d.verified ? colors.success : colors.warning, fontWeight: 600 }}>{d.verified ? '✓ Verified' : 'Unverified'}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Risk signals */}
      <Card title={`Risk assessment — score ${c.riskScore}/100`} style={{ marginTop: '1rem', borderColor: c.riskLevel === 'HIGH' ? tint(colors.danger, 0.4) : colors.border }}>
        <div style={{ marginTop: 10 }}>
          {c.riskSignals.map((s) => (
            <div key={s.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.3rem 0', fontSize: '0.85rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: RISK_COLOR[s.severity], flexShrink: 0 }} />
              <span style={{ color: colors.text }}>{s.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: RISK_COLOR[s.severity], fontWeight: 700 }}>{s.severity}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Story */}
      <Card title="Story" style={{ marginTop: '1rem' }}>
        <p style={{ color: colors.text, fontSize: '0.85rem', lineHeight: 1.6, margin: '10px 0 0' }}>{c.story}</p>
      </Card>

      {error && <p style={{ color: colors.danger, marginTop: '1rem' }}>{error}</p>}

      {/* Decision bar */}
      {decidable ? (
        <div style={{ position: 'sticky', bottom: 0, marginTop: '1.5rem', background: colors.bg, borderTop: `1px solid ${colors.border}`, padding: '0.9rem 0', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {DECISIONS.filter((d) => !(c.status === 'ACTIVE' && d.value !== 'FREEZE')).map((d) => (
            <Button key={d.value} variant={d.variant} onClick={() => { setModal({ decision: d.value, note: '' }); setError(null); }}>
              {d.label}
            </Button>
          ))}
        </div>
      ) : (
        <p style={{ marginTop: '1.5rem', color: colors.muted, fontSize: '0.85rem' }}>This campaign is {c.status.replace('_', ' ').toLowerCase()} — no further review action available.</p>
      )}

      {/* Decision modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: colors.card, borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '30rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontWeight: 700, marginTop: 0, marginBottom: '0.75rem' }}>{DECISIONS.find((d) => d.value === modal.decision)?.label}</h2>
            <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 0 }}>
              {modal.decision === 'APPROVE' ? 'This campaign will go live and accept contributions.' : 'The creator will be notified with your note.'}
            </p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              Admin note{DECISIONS.find((d) => d.value === modal.decision)?.requiresNote ? ' (required)' : ' (optional)'}
              <textarea value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} rows={4} placeholder="Explain your decision…"
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' }} />
            </label>
            {error && <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <Button variant="outline" onClick={() => { setModal(null); setError(null); }}>Cancel</Button>
              <Button variant={DECISIONS.find((d) => d.value === modal.decision)?.variant} disabled={busy} onClick={confirm}>
                {busy ? 'Submitting…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

function Row({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.3rem 0', fontSize: '0.85rem' }}>
      <span style={{ color: colors.muted }}>{k}</span>
      <span style={{ color: highlight ? colors.warning : colors.text, fontWeight: highlight ? 700 : 500, textAlign: 'right' }}>{v}</span>
    </div>
  );
}
