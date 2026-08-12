'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getCategories, toggleCategory, getFees, updateFees, getFeatureFlags, toggleFeatureFlag,
} from '@/services/crowdfundingAdminService';
import type { CfCategoryConfig, CfFeeConfig, CfFeatureFlag } from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, Input, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

export default function CrowdfundingConfigPage() {
  const [categories, setCategories] = useState<CfCategoryConfig[]>([]);
  const [fees, setFees] = useState<CfFeeConfig | null>(null);
  const [flags, setFlags] = useState<CfFeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [c, f, fl] = await Promise.all([getCategories(), getFees(), getFeatureFlags()]);
      setCategories(c); setFees(f); setFlags(fl);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function flash(msg: string) { setSavedMsg(msg); setTimeout(() => setSavedMsg(null), 2500); }

  async function onToggleCategory(id: string, field: 'enabled' | 'requiresEnhancedReview', value: boolean) {
    setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
    try { await toggleCategory(id, field, value); flash('Category updated'); } catch (e) { setError(String(e)); load(); }
  }
  async function onToggleFlag(key: string, enabled: boolean) {
    setFlags((fs) => fs.map((f) => (f.key === key ? { ...f, enabled } : f)));
    try { await toggleFeatureFlag(key, enabled); flash('Feature flag updated'); } catch (e) { setError(String(e)); load(); }
  }
  async function saveFees() {
    if (!fees) return;
    try { await updateFees(fees); flash('Fee settings saved'); } catch (e) { setError(String(e)); }
  }

  return (
    <Page style={{ maxWidth: 880 }}>
      <PageHeader
        title="Platform Configuration"
        subtitle="Categories, fees and feature flags."
        actions={savedMsg ? <span style={{ color: colors.success, fontSize: '0.85rem' }}>{savedMsg}</span> : undefined}
      />

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading || !fees ? <p style={{ color: colors.muted }}>Loading configuration…</p> : (
        <>
          {/* Categories */}
          <h2 style={h2()}>Campaign categories</h2>
          <Card style={{ marginBottom: '1.5rem', padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr>
                <th style={thCell}>Category</th><th style={thCell}>Campaigns</th><th style={{ ...thCell, textAlign: 'center' }}>Enabled</th><th style={{ ...thCell, textAlign: 'center' }}>Enhanced review</th>
              </tr></thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td style={tdCell}><strong>{c.label}</strong> <span style={{ color: colors.muted }}>/{c.slug}</span></td>
                    <td style={tdCell}>{c.campaignCount.toLocaleString('en-NG')}</td>
                    <td style={{ ...tdCell, textAlign: 'center' }}><Toggle on={c.enabled} onChange={(v) => onToggleCategory(c.id, 'enabled', v)} /></td>
                    <td style={{ ...tdCell, textAlign: 'center' }}><Toggle on={c.requiresEnhancedReview} onChange={(v) => onToggleCategory(c.id, 'requiresEnhancedReview', v)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Fees */}
          <h2 style={h2()}>Fees & limits</h2>
          <Card style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
              <FeeField label="Platform fee (bps)" value={fees.platformFeeBps} onChange={(v) => setFees({ ...fees, platformFeeBps: v })} hint={`${(fees.platformFeeBps / 100).toFixed(2)}%`} />
              <FeeField label="Payment fee (bps)" value={fees.paymentFeeBps} onChange={(v) => setFees({ ...fees, paymentFeeBps: v })} hint={`${(fees.paymentFeeBps / 100).toFixed(2)}%`} />
              <FeeField label="Payment flat fee (kobo)" value={fees.paymentFeeFlatKobo} onChange={(v) => setFees({ ...fees, paymentFeeFlatKobo: v })} hint={`₦${(fees.paymentFeeFlatKobo / 100).toLocaleString('en-NG')}`} />
              <FeeField label="Min contribution (kobo)" value={fees.minContributionKobo} onChange={(v) => setFees({ ...fees, minContributionKobo: v })} hint={`₦${(fees.minContributionKobo / 100).toLocaleString('en-NG')}`} />
              <FeeField label="Max contribution (kobo)" value={fees.maxContributionKobo} onChange={(v) => setFees({ ...fees, maxContributionKobo: v })} hint={`₦${(fees.maxContributionKobo / 100).toLocaleString('en-NG')}`} />
            </div>
            <div style={{ marginTop: '1rem' }}>
              <Button variant="primary" onClick={saveFees}>Save fee settings</Button>
            </div>
          </Card>

          {/* Feature flags */}
          <h2 style={h2()}>Feature flags</h2>
          <Card>
            {flags.map((f, i, arr) => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 0', borderBottom: i < arr.length - 1 ? `1px solid ${colors.border}` : 'none' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{f.label} {f.locked && <span style={{ fontSize: '0.7rem', color: colors.danger, background: tint(colors.danger, 0.12), padding: '0.05rem 0.4rem', borderRadius: '0.25rem', marginLeft: '0.4rem' }}>LOCKED</span>}</div>
                  <div style={{ fontSize: '0.8rem', color: colors.muted }}>{f.description}</div>
                </div>
                <Toggle on={f.enabled} disabled={f.locked} onChange={(v) => onToggleFlag(f.key, v)} />
              </div>
            ))}
            <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.75rem', marginBottom: 0 }}>Locked flags (e.g. investment crowdfunding) require regulatory approval before they can be enabled.</p>
          </Card>
        </>
      )}
    </Page>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      aria-pressed={on}
      style={{
        width: 42, height: 24, borderRadius: 9999, border: 'none',
        background: on ? colors.success : colors.inputBorder, position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, padding: 0,
      }}
    >
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: 9999, background: '#fff', transition: 'left 0.15s' }} />
    </button>
  );
}

function FeeField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint: string }) {
  return (
    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: colors.text }}>
      {label}
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} style={{ display: 'block', width: '100%', marginTop: '0.3rem', boxSizing: 'border-box' }} />
      <span style={{ fontSize: '0.72rem', color: colors.muted, fontWeight: 400 }}>= {hint}</span>
    </label>
  );
}

const h2 = (): React.CSSProperties => ({ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem', color: colors.text });
