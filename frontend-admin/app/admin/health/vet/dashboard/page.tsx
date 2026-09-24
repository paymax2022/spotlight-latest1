'use client';

import { useEffect, useState } from 'react';
import { getVetDashboard, formatNaira } from '@/services/healthVetAdminService';
import type { VetDashboard } from '@/types/healthVetAdmin';
import { PageHeader, VetTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo, pct } from '../../_ui';
import { colors } from '@/components/ui/vuexy';
import { FixtureBanner } from '../../../_shared/ui';
import { USE_MOCK, USE_MOCK_ENV } from '@/services/healthVetAdminService';

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
      <FixtureBanner active={USE_MOCK} envVar={USE_MOCK_ENV} />
      <VetTabs active="overview" />

      <DisclosureNote>
        Paymax is the marketplace layer — VCN-licensed vets deliver all clinical care (HL-1). Supply is
        credential-gated on a verified VCN practising licence; expiry auto-suspends discoverability (HL-2).
        e-Prescriptions are issued by a licensed vet and enforce dispense-once with POM gating (HL-3). Health
        data is sensitive under NDPA — masked, consent-gated (HL-8). Patient payment is held in escrow and
        released on consult completion (HL-9). Payouts are KYC + AML gated (HL-10). Tele-consult is not a
        substitute for emergency care — SOS routes to the nearest in-person option (HL-11). All money is in ₦
        (kobo internally).
        <br />
        <strong>Admin-portal gap closure:</strong> reads the real admin console at{' '}
        <code>/api/health/vet/admin/*</code>. The <em>Appointments (total)</em>, <em>Appointments by state</em>{' '}
        card, <em>Platform revenue (7d)</em> and <em>Vets active</em> cards below are real. Everything else on
        this page (completion/no-show rate, GMV, VCN review queue, e-Rx audit counts, service governance,
        moderation, payouts, held/released/refunded balances, appointment mix, trend, activity feed) has no
        backing table or service concept anywhere in the backend yet and reads as 0/empty rather than
        fabricated — see <code>healthVetAdminService.ts</code> for the exact mapping.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Appointments (total)" value={(data.appointments_total ?? 0).toLocaleString('en-NG')} accent={colors.primary} />
              <Kpi label="Platform revenue (7d)" value={formatNaira(data.platform_revenue_kobo_week ?? 0)} accent={colors.success} />
              <Kpi label="Vets active" value={data.vets_active.toLocaleString('en-NG')} sub="APPROVED (HL-2)" />
              <Kpi label="Appointments today" value={data.appointments_today.toLocaleString('en-NG')} sub={`${data.appointments_30d.toLocaleString('en-NG')} (30d) — not computed`} accent={colors.primary} />
              <Kpi label="Consults completed (30d)" value={data.consults_completed_30d.toLocaleString('en-NG')} sub="not computed" />
              <Kpi label="No-show rate" value={pct(data.no_show_rate)} sub="not computed" />
              <Kpi label="GMV today" value={formatNaira(data.gmv_today_kobo)} sub={`${formatNaira(data.gmv_30d_kobo)} (30d) — not computed`} />
              <Kpi label="Net revenue (30d)" value={formatNaira(data.net_revenue_30d_kobo)} accent={colors.success} sub="not computed" />
              <Kpi label="Take rate" value={pct(data.take_rate)} sub="Net ÷ GMV — not computed" />
              <Kpi label="Avg appointment value" value={formatNaira(data.avg_appointment_value_kobo)} sub="not computed" />
              <Kpi label="Held balance" value={formatNaira(data.held_balance_kobo)} sub="not computed" />
              <Kpi label="Released (30d) ₦" value={formatNaira(data.released_30d_kobo)} sub="not computed" />
              <Kpi label="Refunded (30d) ₦" value={formatNaira(data.refunded_30d_kobo)} sub="not computed" />
              <Kpi label="VCN pending" value={data.vcn_pending_review.toLocaleString('en-NG')} sub="HL-2 credential gate — not computed" />
              <Kpi label="VCN expiring (30d)" value={data.vcn_expiring_30d.toLocaleString('en-NG')} sub="not computed" />
              <Kpi label="Vets suspended" value={data.vets_suspended.toLocaleString('en-NG')} sub="not computed" />
              <Kpi label="e-Prescriptions (30d)" value={data.eprescriptions_30d.toLocaleString('en-NG')} sub="not computed" />
              <Kpi label="e-Rx flags open" value={data.eprescription_flags_open.toLocaleString('en-NG')} sub="not computed" />
              <Kpi label="Services pending" value={data.services_pending_governance.toLocaleString('en-NG')} sub="not computed" />
              <Kpi label="Moderation open" value={data.moderation_open.toLocaleString('en-NG')} sub="not computed" />
              <Kpi label="Payouts KYC hold" value={data.payouts_kyc_hold.toLocaleString('en-NG')} sub="not computed" />
              <Kpi label="SOS routed (30d)" value={data.sos_routed_30d.toLocaleString('en-NG')} sub="not computed" />
            </div>

            <Card title="Appointments by state (live)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>State</th><th style={th()}>Appointments</th></tr></thead>
                <tbody>
                  {Object.entries(data.appointments_by_state ?? {}).map(([state, count]) => (
                    <tr key={state}>
                      <td style={td()}><Badge status={state} label={state.replace(/_/g, ' ')} /></td>
                      <td style={td()}>{count.toLocaleString('en-NG')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Appointment mix (30d) — not computed">
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

            <Card title="Appointments trend (14d) — not computed">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {data.appointments_trend.map((p) => {
                  const w = (p.appointments / maxApt) * 100;
                  return (
                    <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: colors.muted }}>{p.date.slice(5)}</span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div style={{ height: 10, width: `${w}%`, minWidth: 2, background: colors.primary, borderRadius: 2 }} title={`${p.appointments}`} />
                        <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{p.appointments.toLocaleString('en-NG')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Recent activity — not computed">
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
