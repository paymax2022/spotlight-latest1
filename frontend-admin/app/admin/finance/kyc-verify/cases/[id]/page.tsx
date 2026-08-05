'use client';

// AK2 — KYC Verification case detail.
// RBAC: finance.admin.kyc (role: KYC Ops for decisions). Shows the full session,
// every check (type/provider/status/confidence/extracted fields/reason), and
// evidence refs as ACCESS-LOGGED links — raw selfies/documents/bio-data are
// NEVER rendered inline. Actions: Approve / Reject / Request re-submit (reason
// required, recorded in the audit trail — AK13).

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  getCase,
  approveCase,
  rejectCase,
  requestResubmit,
  fetchEvidenceAccess,
} from '@/services/kycAdminService';
import type { KycCaseDetail, EvidenceRef } from '@/types/kycAdmin';
import { CHECK_TYPE_LABELS, TIER_LABELS } from '@/types/kycAdmin';
import {
  PageHeader, Card, BackToQueue, btn, btnPrimary, btnDisabled,
  CheckStatusBadge, SessionStatusBadge, ConfidencePill, timeAgo, useKycPermissions,
} from '../../_ui';
import { Page, colors } from '@/components/ui/vuexy';

type ActionKind = 'approve' | 'reject' | 'resubmit';

const ACTION_LABELS: Record<ActionKind, string> = {
  approve: 'Approve case',
  reject: 'Reject case',
  resubmit: 'Request re-submit',
};

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: colors.text, fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{children}</div>
    </div>
  );
}

export default function KycCaseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { canManage } = useKycPermissions();

  const [detail, setDetail] = useState<KycCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState('');

  // Access-logged evidence — we only reveal a metadata confirmation, never raw PII.
  const [evidenceBusy, setEvidenceBusy] = useState<string | null>(null);
  const [accessed, setAccessed] = useState<Record<string, EvidenceRef>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try { setDetail(await getCase(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function runAction() {
    if (!detail || !action) return;
    if (!reason.trim()) { setError('A reason is required and is recorded in the audit log.'); return; }
    setBusy(true); setError(null);
    try {
      if (action === 'approve') await approveCase(detail.session.id, reason.trim());
      else if (action === 'reject') await rejectCase(detail.session.id, reason.trim());
      else await requestResubmit(detail.session.id, reason.trim());
      setAction(null);
      setReason('');
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function viewEvidence(ev: EvidenceRef) {
    if (!detail) return;
    setEvidenceBusy(ev.id); setError(null);
    try {
      // This call is access-logged server-side (surfaced in AK13). We only
      // confirm access — the raw object is never streamed into the DOM here.
      const ref = await fetchEvidenceAccess(detail.session.id, ev.id);
      if (ref) setAccessed((prev) => ({ ...prev, [ev.id]: ref }));
    } catch (e) { setError(String(e)); }
    finally { setEvidenceBusy(null); }
  }

  return (
    <Page style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <div style={{ marginBottom: '0.75rem' }}><BackToQueue /></div>

      {loading ? (
        <p style={{ color: colors.muted }}>Loading case…</p>
      ) : !detail ? (
        <p style={{ color: colors.danger }}>{error ?? 'Case not found.'}</p>
      ) : (
        <>
          <PageHeader
            title={`Case ${detail.session.id}`}
            subtitle={`Target ${TIER_LABELS[detail.session.target_tier] ?? `Tier ${detail.session.target_tier}`} · user ${detail.session.user_id}`}
            action={<SessionStatusBadge status={detail.session.status} />}
          />

          {error && <p style={{ color: colors.danger }}>{error}</p>}

          <Card title="Session">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <Field label="Session ID" mono>{detail.session.id}</Field>
              <Field label="User ID" mono>{detail.session.user_id}</Field>
              <Field label="Target tier">{TIER_LABELS[detail.session.target_tier] ?? `Tier ${detail.session.target_tier}`}</Field>
              <Field label="Status"><SessionStatusBadge status={detail.session.status} /></Field>
              <Field label="Created">{detail.session.created_at ? new Date(detail.session.created_at).toLocaleString() : '—'}</Field>
              <Field label="Updated">{detail.session.updated_at ? new Date(detail.session.updated_at).toLocaleString() : '—'}</Field>
            </div>
          </Card>

          <Card title="Checks">
            {detail.checks.length === 0 ? (
              <p style={{ color: colors.muted, margin: 0 }}>No checks recorded on this session.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {detail.checks.map((c) => (
                  <div key={c.id} style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <strong style={{ fontSize: '0.9rem' }}>{CHECK_TYPE_LABELS[c.type]}</strong>
                        <span style={{ fontSize: '0.75rem', color: colors.muted, textTransform: 'capitalize' }}>· {c.provider}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <ConfidencePill value={c.confidence} />
                        <CheckStatusBadge status={c.status} />
                      </div>
                    </div>
                    {c.reason && (
                      <p style={{ fontSize: '0.8rem', color: '#9a3412', margin: '0 0 0.5rem' }}>{c.reason}</p>
                    )}
                    {c.extracted_fields && Object.keys(c.extracted_fields).length > 0 && (
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {Object.entries(c.extracted_fields).map(([k, v]) => (
                          <span key={k} style={{ fontSize: '0.75rem', background: '#f3f4f6', border: `1px solid ${colors.border}`, borderRadius: '0.375rem', padding: '0.15rem 0.5rem' }}>
                            <span style={{ color: colors.muted }}>{k}:</span> {v}
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.5rem' }}>{timeAgo(c.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Evidence">
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#9a3412', marginBottom: '0.9rem' }}>
              Selfies, documents and bio-data are object-level access-controlled and are <strong>never displayed inline</strong>.
              Every view is <strong>logged</strong> and appears in the Audit &amp; Consent log (AK13).
            </div>
            {detail.evidence_refs.length === 0 ? (
              <p style={{ color: colors.muted, margin: 0 }}>No evidence attached to this case.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {detail.evidence_refs.map((ev) => (
                  <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.5rem 0.75rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{ev.label ?? ev.kind}</div>
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>{ev.kind} · {ev.id}</div>
                    </div>
                    {accessed[ev.id] ? (
                      <span style={{ fontSize: '0.78rem', color: '#15803d', fontWeight: 600 }}>Access logged — open in secure viewer</span>
                    ) : (
                      <button
                        disabled={!canManage || evidenceBusy === ev.id}
                        title={!canManage ? 'Requires finance.admin.kyc' : 'Fetch evidence — this access is logged'}
                        onClick={() => void viewEvidence(ev)}
                        style={!canManage || evidenceBusy === ev.id ? btnDisabled() : btn()}
                      >
                        {evidenceBusy === ev.id ? 'Logging access…' : 'View evidence (logged)'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Decision">
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#9a3412', marginBottom: '1rem' }}>
              KYC decisions are audited. <strong>Approve</strong> promotes the user toward the target tier;
              <strong> Reject</strong> declines the session; <strong>Request re-submit</strong> asks the user to re-capture. A reason is required for all three.
            </div>

            {!canManage && (
              <p style={{ fontSize: '0.8rem', color: '#b91c1c', marginTop: 0 }}>
                You lack <code>finance.admin.kyc</code> — decisions are disabled.
              </p>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                disabled={!canManage || busy}
                onClick={() => { setAction('approve'); setReason(''); setError(null); }}
                style={!canManage || busy ? btnDisabled() : btnPrimary('#15803d')}
              >
                Approve
              </button>
              <button
                disabled={!canManage || busy}
                onClick={() => { setAction('reject'); setReason(''); setError(null); }}
                style={!canManage || busy ? btnDisabled() : btnPrimary('#b91c1c')}
              >
                Reject
              </button>
              <button
                disabled={!canManage || busy}
                onClick={() => { setAction('resubmit'); setReason(''); setError(null); }}
                style={!canManage || busy ? btnDisabled() : btnPrimary('#9a3412')}
              >
                Request re-submit
              </button>
            </div>
          </Card>
        </>
      )}

      {/* Decision confirm modal */}
      {action && detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '30rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontWeight: 700, marginTop: 0, marginBottom: '0.75rem' }}>{ACTION_LABELS[action]}</h2>
            <p style={{ fontSize: '0.85rem', color: colors.text, marginTop: 0 }}>
              Case <code>{detail.session.id}</code> for user <code>{detail.session.user_id}</code> targeting{' '}
              <strong>{TIER_LABELS[detail.session.target_tier] ?? `Tier ${detail.session.target_tier}`}</strong>. This decision is recorded in the audit log.
            </p>

            <label style={{ display: 'block', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600 }}>
              Reason (required)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder={action === 'approve' ? 'e.g. facial match manually confirmed against ID' : action === 'reject' ? 'e.g. identity mismatch confirmed' : 'e.g. document image unreadable — ask user to re-capture'}
                style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </label>

            {error && <p style={{ color: colors.danger, fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => { setAction(null); setReason(''); setError(null); }} style={btn()}>Cancel</button>
              <button
                onClick={() => void runAction()}
                disabled={busy}
                style={busy ? btnDisabled() : btnPrimary(action === 'approve' ? '#15803d' : action === 'reject' ? '#b91c1c' : '#9a3412')}
              >
                {busy ? 'Processing…' : `Confirm ${action === 'resubmit' ? 're-submit' : action}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
