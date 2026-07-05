'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, btn, btnPrimary } from '../../_ui';

const STEPS = [
  { key: 'profile', label: 'Property descriptions', href: '/extranet/profile' },
  { key: 'photos', label: 'Photos & media (min 8)', href: '/extranet/photos' },
  { key: 'amenities', label: 'Amenities & facilities', href: '/extranet/amenities' },
  { key: 'rooms', label: 'Room types', href: '/extranet/room-types' },
  { key: 'rates', label: 'Rate plans', href: '/extranet/rate-plans' },
  { key: 'calendar', label: 'Availability & rates (90 days)', href: '/extranet/calendar' },
];

export default function ContentWizardPage() {
  const [done, setDone] = useState<Record<string, boolean>>({ profile: true, photos: true, amenities: true });

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Property content setup wizard" subtitle="Complete each section so travellers can find and book your property. Each step opens the full editor." />
      <ExtranetTabs active="onboarding" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <Card title="Step 4 of 6 — Content wizard">
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {STEPS.map((s, i) => (
            <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.7rem 0.9rem' }}>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: '#9ca3af' }}>{i + 1}</span>
                <span style={{ fontWeight: 600 }}>{s.label}</span>
                <Badge status={done[s.key] ? 'completed' : 'pending'} />
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <Link href={s.href} style={{ ...btn(), textDecoration: 'none' }}>Open editor</Link>
                <button style={btn()} onClick={() => setDone((d) => ({ ...d, [s.key]: !d[s.key] }))}>{done[s.key] ? 'Mark incomplete' : 'Mark done'}</button>
              </div>
            </div>
          ))}
        </div>
        <Link href="/extranet/onboarding/policies" style={{ ...btnPrimary(), textDecoration: 'none', display: 'inline-block', marginTop: '1rem' }}>Continue → Policies</Link>
      </Card>
    </div>
  );
}
