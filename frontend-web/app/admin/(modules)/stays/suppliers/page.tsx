'use client';

import { useEffect, useState } from 'react';
import { listSuppliers } from '@/services/staysAdminService';
import type { Supplier } from '@/types/staysAdmin';
import {
  StaysTabs,
  Badge,
  DisclosureNote,
  StateBlock,
  timeAgo,
  pct,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function StaysSuppliersPage() {
  const [data, setData] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await listSuppliers()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="Suppliers & connectivity"
        subtitle="Rail A bedbank adapters (RateHawk, ZentrumHub) plus Paymax direct inventory — health, latency, prebook/book success and live property counts."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="supply" />

      <DisclosureNote>
        Credentials are stored encrypted at rest and shown masked only — full API keys and webhook
        secrets are never rendered in the console. Supplier source rail is disclosed to guests at
        quote and booking time.
      </DisclosureNote>

      <Card title="Adapters">
        <StateBlock loading={loading} error={error} empty={data.length === 0} emptyText="No suppliers configured.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={thCell}>Supplier</th>
                  <th style={thCell}>Rail</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Uptime</th>
                  <th style={thCell}>Search p95</th>
                  <th style={thCell}>Prebook</th>
                  <th style={thCell}>Book</th>
                  <th style={thCell}>Live props</th>
                  <th style={thCell}>Open breaks</th>
                  <th style={thCell}>Currencies</th>
                  <th style={thCell}>Credentials (masked)</th>
                  <th style={thCell}>Env</th>
                  <th style={thCell}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.supplier_code}>
                    <td style={tdCell}>
                      <div style={{ fontWeight: 600 }}>{s.display_name}</div>
                      <code style={{ fontSize: '0.72rem', color: colors.muted }}>{s.base_url}</code>
                    </td>
                    <td style={tdCell}><Badge status={s.rail} /></td>
                    <td style={tdCell}><Badge status={s.status} /></td>
                    <td style={tdCell}>{s.uptime_pct.toFixed(2)}%</td>
                    <td style={tdCell}>{s.search_p95_ms.toLocaleString('en-NG')} ms</td>
                    <td style={tdCell}>{pct(s.prebook_success_pct)}</td>
                    <td style={tdCell}>{pct(s.book_success_pct)}</td>
                    <td style={tdCell}>{s.properties_live.toLocaleString('en-NG')}</td>
                    <td style={tdCell}><span style={{ color: s.open_breaks > 0 ? colors.danger : colors.text, fontWeight: s.open_breaks > 0 ? 600 : 400 }}>{s.open_breaks.toLocaleString('en-NG')}</span></td>
                    <td style={tdCell}>{s.currencies.join(', ')}</td>
                    <td style={tdCell}>
                      <div style={{ fontSize: '0.75rem' }}>API: <code>{s.api_key_masked}</code></div>
                      <div style={{ fontSize: '0.75rem' }}>Webhook: <code>{s.webhook_secret_masked}</code></div>
                    </td>
                    <td style={tdCell}><Badge status={s.sandbox ? 'draft' : 'active'} label={s.sandbox ? 'sandbox' : 'live'} /></td>
                    <td style={tdCell}>{timeAgo(s.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </Page>
  );
}
