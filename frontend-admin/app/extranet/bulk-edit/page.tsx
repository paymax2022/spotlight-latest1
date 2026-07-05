'use client';

import { useEffect, useState } from 'react';
import { listRoomTypes, bulkEditCalendar } from '@/services/staysExtranetService';
import type { RoomType, BulkEditPayload } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, StateBlock, btn, btnPrimary, input, label } from '../_ui';

function today(): string { return new Date().toISOString().slice(0, 10); }
function ahead(d: number): string { return new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10); }

export default function BulkEditPage() {
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(ahead(30));
  const [rate, setRate] = useState('');
  const [avail, setAvail] = useState('');
  const [minLos, setMinLos] = useState('');
  const [cta, setCta] = useState(false);
  const [ctd, setCtd] = useState(false);
  const [stopSell, setStopSell] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { const r = await listRoomTypes(); setRooms(r); setSelected(r.map((x) => x.id)); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function toggle(id: string) { setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]); }

  async function apply() {
    setBusy(true); setResult(null);
    try {
      const payload: BulkEditPayload = {
        room_type_ids: selected, date_from: from, date_to: to,
        rate_kobo: rate ? Math.round(Number(rate) * 100) : undefined,
        available: avail ? Number(avail) : undefined,
        min_los: minLos ? Number(minLos) : undefined,
        cta, ctd, stop_sell: stopSell,
      };
      const res = await bulkEditCalendar(payload);
      setResult(`Updated ${res.updated_cells.toLocaleString('en-NG')} calendar cells.`);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Bulk edit — rates, availability & restrictions" subtitle="Apply changes across a date range and selected room types in one action. Rates are entered in Naira and stored in kobo." />
      <ExtranetTabs active="inventory" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={rooms.length === 0}>
        <Card title="Scope">
          <label style={label()}>Room types</label>
          <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
            {rooms.map((r) => (
              <label key={r.id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />{r.name}
              </label>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.7rem' }}>
            <div><label style={label()}>Date from</label><input style={input()} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label style={label()}>Date to</label><input style={input()} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        </Card>

        <Card title="Changes (leave blank to keep existing)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.7rem' }}>
            <div><label style={label()}>Rate (₦)</label><input style={input()} type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="85000" /></div>
            <div><label style={label()}>Available rooms</label><input style={input()} type="number" value={avail} onChange={(e) => setAvail(e.target.value)} /></div>
            <div><label style={label()}>Min length of stay</label><input style={input()} type="number" value={minLos} onChange={(e) => setMinLos(e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', marginTop: '0.85rem', fontSize: '0.85rem' }}>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}><input type="checkbox" checked={cta} onChange={() => setCta(!cta)} /> Closed to arrival (CTA)</label>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}><input type="checkbox" checked={ctd} onChange={() => setCtd(!ctd)} /> Closed to departure (CTD)</label>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}><input type="checkbox" checked={stopSell} onChange={() => setStopSell(!stopSell)} /> Stop-sell</label>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button style={btnPrimary()} onClick={apply} disabled={busy || selected.length === 0}>{busy ? 'Applying…' : 'Apply to range'}</button>
            {result ? <span style={{ color: '#15803d', fontSize: '0.85rem' }}>{result}</span> : null}
          </div>
        </Card>
      </StateBlock>
    </div>
  );
}
