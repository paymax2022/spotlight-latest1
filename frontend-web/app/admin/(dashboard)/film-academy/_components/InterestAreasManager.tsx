'use client';

// ── Admin — Film Academy areas of interest ───────────────────────────────────
// Each area carries a NAIRA fee ADDED to the base application fee. An applicant
// selecting three areas pays application_fee + the three fees, and the total is
// recomputed server-side on submit — so a fee edited here applies to the next
// application immediately, with nothing to invalidate.
//
// The SLUG is intentionally read-only after creation: it is written into
// academy_applications.areas_of_interest, and changing it would orphan every
// historic application that referenced it. Labels are free to change.
//
// Retiring uses the Active toggle rather than deletion, for the same reason —
// a deleted area would leave old applications pointing at nothing.

import { useCallback, useEffect, useState } from 'react';
import { adminAuthHeaders } from '@/src/lib/auth/client';

type Area = {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  fee_ngn: number;
  is_active: boolean;
  sort_order: number;
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8, boxSizing: 'border-box',
  border: '1px solid var(--border)', background: 'transparent', color: 'inherit',
};
const cell: React.CSSProperties = { padding: '10px 8px', verticalAlign: 'middle' };

function naira(n: number) {
  return `₦${Number(n || 0).toLocaleString('en-NG')}`;
}

export default function InterestAreasManager({ onChange, note }: {
  /** Called after a successful create or save, so an embedding page can refresh. */
  onChange?: () => void;
  /** Replaces the default blurb — the batch form needs to say prices are global. */
  note?: string;
} = {}) {
  const [areas, setAreas]     = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);
  const [savingId, setSaving] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState('');
  const [newFee, setNewFee]     = useState('0');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/academy/interest-areas', {
        headers: await adminAuthHeaders(),
        cache: 'no-store',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to load areas');
      setAreas((body.areas ?? body.data?.areas ?? []) as Area[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load areas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = async (id: string, changes: Partial<Area>) => {
    setSaving(id); setError(null); setNotice(null);
    try {
      const res = await fetch('/api/admin/academy/interest-areas', {
        method: 'PUT',
        headers: await adminAuthHeaders(true),
        body: JSON.stringify({ id, ...changes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to save');
      setNotice('Saved. This applies to the next application submitted.');
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(null);
    }
  };

  const create = async () => {
    if (!newLabel.trim()) { setError('Enter a label for the new area.'); return; }
    setCreating(true); setError(null); setNotice(null);
    try {
      const res = await fetch('/api/admin/academy/interest-areas', {
        method: 'POST',
        headers: await adminAuthHeaders(true),
        body: JSON.stringify({
          label: newLabel.trim(),
          fee_ngn: Number(newFee) || 0,
          sort_order: (areas.at(-1)?.sort_order ?? 0) + 10,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to create');
      setNewLabel(''); setNewFee('0');
      setNotice('Area created.');
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  const activeTotal = areas.filter((a) => a.is_active).reduce((s, a) => s + Number(a.fee_ngn || 0), 0);

  return (
    <section className="glass-card rounded-md p-6" style={{ marginTop: 24 }}>
      <h2 className="font-display text-xl text-foreground" style={{ marginBottom: 6 }}>
        Areas of interest
      </h2>
      <p style={{ opacity: 0.75, marginBottom: 20 }}>
        {note ??
          'Applicants choose from these. Each one ADDS its fee to the application fee above, so someone selecting three areas pays the application fee plus those three. Changes apply to the next application submitted.'}
      </p>

      {error &&  <div style={{ color: 'var(--destructive)', marginBottom: 12 }}>{error}</div>}
      {notice && <div style={{ opacity: 0.8, marginBottom: 12 }}>{notice}</div>}

      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontWeight: 600, marginBottom: 12 }}>Add an area</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 240px' }}>
            <label style={{ fontSize: 13, opacity: 0.75 }}>Label</label>
            <input style={inputStyle} value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                   placeholder="e.g. Costume Design" />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ fontSize: 13, opacity: 0.75 }}>Fee (₦)</label>
            <input style={inputStyle} value={newFee} onChange={(e) => setNewFee(e.target.value)}
                   inputMode="decimal" />
          </div>
          <button className="btn-primary py-2 px-5 text-sm" onClick={create} disabled={creating}>
            {creating ? 'Adding…' : 'Add area'}
          </button>
        </div>
        <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
          The slug is derived from the label and cannot be changed afterwards — applications store it.
        </p>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : areas.length === 0 ? (
        <p>No areas yet. Add the first one above.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={cell}>Label</th>
              <th style={cell}>Slug</th>
              <th style={cell}>Fee (₦)</th>
              <th style={cell}>Order</th>
              <th style={cell}>Active</th>
              <th style={cell} />
            </tr>
          </thead>
          <tbody>
            {areas.map((a) => (
              <AreaRow key={a.id} area={a} saving={savingId === a.id} onSave={patch} />
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 20, fontSize: 13, opacity: 0.7 }}>
        Selecting every active area would add {naira(activeTotal)} on top of the base
        application fee.
      </p>
    </section>
  );
}

function AreaRow({ area, saving, onSave }: {
  area: Area; saving: boolean; onSave: (id: string, c: Partial<Area>) => Promise<void>;
}) {
  const [label, setLabel] = useState(area.label);
  const [fee, setFee]     = useState(String(area.fee_ngn ?? 0));
  const [order, setOrder] = useState(String(area.sort_order ?? 0));

  // Re-sync when a reload brings fresh values, so an edit elsewhere is not
  // silently overwritten by this row's stale local state.
  useEffect(() => {
    setLabel(area.label); setFee(String(area.fee_ngn ?? 0)); setOrder(String(area.sort_order ?? 0));
  }, [area.label, area.fee_ngn, area.sort_order]);

  const dirty =
    label !== area.label ||
    Number(fee) !== Number(area.fee_ngn) ||
    Number(order) !== Number(area.sort_order);

  return (
    <tr style={{ borderBottom: '1px solid var(--border)', opacity: area.is_active ? 1 : 0.55 }}>
      <td style={cell}>
        <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} />
      </td>
      <td style={{ ...cell, fontFamily: 'monospace', fontSize: 13, opacity: 0.7 }}>{area.slug}</td>
      <td style={cell}>
        <input style={{ ...inputStyle, maxWidth: 130 }} value={fee} inputMode="decimal"
               onChange={(e) => setFee(e.target.value)} />
      </td>
      <td style={cell}>
        <input style={{ ...inputStyle, maxWidth: 90 }} value={order} inputMode="numeric"
               onChange={(e) => setOrder(e.target.value)} />
      </td>
      <td style={cell}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={area.is_active}
            onChange={(e) => void onSave(area.id, { is_active: e.target.checked })}
          />
          <span style={{ fontSize: 13 }}>{area.is_active ? 'Active' : 'Retired'}</span>
        </label>
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        <button
          className="btn-outline py-1.5 px-3 text-xs"
          disabled={!dirty || saving}
          onClick={() => void onSave(area.id, {
            label: label.trim(),
            fee_ngn: Number(fee) || 0,
            sort_order: Number(order) || 0,
          })}
        >
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </td>
    </tr>
  );
}