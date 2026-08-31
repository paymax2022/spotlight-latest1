'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getPolicy, formatNaira } from '@/services/insuranceAdminService';
import type { PolicyDetail } from '@/types/insuranceAdmin';
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

/** One policy, with its lifecycle, the money on it, and any claims against it. */
export default function InsurancePolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ''));

  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const [failure, setFailure] = useState<EndpointFailure | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setPolicy(await getPolicy(id));
    } catch (e) {
      setPolicy(null);
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
        title={policy?.policy_ref || id}
        subtitle={policy ? `${policy.product_name || policy.product_code} · underwritten by ${policy.underwriter || 'an undisclosed insurer'}` : 'Policy detail'}
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link href="/admin/insurance/policies" style={{ ...btn(), textDecoration: 'none' }}>Back</Link>
            <button onClick={load} style={btn()}>Refresh</button>
          </div>
        }
      />
      <InsuranceTabs active="policies" />

      <LiveState loading={loading} failure={failure} empty={!policy} emptyTitle="Policy not found" onRetry={load}>
        {policy && (
          <>
            <Card title="Policy">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                <Field label="Status"><Badge status={policy.status} /></Field>
                <Field label="Product">
                  <Link href={`/admin/insurance/catalog/${encodeURIComponent(policy.product_code)}`} style={{ color: colors.primary, textDecoration: 'none' }}>
                    {policy.product_name || policy.product_code}
                  </Link>
                </Field>
                <Field label="Underwriter">{policy.underwriter || <NotReported />}</Field>
                <Field label="Aggregator">{policy.aggregator || <NotReported />}</Field>
                <Field label="Policyholder">{policy.policyholder_masked || <NotReported hint="PII is masked by the API." />}</Field>
                <Field label="Provider reference">
                  {policy.provider_policy_ref ? <code style={{ fontSize: 12 }}>{policy.provider_policy_ref}</code> : <NotReported />}
                </Field>
                <Field label="Premium">{money(policy.premium_kobo)}</Field>
                <Field label="Sum insured">{money(policy.sum_insured_kobo)}</Field>
                <Field label="Our commission">
                  <span style={{ color: colors.success, fontWeight: 700 }}>{money(policy.commission_kobo)}</span>
                </Field>
                <Field label="Cover starts">{policy.starts_at ? fmtDate(policy.starts_at) : <NotReported />}</Field>
                <Field label="Cover ends">{policy.ends_at ? fmtDate(policy.ends_at) : <NotReported />}</Field>
                <Field label="Certificate">
                  {policy.certificate_url ? (
                    <a href={policy.certificate_url} target="_blank" rel="noopener noreferrer" style={{ color: colors.primary }}>
                      Open certificate
                    </a>
                  ) : (
                    <NotReported hint="No certificate URL was returned for this policy." />
                  )}
                </Field>
              </div>
            </Card>

            <Card title="Lifecycle">
              {policy.timeline && policy.timeline.length > 0 ? (
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
                    {policy.timeline.map((t, i) => (
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
                <p style={{ color: colors.muted, fontSize: '0.85rem', margin: 0 }}>
                  The API returned no lifecycle entries for this policy.
                </p>
              )}
            </Card>

            <Card title="Claims against this policy">
              {policy.claims && policy.claims.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th()}>Claim</th>
                      <th style={th()}>Status</th>
                      <th style={th()}>Claimed</th>
                      <th style={th()}>Approved</th>
                      <th style={th()}>Loss event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policy.claims.map((c) => (
                      <tr key={c.id}>
                        <td style={td()}>
                          <Link href={`/admin/insurance/claims/${encodeURIComponent(c.id)}`} style={{ color: colors.primary, textDecoration: 'none' }}>
                            <code style={{ fontSize: '0.78rem' }}>{c.claim_ref || c.id}</code>
                          </Link>
                        </td>
                        <td style={td()}><Badge status={c.status} /></td>
                        <td style={td()}>{money(c.claimed_amount_kobo)}</td>
                        <td style={td()}>{money(c.approved_amount_kobo)}</td>
                        <td style={td()}>{c.loss_event_at ? fmtDate(c.loss_event_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: colors.muted, fontSize: '0.85rem', margin: 0 }}>No claims have been made against this policy.</p>
              )}
            </Card>

            {policy.inputs && Object.keys(policy.inputs).length > 0 ? (
              <Card title="Submitted application">
                <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: 0 }}>
                  The per-product fields MyCover required for this purchase. Field names and values are shown
                  exactly as stored; sensitive identifiers are masked upstream by the API, not here.
                </p>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {Object.entries(policy.inputs).map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ ...td(), width: 220, color: colors.muted, fontSize: '0.78rem' }}>{k}</td>
                        <td style={td()}>
                          <code style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>
                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                          </code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : null}
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
