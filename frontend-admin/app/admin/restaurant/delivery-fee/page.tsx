'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DeliveryConfigScope, DeliveryFeeConfig } from '@/types/deliveryFeeAdmin';
import {
  getDeliveryConfig,
  saveDeliveryConfig,
  computeFee,
  nairaLabel,
} from '@/services/deliveryFeeAdminService';
import { DELIVERY_FEE_PERMS, useDeliveryFeePermissions } from './_ui';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

const helper: CSSProperties = { fontSize: 11, color: colors.muted };

// A labelled number field. When `isKobo` is set, shows a ₦ helper (kobo/100).
function NumberField({
  label,
  value,
  onChange,
  isKobo,
  step,
  min,
  max,
  hint,
  invalid,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  isKobo?: boolean;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  invalid?: boolean;
}) {
  return (
    <label style={{ fontSize: 12, display: 'block' }}>
      <span style={{ color: colors.muted }}>{label}</span>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step ?? (isKobo ? 100 : 1)}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ borderColor: invalid ? colors.danger : colors.inputBorder, width: '100%' }}
      />
      <span style={helper}>
        {isKobo ? `= ₦${(value / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}` : ''}
        {isKobo && hint ? ' · ' : ''}
        {hint ?? ''}
      </span>
    </label>
  );
}

// A section card wrapping a grid of fields.
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title} style={{ marginTop: 12 }}>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0,1fr))', marginTop: 10 }}>
        {children}
      </div>
    </Card>
  );
}

// Validate the config: non-negative money/counts, multiplier>0, speed>0,
// road_factor>=1, hours 0-23. Returns a list of human-readable errors.
function validate(cfg: DeliveryFeeConfig): string[] {
  const errs: string[] = [];
  const nonNeg: [keyof DeliveryFeeConfig, string][] = [
    ['base_fee_kobo', 'Base fee'],
    ['free_distance_km', 'Free distance'],
    ['per_km_kobo', 'Per-km fee'],
    ['free_minutes', 'Free minutes'],
    ['per_minute_kobo', 'Per-minute fee'],
    ['night_fee_kobo', 'Night fee'],
    ['weather_fee_kobo', 'Weather fee'],
    ['handling_fee_kobo', 'Handling fee'],
    ['promo_discount_kobo', 'Promo discount'],
    ['min_fee_kobo', 'Min fee'],
    ['max_fee_kobo', 'Max fee'],
  ];
  for (const [k, label] of nonNeg) {
    if (!Number.isFinite(cfg[k] as number) || (cfg[k] as number) < 0) errs.push(`${label} must be ≥ 0.`);
  }
  if (!(cfg.demand_multiplier > 0)) errs.push('Demand multiplier must be > 0.');
  if (!(cfg.avg_speed_kmph > 0)) errs.push('Average speed must be > 0.');
  if (!(cfg.road_factor >= 1)) errs.push('Road factor must be ≥ 1.');
  for (const [k, label] of [
    ['night_start_hour', 'Night start hour'],
    ['night_end_hour', 'Night end hour'],
  ] as [keyof DeliveryFeeConfig, string][]) {
    const v = cfg[k] as number;
    if (!Number.isInteger(v) || v < 0 || v > 23) errs.push(`${label} must be an integer 0–23.`);
  }
  if (cfg.max_fee_kobo > 0 && cfg.max_fee_kobo < cfg.min_fee_kobo)
    errs.push('Max fee (cap) must be 0 (no cap) or ≥ min fee.');
  return errs;
}

const scopeLabel: Record<DeliveryConfigScope, string> = {
  restaurant: 'Per-restaurant override',
  global: 'Global default',
  default: 'Hard-coded fallback',
};

export default function DeliveryFeeConfigPage() {
  const { can } = useDeliveryFeePermissions();
  const canEdit = can(DELIVERY_FEE_PERMS.pricing);

  const [restaurantId, setRestaurantId] = useState('');
  const [loadedScope, setLoadedScope] = useState<DeliveryConfigScope | null>(null);
  const [cfg, setCfg] = useState<DeliveryFeeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // live-preview inputs
  const [sampleDistance, setSampleDistance] = useState(6);
  const [sampleHour, setSampleHour] = useState(13);

  const load = useCallback(async (rid?: string) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await getDeliveryConfig(rid);
      setCfg(res.config);
      setLoadedScope(res.scope);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (k: keyof DeliveryFeeConfig) => (n: number) =>
    setCfg((c) => (c ? { ...c, [k]: n } : c));

  const errors = useMemo(() => (cfg ? validate(cfg) : []), [cfg]);
  const preview = useMemo(
    () => (cfg ? computeFee(sampleDistance, sampleHour, cfg) : null),
    [cfg, sampleDistance, sampleHour],
  );

  const onLoadRestaurant = () => void load(restaurantId);

  const onSave = async () => {
    if (!cfg) return;
    if (errors.length) {
      setError(`Fix ${errors.length} validation error(s) before saving.`);
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const target = restaurantId.trim() ? restaurantId.trim() : null;
      const res = await saveDeliveryConfig({ restaurant_id: target, ...cfg });
      setLoadedScope(res.scope);
      setMessage(
        `Saved ${target ? `override for restaurant ${target}` : 'global default config'}.`,
      );
    } catch (e) {
      setError(`Save failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Delivery Fee Configuration"
        subtitle="Configure the delivery-fee formula. By default this edits the global default config; enter a restaurant ID to load/save a per-restaurant override. All money fields are integer kobo (₦ = kobo ÷ 100). Writes are role-gated (RBAC restaurant.admin.pricing) and audited."
      />

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      {/* Scope / restaurant loader */}
      <Card style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>Scope:</strong>
        <span style={{ fontSize: 12, color: colors.muted }}>
          {loadedScope ? scopeLabel[loadedScope] : '—'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: colors.muted }}>restaurant_id</span>
        <Input
          placeholder="(blank = global default)"
          value={restaurantId}
          onChange={(e) => setRestaurantId(e.target.value)}
          style={{ width: 240 }}
        />
        <Button variant="outline" onClick={onLoadRestaurant} disabled={loading}>
          {loading ? '…' : 'Load'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setRestaurantId('');
            void load();
          }}
          disabled={loading}
        >
          Load global
        </Button>
      </Card>

      {loading || !cfg ? (
        <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p>
      ) : (
        <>
          {/* ── Base & distance ── */}
          <Section title="Base & distance">
            <NumberField label="base_fee_kobo" value={cfg.base_fee_kobo} onChange={set('base_fee_kobo')} isKobo invalid={cfg.base_fee_kobo < 0} />
            <NumberField label="free_distance_km" value={cfg.free_distance_km} onChange={set('free_distance_km')} hint="km included" invalid={cfg.free_distance_km < 0} />
            <NumberField label="per_km_kobo" value={cfg.per_km_kobo} onChange={set('per_km_kobo')} isKobo hint="after free km" invalid={cfg.per_km_kobo < 0} />
          </Section>

          {/* ── Time ── */}
          <Section title="Time">
            <NumberField label="free_minutes" value={cfg.free_minutes} onChange={set('free_minutes')} hint="min included" invalid={cfg.free_minutes < 0} />
            <NumberField label="per_minute_kobo" value={cfg.per_minute_kobo} onChange={set('per_minute_kobo')} isKobo hint="after free min" invalid={cfg.per_minute_kobo < 0} />
          </Section>

          {/* ── Demand / surge ── */}
          <Section title="Demand / surge">
            <NumberField label="demand_multiplier" value={cfg.demand_multiplier} onChange={set('demand_multiplier')} step={0.05} min={0} hint="1.000 = no surge (>0)" invalid={!(cfg.demand_multiplier > 0)} />
          </Section>

          {/* ── Surcharges ── */}
          <Section title="Surcharges (night window · weather · handling)">
            <NumberField label="night_fee_kobo" value={cfg.night_fee_kobo} onChange={set('night_fee_kobo')} isKobo invalid={cfg.night_fee_kobo < 0} />
            <NumberField label="night_start_hour" value={cfg.night_start_hour} onChange={set('night_start_hour')} min={0} max={23} hint="0–23" invalid={cfg.night_start_hour < 0 || cfg.night_start_hour > 23} />
            <NumberField label="night_end_hour" value={cfg.night_end_hour} onChange={set('night_end_hour')} min={0} max={23} hint="0–23 (wraps midnight)" invalid={cfg.night_end_hour < 0 || cfg.night_end_hour > 23} />
            <NumberField label="weather_fee_kobo" value={cfg.weather_fee_kobo} onChange={set('weather_fee_kobo')} isKobo invalid={cfg.weather_fee_kobo < 0} />
            <NumberField label="handling_fee_kobo" value={cfg.handling_fee_kobo} onChange={set('handling_fee_kobo')} isKobo invalid={cfg.handling_fee_kobo < 0} />
          </Section>

          {/* ── Promo ── */}
          <Section title="Promo">
            <NumberField label="promo_discount_kobo" value={cfg.promo_discount_kobo} onChange={set('promo_discount_kobo')} isKobo hint="subtracted from fee" invalid={cfg.promo_discount_kobo < 0} />
          </Section>

          {/* ── ETA / road ── */}
          <Section title="ETA / road">
            <NumberField label="avg_speed_kmph" value={cfg.avg_speed_kmph} onChange={set('avg_speed_kmph')} min={0} hint="for ETA (>0)" invalid={!(cfg.avg_speed_kmph > 0)} />
            <NumberField label="road_factor" value={cfg.road_factor} onChange={set('road_factor')} step={0.05} min={1} hint="straight-line→road (≥1)" invalid={!(cfg.road_factor >= 1)} />
          </Section>

          {/* ── Floor / cap ── */}
          <Section title="Floor / cap">
            <NumberField label="min_fee_kobo" value={cfg.min_fee_kobo} onChange={set('min_fee_kobo')} isKobo hint="floor" invalid={cfg.min_fee_kobo < 0} />
            <NumberField label="max_fee_kobo" value={cfg.max_fee_kobo} onChange={set('max_fee_kobo')} isKobo hint="0 = no cap" invalid={cfg.max_fee_kobo < 0} />
          </Section>

          {/* ── Active ── */}
          <Card title="Active" style={{ marginTop: 12 }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input type="checkbox" checked={cfg.active} onChange={(e) => setCfg((c) => (c ? { ...c, active: e.target.checked } : c))} />
              Config is active (enabled for fee quoting)
            </label>
          </Card>

          {/* ── Live preview ── */}
          <Card title="Live preview" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, marginBottom: 10 }}>
              <label style={{ fontSize: 12 }}>
                <span style={{ color: colors.muted }}>sample distance (km)</span>
                <Input type="number" value={sampleDistance} step={0.5} min={0} onChange={(e) => setSampleDistance(Number(e.target.value))} style={{ width: 110 }} />
              </label>
              <label style={{ fontSize: 12 }}>
                <span style={{ color: colors.muted }}>delivery hour (0–23)</span>
                <Input type="number" value={sampleHour} min={0} max={23} onChange={(e) => setSampleHour(Number(e.target.value))} style={{ width: 110 }} />
              </label>
              {preview ? (
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={helper}>computed ETA ≈ {preview.etaMinutes.toFixed(1)} min</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: colors.success }}>{nairaLabel(preview.fee)}</div>
                  {preview.clamped ? (
                    <div style={{ fontSize: 11, color: colors.warning }}>clamped to {preview.clamped} ({nairaLabel(preview.clamped === 'min' ? cfg.min_fee_kobo : cfg.max_fee_kobo)})</div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {preview ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {([
                    ['Base', preview.base],
                    [`Extra distance (${Math.max(0, sampleDistance - cfg.free_distance_km).toFixed(2)} km × per-km)`, preview.extraDistance],
                    [`Extra time (${Math.max(0, preview.etaMinutes - cfg.free_minutes).toFixed(1)} min × per-min)`, preview.extraTime],
                    [`= Pre-multiplier subtotal`, preview.preMultiplier],
                    [`× Demand ${cfg.demand_multiplier} → after-multiplier`, preview.afterMultiplier],
                    ['+ Night surcharge', preview.night],
                    ['+ Weather', preview.weather],
                    ['+ Handling', preview.handling],
                    ['− Promo discount', -preview.promo],
                    ['= Raw fee (before clamp)', preview.rawFee],
                    ['= Final fee (after clamp)', preview.fee],
                  ] as [string, number][]).map(([label, val], i, arr) => (
                    <tr key={label} style={{ borderTop: i === arr.length - 1 ? `1px solid ${colors.border}` : `1px solid ${colors.border}`, fontWeight: i === arr.length - 1 ? 700 : 400 }}>
                      <td style={{ padding: '4px 6px', color: colors.muted }}>{label}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', color: colors.text }}>{nairaLabel(val)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <p style={{ ...helper, marginTop: 8 }}>
              Preview uses the same formula as the backend: round((base + extra-distance + extra-time) × demand) + night + weather + handling − promo, clamped to [min, max].
            </p>
          </Card>

          {/* ── Validation + Save ── */}
          {errors.length ? (
            <Card style={{ marginTop: 12, borderColor: colors.danger }}>
              <p style={{ color: colors.danger, fontSize: 12, margin: 0, fontWeight: 600 }}>Validation errors:</p>
              <ul style={{ fontSize: 12, color: colors.danger, margin: '6px 0 0', paddingLeft: 18 }}>
                {errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </Card>
          ) : null}

          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button
              variant="primary"
              onClick={onSave}
              disabled={busy || !canEdit || errors.length > 0}
              title={!canEdit ? 'Requires restaurant.admin.pricing' : errors.length ? 'Fix validation errors first' : 'Save config (PUT)'}
            >
              {busy ? 'Saving…' : restaurantId.trim() ? 'Save restaurant override' : 'Save global default'}
            </Button>
            {!canEdit ? <span style={helper}>You lack <code>restaurant.admin.pricing</code> — Save is disabled. Server still enforces.</span> : null}
          </div>
        </>
      )}
    </Page>
  );
}
