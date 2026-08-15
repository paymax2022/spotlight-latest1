'use client';

import { useEffect, useState } from 'react';
import { getConnectConfig, type ConnectConfig } from '@/services/connectAdminOpsService';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="Config & platform" subtitle="Feature flags, matching weights and limits. Backend-owned and read-only here." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: colors.muted }}>Loading config…</p></Card>
      ) : !data ? (
        <Card><p style={{ color: colors.muted }}>No configuration available.</p></Card>
      ) : (
        <>
          <div style={{ background: tint(colors.info, 0.12), border: `1px solid ${tint(colors.info, 0.35)}`, borderRadius: '0.5rem', padding: '0.75rem 1rem', color: colors.info, fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            <strong>Read-only.</strong> {data.source} · Last changed {timeAgo(data.updated_at)}.
          </div>

          <Card title={`Feature flags (${data.flags.length})`} style={{ marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead><tr><th style={thCell}>Key</th><th style={thCell}>Value</th><th style={thCell}>Scope</th><th style={thCell}>Source</th></tr></thead>
              <tbody>
                {data.flags.map((f) => (
                  <tr key={f.key}>
                    <td style={tdCell}><code style={{ fontSize: '0.8rem' }}>{f.key}</code></td>
                    <td style={tdCell}><Badge text={f.value} color={f.value === 'true' ? colors.success : colors.secondary} /></td>
                    <td style={tdCell}>{f.scope}</td>
                    <td style={tdCell}>{f.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Matching weights" style={{ marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead><tr><th style={thCell}>Signal</th><th style={thCell}>Weight</th><th style={thCell}>Description</th></tr></thead>
              <tbody>
                {data.matching_weights.map((w) => (
                  <tr key={w.key}>
                    <td style={tdCell}><code style={{ fontSize: '0.8rem' }}>{w.key}</code></td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ height: 8, background: tint(colors.primary, 0.15), borderRadius: 4, width: 90 }}>
                          <div style={{ height: 8, background: colors.primary, borderRadius: 4, width: `${Math.round(w.weight * 100)}%` }} />
                        </div>
                        <span style={{ fontSize: '0.82rem' }}>{w.weight.toFixed(2)}</span>
                      </div>
                    </td>
                    <td style={tdCell}>{w.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Limits">
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead><tr><th style={thCell}>Key</th><th style={thCell}>Value</th><th style={thCell}>Description</th></tr></thead>
              <tbody>
                {data.limits.map((l) => (
                  <tr key={l.key}>
                    <td style={tdCell}><code style={{ fontSize: '0.8rem' }}>{l.key}</code></td>
                    <td style={tdCell}><strong>{l.value}</strong></td>
                    <td style={tdCell}>{l.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Page>
  );
}
