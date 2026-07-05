'use client';

import { useEffect, useState } from 'react';
import { getProperty, updateContent } from '@/services/staysExtranetService';
import type { PropertyProfile } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, btn, btnPrimary, input, label, select } from '../_ui';

export default function ProfilePage() {
  const [p, setP] = useState<PropertyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setP(await getProperty()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!p) return;
    setSaving(true);
    try { const next = await updateContent(p); setP(next); setSavedAt(new Date().toLocaleTimeString('en-NG')); }
    catch (e) { setError(String(e)); } finally { setSaving(false); }
  }
  const set = (k: keyof PropertyProfile, v: string | number) => setP((x) => (x ? { ...x, [k]: v } : x));

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Property profile & descriptions" subtitle="The name, descriptions and contact details travellers see. Keep it accurate and welcoming." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="content" />
      {p && <PropertyScopeNote propertyName={p.name} />}

      <StateBlock loading={loading} error={error} empty={!p}>
        {p && (
          <Card title="Descriptions" right={<Badge status={p.status} />}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.85rem' }}>
              <div><label style={label()}>Property name</label><input style={input()} value={p.name} onChange={(e) => set('name', e.target.value)} /></div>
              <div><label style={label()}>Star rating</label><select style={select()} value={p.star_rating} onChange={(e) => set('star_rating', Number(e.target.value))}>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}★</option>)}</select></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={label()}>Short tagline</label><input style={input()} value={p.short_tagline} onChange={(e) => set('short_tagline', e.target.value)} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={label()}>Full description</label><textarea style={{ ...input(), minHeight: 120, fontFamily: 'inherit' }} value={p.description} onChange={(e) => set('description', e.target.value)} /></div>
              <div><label style={label()}>Check-in from</label><input style={input()} type="time" value={p.check_in_from} onChange={(e) => set('check_in_from', e.target.value)} /></div>
              <div><label style={label()}>Check-out until</label><input style={input()} type="time" value={p.check_out_until} onChange={(e) => set('check_out_until', e.target.value)} /></div>
              <div><label style={label()}>Contact phone</label><input style={input()} value={p.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} /></div>
              <div><label style={label()}>Contact email</label><input style={input()} value={p.contact_email} onChange={(e) => set('contact_email', e.target.value)} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={label()}>Address</label><input style={input()} value={p.address_line} onChange={(e) => set('address_line', e.target.value)} /></div>
              <div><label style={label()}>City</label><input style={input()} value={p.city} onChange={(e) => set('city', e.target.value)} /></div>
              <div><label style={label()}>State</label><input style={input()} value={p.state} onChange={(e) => set('state', e.target.value)} /></div>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button style={btnPrimary()} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
              {savedAt ? <span style={{ color: '#15803d', fontSize: '0.82rem' }}>Saved at {savedAt}</span> : null}
            </div>
          </Card>
        )}
      </StateBlock>
    </div>
  );
}
