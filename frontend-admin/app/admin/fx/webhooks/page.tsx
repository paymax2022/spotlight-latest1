'use client';

import { useEffect, useState } from 'react';
import { getWebhookEndpoints, getWebhookDeliveries, getApiKeys, replayDelivery, toggleEndpoint } from '@/services/fxAdminService';
import type { WebhookEndpoint, WebhookDelivery, ApiKey } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, btnPrimary, th, td } from '../_ui';

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
      <PageHeader title="Webhooks & Developer" subtitle="Delivery monitor, endpoints and API keys." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="webhooks" />

      <Card title="Delivery monitor">
        {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Event</th><th style={th()}>Customer</th><th style={th()}>Attempts</th><th style={th()}>Code</th><th style={th()}>Status</th><th style={th()}>When</th><th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}><code>{d.event}</code></td>
                  <td style={td()}>{epName(d.endpointId)}</td>
                  <td style={td()}>{d.attempts}</td>
                  <td style={{ ...td(), color: d.responseCode && d.responseCode >= 400 ? '#dc2626' : '#16a34a' }}>{d.responseCode ?? '—'}</td>
                  <td style={td()}><Badge status={d.status === 'delivered' ? 'successful' : d.status === 'failed' ? 'failed' : 'processing'} label={d.status} /></td>
                  <td style={{ ...td(), color: '#6b7280' }}>{new Date(d.createdAt).toLocaleString('en-NG')}</td>
                  <td style={{ ...td(), textAlign: 'right' }}>{d.status !== 'delivered' ? <button disabled={busy === d.id} onClick={() => act(d.id, () => replayDelivery(d.id))} style={btnPrimary()}>Replay</button> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Endpoints">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}><th style={th()}>Customer</th><th style={th()}>URL</th><th style={th()}>Events</th><th style={th()}>Mode</th><th style={th()}>Status</th><th style={th()}></th></tr></thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td()}><strong>{e.customer}</strong></td>
                <td style={td()}><code style={{ fontSize: '0.78rem' }}>{e.url}</code></td>
                <td style={{ ...td(), color: '#6b7280', fontSize: '0.78rem' }}>{e.events.join(', ')}</td>
                <td style={td()}><Badge status={e.sandbox ? 'sandbox' : 'live'} label={e.sandbox ? 'Sandbox' : 'Live'} /></td>
                <td style={td()}><Badge status={e.enabled ? 'successful' : 'failed'} label={e.enabled ? 'Enabled' : 'Disabled'} /></td>
                <td style={{ ...td(), textAlign: 'right' }}><button disabled={busy === e.id} onClick={() => act(e.id, () => toggleEndpoint(e.id, !e.enabled))} style={btn()}>{e.enabled ? 'Disable' : 'Enable'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="API keys">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}><th style={th()}>Customer</th><th style={th()}>Label</th><th style={th()}>Key</th><th style={th()}>Mode</th><th style={th()}>Last used</th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td()}>{k.customer}</td>
                <td style={td()}>{k.label}</td>
                <td style={td()}><code>{k.prefix}••••••••</code></td>
                <td style={td()}><Badge status={k.mode === 'live' ? 'live' : 'sandbox'} label={k.mode} /></td>
                <td style={{ ...td(), color: '#6b7280' }}>{k.lastUsed ? new Date(k.lastUsed).toLocaleString('en-NG') : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.75rem' }}>Keys are shown by prefix only; full secrets are hashed at rest (spec §15).</p>
      </Card>
    </div>
  );
}
