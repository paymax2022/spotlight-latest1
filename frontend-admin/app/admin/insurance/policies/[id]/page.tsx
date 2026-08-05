'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getPolicy, formatNaira } from '@/services/insuranceAdminService';
import type { PolicyDetail } from '@/types/insuranceAdmin';
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

export default function PolicyDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<PolicyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getPolicy(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Policy detail"
        subtitle="Lifecycle, premium ledger, commission and consent for a single policy. PII is masked."
        action={<Link href="/admin/insurance/policies" style={btn()}>&larr; Back to policies</Link>}
      />
      <InsuranceTabs active="policies" />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Policy not found.">
        {data && (
          <>
            <DisclosureNote>
              Underwritten by <strong>{data.underwriter}</strong>, distributed via aggregator <strong>{data.provider}</strong> (NAICOM-licensed insurer disclosed per PRD §13/§18).
            </DisclosureNote>

            <Card title="Key facts" right={<Badge status={data.state} />}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                <Fact k="Policy ref" v={<code style={code}>{data.provider_policy_ref}</code>} />
                <Fact k="Policyholder" v={data.policyholder_masked} />
                <Fact k="Product" v={`${data.product_name} (${data.product_code})`} />
                <Fact k="Provider" v={<Badge status={data.provider} />} />
                <Fact k="Underwriter" v={data.underwriter} />
                <Fact k="Binding mode" v={<Badge status={data.binding_mode} />} />
                <Fact k="Sum insured" v={formatNaira(data.sum_insured_kobo)} />
                <Fact k="Premium" v={`${formatNaira(data.premium_kobo)} ${data.currency}`} />
                <Fact k="Effective" v={fmtDate(data.effective_at)} />
                <Fact k="Expires" v={fmtDate(data.expires_at)} />
                <Fact k="Version" v={`v${data.version}`} />
                <Fact k="Source event" v={data.source_event_id ? <code style={code}>{data.source_event_id}</code> : '—'} />
                <Fact k="Capability" v={<code style={code}>{data.capability_id}</code>} />
              </div>
            </Card>

            <Card title="Premium transactions">
              {data.premium_transactions.length === 0 ? (
                <p style={{ color: colors.muted }}>No premium transactions recorded.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th()}>Reference</th>
                        <th style={th()}>Amount</th>
                        <th style={th()}>Direction</th>
                        <th style={th()}>Status</th>
                        <th style={th()}>Wallet ledger</th>
                        <th style={th()}>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.premium_transactions.map((t) => (
                        <tr key={t.id}>
                          <td style={td()}><code style={code}>{t.reference}</code></td>
                          <td style={td()}>{formatNaira(t.amount_kobo)}</td>
                          <td style={td()}><Badge status={t.direction.toLowerCase()} label={t.direction} /></td>
                          <td style={td()}><Badge status={t.status} /></td>
                          <td style={td()}><code style={code}>{t.wallet_ledger_ref}</code></td>
                          <td style={td()}>{fmtDate(t.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Commission">
              {data.commission ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                  <Fact k="Amount" v={formatNaira(data.commission.amount_kobo)} />
                  <Fact k="Basis" v={data.commission.basis} />
                  <Fact k="Revenue ledger" v={<code style={code}>{data.commission.revenue_ledger_ref}</code>} />
                  <Fact k="Reconciled" v={<Badge status={data.commission.reconciled ? 'reconciled' : 'open'} label={data.commission.reconciled ? 'Reconciled' : 'Unreconciled'} />} />
                </div>
              ) : (
                <p style={{ color: colors.muted }}>No commission recorded.</p>
              )}
            </Card>

            <Card title="Beneficiaries">
              {data.beneficiaries.length === 0 ? (
                <p style={{ color: colors.muted }}>No beneficiaries on this policy.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th()}>Name</th>
                      <th style={th()}>Relationship</th>
                      <th style={th()}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.beneficiaries.map((b) => (
                      <tr key={b.id}>
                        <td style={td()}>{b.name_masked}</td>
                        <td style={td()}>{b.relationship}</td>
                        <td style={td()}>{b.share_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Consent">
              {data.consent ? (
                <p style={{ color: colors.text, fontSize: '0.85rem', margin: 0 }}>
                  Version <strong>{data.consent.version}</strong> &middot; scope <code style={code}>{data.consent.scope}</code> &middot; granted {fmtDate(data.consent.granted_at)}
                </p>
              ) : (
                <p style={{ color: colors.muted, margin: 0 }}>No consent record on file.</p>
              )}
            </Card>

            <Card title="State timeline">
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
