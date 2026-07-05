'use client';

import { useEffect, useState } from 'react';
import {
  getProgramConfig, getReferralRoles, getFeatureFlags, getReferralAudit, formatNaira,
} from '@/services/referralAdminService';
import type { ProgramConfig, ReferralRole, FeatureFlag, ReferralAuditEntry } from '@/types/referralAdmin';
import { PageHeader, ReferralTabs, Card, Badge, btn, th, td, timeAgo, StateBlock } from '../_ui';

type Tab = 'program' | 'rbac' | 'flags' | 'audit';
const TABS: { key: Tab; label: string }[] = [
  { key: 'program', label: 'Program config (A-SADM-02)' },
  { key: 'rbac', label: 'RBAC & permissions (A-SADM-03)' },
  { key: 'flags', label: 'Feature flags & kill-switch (A-SADM-04)' },
  { key: 'audit', label: 'Audit log (A-SADM-06)' },
];

export default function ReferralConfigPage() {
  const [tab, setTab] = useState<Tab>('program');
  const [program, setProgram] = useState<ProgramConfig | null>(null);
  const [roles, setRoles] = useState<ReferralRole[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [audit, setAudit] = useState<ReferralAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, r, f, a] = await Promise.all([getProgramConfig(), getReferralRoles(), getFeatureFlags(), getReferralAudit()]);
      setProgram(p); setRoles(r); setFlags(f); setAudit(a);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function toggleFlag(key: string) {
    setFlags((fs) => fs.map((f) => (f.key === key ? { ...f, enabled: !f.enabled } : f)));
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Program configuration"
        subtitle="Global rules, RBAC roster, feature flags / kill-switches and the privileged-action audit trail (A-SADM-02/03/04/06)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <ReferralTabs active="config" />

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ ...btn(), background: tab === t.key ? '#eef2ff' : '#fff', borderColor: tab === t.key ? '#340075' : '#d1d5db', fontWeight: tab === t.key ? 700 : 400 }}>{t.label}</button>
        ))}
      </div>

      <StateBlock loading={loading} error={error} empty={false}>
        {tab === 'program' && program && (
          <>
            <Card title="Global program rules">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem' }}>
                <Field label="Program enabled" value={<Badge status={program.program_enabled ? 'active' : 'closed'} label={program.program_enabled ? 'Enabled' : 'Disabled'} />} />
                <Field label="Default tier" value={program.default_tier} />
                <Field label="Qualifying action" value={program.qualifying_action.replace(/_/g, ' ')} />
                <Field label="Reward-to-LTV cap" value={`${program.reward_to_ltv_cap_pct}%`} />
                <Field label="Welcome reward" value={<Badge status={program.welcome_reward_enabled ? 'active' : 'closed'} label={program.welcome_reward_enabled ? 'On' : 'Off'} />} />
                <Field label="Last updated" value={timeAgo(program.updated_at)} />
              </div>
            </Card>
            <Card title="Default tiers & caps">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Tier</th><th style={th()}>Monthly cap</th><th style={th()}>Override %</th><th style={th()}>Disclosure</th></tr></thead>
                <tbody>
                  {program.tiers.map((t) => (
                    <tr key={t.name}>
                      <td style={td()}><strong>{t.name}</strong></td>
                      <td style={td()}>{formatNaira(t.monthly_cap_kobo)}</td>
                      <td style={td()}>{t.override_pct}%</td>
                      <td style={{ ...td(), color: '#6b7280' }}>{t.disclosure}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: '0.75rem', color: '#9a3412', marginTop: '0.5rem' }}>Overrides are tied to verified network activity only — never recruitment (pyramid-line, §7).</p>
            </Card>
          </>
        )}

        {tab === 'rbac' && (
          <Card title="referral.* roles & entitlements (read-only)">
            <StateBlock loading={false} error={null} empty={roles.length === 0} emptyText="No roles configured.">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Role</th><th style={th()}>Scope</th><th style={th()}>Permissions</th></tr></thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.role}>
                      <td style={td()}><strong>{r.role}</strong></td>
                      <td style={td()}><Badge status="normal" label={r.scope} /></td>
                      <td style={td()}>{r.permissions.map((p) => <code key={p} style={{ fontSize: '0.72rem', background: '#f3f4f6', padding: '0.1rem 0.35rem', borderRadius: 4, marginRight: 4, display: 'inline-block', marginBottom: 2 }}>{p}</code>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </StateBlock>
          </Card>
        )}

        {tab === 'flags' && (
          <Card title="Feature flags & emergency kill-switches">
            <StateBlock loading={false} error={null} empty={flags.length === 0} emptyText="No flags defined.">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Flag</th><th style={th()}>Phase</th><th style={th()}>State</th><th style={th()}></th></tr></thead>
                <tbody>
                  {flags.map((f) => (
                    <tr key={f.key}>
                      <td style={td()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <strong>{f.label}</strong>
                          {f.kill_switch && <Badge status="critical" label="kill-switch" />}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{f.description} <code style={{ fontSize: '0.7rem' }}>{f.key}</code></div>
                      </td>
                      <td style={td()}><Badge status="normal" label={f.phase} /></td>
                      <td style={td()}><Badge status={f.enabled ? 'active' : 'closed'} label={f.enabled ? 'On' : 'Off'} /></td>
                      <td style={{ ...td(), textAlign: 'right' }}>
                        <button onClick={() => toggleFlag(f.key)} style={{ ...btn(), color: f.enabled ? '#b91c1c' : '#15803d', borderColor: f.enabled ? '#fca5a5' : '#86efac' }}>{f.enabled ? 'Disable' : 'Enable'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem' }}>Toggles are local-preview in mock mode; live mode persists to the backend with an audit event.</p>
            </StateBlock>
          </Card>
        )}

        {tab === 'audit' && (
          <Card title="Privileged-action audit log" right={<button style={btn()}>Export CSV</button>}>
            <StateBlock loading={false} error={null} empty={audit.length === 0} emptyText="No audit entries.">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Action</th><th style={th()}>Actor</th><th style={th()}>Entity</th><th style={th()}>Reason</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.action}</code></td>
                      <td style={td()}>{a.actor_id}{a.actor_role ? ` (${a.actor_role})` : ''}</td>
                      <td style={td()}><code style={{ fontSize: '0.76rem' }}>{a.entity_type}:{a.entity_id}</code></td>
                      <td style={{ ...td(), color: '#6b7280' }}>{a.reason ?? '—'}</td>
                      <td style={td()}>{timeAgo(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </StateBlock>
          </Card>
        )}
      </StateBlock>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '0.95rem', marginTop: '0.2rem', color: '#111827' }}>{value}</div>
    </div>
  );
}
