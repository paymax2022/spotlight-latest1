'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getClaim, formatNaira } from '@/services/insuranceAdminService';
import type { ClaimDetail } from '@/types/insuranceAdmin';
import { PageHeader, InsuranceTabs, Card, Badge, btn, th, td, fmtDate, timeAgo, StateBlock, DisclosureNote } from '../../_ui';
import { colors } from '@/components/ui/vuexy';

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{k}</div>
      <div style={{ fontSize: '0.9rem', color: colors.text, marginTop: '0.15rem' }}>{v}</div>
    </div>
  );
}

const code: React.CSSProperties = { fontSize: '0.78rem', background: colors.border, padding: '0.1rem 0.35rem', borderRadius: '0.25rem' };

export default function ClaimDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<ClaimDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getClaim(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Claim detail"
        subtitle="FNOL → assessment → payout lifecycle for a single claim. Evidence pointers are access-controlled; PII is masked."
        action={<Link href="/admin/insurance/claims" style={btn()}>&larr; Back to claims</Link>}
      />
      <InsuranceTabs active="claims" />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Claim not found.">
        {data && (
          <>
            <DisclosureNote>
              Underwritten by <strong>{data.underwriter}</strong>, handled via aggregator <strong>{data.provider}</strong> (NAICOM-licensed insurer disclosed per PRD §13/§18).
            </DisclosureNote>

            <Card title="Key facts" right={<Badge status={data.state} />}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                <Fact k="Claim ref" v={<code style={code}>{data.provider_claim_ref}</code>} />
                <Fact k="Claimant" v={data.claimant_masked} />
                <Fact k="Product" v={data.product_name} />
                <Fact k="Policy" v={<Link href={`/admin/insurance/policies/${data.policy_id}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>{data.policy_id}</Link>} />
                <Fact k="Provider" v={<Badge status={data.provider} />} />
                <Fact k="Underwriter" v={data.underwriter} />
                <Fact k="Claimed" v={formatNaira(data.claimed_amount_kobo)} />
                <Fact k="Approved" v={formatNaira(data.approved_amount_kobo)} />
                <Fact k="Payout ledger" v={data.payout_ledger_ref ? <code style={code}>{data.payout_ledger_ref}</code> : '—'} />
                <Fact k="SLA target" v={data.sla_target_minutes != null ? `≤${data.sla_target_minutes}m SLA` : '—'} />
                <Fact k="Loss event" v={fmtDate(data.loss_event_at)} />
                <Fact k="Reported" v={fmtDate(data.reported_at)} />
              </div>
              {data.notes ? (
                <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: colors.text }}>
                  <span style={{ fontWeight: 600 }}>Notes:</span> {data.notes}
                </div>
              ) : null}
            </Card>

            <Card title="Evidence">
              {data.evidence.length === 0 ? (
                <p style={{ color: colors.muted }}>No evidence uploaded for this claim.</p>
              ) : (
                <>
                  <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: 0 }}>
                    References are access-controlled vault pointers, not directly clickable URLs.
                  </p>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th()}>Kind</th>
                          <th style={th()}>Label</th>
                          <th style={th()}>Reference</th>
                          <th style={th()}>Uploaded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.evidence.map((e) => (
                          <tr key={e.id}>
                            <td style={td()}><Badge status={e.kind} /></td>
                            <td style={td()}>{e.label}</td>
                            <td style={td()}><code style={code}>{e.signed_url_ref}</code></td>
                            <td style={td()}>{fmtDate(e.uploaded_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>

            <Card title="Claim timeline">
              {data.timeline.length === 0 ? (
                <p style={{ color: colors.muted }}>No timeline entries.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {data.timeline.map((t, i) => (
                    <div key={`${t.at}-${i}`} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 130 }}><Badge status={t.state} /></div>
                      <div>
                        <div style={{ fontSize: '0.85rem', color: colors.text }}>
                          <strong>{t.actor}</strong>{t.note ? ` — ${t.note}` : ''}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.1rem' }}>{timeAgo(t.at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
