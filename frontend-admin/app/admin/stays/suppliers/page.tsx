'use client';

import { useEffect, useState } from 'react';
import { listSuppliers } from '@/services/staysAdminService';
import type { Supplier } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Card,
  Badge,
  DisclosureNote,
  StateBlock,
  btn,
  th,
  td,
  timeAgo,
  pct,
} from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Suppliers & connectivity"
        subtitle="Rail A bedbank adapters (RateHawk, ZentrumHub) plus Paymax direct inventory — health, latency, prebook/book success and live property counts."
        action={<button onClick={load} style={btn()}>Refresh</button>}
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
                  <th style={th()}>Supplier</th>
                  <th style={th()}>Rail</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Uptime</th>
                  <th style={th()}>Search p95</th>
                  <th style={th()}>Prebook</th>
                  <th style={th()}>Book</th>
                  <th style={th()}>Live props</th>
                  <th style={th()}>Open breaks</th>
                  <th style={th()}>Currencies</th>
                  <th style={th()}>Credentials (masked)</th>
                  <th style={th()}>Env</th>
                  <th style={th()}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.supplier_code}>
                    <td style={td()}>
                      <div style={{ fontWeight: 600 }}>{s.display_name}</div>
                      <code style={{ fontSize: '0.72rem', color: '#6b7280' }}>{s.base_url}</code>
                    </td>
                    <td style={td()}><Badge status={s.rail} /></td>
                    <td style={td()}><Badge status={s.status} /></td>
                    <td style={td()}>{s.uptime_pct.toFixed(2)}%</td>
                    <td style={td()}>{s.search_p95_ms.toLocaleString('en-NG')} ms</td>
                    <td style={td()}>{pct(s.prebook_success_pct)}</td>
                    <td style={td()}>{pct(s.book_success_pct)}</td>
                    <td style={td()}>{s.properties_live.toLocaleString('en-NG')}</td>
                    <td style={td()}><span style={{ color: s.open_breaks > 0 ? '#b91c1c' : '#374151', fontWeight: s.open_breaks > 0 ? 600 : 400 }}>{s.open_breaks.toLocaleString('en-NG')}</span></td>
                    <td style={td()}>{s.currencies.join(', ')}</td>
                    <td style={td()}>
                      <div style={{ fontSize: '0.75rem' }}>API: <code>{s.api_key_masked}</code></div>
                      <div style={{ fontSize: '0.75rem' }}>Webhook: <code>{s.webhook_secret_masked}</code></div>
                    </td>
                    <td style={td()}><Badge status={s.sandbox ? 'draft' : 'active'} label={s.sandbox ? 'sandbox' : 'live'} /></td>
                    <td style={td()}>{timeAgo(s.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
