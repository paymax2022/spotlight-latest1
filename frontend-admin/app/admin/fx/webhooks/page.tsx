'use client';

import { useEffect, useState } from 'react';
import { getWebhookEndpoints, getWebhookDeliveries, getApiKeys, replayDelivery, toggleEndpoint } from '@/services/fxAdminService';
import type { WebhookEndpoint, WebhookDelivery, ApiKey } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge } from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function FxWebhooksPage() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { const [e, d, k] = await Promise.all([getWebhookEndpoints(), getWebhookDeliveries(), getApiKeys()]); setEndpoints(e); setDeliveries(d); setKeys(k); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function act(key: string, fn: () => Promise<unknown>) { setBusy(key); try { await fn(); await load(); } finally { setBusy(null); } }
  const epName = (id: string) => endpoints.find((e) => e.id === id)?.customer ?? id;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Webhooks & Developer" subtitle="Delivery monitor, endpoints and API keys." action={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <FxTabs active="webhooks" />

      <Card title="Delivery monitor">
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Event</th><th style={thCell}>Customer</th><th style={thCell}>Attempts</th><th style={thCell}>Code</th><th style={thCell}>Status</th><th style={thCell}>When</th><th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}><code>{d.event}</code></td>
                  <td style={tdCell}>{epName(d.endpointId)}</td>
                  <td style={tdCell}>{d.attempts}</td>
                  <td style={{ ...tdCell, color: d.responseCode && d.responseCode >= 400 ? colors.danger : colors.success }}>{d.responseCode ?? '—'}</td>
                  <td style={tdCell}><Badge status={d.status === 'delivered' ? 'successful' : d.status === 'failed' ? 'failed' : 'processing'} label={d.status} /></td>
                  <td style={{ ...tdCell, color: colors.muted }}>{new Date(d.createdAt).toLocaleString('en-NG')}</td>
                  <td style={{ ...tdCell, textAlign: 'right' }}>{d.status !== 'delivered' ? <Button variant="primary" sm disabled={busy === d.id} onClick={() => act(d.id, () => replayDelivery(d.id))}>Replay</Button> : <span style={{ color: colors.muted }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Endpoints">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Customer</th><th style={thCell}>URL</th><th style={thCell}>Events</th><th style={thCell}>Mode</th><th style={thCell}>Status</th><th style={thCell}></th></tr></thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={e.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={tdCell}><strong>{e.customer}</strong></td>
                <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{e.url}</code></td>
                <td style={{ ...tdCell, color: colors.muted, fontSize: '0.78rem' }}>{e.events.join(', ')}</td>
                <td style={tdCell}><Badge status={e.sandbox ? 'sandbox' : 'live'} label={e.sandbox ? 'Sandbox' : 'Live'} /></td>
                <td style={tdCell}><Badge status={e.enabled ? 'successful' : 'failed'} label={e.enabled ? 'Enabled' : 'Disabled'} /></td>
                <td style={{ ...tdCell, textAlign: 'right' }}><Button variant="outline" sm disabled={busy === e.id} onClick={() => act(e.id, () => toggleEndpoint(e.id, !e.enabled))}>{e.enabled ? 'Disable' : 'Enable'}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="API keys">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Customer</th><th style={thCell}>Label</th><th style={thCell}>Key</th><th style={thCell}>Mode</th><th style={thCell}>Last used</th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={tdCell}>{k.customer}</td>
                <td style={tdCell}>{k.label}</td>
                <td style={tdCell}><code>{k.prefix}••••••••</code></td>
                <td style={tdCell}><Badge status={k.mode === 'live' ? 'live' : 'sandbox'} label={k.mode} /></td>
                <td style={{ ...tdCell, color: colors.muted }}>{k.lastUsed ? new Date(k.lastUsed).toLocaleString('en-NG') : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.75rem' }}>Keys are shown by prefix only; full secrets are hashed at rest (spec §15).</p>
      </Card>
    </div>
  );
}
