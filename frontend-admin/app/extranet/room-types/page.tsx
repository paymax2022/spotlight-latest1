'use client';

import { useEffect, useState } from 'react';
import { listRoomTypes, upsertRoomType } from '@/services/staysExtranetService';
import type { RoomType } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, btn, btnPrimary, input, label, th, td } from '../_ui';

export default function RoomTypesPage() {
  const [rows, setRows] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', max_occupancy: '2', beds: '1 Queen', size_sqm: '24', count: '1' });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listRoomTypes()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true);
    try {
      const rt = await upsertRoomType({ name: draft.name, max_occupancy: Number(draft.max_occupancy), beds: draft.beds, size_sqm: Number(draft.size_sqm), count: Number(draft.count), status: 'active' });
      setRows((r) => [...r, rt]);
      setDraft({ name: '', max_occupancy: '2', beds: '1 Queen', size_sqm: '24', count: '1' });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Room types" subtitle="Define each bookable room type — occupancy, bedding, size and physical count." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="content" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <Card title={`Room types (${rows.length})`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No room types yet. Add your first below.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Name</th><th style={th()}>Occupancy</th><th style={th()}>Beds</th><th style={th()}>Size</th><th style={th()}>Rooms</th><th style={th()}>Status</th><th style={th()} /></tr></thead>
            <tbody>
              {rows.map((rt) => (
                <tr key={rt.id}>
                  <td style={td()}>{rt.name}</td>
                  <td style={td()}>{rt.max_occupancy} guests</td>
                  <td style={td()}>{rt.beds}</td>
                  <td style={td()}>{rt.size_sqm} m²</td>
                  <td style={td()}>{rt.count}</td>
                  <td style={td()}><Badge status={rt.status} /></td>
                  <td style={td()}><button style={btn()}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      <Card title="Add room type">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.7rem' }}>
          <div><label style={label()}>Name</label><input style={input()} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Deluxe King" /></div>
          <div><label style={label()}>Max occupancy</label><input style={input()} type="number" value={draft.max_occupancy} onChange={(e) => setDraft({ ...draft, max_occupancy: e.target.value })} /></div>
          <div><label style={label()}>Beds</label><input style={input()} value={draft.beds} onChange={(e) => setDraft({ ...draft, beds: e.target.value })} /></div>
          <div><label style={label()}>Size (m²)</label><input style={input()} type="number" value={draft.size_sqm} onChange={(e) => setDraft({ ...draft, size_sqm: e.target.value })} /></div>
          <div><label style={label()}>Rooms of this type</label><input style={input()} type="number" value={draft.count} onChange={(e) => setDraft({ ...draft, count: e.target.value })} /></div>
        </div>
        <button style={{ ...btnPrimary(), marginTop: '0.85rem' }} onClick={create} disabled={busy || !draft.name}>{busy ? 'Adding…' : 'Add room type'}</button>
      </Card>
    </div>
  );
}
