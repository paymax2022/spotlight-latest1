'use client';

import { useEffect, useState } from 'react';
import { getConfig } from '@/services/staysAdminService';
import type { PlatformConfig, FeatureFlag } from '@/types/staysAdmin';
import {
  StaysTabs,
  Card,
  Badge,
  DisclosureNote,
  StateBlock,
  fmtDate,
} from '../_ui';
import { Page, PageHeader, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Feature flags & config"
        subtitle="Runtime feature flags and platform settings for Paymax Stays. Toggles below are a local preview — saving routes through the audited config service."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
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
                <th style={thCell}>Key</th>
                <th style={thCell}>Label</th>
                <th style={thCell}>Description</th>
                <th style={thCell}>Scope</th>
                <th style={thCell}>Updated</th>
                <th style={thCell}>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.key}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{f.key}</code></td>
                  <td style={tdCell}>{f.label}</td>
                  <td style={{ ...tdCell, color: colors.muted, maxWidth: 360 }}>{f.description}</td>
                  <td style={tdCell}><Badge status={f.scope} label={f.scope} /></td>
                  <td style={tdCell}>{fmtDate(f.updated_at)}</td>
                  <td style={tdCell}>
                    <button
                      onClick={() => toggleFlag(f.key)}
                      style={{
                        width: 56,
                        textAlign: 'center',
                        fontWeight: 600,
                        color: f.enabled ? colors.success : colors.muted,
                        background: f.enabled ? tint(colors.success, 0.12) : colors.bg,
                        border: f.enabled ? `1px solid ${tint(colors.success, 0.3)}` : `1px solid ${colors.border}`,
                        borderRadius: 6,
                        padding: '8px 14px',
                        cursor: 'pointer',
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
          <p style={{ color: colors.muted }}>No settings defined.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Key</th>
                <th style={thCell}>Label</th>
                <th style={thCell}>Value</th>
                <th style={thCell}>Type</th>
              </tr>
            </thead>
            <tbody>
              {data.settings.map((s) => (
                <tr key={s.key}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{s.key}</code></td>
                  <td style={tdCell}>{s.label}</td>
                  <td style={tdCell}>{s.value}</td>
                  <td style={tdCell}><Badge status={s.type} label={s.type} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
