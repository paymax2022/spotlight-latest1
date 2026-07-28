'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getCategories, toggleCategory, getFees, updateFees, getFeatureFlags, toggleFeatureFlag,
} from '@/services/crowdfundingAdminService';
import type { CfCategoryConfig, CfFeeConfig, CfFeatureFlag } from '@/types/crowdfunding';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem', maxWidth: 880 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Platform Configuration</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>Categories, fees and feature flags.</p>
        </div>
        {savedMsg && <span style={{ color: '#16a34a', fontSize: '0.85rem' }}>{savedMsg}</span>}
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

      {loading || !fees ? <p style={{ color: '#6b7280' }}>Loading configuration…</p> : (
        <>
          {/* Categories */}
          <h2 style={h2()}>Campaign categories</h2>
          <div style={{ ...card(), marginBottom: '1.5rem', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Category</th><th style={th()}>Campaigns</th><th style={{ ...th(), textAlign: 'center' }}>Enabled</th><th style={{ ...th(), textAlign: 'center' }}>Enhanced review</th>
              </tr></thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><strong>{c.label}</strong> <span style={{ color: '#9ca3af' }}>/{c.slug}</span></td>
                    <td style={td()}>{c.campaignCount.toLocaleString('en-NG')}</td>
                    <td style={{ ...td(), textAlign: 'center' }}><Toggle on={c.enabled} onChange={(v) => onToggleCategory(c.id, 'enabled', v)} /></td>
                    <td style={{ ...td(), textAlign: 'center' }}><Toggle on={c.requiresEnhancedReview} onChange={(v) => onToggleCategory(c.id, 'requiresEnhancedReview', v)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Fees */}
          <h2 style={h2()}>Fees & limits</h2>
          <div style={{ ...card(), marginBottom: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
              <FeeField label="Platform fee (bps)" value={fees.platformFeeBps} onChange={(v) => setFees({ ...fees, platformFeeBps: v })} hint={`${(fees.platformFeeBps / 100).toFixed(2)}%`} />
              <FeeField label="Payment fee (bps)" value={fees.paymentFeeBps} onChange={(v) => setFees({ ...fees, paymentFeeBps: v })} hint={`${(fees.paymentFeeBps / 100).toFixed(2)}%`} />
              <FeeField label="Payment flat fee (kobo)" value={fees.paymentFeeFlatKobo} onChange={(v) => setFees({ ...fees, paymentFeeFlatKobo: v })} hint={`₦${(fees.paymentFeeFlatKobo / 100).toLocaleString('en-NG')}`} />
              <FeeField label="Min contribution (kobo)" value={fees.minContributionKobo} onChange={(v) => setFees({ ...fees, minContributionKobo: v })} hint={`₦${(fees.minContributionKobo / 100).toLocaleString('en-NG')}`} />
              <FeeField label="Max contribution (kobo)" value={fees.maxContributionKobo} onChange={(v) => setFees({ ...fees, maxContributionKobo: v })} hint={`₦${(fees.maxContributionKobo / 100).toLocaleString('en-NG')}`} />
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button onClick={saveFees} style={{ padding: '0.5rem 1.1rem', borderRadius: '0.375rem', border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Save fee settings</button>
            </div>
          </div>

          {/* Feature flags */}
          <h2 style={h2()}>Feature flags</h2>
          <div style={card()}>
            {flags.map((f, i, arr) => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 0', borderBottom: i < arr.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{f.label} {f.locked && <span style={{ fontSize: '0.7rem', color: '#dc2626', background: '#fee2e2', padding: '0.05rem 0.4rem', borderRadius: '0.25rem', marginLeft: '0.4rem' }}>LOCKED</span>}</div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{f.description}</div>
                </div>
                <Toggle on={f.enabled} disabled={f.locked} onChange={(v) => onToggleFlag(f.key, v)} />
              </div>
            ))}
            <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.75rem', marginBottom: 0 }}>Locked flags (e.g. investment crowdfunding) require regulatory approval before they can be enabled.</p>
          </div>
        </>
      )}
    </div>
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
        background: on ? '#16a34a' : '#d1d5db', position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, padding: 0,
      }}
    >
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: 9999, background: '#fff', transition: 'left 0.15s' }} />
    </button>
  );
}

function FeeField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint: string }) {
  return (
    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>
      {label}
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', boxSizing: 'border-box' }} />
      <span style={{ fontSize: '0.72rem', color: '#9ca3af', fontWeight: 400 }}>= {hint}</span>
    </label>
  );
}

const card = (): React.CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
const h2 = (): React.CSSProperties => ({ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' });
const th = (): React.CSSProperties => ({ padding: '0.5rem 0.75rem', fontWeight: 600 });
const td = (): React.CSSProperties => ({ padding: '0.6rem 0.75rem', color: '#374151' });
