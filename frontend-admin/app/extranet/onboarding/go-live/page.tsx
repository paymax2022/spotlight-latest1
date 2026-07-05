'use client';

import { useEffect, useState } from 'react';
import { getVerificationStatus, submitForReview } from '@/services/staysExtranetService';
import type { VerificationStatus } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, btn, btnPrimary, fmtDate, th, td } from '../../_ui';

export default function GoLivePage() {
  const [data, setData] = useState<VerificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getVerificationStatus()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function submit() {
    setSubmitting(true);
    try { setData(await submitForReview()); }
    catch (e) { setError(String(e)); } finally { setSubmitting(false); }
  }

  const required = data?.checklist.filter((c) => c.required) ?? [];
  const remaining = required.filter((c) => c.status !== 'approved').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Go-live checklist" subtitle="Confirm every required step is complete, then submit your property for review. Paymax verifies and publishes it to travellers." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="onboarding" />
      {data && <PropertyScopeNote propertyName={data.property_name} />}

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <Card title="Step 6 of 6 — Readiness" right={<Badge status={data.overall} />}>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem', fontSize: '0.85rem', color: '#6b7280' }}>
                <span>Submitted: {fmtDate(data.submitted_for_review_at)}</span>
                <span>Reviewed: {fmtDate(data.reviewed_at)}</span>
                <span>Go-live eligible: <strong style={{ color: data.go_live_eligible ? '#15803d' : '#b91c1c' }}>{data.go_live_eligible ? 'Yes' : 'No'}</strong></span>
              </div>
              {data.reviewer_note ? <p style={{ fontSize: '0.82rem', color: '#374151', background: '#f9fafb', borderRadius: '0.5rem', padding: '0.6rem 0.8rem' }}>Reviewer: {data.reviewer_note}</p> : null}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Requirement</th><th style={th()}>Stage</th><th style={th()}>Status</th></tr></thead>
                <tbody>
                  {data.checklist.map((c) => (
                    <tr key={c.key}>
                      <td style={td()}>{c.label}{c.required ? '' : <span style={{ color: '#9ca3af' }}> (optional)</span>}</td>
                      <td style={td()}>{c.stage.replace(/_/g, ' ')}</td>
                      <td style={td()}><Badge status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Submit for review">
              <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                {remaining === 0 ? 'All required steps are complete. Submit to publish.' : `${remaining} required step(s) still pending.`}
              </p>
              <button style={btnPrimary()} disabled={remaining > 0 || submitting} onClick={submit}>{submitting ? 'Submitting…' : 'Submit for review'}</button>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
