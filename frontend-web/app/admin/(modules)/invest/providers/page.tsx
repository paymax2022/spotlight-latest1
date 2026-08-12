'use client';

import { useEffect, useState } from 'react';
import { getProviderHealth } from '@/services/investAdminService';
import type { ProviderHealth } from '@/types/investAdmin';
import { InvestTabs } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Providers"
        subtitle="Broker and market-data adapter health. Mock adapters report healthy; HTTP adapters ping the partner gateway."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InvestTabs />
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? (
          <p style={{ color: colors.muted, padding: 14 }}>Checking providers…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thCell}>Role</th>
                <th style={thCell}>Provider</th>
                <th style={thCell}>Health</th>
                <th style={thCell}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.role}>
                  <td style={tdCell}>{r.role}</td>
                  <td style={tdCell}><strong>{r.provider}</strong></td>
                  <td style={tdCell}><Badge text={r.healthy ? 'Healthy' : 'Unhealthy'} color={r.healthy ? colors.success : colors.danger} /></td>
                  <td style={tdCell}>{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
