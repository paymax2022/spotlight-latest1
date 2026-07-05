'use client';

import { useEffect, useState } from 'react';
import { getLoyaltyOptIn, updateLoyaltyOptIn, formatNaira } from '@/services/staysExtranetService';
import type { LoyaltyOptIn } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, Kpi, PropertyScopeNote, Badge, StateBlock, btn, th, td, pct } from '../_ui';

export default function LoyaltyPage() {
  const [data, setData] = useState<LoyaltyOptIn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getLoyaltyOptIn()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function toggle(id: string, current: boolean) {
    setBusy(id);
    try { setData(await updateLoyaltyOptIn(id, !current)); }
    catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Loyalty — Paymax Stays Rewards" subtitle="Opt rate plans into the loyalty programme. Members earn points and tend to book more and cancel less." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="promotions" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Program" value={data.program_name} />
              <Kpi label="Member bookings (30d)" value={data.member_bookings_30d.toLocaleString('en-NG')} accent="#340075" />
              <Kpi label="Member GMV (30d)" value={formatNaira(data.member_gmv_30d_kobo)} sub="NGN" accent="#15803d" />
            </div>
            <Card title="Rate plan enrolment">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Rate plan</th><th style={th()}>Earn rate</th><th style={th()}>Status</th><th style={th()} /></tr></thead>
                <tbody>
                  {data.enrolled_rate_plans.map((rp) => (
                    <tr key={rp.rate_plan_id}>
                      <td style={td()}>{rp.name}</td>
                      <td style={td()}>{rp.opted_in ? pct(rp.earn_rate_pct) : '—'}</td>
                      <td style={td()}>{rp.opted_in ? <Badge status="enrolled" label="Opted in" /> : <Badge status="disabled" label="Not enrolled" />}</td>
                      <td style={td()}><button style={btn()} disabled={busy === rp.rate_plan_id} onClick={() => toggle(rp.rate_plan_id, rp.opted_in)}>{busy === rp.rate_plan_id ? '…' : rp.opted_in ? 'Opt out' : 'Opt in'}</button></td>
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
