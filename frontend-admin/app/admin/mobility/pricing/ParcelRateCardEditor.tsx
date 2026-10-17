'use client';

// Parcel rate card editor: one cell per size × speed, each a fare multiplier
// (integer basis points, 10000 = 1.0×) applied to the parcel distance/time base
// above, plus a minimum fare (integer kobo). Every save is audited server-side
// with the reason. An edit only reaches the NEXT estimate — a card checkout
// already quoted keeps the cell it priced from.

import { useCallback, useEffect, useState } from 'react';
import { getParcelRateCard, updateParcelRateCell } from '@/services/mobilityAdminService';
import type { ParcelRateCell, ParcelRateCellPatch, ParcelSize, ParcelSpeed } from '@/types/mobility';
import { Card, StateNote, btn, btnPrimary, btnDisabled, input } from '../_ui';
import { colors, thCell, tdCell, tint } from '@/components/ui/vuexy';

const SIZES: Array<{ key: ParcelSize; label: string }> = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
];
const SPEEDS: Array<{ key: ParcelSpeed; label: string; hint?: string }> = [
  { key: 'standard', label: 'Standard' },
  { key: 'express', label: 'Express' },
  { key: 'same_day', label: 'Priority', hint: 'same_day' },
  { key: 'scheduled', label: 'Scheduled', hint: 'not offered in the app' },
];

// Server bounds (backend/internal/transport/parcel_rate_card_admin.go).
const MIN_BPS = 1000;
const MAX_BPS = 100000;
const MAX_MIN_FARE_KOBO = 100_000_000;
const MAX_REASON = 500;

export const multiplierLabel = (bps: number) => `${Number((bps / 10000).toFixed(4))}×`;
const nairaLabel = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

type Edit = { size: ParcelSize; speed: ParcelSpeed; multiplier: string; minFare: string; active: boolean; reason: string };

// Parse the form into integer bps / kobo, or explain why it cannot be saved.
// Decimal places are capped instead of rounded so nothing is silently changed.
function parseEdit(e: Edit): { patch: { multiplierBps: number; minFareKobo: number }; error: null } | { patch: null; error: string } {
  if (!/^\d+(\.\d{1,4})?$/.test(e.multiplier.trim())) return { patch: null, error: 'Multiplier must be a number like 1.5 (up to 4 decimals).' };
  if (!/^\d+(\.\d{1,2})?$/.test(e.minFare.trim())) return { patch: null, error: 'Minimum fare must be naira, up to 2 decimals.' };
  const multiplierBps = Math.round(Number(e.multiplier) * 10000);
  const minFareKobo = Math.round(Number(e.minFare) * 100);
  if (multiplierBps < MIN_BPS || multiplierBps > MAX_BPS) return { patch: null, error: 'Multiplier must be between 0.1× and 10×.' };
  if (minFareKobo > MAX_MIN_FARE_KOBO) return { patch: null, error: 'Minimum fare cannot exceed ₦1,000,000.' };
  if (!e.reason.trim()) return { patch: null, error: 'A reason is required — it is written to the audit log.' };
  if (e.reason.trim().length > MAX_REASON) return { patch: null, error: `Reason must be at most ${MAX_REASON} characters.` };
  return { patch: { multiplierBps, minFareKobo }, error: null };
}

export default function ParcelRateCardEditor({ canManage, zone = 'default' }: { canManage: boolean; zone?: string }) {
  const [cells, setCells] = useState<ParcelRateCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setCells(await getParcelRateCard(zone)); }
    catch (e) { setError(`Could not load the rate card: ${String(e)}`); }
    finally { setLoading(false); }
  }, [zone]);

  useEffect(() => { void load(); }, [load]);

  const cellFor = (size: ParcelSize, speed: ParcelSpeed) => cells.find((c) => c.size === size && c.speed === speed);

  const open = (c: ParcelRateCell) => {
    setMessage(''); setError(null);
    setEdit({
      size: c.size, speed: c.speed,
      multiplier: String(c.multiplierBps / 10000),
      minFare: String(c.minFareKobo / 100),
      active: c.active, reason: '',
    });
  };

  const current = edit ? cellFor(edit.size, edit.speed) : undefined;
  const parsed = edit ? parseEdit(edit) : null;
  // Send only what changed, so the audit row shows the real edit.
  const changes: ParcelRateCellPatch = {};
  if (edit && current && parsed?.patch) {
    if (parsed.patch.multiplierBps !== current.multiplierBps) changes.multiplierBps = parsed.patch.multiplierBps;
    if (parsed.patch.minFareKobo !== current.minFareKobo) changes.minFareKobo = parsed.patch.minFareKobo;
    if (edit.active !== current.active) changes.active = edit.active;
  }
  const hasChanges = Object.keys(changes).length > 0;
  const canSave = canManage && !!parsed?.patch && hasChanges && !saving;

  const save = async () => {
    if (!edit || !canSave) return;
    setSaving(true); setError(null); setMessage('');
    try {
      await updateParcelRateCell(zone, edit.size, edit.speed, changes, edit.reason.trim());
      const label = SPEEDS.find((s) => s.key === edit.speed)?.label ?? edit.speed;
      setMessage(`${SIZES.find((s) => s.key === edit.size)?.label ?? edit.size} · ${label} saved (audited). Applies to the next parcel estimate.`);
      setEdit(null);
      await load();
    } catch (e) { setError(`Save failed: ${String(e instanceof Error ? e.message : e)}`); }
    finally { setSaving(false); }
  };

  return (
    <Card
      title={`Parcel rate card · ${zone}`}
      right={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
    >
      <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0 0 0.75rem' }}>
        Each cell multiplies the <strong>parcel</strong> distance/time fare above and sets that option&apos;s minimum fare.
        Used when <code>FEATURE_PARCEL_RATE_CARD_ENABLED</code> is on. Changes apply to new estimates only — checkouts already quoted keep their price.
      </p>
      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      {loading && cells.length === 0 ? <StateNote kind="loading">Loading rate card…</StateNote>
        : cells.length === 0 ? <StateNote kind="empty">No rate-card cells for zone “{zone}”. Parcels in this zone price from the default zone.</StateNote>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: 560, tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                  <th style={thCell}>Size \ Speed</th>
                  {SPEEDS.map((s) => (
                    <th key={s.key} style={thCell}>
                      {s.label}
                      {s.hint && <span style={{ display: 'block', fontWeight: 400, fontSize: '0.7rem' }}>{s.hint}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SIZES.map((size) => (
                  <tr key={size.key} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={tdCell}><strong>{size.label}</strong></td>
                    {SPEEDS.map((speed) => {
                      const c = cellFor(size.key, speed.key);
                      if (!c) return <td key={speed.key} style={{ ...tdCell, color: colors.muted }}>— not set</td>;
                      const selected = edit?.size === c.size && edit?.speed === c.speed;
                      return (
                        <td key={speed.key} style={tdCell}>
                          <button
                            type="button"
                            onClick={() => open(c)}
                            aria-label={`Edit ${size.label} ${speed.label}`}
                            data-cell={`${c.size}/${c.speed}`}
                            style={{
                              width: '100%', textAlign: 'left', cursor: 'pointer', padding: '0.45rem 0.6rem', borderRadius: '0.375rem',
                              border: `1px solid ${selected ? colors.primary : colors.border}`,
                              background: selected ? tint(colors.primary, 0.08) : c.active ? colors.card : colors.headBg,
                              opacity: c.active ? 1 : 0.7,
                            }}
                          >
                            <span style={{ display: 'block', fontWeight: 700, color: colors.text }}>{multiplierLabel(c.multiplierBps)}</span>
                            <span style={{ display: 'block', fontSize: '0.75rem', color: colors.muted }}>min {nairaLabel(c.minFareKobo)}</span>
                            {!c.active && <span style={{ display: 'block', fontSize: '0.7rem', color: colors.danger, fontWeight: 600 }}>inactive</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {edit && current && (
        <div style={{ marginTop: '1rem', padding: '0.85rem', border: `1px solid ${colors.border}`, borderRadius: '0.5rem', background: colors.headBg }}>
          <div style={{ fontWeight: 700, marginBottom: '0.6rem', color: colors.text }}>
            {SIZES.find((s) => s.key === edit.size)?.label} · {SPEEDS.find((s) => s.key === edit.speed)?.label}
            <span style={{ fontWeight: 400, color: colors.muted, fontSize: '0.78rem' }}>
              {' '}— now {multiplierLabel(current.multiplierBps)}, min {nairaLabel(current.minFareKobo)}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: colors.text }}>
              Multiplier (×)
              <input inputMode="decimal" value={edit.multiplier} disabled={!canManage}
                onChange={(e) => setEdit({ ...edit, multiplier: e.target.value })}
                style={{ ...input(), marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: colors.text }}>
              Minimum fare (₦)
              <input inputMode="decimal" value={edit.minFare} disabled={!canManage}
                onChange={(e) => setEdit({ ...edit, minFare: e.target.value })}
                style={{ ...input(), marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'flex', alignItems: 'center', gap: 6, marginTop: 18 }}>
              <input type="checkbox" checked={edit.active} disabled={!canManage}
                onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
              Active
            </label>
          </div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: colors.text, marginTop: '0.75rem' }}>
            Reason (required, audited)
            <textarea value={edit.reason} disabled={!canManage} maxLength={MAX_REASON} rows={2}
              placeholder="e.g. Priority on large boxes needs a car"
              onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
              style={{ ...input(), marginTop: 4, resize: 'vertical', fontFamily: 'inherit' }} />
          </label>
          {!edit.active && current.active && (
            <p style={{ color: colors.warning, fontSize: '0.8rem', margin: '0.5rem 0 0' }}>
              Inactive does not hide this option — it stays bookable, priced with the legacy size × speed multiplier and without this cell’s minimum fare.
            </p>
          )}
          {parsed?.error && <p style={{ color: colors.danger, fontSize: '0.8rem', margin: '0.5rem 0 0' }}>{parsed.error}</p>}
          {!parsed?.error && !hasChanges && <p style={{ color: colors.muted, fontSize: '0.8rem', margin: '0.5rem 0 0' }}>No changes yet.</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="button" style={btn()} onClick={() => setEdit(null)} disabled={saving}>Cancel</button>
            <button type="button" style={canSave ? btnPrimary() : btnDisabled()} disabled={!canSave} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save (audited)'}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
