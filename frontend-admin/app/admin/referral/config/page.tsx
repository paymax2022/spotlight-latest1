'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  getProgramConfig, getReferralRoles, getFeatureFlags, getReferralAudit, formatNaira,
} from '@/services/referralAdminService';
import type { ProgramConfig, ReferralRole, FeatureFlag, ReferralAuditEntry } from '@/types/referralAdmin';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { NOT_REPORTED, errorMessage, textOrDash, timeAgo } from '../_ui';

type Tab = 'program' | 'rbac' | 'flags' | 'audit';
const TABS: { key: Tab; label: string }[] = [
  { key: 'program', label: 'Program config (A-SADM-02)' },
  { key: 'rbac', label: 'RBAC & permissions (A-SADM-03)' },
  { key: 'flags', label: 'Feature flags & kill-switch (A-SADM-04)' },
  { key: 'audit', label: 'Audit log (A-SADM-06)' },
];

const REFERRAL_TABS = [
  { href: '/admin/referral/dashboard', label: 'Overview', key: 'dashboard' },
  { href: '/admin/referral/campaigns', label: 'Campaigns', key: 'campaigns' },
  { href: '/admin/referral/rewards', label: 'Rewards & Ledger', key: 'rewards' },
  { href: '/admin/referral/attribution', label: 'Attribution', key: 'attribution' },
  { href: '/admin/referral/house', label: 'House ledger', key: 'house' },
  { href: '/admin/referral/config', label: 'Config', key: 'config' },
];

function ReferralTabs({ active }: { active: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
      {REFERRAL_TABS.map((t) => (
        <Link key={t.key} href={t.href} style={{
          textDecoration: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
          color: active === t.key ? '#fff' : colors.text,
          background: active === t.key ? colors.primary : colors.headBg,
          border: `1px solid ${active === t.key ? colors.primary : colors.border}`,
        }}>{t.label}</Link>
      ))}
    </div>
  );
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'resolved', 'eligible', 'paid'].includes(s)) return colors.success;
  if (['closed', 'ended', 'draft'].includes(s)) return colors.secondary;
  if (['rejected', 'clawed_back', 'critical'].includes(s)) return colors.danger;
  if (['normal'].includes(s)) return colors.info;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

export default function ReferralConfigPage() {
  const [tab, setTab] = useState<Tab>('program');
  const [program, setProgram] = useState<ProgramConfig | null>(null);
  const [roles, setRoles] = useState<ReferralRole[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [audit, setAudit] = useState<ReferralAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // One refusal used to take all four tabs down: GET /config answers the program
  // tab, while roles, flags and the audit trail have no admin route at all
  // (referral_routes.go registers none of /roles, /flags, /audit). Loaded
  // independently, the config that does exist stays readable.
  const [tabErrors, setTabErrors] = useState<Partial<Record<Tab, string>>>({});

  async function load() {
    setLoading(true); setTabErrors({});
    const [p, r, f, a] = await Promise.allSettled([getProgramConfig(), getReferralRoles(), getFeatureFlags(), getReferralAudit()]);
    const next: Partial<Record<Tab, string>> = {};
    setProgram(p.status === 'fulfilled' ? p.value : null);
    setRoles(r.status === 'fulfilled' ? r.value : []);
    setFlags(f.status === 'fulfilled' ? f.value : []);
    setAudit(a.status === 'fulfilled' ? a.value : []);
    if (p.status === 'rejected') next.program = errorMessage(p.reason);
    if (r.status === 'rejected') next.rbac = errorMessage(r.reason);
    if (f.status === 'rejected') next.flags = errorMessage(f.reason);
    if (a.status === 'rejected') next.audit = errorMessage(a.reason);
    setTabErrors(next);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function toggleFlag(key: string) {
    setFlags((fs) => fs.map((f) => (f.key === key ? { ...f, enabled: !f.enabled } : f)));
  }

  return (
    <Page>
      <PageHeader
        title="Program configuration"
        subtitle="Global rules, RBAC roster, feature flags / kill-switches and the privileged-action audit trail (A-SADM-02/03/04/06)."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <ReferralTabs active="config" />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
              background: tab === t.key ? tint(colors.primary, 0.08) : colors.card,
              border: `1px solid ${tab === t.key ? colors.primary : colors.inputBorder}`,
              color: colors.text, fontWeight: tab === t.key ? 700 : 400,
            }}
          >{t.label}</button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : (
        <>
          {tabErrors[tab] ? <p style={{ color: colors.warning, fontSize: 13, marginBottom: 12 }}>{tabErrors[tab]}</p> : null}
          {tab === 'program' && program && (
            <>
              <Card title="Global program rules" style={{ marginBottom: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12 }}>
                  {/* Only welcome_reward_enabled is a referral_config column
                      (backend/internal/referral/config/service.go:18). The rest
                      live in the reward/campaign engine and no admin route
                      serves them, so they read as not reported. */}
                  <Field label="Program enabled" value={NOT_REPORTED} />
                  <Field label="Default tier" value={NOT_REPORTED} />
                  <Field label="Qualifying action" value={NOT_REPORTED} />
                  <Field label="Reward-to-LTV cap" value={NOT_REPORTED} />
                  <Field label="Welcome reward" value={<StatusBadge status={program.welcome_reward_enabled ? 'active' : 'closed'} label={program.welcome_reward_enabled ? 'On' : 'Off'} />} />
                  <Field label="Last updated" value={timeAgo(program.updated_at)} />
                </div>
              </Card>
              <Card title="Default tiers & caps">
                <p style={{ fontSize: 12, color: colors.muted, marginTop: 0 }}>
                  Not reported: GET /api/referral/admin/config returns the six referral_config columns
                  (attribution window, grace window, fallback chain, house code, budget-neutral, welcome reward).
                  Tier caps, the qualifying action and the LTV guardrail are not columns of that row and no admin
                  route exposes them — see docs/ops/admin-pages-to-backend-flags.md.
                </p>
                {program.tiers == null ? null : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Tier</th><th style={thCell}>Monthly cap</th><th style={thCell}>Override %</th><th style={thCell}>Disclosure</th></tr></thead>
                    <tbody>
                      {program.tiers.map((t) => (
                        <tr key={t.name}>
                          <td style={tdCell}><strong>{t.name}</strong></td>
                          <td style={tdCell}>{formatNaira(t.monthly_cap_kobo)}</td>
                          <td style={tdCell}>{t.override_pct}%</td>
                          <td style={{ ...tdCell, color: colors.muted }}>{t.disclosure}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
                <p style={{ fontSize: 12, color: colors.warning, marginTop: 8 }}>Overrides are tied to verified network activity only — never recruitment (pyramid-line, §7).</p>
              </Card>
            </>
          )}

          {tab === 'rbac' && (
            <Card title="referral.* roles & entitlements (read-only)">
              {!tabErrors.rbac && roles.length === 0 ? <p style={{ color: colors.muted }}>No roles configured.</p> : !tabErrors.rbac ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Role</th><th style={thCell}>Scope</th><th style={thCell}>Permissions</th></tr></thead>
                    <tbody>
                      {roles.map((r) => (
                        <tr key={r.role}>
                          <td style={tdCell}><strong>{r.role}</strong></td>
                          <td style={tdCell}><StatusBadge status="normal" label={r.scope} /></td>
                          <td style={tdCell}>{r.permissions.map((p) => <code key={p} style={{ fontSize: '0.72rem', background: colors.headBg, padding: '0.1rem 0.35rem', borderRadius: 4, marginRight: 4, display: 'inline-block', marginBottom: 2 }}>{p}</code>)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </Card>
          )}

          {tab === 'flags' && (
            <Card title="Feature flags & emergency kill-switches">
              {!tabErrors.flags && flags.length === 0 ? <p style={{ color: colors.muted }}>No flags defined.</p> : !tabErrors.flags ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Flag</th><th style={thCell}>Phase</th><th style={thCell}>State</th><th style={thCell}></th></tr></thead>
                    <tbody>
                      {flags.map((f) => (
                        <tr key={f.key}>
                          <td style={tdCell}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <strong>{f.label}</strong>
                              {f.kill_switch && <StatusBadge status="critical" label="kill-switch" />}
                            </div>
                            <div style={{ fontSize: 12, color: colors.muted }}>{f.description} <code style={{ fontSize: '0.7rem' }}>{f.key}</code></div>
                          </td>
                          <td style={tdCell}><StatusBadge status="normal" label={f.phase} /></td>
                          <td style={tdCell}><StatusBadge status={f.enabled ? 'active' : 'closed'} label={f.enabled ? 'On' : 'Off'} /></td>
                          <td style={{ ...tdCell, textAlign: 'right' }}>
                            <Button variant={f.enabled ? 'danger' : 'outline'} sm onClick={() => toggleFlag(f.key)}>{f.enabled ? 'Disable' : 'Enable'}</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                ) : null}
              <p style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>Flag toggles are a mock-mode preview only: no admin route writes referral flags, so live mode has nothing to persist to.</p>
            </Card>
          )}

          {tab === 'audit' && (
            <Card title="Privileged-action audit log">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <Button variant="outline" sm>Export CSV</Button>
              </div>
              {!tabErrors.audit && audit.length === 0 ? <p style={{ color: colors.muted }}>No audit entries.</p> : !tabErrors.audit ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Action</th><th style={thCell}>Actor</th><th style={thCell}>Entity</th><th style={thCell}>Reason</th><th style={thCell}>When</th></tr></thead>
                    <tbody>
                      {audit.map((a) => (
                        <tr key={a.id}>
                          <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.action}</code></td>
                          <td style={tdCell}>{a.actor_id}{a.actor_role ? ` (${a.actor_role})` : ''}</td>
                          <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{a.entity_type}:{a.entity_id}</code></td>
                          <td style={{ ...tdCell, color: colors.muted }}>{a.reason ?? '—'}</td>
                          <td style={tdCell}>{timeAgo(a.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 14, marginTop: 3, color: colors.text }}>{value}</div>
    </div>
  );
}
