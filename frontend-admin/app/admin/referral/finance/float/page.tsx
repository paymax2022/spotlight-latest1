'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getFloat, formatNaira } from '@/services/referralAdminOpsService';
import type { Float } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, th, td, StateBlock } from '../../_ui';

export default function FloatPage() {
  const [data, setData] = useState<Float | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getFloat()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Finance — Float management"
        subtitle="Reward float positions across providers & wallets (A-FIN-05). Positions below threshold flagged for top-up."
        action={<Link href="/admin/referral/finance" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Payouts</Link>}
      />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Total balance" value={formatNaira(data.total_balance_kobo)} />
              <Kpi label="Reserved" value={formatNaira(data.total_reserved_kobo)} accent="#9a3412" />
              <Kpi label="Available" value={formatNaira(data.total_available_kobo)} accent="#15803d" />
            </div>

            <Card title="Float positions">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th()}>Account</th><th style={th()}>Provider</th><th style={th()}>Balance</th>
                  <th style={th()}>Reserved</th><th style={th()}>Available</th><th style={th()}>Threshold</th><th style={th()}>Status</th>
                </tr></thead>
                <tbody>
                  {data.positions.map((p) => (
                    <tr key={p.id}>
                      <td style={td()}>{p.account}</td>
                      <td style={td()}>{p.provider}</td>
                      <td style={td()}>{formatNaira(p.balance_kobo)}</td>
                      <td style={td()}>{formatNaira(p.reserved_kobo)}</td>
                      <td style={td()}><strong>{formatNaira(p.available_kobo)}</strong></td>
                      <td style={td()}>{formatNaira(p.threshold_kobo)}</td>
                      <td style={td()}><Badge status={p.status === 'healthy' ? 'active' : p.status === 'low' ? 'high' : 'critical'} label={p.status} /></td>
                    </tr>
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
