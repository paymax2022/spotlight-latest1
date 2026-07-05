'use client';

import { useEffect, useState } from 'react';
import { getGeoConfig, type GeoConfig } from '@/services/connectAdminOpsService';
import { PageHeader, Card, Badge, btn, th, td } from '../_ui';

export default function ConnectGeoPage() {
  const [data, setData] = useState<GeoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getGeoConfig()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Geo & market ops" subtitle="Geo availability, restrictions and the approximate-location privacy policy." action={<button onClick={load} style={btn()}>Refresh</button>} />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: '#6b7280' }}>Loading geo config…</p></Card>
      ) : !data ? (
        <Card><p style={{ color: '#6b7280' }}>No geo configuration.</p></Card>
      ) : (
        <>
          <Card title="Approximate-location policy">
            <p style={{ color: '#374151', fontSize: '0.88rem', lineHeight: 1.6, margin: '0 0 0.5rem' }}>{data.approximate_location_policy}</p>
            <p style={{ color: '#374151', fontSize: '0.85rem', margin: '0.25rem 0' }}><strong>Trust threshold for opt-in:</strong> {data.trust_threshold}</p>
            <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.5rem' }}>Source: {data.source}</p>
          </Card>

          <Card title={`Markets (${data.markets.length})`}>
            {data.markets.length === 0 ? (
              <p style={{ color: '#6b7280' }}>No markets configured.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Market</th><th style={th()}>Country</th><th style={th()}>Status</th><th style={th()}>Users</th><th style={th()}>Location</th><th style={th()}>Notes</th></tr></thead>
                <tbody>
                  {data.markets.map((m) => (
                    <tr key={m.id}>
                      <td style={td()}><strong>{m.name}</strong></td>
                      <td style={td()}>{m.country}</td>
                      <td style={td()}><Badge status={m.status === 'live' ? 'resolved' : m.status === 'pilot' ? 'normal' : m.status === 'restricted' ? 'high' : 'critical'} label={m.status} /></td>
                      <td style={td()}>{m.users.toLocaleString()}</td>
                      <td style={td()}>{m.approximate_only ? 'Approximate only' : 'Exact (opt-in)'}</td>
                      <td style={td()}>{m.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
