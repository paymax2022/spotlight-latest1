'use client';

import { useEffect, useState } from 'react';
import { getRestrictions, updateRestrictions } from '@/services/staysExtranetService';
import type { Restriction } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, StateBlock, btn, btnPrimary, input, th, td } from '../_ui';

export default function RestrictionsPage() {
  const [rows, setRows] = useState<Restriction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getRestrictions()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function setField(id: string, k: keyof Restriction, v: number | boolean) {
    setRows((rs) => rs.map((r) => r.room_type_id === id ? { ...r, [k]: v } : r));
  }
  async function save() {
    setSaving(true);
    try { setRows(await updateRestrictions(rows)); setSavedAt(new Date().toLocaleTimeString('en-NG')); }
    catch (e) { setError(String(e)); } finally { setSaving(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Restrictions" subtitle="Min/max length of stay, closed-to-arrival (CTA), closed-to-departure (CTD) and stop-sell per room type." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="inventory" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <Card title="Default restrictions">
        <StateBlock loading={loading} error={error} empty={rows.length === 0}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Room type</th><th style={th()}>Min LOS</th><th style={th()}>Max LOS</th><th style={th()}>CTA</th><th style={th()}>CTD</th><th style={th()}>Stop-sell</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.room_type_id}>
                  <td style={td()}>{r.room_type_name}</td>
                  <td style={td()}><input style={{ ...input(), width: 70 }} type="number" value={r.min_los} onChange={(e) => setField(r.room_type_id, 'min_los', Number(e.target.value))} /></td>
                  <td style={td()}><input style={{ ...input(), width: 70 }} type="number" value={r.max_los} onChange={(e) => setField(r.room_type_id, 'max_los', Number(e.target.value))} /></td>
                  <td style={td()}><input type="checkbox" checked={r.cta} onChange={() => setField(r.room_type_id, 'cta', !r.cta)} /></td>
                  <td style={td()}><input type="checkbox" checked={r.ctd} onChange={() => setField(r.room_type_id, 'ctd', !r.ctd)} /></td>
                  <td style={td()}><input type="checkbox" checked={r.stop_sell} onChange={() => setField(r.room_type_id, 'stop_sell', !r.stop_sell)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button style={btnPrimary()} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save restrictions'}</button>
            {savedAt ? <span style={{ color: '#15803d', fontSize: '0.82rem' }}>Saved at {savedAt}</span> : null}
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
