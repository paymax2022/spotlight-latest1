'use client';

// SU-10 — Feature Flag & Tenant Configuration. Roll features out per school,
// region or verification tier. RBAC: platform_edtech_admin.

import { useEffect, useState } from 'react';
import { listFeatureFlags, toggleFeatureFlag } from '@/services/platformEdtechAdminService';
import type { FeatureFlag } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, fmtDate,
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote, btn, th, td,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setFlags(await listFeatureFlags()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function toggle(fl: FeatureFlag) {
    const key = `${fl.key}|${fl.scope_type}|${fl.scope_ref}`;
    setBusy(key); setNotice(null);
    try { const u = await toggleFeatureFlag({ key: fl.key, scope_type: fl.scope_type, scope_ref: fl.scope_ref, enabled: !fl.enabled }); setNotice(`${u.label} (${u.scope_type}${u.scope_ref ? `:${u.scope_ref}` : ''}) → ${u.enabled ? 'ON' : 'OFF'}.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Feature Flag & Tenant Configuration" subtitle="Roll EdTech features out incrementally per school, region or verification tier. Backend flags follow the FEATURE_ACADEMY_* pattern (no flag, no merge)." action={<button onClick={load} style={btn()}>Refresh</button>} />
        <PlatformTabs active="flags" />
        <DisclosureNote>Requires <code>platform_edtech_admin</code>. Scope precedence at runtime: <strong>global → tier → region → school</strong> (most specific wins). Every toggle is audited.</DisclosureNote>
        {notice ? <div style={{ marginBottom: '1rem', color: colors.primary }}>{notice}</div> : null}

        <StateBlock loading={loading} error={error} empty={false}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Flags configured" value={flags.length.toString()} accent={colors.primary} />
            <Kpi label="Enabled" value={flags.filter((f) => f.enabled).length.toString()} accent={colors.success} />
            <Kpi label="Scoped (non-global)" value={flags.filter((f) => f.scope_type !== 'global').length.toString()} />
          </div>

          <Card title="Feature flags">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Flag</th><th style={th()}>Scope</th><th style={th()}>State</th><th style={th()}>Updated</th><th style={th()}></th></tr></thead>
              <tbody>
                {flags.map((fl) => {
                  const key = `${fl.key}|${fl.scope_type}|${fl.scope_ref}`;
                  return (
                    <tr key={key}>
                      <td style={td()}><strong>{fl.label}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}><code>{fl.key}</code></div><div style={{ fontSize: '0.76rem', color: colors.muted, marginTop: 2 }}>{fl.description}</div></td>
                      <td style={td()}><Badge status="verified" label={fl.scope_type} />{fl.scope_ref ? <div style={{ fontSize: '0.74rem', color: colors.muted, marginTop: 2 }}>{fl.scope_ref}</div> : null}</td>
                      <td style={td()}>{fl.enabled ? <Badge status="active" label="on" /> : <Badge status="none" label="off" />}</td>
                      <td style={td()}>{fmtDate(fl.updated_at)}</td>
                      <td style={td()}><button onClick={() => toggle(fl)} disabled={busy === key} style={btn()}>{fl.enabled ? 'Disable' : 'Enable'}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <AuditNote>Flag toggles are written to the immutable audit trail with operator + scope.</AuditNote>
          </Card>
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
