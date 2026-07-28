'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAttributionConfig, updateAttributionConfig } from '@/services/referralAdminService';
import type { AttributionConfig, FallbackChainEntry } from '@/types/referralAdmin';
import { PageHeader, ReferralTabs, Card, Badge, btn, btnPrimary, input, label, timeAgo, StateBlock } from '../_ui';

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

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Attribution & default-referrer config"
        subtitle="A-SADM-07 / §7A — attribution window, priority fallback-referrer chain, grace window, house-account designation and budget-neutral vs funded-pool toggle."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={load} style={btn()}>Refresh</button>
            <Link href="/admin/referral/attribution/reassignments" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>Reassignments & disputes →</Link>
          </div>
        }
      />
      <ReferralTabs active="attribution" />

      <StateBlock loading={loading} error={error} empty={!cfg} emptyText="No attribution config available.">
        {cfg && (
          <>
            <Card title="Windows">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: '1rem' }}>
                <div>
                  <label style={label()}>Attribution window (hours)</label>
                  <input type="number" min={0} value={cfg.attribution_window_hours} onChange={(e) => patch({ attribution_window_hours: Number(e.target.value) })} style={input()} />
                  <p style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.25rem' }}>How long a deferred deep-link click counts toward the original referrer (§7A.1).</p>
                </div>
                <div>
                  <label style={label()}>Grace window (hours)</label>
                  <input type="number" min={0} value={cfg.grace_window_hours} onChange={(e) => patch({ grace_window_hours: Number(e.target.value) })} style={input()} />
                  <p style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.25rem' }}>Late code-claim window; after it closes, attribution locks (§7A.3).</p>
                </div>
              </div>
            </Card>

            <Card title="Priority fallback-referrer chain" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>First match wins; house is last resort</span>}>
              <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: 0 }}>
                Resolution order: code → deep-link → context (agent/estate/campaign) → regional house → global house/Super-Admin (§7A.1). Reorder or disable tiers; the global house must remain the ultimate fallback so no signup goes unattributed.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {cfg.fallback_chain.map((e, i) => (
                    <tr key={e.tier}>
                      <td style={{ padding: '0.5rem', borderTop: '1px solid #f3f4f6', width: 36, color: '#6b7280', fontWeight: 700 }}>{i + 1}</td>
                      <td style={{ padding: '0.5rem', borderTop: '1px solid #f3f4f6' }}>
                        <code style={{ fontSize: '0.78rem' }}>{e.tier}</code>
                        <div style={{ fontSize: '0.85rem', color: '#374151' }}>{e.label}</div>
                      </td>
                      <td style={{ padding: '0.5rem', borderTop: '1px solid #f3f4f6' }}>
                        {e.tier === 'global_house' ? <Badge status="house" label="ultimate fallback" /> : <Badge status={e.enabled ? 'active' : 'closed'} label={e.enabled ? 'Enabled' : 'Disabled'} />}
                      </td>
                      <td style={{ padding: '0.5rem', borderTop: '1px solid #f3f4f6', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => move(i, -1)} disabled={i === 0} style={{ ...btn(), opacity: i === 0 ? 0.4 : 1, marginRight: 4 }}>↑</button>
                        <button onClick={() => move(i, 1)} disabled={i === cfg.fallback_chain.length - 1} style={{ ...btn(), opacity: i === cfg.fallback_chain.length - 1 ? 0.4 : 1, marginRight: 4 }}>↓</button>
                        <button onClick={() => toggleTier(i)} disabled={e.tier === 'global_house'} style={{ ...btn(), opacity: e.tier === 'global_house' ? 0.4 : 1 }}>{e.enabled ? 'Disable' : 'Enable'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="House account & accounting policy">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: '1rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={label()}>House account code (§7A.1)</label>
                  <input value={cfg.house_account_code} onChange={(e) => patch({ house_account_code: e.target.value })} style={input()} />
                  <p style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.25rem' }}>A dedicated system account owned by the Super Admin — never an individual's personal wallet.</p>
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

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button onClick={save} disabled={saving} style={{ ...btnPrimary(), opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save configuration'}</button>
              {saved && <span style={{ color: '#15803d', fontSize: '0.85rem' }}>Saved · updated {timeAgo(cfg.updated_at)}</span>}
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Changes are audited (A-SADM-06).</span>
            </div>
          </>
        )}
      </StateBlock>
    </div>
  );
}

function ToggleRow({ label: lbl, hint, value, onChange, onText = 'On', offText = 'Off' }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void; onText?: string; offText?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', border: '1px solid #f3f4f6', borderRadius: '0.5rem', padding: '0.6rem 0.75rem' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{lbl}</div>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', maxWidth: 620 }}>{hint}</div>
      </div>
      <button onClick={() => onChange(!value)} style={{ ...btn(), whiteSpace: 'nowrap', color: value ? '#15803d' : '#6b7280', borderColor: value ? '#86efac' : '#d1d5db', fontWeight: 600 }}>{value ? onText : offText}</button>
    </div>
  );
}
