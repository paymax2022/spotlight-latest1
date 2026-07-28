'use client';

import { useEffect, useState } from 'react';
import { getConnectConfig, type ConnectConfig } from '@/services/connectAdminOpsService';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../_ui';

export default function ConnectConfigPage() {
  const [data, setData] = useState<ConnectConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getConnectConfig()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Config & platform" subtitle="Feature flags, matching weights and limits. Backend-owned and read-only here." action={<button onClick={load} style={btn()}>Refresh</button>} />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: '#6b7280' }}>Loading config…</p></Card>
      ) : !data ? (
        <Card><p style={{ color: '#6b7280' }}>No configuration available.</p></Card>
      ) : (
        <>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem', padding: '0.75rem 1rem', color: '#1e40af', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            <strong>Read-only.</strong> {data.source} · Last changed {timeAgo(data.updated_at)}.
          </div>

          <Card title={`Feature flags (${data.flags.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Key</th><th style={th()}>Value</th><th style={th()}>Scope</th><th style={th()}>Source</th></tr></thead>
              <tbody>
                {data.flags.map((f) => (
                  <tr key={f.key}>
                    <td style={td()}><code style={{ fontSize: '0.8rem' }}>{f.key}</code></td>
                    <td style={td()}><Badge status={f.value === 'true' ? 'resolved' : 'closed'} label={f.value} /></td>
                    <td style={td()}>{f.scope}</td>
                    <td style={td()}>{f.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Matching weights">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Signal</th><th style={th()}>Weight</th><th style={th()}>Description</th></tr></thead>
              <tbody>
                {data.matching_weights.map((w) => (
                  <tr key={w.key}>
                    <td style={td()}><code style={{ fontSize: '0.8rem' }}>{w.key}</code></td>
                    <td style={td()}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ height: 8, background: '#ede9fe', borderRadius: 4, width: 90 }}>
                          <div style={{ height: 8, background: '#340075', borderRadius: 4, width: `${Math.round(w.weight * 100)}%` }} />
                        </div>
                        <span style={{ fontSize: '0.82rem' }}>{w.weight.toFixed(2)}</span>
                      </div>
                    </td>
                    <td style={td()}>{w.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Limits">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Key</th><th style={th()}>Value</th><th style={th()}>Description</th></tr></thead>
              <tbody>
                {data.limits.map((l) => (
                  <tr key={l.key}>
                    <td style={td()}><code style={{ fontSize: '0.8rem' }}>{l.key}</code></td>
                    <td style={td()}><strong>{l.value}</strong></td>
                    <td style={td()}>{l.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
