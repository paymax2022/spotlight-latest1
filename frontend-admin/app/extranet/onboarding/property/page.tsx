'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PropertyType } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, btnPrimary, input, label, select } from '../../_ui';

const TYPES: PropertyType[] = ['hotel', 'apartment', 'guesthouse', 'resort', 'hostel', 'villa'];

export default function PropertyRegistrationPage() {
  const [form, setForm] = useState({ name: '', type: 'hotel' as PropertyType, address: '', city: 'Lagos', state: 'Lagos', lat: '', lng: '' });
  const [saved, setSaved] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Register your property" subtitle="Tell us the basics. You can refine the full profile, photos and rooms in the next steps." />
      <ExtranetTabs active="onboarding" />
      <PropertyScopeNote propertyName={form.name || 'your new property'} />

      <Card title="Step 2 of 6 — Property registration">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.85rem' }}>
          <div><label style={label()}>Property name</label><input style={input()} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Lekki Grand Hotel & Suites" /></div>
          <div><label style={label()}>Property type</label><select style={select()} value={form.type} onChange={(e) => set('type', e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={label()}>Street address</label><input style={input()} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="14 Admiralty Way, Lekki Phase 1" /></div>
          <div><label style={label()}>City</label><input style={input()} value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
          <div><label style={label()}>State</label><input style={input()} value={form.state} onChange={(e) => set('state', e.target.value)} /></div>
          <div><label style={label()}>Latitude</label><input style={input()} value={form.lat} onChange={(e) => set('lat', e.target.value)} placeholder="6.4391" /></div>
          <div><label style={label()}>Longitude</label><input style={input()} value={form.lng} onChange={(e) => set('lng', e.target.value)} placeholder="3.4731" /></div>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button style={btnPrimary()} onClick={() => setSaved(true)} disabled={!form.name || !form.address}>Save & continue</button>
          {saved ? <Link href="/extranet/onboarding/verification" style={{ ...btnPrimary(), textDecoration: 'none' }}>Continue → Verification</Link> : null}
        </div>
        {saved ? <p style={{ color: '#15803d', fontSize: '0.85rem', marginTop: '0.5rem' }}>Property registered as draft.</p> : null}
      </Card>
    </div>
  );
}
