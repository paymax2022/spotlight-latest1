'use client';

import { useEffect, useState } from 'react';
import { getAmenities, updateAmenities } from '@/services/staysExtranetService';
import type { AmenityGroup } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, StateBlock, btn, btnPrimary } from '../_ui';

export default function AmenitiesPage() {
  const [groups, setGroups] = useState<AmenityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setGroups(await getAmenities()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function toggle(gi: number, ii: number) {
    setGroups((gs) => gs.map((g, i) => i !== gi ? g : { ...g, items: g.items.map((it, j) => j !== ii ? it : { ...it, enabled: !it.enabled }) }));
  }
  async function save() {
    setSaving(true);
    try { setGroups(await updateAmenities(groups)); setSavedAt(new Date().toLocaleTimeString('en-NG')); }
    catch (e) { setError(String(e)); } finally { setSaving(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Amenities & facilities" subtitle="Toggle the amenities your property offers. These power traveller search filters." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="content" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={groups.length === 0}>
        {groups.map((g, gi) => (
          <Card key={g.group} title={g.group}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem' }}>
              {g.items.map((it, ii) => (
                <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={it.enabled} onChange={() => toggle(gi, ii)} />
                  <span style={{ color: it.enabled ? '#111827' : '#9ca3af' }}>{it.label}</span>
                </label>
              ))}
            </div>
          </Card>
        ))}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button style={btnPrimary()} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save amenities'}</button>
          {savedAt ? <span style={{ color: '#15803d', fontSize: '0.82rem' }}>Saved at {savedAt}</span> : null}
        </div>
      </StateBlock>
    </div>
  );
}
