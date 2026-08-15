'use client';

import { useEffect, useState } from 'react';
import { getTelemedDashboard, formatNaira, type TelemedDashboard } from '@/services/telemedicineAdminService';
import { PageHeader, TelemedTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo } from '../_ui';

export default function TelemedDashboardPage() {
  const [data, setData] = useState<TelemedDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getTelemedDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Telemedicine overview"
        subtitle="Clinician roster, consultation throughput and consult-fee revenue across the telemedicine book."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <TelemedTabs active="overview" />

      <DisclosureNote>
        Read-only oversight — the telemedicine backend currently exposes <strong>no admin route group</strong>;
        these surfaces read the member/clinician projections at <code>/api/v1/telemedicine/*</code>. Verification
        and moderation actions are mocked until a dedicated admin surface is added.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Clinicians" value={data.clinicians_total.toLocaleString('en-NG')} sub={`${data.clinicians_verified} verified / ${data.clinicians_pending} pending`} accent="#340075" />
              <Kpi label="Consultations today" value={data.consultations_today.toLocaleString('en-NG')} sub={`${data.consultations_open} open`} />
              <Kpi label="Completed (30d)" value={data.consultations_completed_30d.toLocaleString('en-NG')} />
              <Kpi label="Consult revenue (30d)" value={formatNaira(data.consultation_revenue_30d_kobo)} />
              <Kpi label="Average rating" value={`${data.avg_rating.toFixed(1)} / 5`} />
              <Kpi label="Cancellations (30d)" value={data.cancellations_30d.toLocaleString('en-NG')} accent={data.cancellations_30d > 0 ? '#9a3412' : undefined} />
              <Kpi label="e-Prescriptions (30d)" value={data.prescriptions_issued_30d.toLocaleString('en-NG')} />
            </div>

            <Card title="Specialties">
              {data.specialties.length === 0 ? <p style={{ color: '#6b7280' }}>No specialty data.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Specialty</th><th style={th()}>Clinicians</th><th style={th()}>Consultations (30d)</th></tr></thead>
                  <tbody>
                    {data.specialties.map((s) => (
                      <tr key={s.name}>
                        <td style={td()}>{s.name}</td>
                        <td style={td()}>{s.clinicians.toLocaleString('en-NG')}</td>
                        <td style={td()}>{s.consultations_30d.toLocaleString('en-NG')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Recent activity">
              {data.activity.length === 0 ? <p style={{ color: '#6b7280' }}>No recent activity.</p> : (
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
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
