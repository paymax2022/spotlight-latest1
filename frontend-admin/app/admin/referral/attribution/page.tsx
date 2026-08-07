'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAttributionConfig, updateAttributionConfig } from '@/services/referralAdminService';
import type { AttributionConfig, FallbackChainEntry } from '@/types/referralAdmin';
import { ReferralTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors } from '@/components/ui/vuexy';

export default function AttributionConfigPage() {
  const [cfg, setCfg] = useState<AttributionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setCfg(await getAttributionConfig()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!cfg) return;
    setSaving(true); setSaved(false); setError(null);
    try { setCfg(await updateAttributionConfig(cfg)); setSaved(true); }
    catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  function patch(p: Partial<AttributionConfig>) { setCfg((c) => (c ? { ...c, ...p } : c)); setSaved(false); }
  function setChain(chain: FallbackChainEntry[]) { patch({ fallback_chain: chain }); }
  function toggleTier(i: number) {
    if (!cfg) return;
    setChain(cfg.fallback_chain.map((e, idx) => (idx === i ? { ...e, enabled: !e.enabled } : e)));
  }
  function move(i: number, dir: -1 | 1) {
    if (!cfg) return;
    const j = i + dir;
    if (j < 0 || j >= cfg.fallback_chain.length) return;
    const next = [...cfg.fallback_chain];
    [next[i], next[j]] = [next[j], next[i]];
    setChain(next);
  }

  const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' } as const;

  return (
    <Page>
      <PageHeader
        title="Attribution & default-referrer config"
        subtitle="A-SADM-07 / §7A — attribution window, priority fallback-referrer chain, grace window, house-account designation and budget-neutral vs funded-pool toggle."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="outline" onClick={load}>Refresh</Button>
            <Link href="/admin/referral/attribution/reassignments"><Button variant="outline">Reassignments & disputes →</Button></Link>
          </div>
        }
      />
      <ReferralTabs active="attribution" />

      {loading ? (
        <p style={{ color: colors.muted, fontSize: 13 }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>
      ) : !cfg ? (
        <p style={{ color: colors.muted, fontSize: 13 }}>No attribution config available.</p>
      ) : (
        <>
          <Card title="Windows">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: '1rem', marginTop: 14 }}>
              <div>
                <label style={labelStyle}>Attribution window (hours)</label>
                <Input type="number" min={0} value={cfg.attribution_window_hours} onChange={(e) => patch({ attribution_window_hours: Number(e.target.value) })} />
                <p style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.25rem' }}>How long a deferred deep-link click counts toward the original referrer (§7A.1).</p>
              </div>
              <div>
                <label style={labelStyle}>Grace window (hours)</label>
                <Input type="number" min={0} value={cfg.grace_window_hours} onChange={(e) => patch({ grace_window_hours: Number(e.target.value) })} />
                <p style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.25rem' }}>Late code-claim window; after it closes, attribution locks (§7A.3).</p>
              </div>
            </div>
          </Card>

          <Card style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Priority fallback-referrer chain</h2>
              <span style={{ fontSize: '0.75rem', color: colors.muted }}>First match wins; house is last resort</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: colors.text, marginTop: 0 }}>
              Resolution order: code → deep-link → context (agent/estate/campaign) → regional house → global house/Super-Admin (§7A.1). Reorder or disable tiers; the global house must remain the ultimate fallback so no signup goes unattributed.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {cfg.fallback_chain.map((e, i) => (
                  <tr key={e.tier}>
                    <td style={{ padding: '0.5rem', borderTop: `1px solid ${colors.border}`, width: 36, color: colors.muted, fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ padding: '0.5rem', borderTop: `1px solid ${colors.border}` }}>
                      <code style={{ fontSize: '0.78rem' }}>{e.tier}</code>
                      <div style={{ fontSize: '0.85rem', color: colors.text }}>{e.label}</div>
                    </td>
                    <td style={{ padding: '0.5rem', borderTop: `1px solid ${colors.border}` }}>
                      {e.tier === 'global_house' ? <Badge text="ultimate fallback" color={colors.primary} /> : <Badge text={e.enabled ? 'Enabled' : 'Disabled'} color={e.enabled ? colors.success : colors.secondary} />}
                    </td>
                    <td style={{ padding: '0.5rem', borderTop: `1px solid ${colors.border}`, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button variant="outline" sm onClick={() => move(i, -1)} disabled={i === 0} style={{ marginRight: 4 }}>↑</Button>
                      <Button variant="outline" sm onClick={() => move(i, 1)} disabled={i === cfg.fallback_chain.length - 1} style={{ marginRight: 4 }}>↓</Button>
                      <Button variant="outline" sm onClick={() => toggleTier(i)} disabled={e.tier === 'global_house'}>{e.enabled ? 'Disable' : 'Enable'}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="House account & accounting policy" style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: '1rem', marginBottom: '0.75rem', marginTop: 14 }}>
              <div>
                <label style={labelStyle}>House account code (§7A.1)</label>
                <Input value={cfg.house_account_code} onChange={(e) => patch({ house_account_code: e.target.value })} />
                <p style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.25rem' }}>A dedicated system account owned by the Super Admin — never an individual's personal wallet.</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <ToggleRow
                label="Budget-neutral house pool (recommended)"
                hint="On = company simply doesn't pay a referrer-side bonus on organic signups. Off = funded house pool that bankrolls future promotions (§7A.2)."
                value={cfg.budget_neutral}
                onChange={(v) => patch({ budget_neutral: v })}
                onText="Budget-neutral" offText="Funded pool"
              />
              <ToggleRow
                label="Welcome reward for organic users"
                hint="The referee/welcome side is a separate campaign decision and is never penalised by the default-referrer rule (§7A.2)."
                value={cfg.welcome_reward_enabled}
                onChange={(v) => patch({ welcome_reward_enabled: v })}
              />
              <ToggleRow
                label="Block self-referral"
                hint="Own code, same KYC identity or same device → blocked, no referrer-side reward, defaults to house, flagged to Risk (§7A.4)."
                value={cfg.self_referral_blocked}
                onChange={(v) => patch({ self_referral_blocked: v })}
              />
            </div>
          </Card>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: 16 }}>
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save configuration'}</Button>
            {saved && <span style={{ color: colors.success, fontSize: '0.85rem' }}>Saved · updated {timeAgo(cfg.updated_at)}</span>}
            <span style={{ fontSize: '0.75rem', color: colors.muted }}>Changes are audited (A-SADM-06).</span>
          </div>
        </>
      )}
    </Page>
  );
}

function ToggleRow({ label: lbl, hint, value, onChange, onText = 'On', offText = 'Off' }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void; onText?: string; offText?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.6rem 0.75rem' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{lbl}</div>
        <div style={{ fontSize: '0.75rem', color: colors.muted, maxWidth: 620 }}>{hint}</div>
      </div>
      <Button variant="outline" sm onClick={() => onChange(!value)} style={{ whiteSpace: 'nowrap', color: value ? colors.success : colors.muted, fontWeight: 600 }}>{value ? onText : offText}</Button>
    </div>
  );
}
