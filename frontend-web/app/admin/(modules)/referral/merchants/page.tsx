'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listMerchants, formatNaira } from '@/services/referralAdminOpsService';
import type { MerchantSummary } from '@/types/referralAdminOps';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'onboarding', 'active', 'suspended', 'rejected'];

function badgeColor(status: string): string {
  switch (status) {
    case 'active': case 'verified':
      return colors.success;
    case 'onboarding': case 'pending':
      return colors.warning;
    case 'suspended': case 'rejected': case 'failed':
      return colors.danger;
    default:
      return colors.secondary;
  }
}

export default function MerchantsDirectoryPage() {
  const [rows, setRows] = useState<MerchantSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listMerchants(status)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <Page>
      <PageHeader
        title="Merchants & Partners — Directory & onboarding"
        subtitle="Referral-as-a-platform: vet & onboard partners (A-MER-01), approve funded campaigns and track funding/revenue-share & billing (A-MER-02..04)."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Partner directory</h2>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
        </div>
        <div style={{ padding: 14 }}>
          {loading ? <p style={{ color: colors.muted }}>Loading…</p>
            : error ? <p style={{ color: colors.danger }}>{error}</p>
            : (!rows || rows.length === 0) ? <p style={{ color: colors.muted }}>No merchants.</p>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>Merchant</th><th style={thCell}>Category</th><th style={thCell}>Status</th><th style={thCell}>KYC</th>
                    <th style={thCell}>Campaigns</th><th style={thCell}>Funded</th><th style={thCell}>Take rate</th><th style={thCell}>Joined</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.id}>
                        <td style={tdCell}><Link href={`/admin/referral/merchants/${m.id}`} style={{ fontWeight: 600 }}>{m.name}</Link><br /><code style={{ fontSize: 12, color: colors.muted }}>{m.id}</code></td>
                        <td style={tdCell}>{m.category}</td>
                        <td style={tdCell}><Badge text={m.status} color={badgeColor(m.status)} /></td>
                        <td style={tdCell}><Badge text={m.kyc_status} color={badgeColor(m.kyc_status)} /></td>
                        <td style={tdCell}>{m.campaigns}</td>
                        <td style={tdCell}>{formatNaira(m.funded_kobo)}</td>
                        <td style={tdCell}>{m.take_rate_pct}%</td>
                        <td style={tdCell}>{timeAgo(m.joined_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </Card>
    </Page>
  );
}
