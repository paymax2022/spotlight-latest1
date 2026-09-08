'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getClaim, formatNaira } from '@/services/insuranceAdminService';
import type { ClaimDetail } from '@/types/insuranceAdmin';
import {
  PageHeader,
  InsuranceTabs,
  Card,
  Badge,
  NotReported,
  LiveState,
  toFailure,
  type EndpointFailure,
  btn,
  th,
  td,
  fmtDate,
} from '../../_ui';
import { colors } from '@/components/ui/vuexy';

const dt: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  color: colors.muted,
  fontWeight: 600,
  marginBottom: 3,
};

export default function InsuranceClaimDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ''));

  const [claim, setClaim] = useState<ClaimDetail | null>(null);
  const [failure, setFailure] = useState<EndpointFailure | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setClaim(await getClaim(id));
    } catch (e) {
      setClaim(null);
      setFailure(toFailure(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (v: number | null | undefined) => (v === null || v === undefined ? <NotReported /> : formatNaira(v));

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={claim?.claim_ref || id}
        subtitle={claim ? `${claim.product_name || 'Claim'} · assessed by ${claim.underwriter || 'the underwriter'}` : 'Claim detail'}
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link href="/admin/insurance/claims" style={{ ...btn(), textDecoration: 'none' }}>Back</Link>
            <button onClick={load} style={btn()}>Refresh</button>
          </div>
        }
      />
      <InsuranceTabs active="claims" />

      <LiveState loading={loading} failure={failure} empty={!claim} emptyTitle="Claim not found" onRetry={load}>
        {claim && (
          <>
            <Card title="Claim">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                <Field label="Status"><Badge status={claim.status} /></Field>
                <Field label="Policy">
                  <Link href={`/admin/insurance/policies/${encodeURIComponent(claim.policy_id)}`} style={{ color: colors.primary, textDecoration: 'none' }}>
                    <code style={{ fontSize: 12 }}>{claim.policy_id}</code>
                  </Link>
                </Field>
                <Field label="Underwriter">{claim.underwriter || <NotReported />}</Field>
                <Field label="Claimant">{claim.claimant_masked || <NotReported hint="PII is masked by the API." />}</Field>
                <Field label="Provider reference">
                  {claim.provider_claim_ref ? <code style={{ fontSize: 12 }}>{claim.provider_claim_ref}</code> : <NotReported />}
                </Field>
                <Field label="Claimed">{money(claim.claimed_amount_kobo)}</Field>
                <Field label="Approved">
                  <span style={{ fontWeight: 700 }}>{money(claim.approved_amount_kobo)}</span>
                </Field>
                <Field label="Loss event">{claim.loss_event_at ? fmtDate(claim.loss_event_at) : <NotReported />}</Field>
                <Field label="Raised">{claim.created_at ? fmtDate(claim.created_at) : <NotReported />}</Field>
                <Field label="Payout ledger">
                  {claim.payout_ledger_ref ? <code style={{ fontSize: 12 }}>{claim.payout_ledger_ref}</code> : <NotReported hint="No payout has been posted to the ledger for this claim." />}
                </Field>
              </div>
              {claim.description ? (
                <div style={{ marginTop: 16 }}>
                  <div style={dt}>Description</div>
                  <div style={{ fontSize: 13, color: colors.text, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{claim.description}</div>
                </div>
              ) : null}
            </Card>

            <Card title="Evidence">
              {claim.evidence && claim.evidence.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th()}>Label</th>
                      <th style={th()}>Kind</th>
                      <th style={th()}>Reference</th>
                      <th style={th()}>Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claim.evidence.map((e) => (
                      <tr key={e.id}>
                        <td style={td()}>{e.label || '—'}</td>
                        <td style={td()}>{e.kind || '—'}</td>
                        <td style={td()}><code style={{ fontSize: '0.76rem', wordBreak: 'break-all' }}>{e.ref || '—'}</code></td>
                        <td style={td()}>{e.uploaded_at ? fmtDate(e.uploaded_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: colors.muted, fontSize: '0.85rem', margin: 0 }}>No evidence has been attached to this claim.</p>
              )}
            </Card>

            <Card title="Assessment timeline">
              {claim.timeline && claim.timeline.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th()}>When</th>
                      <th style={th()}>Status</th>
                      <th style={th()}>Actor</th>
                      <th style={th()}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claim.timeline.map((t, i) => (
                      <tr key={`${t.at}-${i}`}>
                        <td style={td()}>{fmtDate(t.at)}</td>
                        <td style={td()}><Badge status={t.status} /></td>
                        <td style={td()}>{t.actor || '—'}</td>
                        <td style={td()}>{t.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: colors.muted, fontSize: '0.85rem', margin: 0 }}>The API returned no timeline entries for this claim.</p>
              )}
            </Card>
          </>
        )}
      </LiveState>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={dt}>{label}</div>
      <div style={{ fontSize: 13, color: colors.text }}>{children}</div>
    </div>
  );
}
