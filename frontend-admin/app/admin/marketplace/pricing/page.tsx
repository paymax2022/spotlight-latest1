'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listBoostPackages, upsertBoostPackage, getCommissionConfig, setCommissionConfig,
  listDiscountCodes, createDiscountCode, setDiscountCodeActive,
  listFeaturedSlots, setFeaturedSlotCap, getBoostDailyRate, setBoostDailyRate, formatKobo,
} from '@/services/marketplaceAdminService';
import type {
  MktBoostPackage, MktBoostDailyRate, MktCommissionConfig, MktDiscountCode, MktDiscountKind, MktFeaturedSlotConfig,
} from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, StatusBadge, DisclosureNote, AuditNote, PermissionBanner,
  btn, btnPrimary, btnDanger, btnDisabled, input, th, td, select, label as lbl, fmtDate,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

const nairaToKobo = (n: string) => Math.round((Number(n.replace(/[^0-9.]/g, '')) || 0) * 100);

export default function PricingPage() {
  const { allowed: canEdit } = useMarketplacePermission(MARKETPLACE_PERMS.pricing);
  const [packages, setPackages] = useState<MktBoostPackage[]>([]);
  const [dailyRate, setDailyRateState] = useState<MktBoostDailyRate | null>(null);
  const [commission, setCommission] = useState<MktCommissionConfig | null>(null);
  const [discounts, setDiscounts] = useState<MktDiscountCode[]>([]);
  const [slots, setSlots] = useState<MktFeaturedSlotConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [pk, dr, cm, dc, sl] = await Promise.all([listBoostPackages(), getBoostDailyRate(), getCommissionConfig(), listDiscountCodes(), listFeaturedSlots()]);
      setPackages(pk); setDailyRateState(dr); setCommission(cm); setDiscounts(dc); setSlots(sl);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setMsg(null); setError(null);
    try { await fn(); } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — Pricing & Monetisation"
        subtitle="Boost packages, platform commission, discount codes, and featured-slot inventory."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <MarketplaceTabs active="pricing" />
      <DisclosureNote>
        Config changes apply to <strong>new purchases only</strong> — existing active boosts keep their bought terms (ADM-001).
        Every change requires a reason_code and is audited. Per-category commission overrides live in <strong>Taxonomy</strong>.
      </DisclosureNote>

      {!canEdit && <PermissionBanner permission={MARKETPLACE_PERMS.pricing} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
        <>
          <BoostPackagesCard packages={packages} canEdit={canEdit} busy={busy}
            onSave={(pkg, reason) => run(`pkg:${pkg.tier}`, async () => { const s = await upsertBoostPackage(pkg, reason); setPackages((ps) => ps.map((p) => (p.tier === s.tier ? s : p))); setMsg(`Boost package “${s.label}” saved. Audit entry recorded.`); })}
          />
          {dailyRate && (
            <DailyRateCard rate={dailyRate} canEdit={canEdit} busy={busy === 'daily-rate'}
              onSave={(kobo, reason) => run('daily-rate', async () => { const r = await setBoostDailyRate(kobo, reason); setDailyRateState(r); setMsg(`Custom-boost daily rate set to ${formatKobo(r.daily_rate_kobo)}/day. Audit entry recorded.`); })}
            />
          )}
          {commission && (
            <CommissionCard config={commission} canEdit={canEdit} busy={busy === 'commission'}
              onSave={(bps, reason) => run('commission', async () => { const c = await setCommissionConfig(bps, reason); setCommission(c); setMsg('Commission default saved. Audit entry recorded.'); })}
            />
          )}
          <DiscountsCard discounts={discounts} canEdit={canEdit} busy={busy}
            onCreate={(inp) => run('dsc:create', async () => { const d = await createDiscountCode(inp); setDiscounts((ds) => [d, ...ds]); setMsg(`Discount code ${d.code} created. Audit entry recorded.`); })}
            onToggle={(d, reason) => run(`dsc:${d.id}`, async () => { const u = await setDiscountCodeActive(d.id, !d.is_active, reason); setDiscounts((ds) => ds.map((x) => (x.id === u.id ? u : x))); setMsg(`Discount code ${u.code} ${u.is_active ? 'enabled' : 'disabled'}. Audit entry recorded.`); })}
          />
          <FeaturedSlotsCard slots={slots} canEdit={canEdit} busy={busy}
            onSave={(surface, max, reason) => run(`slot:${surface}`, async () => { const s = await setFeaturedSlotCap(surface, max, reason); setSlots((ss) => ss.map((x) => (x.surface === s.surface ? s : x))); setMsg(`Slot inventory for “${s.label}” set to ${s.max_slots}. Audit entry recorded.`); })}
          />
        </>
      )}
    </div>
  );
}

// ── Boost packages ───────────────────────────────────────────────────────────
function BoostPackagesCard({ packages, canEdit, busy, onSave }: { packages: MktBoostPackage[]; canEdit: boolean; busy: string | null; onSave: (pkg: MktBoostPackage, reason: string) => void }) {
  const [draft, setDraft] = useState<Record<string, { price: string; duration: string; weight: string; active: boolean; reason: string }>>({});
  const rowOf = (p: MktBoostPackage) => draft[p.tier] ?? { price: String(p.price_kobo / 100), duration: String(p.duration_days), weight: String(p.weight), active: p.is_active, reason: '' };
  const patch = (tier: string, base: MktBoostPackage, k: string, v: string | boolean) => setDraft((d) => ({ ...d, [tier]: { ...rowOf(base), [k]: v } }));

  return (
    <Card title="Boost packages (MO-002)">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th()}>Tier</th><th style={th()}>Price (₦)</th><th style={th()}>Duration (days)</th><th style={th()}>Search weight</th><th style={th()}>Active</th><th style={th()}>reason</th><th style={th()}></th></tr></thead>
        <tbody>
          {packages.map((p) => {
            const r = rowOf(p);
            return (
              <tr key={p.tier}>
                <td style={td()}><strong>{p.label}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}><code>{p.tier}</code></div></td>
                <td style={td()}><input style={{ ...input(), width: 110 }} value={r.price} onChange={(e) => patch(p.tier, p, 'price', e.target.value)} /></td>
                <td style={td()}><input style={{ ...input(), width: 70 }} value={r.duration} onChange={(e) => patch(p.tier, p, 'duration', e.target.value)} /></td>
                <td style={td()}><input style={{ ...input(), width: 70 }} value={r.weight} onChange={(e) => patch(p.tier, p, 'weight', e.target.value)} /></td>
                <td style={td()}><input type="checkbox" checked={r.active} onChange={(e) => patch(p.tier, p, 'active', e.target.checked)} /></td>
                <td style={td()}><input style={{ ...input(), width: 120 }} value={r.reason} onChange={(e) => patch(p.tier, p, 'reason', e.target.value)} placeholder="reason_code" /></td>
                <td style={td()}>
                  <button
                    style={canEdit && r.reason.trim() && busy !== `pkg:${p.tier}` ? btnPrimary() : btnDisabled()}
                    disabled={!canEdit || !r.reason.trim() || busy === `pkg:${p.tier}`}
                    onClick={() => onSave({ tier: p.tier, label: p.label, price_kobo: nairaToKobo(r.price), duration_days: Number(r.duration), weight: Number(r.weight), is_active: r.active }, r.reason.trim())}
                  >{busy === `pkg:${p.tier}` ? '…' : 'Save'}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// ── Custom-range daily rate (start date+time / end date+time boosts) ─────────
function DailyRateCard({ rate, canEdit, busy, onSave }: { rate: MktBoostDailyRate; canEdit: boolean; busy: boolean; onSave: (dailyRateKobo: number, reason: string) => void }) {
  const [naira, setNaira] = useState(String(rate.daily_rate_kobo / 100));
  const [reason, setReason] = useState('');
  return (
    <Card title="Custom boost daily rate (MO-002)">
      <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 0, marginBottom: '0.75rem' }}>
        Prices a buyer&apos;s own start-date+time / end-date+time boost on the mobile Boost screen — duration (rounded up to whole days) × this rate.
      </p>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={lbl()}>₦ per day</label>
          <input style={{ ...input(), width: 120 }} value={naira} onChange={(e) => setNaira(e.target.value)} placeholder="e.g. 100" />
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={lbl()}>reason_code</label>
          <input style={input()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. q3_boost_rate_change" />
        </div>
        <button
          style={canEdit && reason.trim() && !busy ? btnPrimary() : btnDisabled()}
          disabled={!canEdit || !reason.trim() || busy}
          onClick={() => onSave(nairaToKobo(naira), reason.trim())}
        >{busy ? '…' : 'Save'}</button>
      </div>
      <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.6rem' }}>
        Last changed {rate.updated_at ? fmtDate(rate.updated_at) : '—'}{rate.updated_by ? ` by ${rate.updated_by}` : ''}.
      </div>
    </Card>
  );
}

// ── Commission ───────────────────────────────────────────────────────────────
function CommissionCard({ config, canEdit, busy, onSave }: { config: MktCommissionConfig; canEdit: boolean; busy: boolean; onSave: (bps: number, reason: string) => void }) {
  const [bps, setBps] = useState(String(config.default_bps));
  const [reason, setReason] = useState('');
  return (
    <Card title="Platform commission (ADM-002)">
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={lbl()}>Default take-rate (bps)</label>
          <input style={{ ...input(), width: 120 }} type="number" min={0} max={10000} value={bps} onChange={(e) => setBps(e.target.value)} />
          <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>{(Number(bps) / 100).toFixed(2)}% · per-category overrides in Taxonomy</div>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={lbl()}>reason_code</label>
          <input style={input()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. q3_take_rate_change" />
        </div>
        <button style={canEdit && reason.trim() && !busy ? btnPrimary() : btnDisabled()} disabled={!canEdit || !reason.trim() || busy} onClick={() => onSave(Number(bps), reason.trim())}>{busy ? '…' : 'Save'}</button>
      </div>
      <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.6rem' }}>Last changed {config.updated_at ? fmtDate(config.updated_at) : '—'}{config.updated_by ? ` by ${config.updated_by}` : ''}.</div>
    </Card>
  );
}

// ── Discount codes ───────────────────────────────────────────────────────────
function DiscountsCard({ discounts, canEdit, busy, onCreate, onToggle }: {
  discounts: MktDiscountCode[]; canEdit: boolean; busy: string | null;
  onCreate: (inp: { code: string; kind: MktDiscountKind; value: number; applies_to: 'boost' | 'listing_fee'; max_redemptions: number | null; valid_until: string | null; reason_code: string }) => void;
  onToggle: (d: MktDiscountCode, reason: string) => void;
}) {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<MktDiscountKind>('percent');
  const [value, setValue] = useState('');
  const [appliesTo, setAppliesTo] = useState<'boost' | 'listing_fee'>('boost');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [reason, setReason] = useState('');
  const [toggleReason, setToggleReason] = useState<Record<string, string>>({});

  const codeValid = /^[A-Z0-9_-]{3,24}$/.test(code);
  const valueNum = kind === 'fixed' ? nairaToKobo(value) : Number(value);
  const canCreate = canEdit && codeValid && valueNum > 0 && reason.trim();

  return (
    <Card title="Discount codes (MO-011)">
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
        <thead><tr><th style={th()}>Code</th><th style={th()}>Discount</th><th style={th()}>Applies to</th><th style={th()}>Redeemed</th><th style={th()}>Valid until</th><th style={th()}>Status</th><th style={th()}>Action</th></tr></thead>
        <tbody>
          {discounts.map((d) => (
            <tr key={d.id}>
              <td style={td()}><code style={{ fontWeight: 700 }}>{d.code}</code></td>
              <td style={td()}>{d.kind === 'percent' ? `${d.value}%` : formatKobo(d.value)}</td>
              <td style={td()}>{d.applies_to.replace(/_/g, ' ')}</td>
              <td style={td()}>{d.redeemed_count.toLocaleString('en-NG')}{d.max_redemptions != null ? ` / ${d.max_redemptions.toLocaleString('en-NG')}` : ''}</td>
              <td style={td()}>{d.valid_until ? fmtDate(d.valid_until) : 'no expiry'}</td>
              <td style={td()}><StatusBadge status={d.is_active ? 'active' : 'paused'} /></td>
              <td style={td()}>
                <div style={{ display: 'flex', gap: '0.35rem', minWidth: 190 }}>
                  <input style={{ ...input(), width: 90 }} placeholder="reason" value={toggleReason[d.id] ?? ''} onChange={(e) => setToggleReason((s) => ({ ...s, [d.id]: e.target.value }))} />
                  <button
                    style={canEdit && (toggleReason[d.id] ?? '').trim() && busy !== `dsc:${d.id}` ? (d.is_active ? btnDanger() : btnPrimary('#15803d')) : btnDisabled()}
                    disabled={!canEdit || !(toggleReason[d.id] ?? '').trim() || busy === `dsc:${d.id}`}
                    onClick={() => onToggle(d, (toggleReason[d.id] ?? '').trim())}
                  >{d.is_active ? 'Disable' : 'Enable'}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '0.9rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.6rem' }}>New code</div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label style={lbl()}>Code</label><input style={{ ...input(), width: 140 }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BOOST50" /></div>
          <div><label style={lbl()}>Kind</label><select style={select()} value={kind} onChange={(e) => setKind(e.target.value as MktDiscountKind)}><option value="percent">percent</option><option value="fixed">fixed (₦)</option></select></div>
          <div><label style={lbl()}>{kind === 'percent' ? 'Percent (1–100)' : 'Amount (₦)'}</label><input style={{ ...input(), width: 110 }} value={value} onChange={(e) => setValue(e.target.value)} /></div>
          <div><label style={lbl()}>Applies to</label><select style={select()} value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as 'boost' | 'listing_fee')}><option value="boost">boost</option><option value="listing_fee">listing fee</option></select></div>
          <div><label style={lbl()}>Max redemptions</label><input style={{ ...input(), width: 120 }} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="unlimited" /></div>
          <div style={{ flex: 1, minWidth: 140 }}><label style={lbl()}>reason_code</label><input style={input()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="promo_campaign" /></div>
          <button
            style={canCreate && busy !== 'dsc:create' ? btnPrimary() : btnDisabled()}
            disabled={!canCreate || busy === 'dsc:create'}
            onClick={() => onCreate({ code, kind, value: valueNum, applies_to: appliesTo, max_redemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null, valid_until: null, reason_code: reason.trim() })}
          >{busy === 'dsc:create' ? '…' : 'Create'}</button>
        </div>
        {code && !codeValid ? <p style={{ color: '#dc2626', fontSize: '0.78rem', marginTop: '0.4rem' }}>Code must be 3–24 chars: A–Z, 0–9, dash, underscore.</p> : null}
      </div>
    </Card>
  );
}

// ── Featured slots ───────────────────────────────────────────────────────────
function FeaturedSlotsCard({ slots, canEdit, busy, onSave }: { slots: MktFeaturedSlotConfig[]; canEdit: boolean; busy: string | null; onSave: (surface: string, max: number, reason: string) => void }) {
  const [draft, setDraft] = useState<Record<string, { max: string; reason: string }>>({});
  const rowOf = (s: MktFeaturedSlotConfig) => draft[s.surface] ?? { max: String(s.max_slots), reason: '' };
  const patch = (surface: string, base: MktFeaturedSlotConfig, k: string, v: string) => setDraft((d) => ({ ...d, [surface]: { ...rowOf(base), [k]: v } }));

  return (
    <Card title="Featured-slot inventory (MO-016)">
      <p style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: 0 }}>The max concurrently-featured listings each surface renders. Keeping this scarce protects the value of a boost.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th()}>Surface</th><th style={th()}>Filled / cap</th><th style={th()}>New cap</th><th style={th()}>reason</th><th style={th()}></th></tr></thead>
        <tbody>
          {slots.map((s) => {
            const r = rowOf(s);
            const full = s.filled_slots >= s.max_slots;
            return (
              <tr key={s.surface}>
                <td style={td()}>{s.label}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}><code>{s.surface}</code></div></td>
                <td style={td()}><span style={{ color: full ? '#9a3412' : '#374151', fontWeight: 600 }}>{s.filled_slots} / {s.max_slots}</span>{full ? <span style={{ fontSize: '0.7rem', color: '#9a3412' }}> · full</span> : null}</td>
                <td style={td()}><input style={{ ...input(), width: 70 }} value={r.max} onChange={(e) => patch(s.surface, s, 'max', e.target.value)} /></td>
                <td style={td()}><input style={{ ...input(), width: 120 }} value={r.reason} onChange={(e) => patch(s.surface, s, 'reason', e.target.value)} placeholder="reason_code" /></td>
                <td style={td()}>
                  <button
                    style={canEdit && r.reason.trim() && busy !== `slot:${s.surface}` ? btnPrimary() : btnDisabled()}
                    disabled={!canEdit || !r.reason.trim() || busy === `slot:${s.surface}`}
                    onClick={() => onSave(s.surface, Number(r.max), r.reason.trim())}
                  >{busy === `slot:${s.surface}` ? '…' : 'Save'}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
