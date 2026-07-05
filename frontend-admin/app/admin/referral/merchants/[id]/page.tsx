'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getMerchant, approveMerchantCampaign, formatNaira } from '@/services/referralAdminOpsService';
import type { MerchantDetail } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, btnPrimary, th, td, timeAgo, StateBlock } from '../../_ui';

export default function MerchantDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [data, setData] = useState<MerchantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getMerchant(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function approveCampaign(campaignId: string) {
    if (!data) return;
    setBusy(campaignId); setMsg(null);
    try {
      await approveMerchantCampaign(data.id, campaignId, 'Merchant campaign approved');
      setData((cur) => cur ? { ...cur, campaign_list: cur.campaign_list.map((c) => c.id === campaignId ? { ...c, status: 'active' } : c) } : cur);
      setMsg(`Campaign ${campaignId} approved — audit event emitted.`);
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={data ? data.name : 'Merchant'}
        subtitle="Onboarding, campaign approval (A-MER-02), funding/revenue-share (A-MER-03) and analytics/billing (A-MER-04)."
        action={<Link href="/admin/referral/merchants" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Directory</Link>}
      />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Merchant not found.">
        {data && (
          <>
            <Card title="Partner profile" right={<Badge status={data.status === 'active' ? 'active' : data.status === 'suspended' ? 'critical' : data.status === 'rejected' ? 'rejected' : 'pending'} label={data.status} />}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px,1fr))', gap: '0.5rem' }}>
                <Kpi label="Category" value={data.category} />
                <Kpi label="KYC" value={data.kyc_status} accent={data.kyc_status === 'verified' ? '#15803d' : '#9a3412'} />
                <Kpi label="API key" value={data.api_key_active ? 'Active' : 'Inactive'} sub="A-MER-05 credentials" />
                <Kpi label="Take rate" value={`${data.take_rate_pct}%`} />
                <Kpi label="Revenue share" value={`${data.revenue_share_pct}%`} />
                <Kpi label="Funded" value={formatNaira(data.funded_kobo)} />
                <Kpi label="Outstanding" value={formatNaira(data.outstanding_balance_kobo)} accent={data.outstanding_balance_kobo > 0 ? '#9a3412' : '#15803d'} />
              </div>
              <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.75rem' }}>{data.contact_email} · {data.contact_phone} · joined {timeAgo(data.joined_at)}</p>
            </Card>

            <Card title="Campaigns & approval (A-MER-02)">
              {data.campaign_list.length === 0 ? <p style={{ color: '#6b7280' }}>No campaigns.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Campaign</th><th style={th()}>Funded</th><th style={th()}>Spent</th><th style={th()}>Status</th><th style={th()} /></tr></thead>
                  <tbody>
                    {data.campaign_list.map((c) => (
                      <tr key={c.id}>
                        <td style={td()}>{c.name}<br /><code style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.id}</code></td>
                        <td style={td()}>{formatNaira(c.funded_kobo)}</td>
                        <td style={td()}>{formatNaira(c.spent_kobo)}</td>
                        <td style={td()}><Badge status={c.status === 'active' ? 'active' : c.status === 'ended' ? 'ended' : c.status === 'paused' ? 'paused' : 'draft'} label={c.status} /></td>
                        <td style={td()}>
                          {(c.status === 'draft' || c.status === 'paused') ? (
                            <button disabled={busy === c.id} onClick={() => approveCampaign(c.id)} style={btnPrimary()}>{busy === c.id ? '…' : 'Approve'}</button>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {msg && <p style={{ color: '#15803d', fontSize: '0.8rem', marginTop: '0.5rem' }}>{msg}</p>}
            </Card>

            <Card title="Invoices & billing (A-MER-04)">
              {data.invoices.length === 0 ? <p style={{ color: '#6b7280' }}>No invoices.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Invoice</th><th style={th()}>Period</th><th style={th()}>Amount</th><th style={th()}>Status</th></tr></thead>
                  <tbody>
                    {data.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td style={td()}><code style={{ fontSize: '0.78rem' }}>{inv.id}</code></td>
                        <td style={td()}>{inv.period}</td>
                        <td style={td()}>{formatNaira(inv.amount_kobo)}</td>
                        <td style={td()}><Badge status={inv.status === 'paid' ? 'paid' : inv.status === 'overdue' ? 'critical' : 'pending'} label={inv.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Audit trail">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>When</th><th style={th()}>Actor</th><th style={th()}>Action</th></tr></thead>
                <tbody>
                  {data.audit.map((a, i) => (
                    <tr key={i}><td style={td()}>{timeAgo(a.ts)}</td><td style={td()}>{a.actor}</td><td style={td()}>{a.action}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
