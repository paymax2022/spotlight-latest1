'use client';

import { useEffect, useState } from 'react';
import { getHouseLedger, formatNaira } from '@/services/referralAdminService';
import type { HouseLedger } from '@/types/referralAdmin';
import { PageHeader, ReferralTabs, Card, Kpi, Badge, btn, th, td, timeAgo, StateBlock } from '../_ui';

export default function HouseLedgerPage() {
  const [data, setData] = useState<HouseLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getHouseLedger()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="House / system-account ledger"
        subtitle="A-USR-05 / §7A.2 — Super-Admin house capture of no-code signups. NON-WITHDRAWABLE, segmented from user payouts, excluded from override chains and K-factor."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <ReferralTabs active="house" />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No house ledger data.">
        {data && (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <Badge status="critical" label="Non-withdrawable" />
              <Badge status="vesting" label="Excluded from override chains" />
              <Badge status="vesting" label="Excluded from K-factor" />
              <Badge status="house" label={data.budget_neutral ? 'Budget-neutral' : 'Funded house pool'} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="House-attributed volume" value={data.total_house_volume.toLocaleString('en-NG')} sub="no-code signups captured" />
              <Kpi label="House-attributed value" value={formatNaira(data.total_house_value_kobo)} accent="#7c3aed" />
              <Kpi label="House accounts" value={String(data.accounts.length)} />
              <Kpi label="Accounting mode" value={data.budget_neutral ? 'Budget-neutral' : 'Funded pool'} sub="set in Attribution config (§7A.2)" />
            </div>

            <Card title="System / house accounts">
              <StateBlock loading={false} error={null} empty={data.accounts.length === 0} emptyText="No house accounts configured.">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Code</th><th style={th()}>Scope</th><th style={th()}>Region</th><th style={th()}>Owner</th><th style={th()}>Balance (notional)</th><th style={th()}>Withdrawable</th></tr></thead>
                  <tbody>
                    {data.accounts.map((a) => (
                      <tr key={a.id}>
                        <td style={td()}><code style={{ fontSize: '0.8rem' }}>{a.code}</code></td>
                        <td style={td()}><Badge status="normal" label={a.scope} /></td>
                        <td style={td()}>{a.region ?? '—'}</td>
                        <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.owner_user_id}</code></td>
                        <td style={td()}>{formatNaira(a.balance_kobo)}</td>
                        <td style={td()}><Badge status={a.non_withdrawable ? 'critical' : 'active'} label={a.non_withdrawable ? 'No (notional)' : 'Yes'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StateBlock>
            </Card>

            <Card title="House-attributed reward entries">
              <StateBlock loading={false} error={null} empty={data.entries.length === 0} emptyText="No house-attributed rewards yet.">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>ID</th><th style={th()}>Referred user</th><th style={th()}>Kind</th><th style={th()}>Amount</th><th style={th()}>State</th><th style={th()}>Captured</th></tr></thead>
                  <tbody>
                    {data.entries.map((e) => (
                      <tr key={e.id}>
                        <td style={td()}><code style={{ fontSize: '0.76rem' }}>{e.id}</code></td>
                        <td style={td()}><code style={{ fontSize: '0.78rem' }}>{e.referred_user_id ?? '—'}</code></td>
                        <td style={td()}><Badge status="normal" label={e.kind} /></td>
                        <td style={td()}>{formatNaira(e.amount_kobo)}</td>
                        <td style={td()}><Badge status={e.state} /></td>
                        <td style={td()}>{timeAgo(e.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StateBlock>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
