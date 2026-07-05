'use client';

import { useEffect, useState } from 'react';
import { getVetDashboard, formatNaira } from '@/services/healthVetAdminService';
import type { VetDashboard } from '@/types/healthVetAdmin';
import { PageHeader, VetTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo, pct } from '../../_ui';

export default function VetDashboardPage() {
  const [data, setData] = useState<VetDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getVetDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxApt = data ? Math.max(...data.appointments_trend.map((p) => p.appointments), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Veterinary overview"
        subtitle="Appointments, consults, GMV, VCN credential gating, e-prescription discipline, emergency (SOS) routing, payout gating and held→released payment flow across the VCN-verified vet network."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <VetTabs active="overview" />

      <DisclosureNote>
        Paymax is the marketplace layer — VCN-licensed vets deliver all clinical care (HL-1). Supply is
        credential-gated on a verified VCN practising licence; expiry auto-suspends discoverability (HL-2).
        e-Prescriptions are issued by a licensed vet and enforce dispense-once with POM gating (HL-3). Health
        data is sensitive under NDPA — masked, consent-gated (HL-8). Patient payment is held in escrow and
        released on consult completion (HL-9). Payouts are KYC + AML gated (HL-10). Tele-consult is not a
        substitute for emergency care — SOS routes to the nearest in-person option (HL-11). All money is in ₦
        (kobo internally).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Appointments today" value={data.appointments_today.toLocaleString('en-NG')} sub={`${data.appointments_30d.toLocaleString('en-NG')} (30d)`} accent="#340075" />
              <Kpi label="Consults completed (30d)" value={data.consults_completed_30d.toLocaleString('en-NG')} sub={`completion ${pct(data.appointment_completion_rate)}`} />
              <Kpi label="No-show rate" value={pct(data.no_show_rate)} accent={data.no_show_rate > 0.06 ? '#b91c1c' : undefined} />
              <Kpi label="GMV today" value={formatNaira(data.gmv_today_kobo)} sub={`${formatNaira(data.gmv_30d_kobo)} (30d)`} />
              <Kpi label="Net revenue (30d)" value={formatNaira(data.net_revenue_30d_kobo)} accent="#15803d" />
              <Kpi label="Take rate" value={pct(data.take_rate)} sub="Net ÷ GMV" />
              <Kpi label="Avg appointment value" value={formatNaira(data.avg_appointment_value_kobo)} />
              <Kpi label="Held balance" value={formatNaira(data.held_balance_kobo)} sub="HL-9 escrow held" accent="#7c3aed" />
              <Kpi label="Released (30d) ₦" value={formatNaira(data.released_30d_kobo)} accent="#15803d" />
              <Kpi label="Refunded (30d) ₦" value={formatNaira(data.refunded_30d_kobo)} accent="#7c3aed" />
              <Kpi label="VCN pending" value={data.vcn_pending_review.toLocaleString('en-NG')} sub="HL-2 credential gate" accent={data.vcn_pending_review > 0 ? '#9a3412' : undefined} />
              <Kpi label="VCN expiring (30d)" value={data.vcn_expiring_30d.toLocaleString('en-NG')} sub="HL-2 auto-suspend risk" accent={data.vcn_expiring_30d > 0 ? '#9a3412' : undefined} />
              <Kpi label="Vets active" value={data.vets_active.toLocaleString('en-NG')} sub={`${data.vets_suspended} suspended`} />
              <Kpi label="e-Prescriptions (30d)" value={data.eprescriptions_30d.toLocaleString('en-NG')} sub={`${data.eprescriptions_pom_30d.toLocaleString('en-NG')} POM · HL-3`} />
              <Kpi label="e-Rx flags open" value={data.eprescription_flags_open.toLocaleString('en-NG')} sub="HL-3 audit anomalies" accent={data.eprescription_flags_open > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Services pending" value={data.services_pending_governance.toLocaleString('en-NG')} sub="fee/service governance" />
              <Kpi label="Moderation open" value={data.moderation_open.toLocaleString('en-NG')} sub="content/credential" accent={data.moderation_open > 0 ? '#9a3412' : undefined} />
              <Kpi label="Payouts KYC hold" value={data.payouts_kyc_hold.toLocaleString('en-NG')} sub="HL-10 payout gate" accent={data.payouts_kyc_hold > 0 ? '#9a3412' : undefined} />
              <Kpi label="SOS routed (30d)" value={data.sos_routed_30d.toLocaleString('en-NG')} sub="HL-11 to in-person care" accent={data.sos_routed_30d > 0 ? '#b91c1c' : undefined} />
            </div>

            <Card title="Appointment mix (30d)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Mode</th><th style={th()}>Appointments</th><th style={th()}>GMV</th><th style={th()}>Share</th></tr></thead>
                <tbody>
                  {data.appointment_mix.map((s) => (
                    <tr key={s.label}>
                      <td style={td()}>{s.label}</td>
                      <td style={td()}>{s.appointments.toLocaleString('en-NG')}</td>
                      <td style={td()}>{formatNaira(s.gmv_kobo)}</td>
                      <td style={td()}>{pct(s.share_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Appointments trend (14d)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {data.appointments_trend.map((p) => {
                  const w = (p.appointments / maxApt) * 100;
                  return (
                    <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: '#9ca3af' }}>{p.date.slice(5)}</span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div style={{ height: 10, width: `${w}%`, minWidth: 2, background: '#340075', borderRadius: 2 }} title={`${p.appointments}`} />
                        <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{p.appointments.toLocaleString('en-NG')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Recent activity">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Event</th><th style={th()}>Type</th><th style={th()}>Ref</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {data.activity.map((a) => (
                    <tr key={a.id}>
                      <td style={td()}>{a.label}</td>
                      <td style={td()}><Badge status={a.kind} label={a.kind.replace(/_/g, ' ')} /></td>
                      <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.ref ?? '—'}</code></td>
                      <td style={td()}>{timeAgo(a.created_at)}</td>
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
