'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listMerchants, formatNaira } from '@/services/referralAdminOpsService';
import type { MerchantSummary } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, th, td, timeAgo, StateBlock } from '../_ui';

const STATUSES = ['all', 'onboarding', 'active', 'suspended', 'rejected'];

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Merchants & Partners — Directory & onboarding"
        subtitle="Referral-as-a-platform: vet & onboard partners (A-MER-01), approve funded campaigns and track funding/revenue-share & billing (A-MER-02..04)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />

      <Card title="Partner directory" right={
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
        </select>
      }>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No merchants.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Merchant</th><th style={th()}>Category</th><th style={th()}>Status</th><th style={th()}>KYC</th>
              <th style={th()}>Campaigns</th><th style={th()}>Funded</th><th style={th()}>Take rate</th><th style={th()}>Joined</th>
            </tr></thead>
            <tbody>
              {(rows ?? []).map((m) => (
                <tr key={m.id}>
                  <td style={td()}><Link href={`/admin/referral/merchants/${m.id}`} style={{ color: '#340075', fontWeight: 600 }}>{m.name}</Link><br /><code style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{m.id}</code></td>
                  <td style={td()}>{m.category}</td>
                  <td style={td()}><Badge status={m.status === 'active' ? 'active' : m.status === 'suspended' ? 'critical' : m.status === 'rejected' ? 'rejected' : 'pending'} label={m.status} /></td>
                  <td style={td()}><Badge status={m.kyc_status === 'verified' ? 'active' : m.kyc_status === 'failed' ? 'critical' : 'pending'} label={m.kyc_status} /></td>
                  <td style={td()}>{m.campaigns}</td>
                  <td style={td()}>{formatNaira(m.funded_kobo)}</td>
                  <td style={td()}>{m.take_rate_pct}%</td>
                  <td style={td()}>{timeAgo(m.joined_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
