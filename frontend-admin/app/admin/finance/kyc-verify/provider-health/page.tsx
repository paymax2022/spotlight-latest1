'use client';

// AK10 — Provider health dashboard (SCAFFOLD).
// RBAC: finance.admin.kyc (role: Admin). Per provider: success rate, latency,
// failover events, wallet balance, cost/check. Shell: cards + empty metrics.
// Backend endpoint TBD (e.g. GET /kyc/provider-health).

import { PageHeader, Card, th, td, ScaffoldNotice } from '../_ui';

// Providers we route to (mirrors kycAdminService KNOWN_PROVIDERS).
const PROVIDERS = ['smile_id', 'dojah', 'complyadvantage'];

export default function KycProviderHealthPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Provider Health Dashboard (AK10)"
        subtitle="Per provider: success rate, latency, failover events, wallet balance, cost/check. RBAC: finance.admin.kyc (Admin)."
      />

      <ScaffoldNotice>
        Functional shell. Wire to a provider-health endpoint (e.g. <code>GET /kyc/provider-health</code>) to populate success rate, p95 latency, failover count and cost/check.
      </ScaffoldNotice>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        {PROVIDERS.map((p) => (
          <div key={p} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span style={{ width: 9, height: 9, borderRadius: 9999, background: '#9ca3af', display: 'inline-block' }} />
              <strong style={{ textTransform: 'capitalize' }}>{p.replace(/_/g, ' ')}</strong>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Success rate: —</div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>p95 latency: —</div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Cost / check: —</div>
          </div>
        ))}
      </div>

      <Card title="Failover events">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr><th style={th()}>When</th><th style={th()}>Check</th><th style={th()}>From → To</th><th style={th()}>Reason</th></tr>
          </thead>
          <tbody>
            <tr><td colSpan={4} style={{ ...td(), color: '#6b7280' }}>No failover events loaded.</td></tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
