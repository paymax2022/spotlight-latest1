'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPricing, updatePricing, getCommission, updateCommission } from '@/services/mobilityAdminService';
import type { PricingConfig, CommissionConfig } from '@/types/mobility';
import {
  PageHeader, MobilityTabs, Card, StateNote, AuditedNotice,
  btn, btnPrimary, btnDisabled, input, naira,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';
import { colors, thCell, tdCell } from '@/components/ui/vuexy';

type Draft = Record<string, Partial<PricingConfig>>;

const FIELDS: Array<{ key: keyof PricingConfig; label: string; kobo?: boolean; pct?: boolean; step?: number }> = [
  { key: 'baseFareKobo', label: 'Base fare', kobo: true },
  { key: 'perKmKobo', label: 'Per km', kobo: true },
  { key: 'perMinKobo', label: 'Per min', kobo: true },
  { key: 'minFareKobo', label: 'Min fare', kobo: true },
  { key: 'driverProfitFloorKobo', label: 'Driver profit floor', kobo: true },
  { key: 'fareFloorPct', label: 'Fare floor ×', step: 0.01 },
  { key: 'fareCeilingPct', label: 'Fare ceiling ×', step: 0.01 },
  { key: 'surgeMultiplier', label: 'Surge ×', step: 0.1 },
];

export default function MobilityPricingPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.pricingManage);

  const [pricing, setPricing] = useState<PricingConfig[]>([]);
  const [commission, setCommission] = useState<CommissionConfig[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [commDraft, setCommDraft] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [p, c] = await Promise.all([getPricing(), getCommission()]);
      setPricing(p); setCommission(c);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rowKey = (p: PricingConfig) => `${p.zone}::${p.serviceType}`;

  const setField = (p: PricingConfig, key: keyof PricingConfig, raw: string) => {
    const k = rowKey(p);
    const isKobo = FIELDS.find((f) => f.key === key)?.kobo;
    const num = raw === '' ? 0 : Number(raw);
    const value = isKobo ? Math.round(num * 100) : num; // money entered as major units → kobo
    setDraft((d) => ({ ...d, [k]: { ...d[k], [key]: value } }));
  };

  const fieldValue = (p: PricingConfig, key: keyof PricingConfig): number => {
    const k = rowKey(p);
    const v = draft[k]?.[key];
    return (typeof v === 'number' ? v : (p[key] as number));
  };

  const validate = (p: PricingConfig): string | null => {
    const floor = fieldValue(p, 'fareFloorPct');
    const ceil = fieldValue(p, 'fareCeilingPct');
    if (floor <= 0 || floor > 1) return 'Fare floor must be between 0 and 1.';
    if (ceil < 1) return 'Fare ceiling must be ≥ 1.';
    if (floor >= ceil) return 'Fare floor must be below ceiling.';
    if (fieldValue(p, 'surgeMultiplier') < 1) return 'Surge multiplier must be ≥ 1.';
    if (fieldValue(p, 'driverProfitFloorKobo') < 0 || fieldValue(p, 'minFareKobo') < 0) return 'Amounts cannot be negative.';
    return null;
  };

  const save = async (p: PricingConfig) => {
    const k = rowKey(p);
    const v = validate(p);
    if (v) { setError(v); return; }
    const patch = draft[k];
    if (!patch || Object.keys(patch).length === 0) { setError('No changes to save.'); return; }
    setSavingKey(k); setError(null); setMessage('');
    try {
      await updatePricing(p.zone, p.serviceType, patch);
      setMessage(`Pricing for ${p.zone} / ${p.serviceType} saved (audited).`);
      setDraft((d) => { const nd = { ...d }; delete nd[k]; return nd; });
      await load();
    } catch (e) { setError(`Save failed: ${String(e)}`); }
    finally { setSavingKey(null); }
  };

  const saveCommission = async (c: CommissionConfig) => {
    const pct = commDraft[c.tier] ?? c.driverPct;
    if (pct < 0 || pct > 100) { setError('Driver split must be 0–100%.'); return; }
    setSavingKey(`comm::${c.tier}`); setError(null); setMessage('');
    try {
      await updateCommission(c.tier, pct);
      setMessage(`Commission tier ${c.tier} saved (audited).`);
      setCommDraft((d) => { const nd = { ...d }; delete nd[c.tier]; return nd; });
      await load();
    } catch (e) { setError(`Save failed: ${String(e)}`); }
    finally { setSavingKey(null); }
  };

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Pricing & Commission"
        subtitle="Fare and commission configuration per zone / service type."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="pricing" />
      <AuditedNotice text="Pricing and commission changes require the mobility.pricing.manage role and follow maker rules." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}
      {!canManage && <StateNote kind="restricted">Read-only — your role cannot edit pricing or commission.</StateNote>}

      {loading && pricing.length === 0 ? <StateNote kind="loading">Loading config…</StateNote>
        : pricing.length === 0 ? <StateNote kind="empty">No pricing configs.</StateNote>
        : pricing.map((p) => {
          const k = rowKey(p);
          const dirty = !!draft[k] && Object.keys(draft[k]).length > 0;
          const valErr = dirty ? validate(p) : null;
          return (
            <Card key={k} title={`${p.zone} · ${p.serviceType}`} right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>v{p.version} · updated {new Date(p.updatedAt).toLocaleDateString()}</span>}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem' }}>
                {FIELDS.map((f) => {
                  const val = fieldValue(p, f.key);
                  const display = f.kobo ? (val / 100) : val;
                  return (
                    <label key={String(f.key)} style={{ fontSize: '0.78rem', fontWeight: 600, color: colors.text }}>
                      {f.label}{f.kobo ? ' (₦)' : ''}
                      <input
                        type="number"
                        step={f.kobo ? 0.01 : f.step ?? 1}
                        value={display}
                        disabled={!canManage}
                        onChange={(e) => setField(p, f.key, e.target.value)}
                        style={{ ...input(), marginTop: 4, background: canManage ? colors.card : colors.headBg }}
                      />
                    </label>
                  );
                })}
              </div>
              {valErr && <p style={{ color: colors.danger, fontSize: '0.8rem', marginTop: '0.5rem' }}>{valErr}</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem', gap: '0.5rem' }}>
                <button disabled={!canManage || !dirty || !!valErr || savingKey === k} style={!canManage || !dirty || !!valErr ? btnDisabled() : btnPrimary()} onClick={() => save(p)}>
                  {savingKey === k ? 'Saving…' : 'Save (audited)'}
                </button>
              </div>
            </Card>
          );
        })}

      <Card title="Commission tiers (driver / platform split)">
        {commission.length === 0 ? <StateNote kind="empty">No commission tiers.</StateNote> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Tier</th><th style={thCell}>Driver %</th><th style={thCell}>Platform %</th><th style={thCell}>Updated</th><th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {commission.map((c) => {
                const pct = commDraft[c.tier] ?? c.driverPct;
                const dirty = commDraft[c.tier] !== undefined && commDraft[c.tier] !== c.driverPct;
                return (
                  <tr key={c.tier} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={tdCell}><strong style={{ textTransform: 'capitalize' }}>{c.tier}</strong></td>
                    <td style={tdCell}>
                      <input type="number" min={0} max={100} value={pct} disabled={!canManage} onChange={(e) => setCommDraft((d) => ({ ...d, [c.tier]: Number(e.target.value) }))} style={{ ...input(), width: 90, background: canManage ? colors.card : colors.headBg }} />
                    </td>
                    <td style={tdCell}>{100 - pct}%</td>
                    <td style={tdCell}>{new Date(c.updatedAt).toLocaleDateString()}</td>
                    <td style={tdCell}>
                      <button disabled={!canManage || !dirty || savingKey === `comm::${c.tier}`} style={!canManage || !dirty ? btnDisabled() : btnPrimary()} onClick={() => saveCommission(c)}>
                        {savingKey === `comm::${c.tier}` ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.75rem' }}>
          Splits are applied server-side at trip settlement. Fares are stored and computed in integer kobo (e.g. {naira(320000)} = ₦3,200).
        </p>
      </Card>
    </div>
  );
}
