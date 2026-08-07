'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getMerchant, approveMerchantCampaign, formatNaira } from '@/services/referralAdminOpsService';
import type { MerchantDetail } from '@/types/referralAdminOps';
import { timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function badgeColor(status: string): string {
  switch (status) {
    case 'active': case 'verified': case 'paid':
      return colors.success;
    case 'ended': case 'draft':
      return colors.secondary;
    case 'suspended': case 'rejected': case 'failed': case 'overdue':
      return colors.danger;
    default:
      return colors.warning;
  }
}

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
    <Page>
      <PageHeader
        title={data ? data.name : 'Merchant'}
        subtitle="Onboarding, campaign approval (A-MER-02), funding/revenue-share (A-MER-03) and analytics/billing (A-MER-04)."
        actions={<Link href="/admin/referral/merchants" className="vx-btn vx-btn--outline" style={{ textDecoration: 'none' }}>← Directory</Link>}
      />

      {loading ? <p style={{ color: colors.muted }}>Loading…</p>
        : error ? <p style={{ color: colors.danger }}>{error}</p>
        : !data ? <p style={{ color: colors.muted }}>Merchant not found.</p>
        : (
          <>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Partner profile</h2>
                <Badge text={data.status} color={badgeColor(data.status)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px,1fr))', gap: 10 }}>
                <Kpi label="Category" value={data.category} />
                <Kpi label="KYC" value={data.kyc_status} accent={data.kyc_status === 'verified' ? colors.success : colors.warning} />
                <Kpi label="API key" value={data.api_key_active ? 'Active' : 'Inactive'} sub="A-MER-05 credentials" />
                <Kpi label="Take rate" value={`${data.take_rate_pct}%`} />
                <Kpi label="Revenue share" value={`${data.revenue_share_pct}%`} />
                <Kpi label="Funded" value={formatNaira(data.funded_kobo)} />
                <Kpi label="Outstanding" value={formatNaira(data.outstanding_balance_kobo)} accent={data.outstanding_balance_kobo > 0 ? colors.warning : colors.success} />
              </div>
              <p style={{ fontSize: 12, color: colors.muted, marginTop: 12 }}>{data.contact_email} · {data.contact_phone} · joined {timeAgo(data.joined_at)}</p>
            </Card>

            <Card title="Campaigns & approval (A-MER-02)" style={{ marginBottom: 16 }}>
              {data.campaign_list.length === 0 ? <p style={{ color: colors.muted }}>No campaigns.</p> : (
                <div style={{ overflowX: 'auto', marginTop: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Campaign</th><th style={thCell}>Funded</th><th style={thCell}>Spent</th><th style={thCell}>Status</th><th style={thCell} /></tr></thead>
                    <tbody>
                      {data.campaign_list.map((c) => (
                        <tr key={c.id}>
                          <td style={tdCell}>{c.name}<br /><code style={{ fontSize: 12, color: colors.muted }}>{c.id}</code></td>
                          <td style={tdCell}>{formatNaira(c.funded_kobo)}</td>
                          <td style={tdCell}>{formatNaira(c.spent_kobo)}</td>
                          <td style={tdCell}><Badge text={c.status} color={badgeColor(c.status)} /></td>
                          <td style={tdCell}>
                            {(c.status === 'draft' || c.status === 'paused') ? (
                              <Button variant="primary" sm disabled={busy === c.id} onClick={() => approveCampaign(c.id)}>{busy === c.id ? '…' : 'Approve'}</Button>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {msg && <p style={{ color: colors.success, fontSize: 13, marginTop: 8 }}>{msg}</p>}
            </Card>

            <Card title="Invoices & billing (A-MER-04)" style={{ marginBottom: 16 }}>
              {data.invoices.length === 0 ? <p style={{ color: colors.muted }}>No invoices.</p> : (
                <div style={{ overflowX: 'auto', marginTop: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Invoice</th><th style={thCell}>Period</th><th style={thCell}>Amount</th><th style={thCell}>Status</th></tr></thead>
                    <tbody>
                      {data.invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td style={tdCell}><code style={{ fontSize: 13 }}>{inv.id}</code></td>
                          <td style={tdCell}>{inv.period}</td>
                          <td style={tdCell}>{formatNaira(inv.amount_kobo)}</td>
                          <td style={tdCell}><Badge text={inv.status} color={badgeColor(inv.status)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Audit trail">
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>When</th><th style={thCell}>Actor</th><th style={thCell}>Action</th></tr></thead>
                  <tbody>
                    {data.audit.map((a, i) => (
                      <tr key={i}><td style={tdCell}>{timeAgo(a.ts)}</td><td style={tdCell}>{a.actor}</td><td style={tdCell}>{a.action}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
    </Page>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: '13px 15px', background: colors.card }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 4, color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
