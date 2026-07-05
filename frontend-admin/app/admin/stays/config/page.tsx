'use client';

import { useEffect, useState } from 'react';
import { getConfig } from '@/services/staysAdminService';
import type { PlatformConfig, FeatureFlag } from '@/types/staysAdmin';
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
  fmtDate,
} from '../_ui';

export default function StaysConfigPage() {
  const [data, setData] = useState<PlatformConfig | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const cfg = await getConfig();
      setData(cfg);
      setFlags(cfg.flags.map((f) => ({ ...f })));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function toggleFlag(key: string) {
    setFlags((prev) => prev.map((f) => (f.key === key ? { ...f, enabled: !f.enabled } : f)));
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Feature flags & config"
        subtitle="Runtime feature flags and platform settings for Paymax Stays. Toggles below are a local preview — saving routes through the audited config service."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="platform" />

      <DisclosureNote>
        All flag changes are audited. Money-path flags (fast-path refund, auto-merge dedup) require
        a second reviewer before they can be enabled in production.
      </DisclosureNote>

      <Card title="Feature flags">
        <StateBlock loading={loading} error={error} empty={flags.length === 0} emptyText="No feature flags defined.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>Key</th>
                <th style={th()}>Label</th>
                <th style={th()}>Description</th>
                <th style={th()}>Scope</th>
                <th style={th()}>Updated</th>
                <th style={th()}>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.key}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{f.key}</code></td>
                  <td style={td()}>{f.label}</td>
                  <td style={{ ...td(), color: '#6b7280', maxWidth: 360 }}>{f.description}</td>
                  <td style={td()}><Badge status={f.scope} label={f.scope} /></td>
                  <td style={td()}>{fmtDate(f.updated_at)}</td>
                  <td style={td()}>
                    <button
                      onClick={() => toggleFlag(f.key)}
                      style={{
                        ...btn(),
                        width: 56,
                        textAlign: 'center',
                        fontWeight: 600,
                        color: f.enabled ? '#15803d' : '#6b7280',
                        background: f.enabled ? '#dcfce7' : '#f3f4f6',
                        border: f.enabled ? '1px solid #bbf7d0' : '1px solid #e5e7eb',
                      }}
                    >
                      {f.enabled ? 'On' : 'Off'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      <Card title="Settings">
        {(!data || data.settings.length === 0) ? (
          <p style={{ color: '#6b7280' }}>No settings defined.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>Key</th>
                <th style={th()}>Label</th>
                <th style={th()}>Value</th>
                <th style={th()}>Type</th>
              </tr>
            </thead>
            <tbody>
              {data.settings.map((s) => (
                <tr key={s.key}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{s.key}</code></td>
                  <td style={td()}>{s.label}</td>
                  <td style={td()}>{s.value}</td>
                  <td style={td()}><Badge status={s.type} label={s.type} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
