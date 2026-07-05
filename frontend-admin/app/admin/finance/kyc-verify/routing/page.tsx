'use client';

// AK6 — Provider routing rules.
// RBAC: finance.admin.kyc (role: Admin). Per check type: an ordered
// primary→fallback provider list, a pass/review threshold, and an enable toggle.
// Saving PUTs the rule so providers can be swapped with NO code change.

import { useCallback, useEffect, useState } from 'react';
import { listRoutingRules, updateRoutingRule } from '@/services/kycAdminService';
import type { KycRoutingRule, CheckType } from '@/types/kycAdmin';
import { CHECK_TYPE_LABELS } from '@/types/kycAdmin';
import { PageHeader, Card, btn, btnPrimary, btnDisabled, inputStyle, useKycPermissions } from '../_ui';

// Known KYC providers the ordered list can be composed from.
const KNOWN_PROVIDERS = ['smile_id', 'dojah', 'complyadvantage', 'prembly', 'youverify'];

function moveProvider(list: string[], index: number, dir: -1 | 1): string[] {
  const next = [...list];
  const target = index + dir;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function RuleEditor({ rule, canManage, onSaved }: { rule: KycRoutingRule; canManage: boolean; onSaved: (r: KycRoutingRule) => void }) {
  const [providers, setProviders] = useState<string[]>(rule.ordered_providers);
  const [threshold, setThreshold] = useState<number>(rule.threshold);
  const [enabled, setEnabled] = useState<boolean>(rule.enabled);
  const [addChoice, setAddChoice] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    JSON.stringify(providers) !== JSON.stringify(rule.ordered_providers) ||
    threshold !== rule.threshold ||
    enabled !== rule.enabled;

  const available = KNOWN_PROVIDERS.filter((p) => !providers.includes(p));

  async function save() {
    if (providers.length === 0) { setError('At least one provider is required.'); return; }
    if (threshold < 0 || threshold > 100) { setError('Threshold must be 0–100.'); return; }
    setBusy(true); setError(null); setSaved(false);
    try {
      const updated = await updateRoutingRule(rule.check_type, { ordered_providers: providers, threshold, enabled });
      setSaved(true);
      onSaved(updated);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Card title={CHECK_TYPE_LABELS[rule.check_type]} right={
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: '#374151' }}>
        <input type="checkbox" checked={enabled} disabled={!canManage} onChange={(e) => setEnabled(e.target.checked)} />
        {enabled ? 'Enabled' : 'Disabled'}
      </label>
    }>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: '0.5rem' }}>
        Provider order (primary → fallback)
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {providers.map((p, i) => (
          <li key={p} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', padding: '0.4rem 0.6rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: i === 0 ? '#15803d' : '#6b7280', minWidth: '4.5rem' }}>
              {i === 0 ? 'Primary' : `Fallback ${i}`}
            </span>
            <span style={{ flex: 1, fontSize: '0.85rem', textTransform: 'capitalize' }}>{p.replace(/_/g, ' ')}</span>
            <button disabled={!canManage || i === 0} onClick={() => setProviders(moveProvider(providers, i, -1))} style={!canManage || i === 0 ? btnDisabled() : btn()} title="Move up">↑</button>
            <button disabled={!canManage || i === providers.length - 1} onClick={() => setProviders(moveProvider(providers, i, 1))} style={!canManage || i === providers.length - 1 ? btnDisabled() : btn()} title="Move down">↓</button>
            <button disabled={!canManage || providers.length === 1} onClick={() => setProviders(providers.filter((x) => x !== p))} style={!canManage || providers.length === 1 ? btnDisabled() : btn()} title="Remove">✕</button>
          </li>
        ))}
      </ol>

      {available.length > 0 && canManage && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.6rem' }}>
          <select value={addChoice} onChange={(e) => setAddChoice(e.target.value)} style={{ ...inputStyle(), textTransform: 'capitalize' }}>
            <option value="">Add provider…</option>
            {available.map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
          </select>
          <button
            disabled={!addChoice}
            onClick={() => { if (addChoice) { setProviders([...providers, addChoice]); setAddChoice(''); } }}
            style={!addChoice ? btnDisabled() : btn()}
          >
            Add
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginTop: '0.9rem', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          Threshold (pass / review cut-off, %)
          <input
            type="number" min={0} max={100} value={threshold}
            disabled={!canManage}
            onChange={(e) => setThreshold(Number(e.target.value))}
            style={{ ...inputStyle(), width: '8rem' }}
          />
        </label>
        <button disabled={!canManage || !dirty || busy} onClick={() => void save()} style={!canManage || !dirty || busy ? btnDisabled() : btnPrimary()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && !dirty && <span style={{ fontSize: '0.8rem', color: '#15803d', fontWeight: 600 }}>Saved</span>}
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0.6rem 0 0' }}>{error}</p>}
    </Card>
  );
}

export default function KycRoutingRulesPage() {
  const { canManage } = useKycPermissions();
  const [rules, setRules] = useState<KycRoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRules(await listRoutingRules()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function onSaved(updated: KycRoutingRule) {
    setRules((prev) => prev.map((r) => (r.check_type === updated.check_type ? updated : r)));
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="KYC Provider Routing Rules"
        subtitle="Per check type: ordered primary→fallback providers, pass/review threshold, enable toggle. Saved via PUT — swap providers with no code change. RBAC: finance.admin.kyc (Admin)."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />

      {!canManage && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#b91c1c', marginBottom: '1.25rem' }}>
          You lack <code>finance.admin.kyc</code>. Rules are read-only. Backend RBAC is authoritative.
        </div>
      )}

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading routing rules…</p>
      ) : rules.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No routing rules configured.</p>
      ) : (
        rules.map((r: KycRoutingRule & { check_type: CheckType }) => (
          <RuleEditor key={r.check_type} rule={r} canManage={canManage} onSaved={onSaved} />
        ))
      )}
    </div>
  );
}
