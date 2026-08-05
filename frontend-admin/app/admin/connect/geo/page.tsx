'use client';

import { useEffect, useState } from 'react';
import { getGeoConfig, type GeoConfig } from '@/services/connectAdminOpsService';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="Geo & market ops" subtitle="Geo availability, restrictions and the approximate-location privacy policy." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: colors.muted }}>Loading geo config…</p></Card>
      ) : !data ? (
        <Card><p style={{ color: colors.muted }}>No geo configuration.</p></Card>
      ) : (
        <>
          <Card title="Approximate-location policy">
            <p style={{ color: colors.text, fontSize: '0.88rem', lineHeight: 1.6, margin: '0 0 0.5rem' }}>{data.approximate_location_policy}</p>
            <p style={{ color: colors.text, fontSize: '0.85rem', margin: '0.25rem 0' }}><strong>Trust threshold for opt-in:</strong> {data.trust_threshold}</p>
            <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: '0.5rem' }}>Source: {data.source}</p>
          </Card>

          <Card title={`Markets (${data.markets.length})`}>
            {data.markets.length === 0 ? (
              <p style={{ color: colors.muted }}>No markets configured.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Market</th><th style={thCell}>Country</th><th style={thCell}>Status</th><th style={thCell}>Users</th><th style={thCell}>Location</th><th style={thCell}>Notes</th></tr></thead>
                <tbody>
                  {data.markets.map((m) => (
                    <tr key={m.id}>
                      <td style={tdCell}><strong>{m.name}</strong></td>
                      <td style={tdCell}>{m.country}</td>
                      <td style={tdCell}><Badge text={m.status} color={m.status === 'live' ? colors.success : m.status === 'pilot' ? colors.info : m.status === 'restricted' ? colors.warning : colors.danger} /></td>
                      <td style={tdCell}>{m.users.toLocaleString()}</td>
                      <td style={tdCell}>{m.approximate_only ? 'Approximate only' : 'Exact (opt-in)'}</td>
                      <td style={tdCell}>{m.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
