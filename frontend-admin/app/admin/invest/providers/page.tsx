'use client';

import { useEffect, useState } from 'react';
import { getProviderHealth } from '@/services/investAdminService';
import type { ProviderHealth } from '@/types/investAdmin';
import { PageHeader, InvestTabs, Card, Badge, btn, th, td } from '../_ui';

export default function InvestProvidersPage() {
  const [rows, setRows] = useState<ProviderHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getProviderHealth()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Providers"
        subtitle="Broker and market-data adapter health. Mock adapters report healthy; HTTP adapters ping the partner gateway."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InvestTabs />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? (
          <p style={{ color: '#6b7280' }}>Checking providers…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={th()}>Role</th>
                <th style={th()}>Provider</th>
                <th style={th()}>Health</th>
                <th style={th()}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.role}>
                  <td style={td()}>{r.role}</td>
                  <td style={td()}><strong>{r.provider}</strong></td>
                  <td style={td()}><Badge status={r.healthy ? 'Settled' : 'Failed'} label={r.healthy ? 'Healthy' : 'Unhealthy'} /></td>
                  <td style={td()}>{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
