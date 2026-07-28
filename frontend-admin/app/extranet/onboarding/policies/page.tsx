'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, btnPrimary, input, label, select } from '../../_ui';

export default function PoliciesPage() {
  const [p, setP] = useState({
    check_in: '14:00', check_out: '12:00',
    cancellation: 'flexible_24h', children: 'allowed', pets: 'not_allowed',
    deposit_pct: '20', smoking: 'no',
  });
  const [saved, setSaved] = useState(false);
  const set = (k: string, v: string) => setP((x) => ({ ...x, [k]: v }));

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Policies setup" subtitle="Check-in/out, cancellation, children, pets and deposit rules. These appear to travellers before they book." />
      <ExtranetTabs active="onboarding" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <Card title="Step 5 of 6 — Policies">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.85rem' }}>
          <div><label style={label()}>Check-in from</label><input style={input()} type="time" value={p.check_in} onChange={(e) => set('check_in', e.target.value)} /></div>
          <div><label style={label()}>Check-out until</label><input style={input()} type="time" value={p.check_out} onChange={(e) => set('check_out', e.target.value)} /></div>
          <div><label style={label()}>Cancellation policy</label>
            <select style={select()} value={p.cancellation} onChange={(e) => set('cancellation', e.target.value)}>
              <option value="flexible_24h">Flexible — free until 24h before</option>
              <option value="flexible_48h">Flexible — free until 48h before</option>
              <option value="moderate">Moderate — 50% if &lt;72h</option>
              <option value="non_refundable">Non-refundable</option>
            </select>
          </div>
          <div><label style={label()}>Children</label>
            <select style={select()} value={p.children} onChange={(e) => set('children', e.target.value)}><option value="allowed">Allowed</option><option value="not_allowed">Not allowed</option></select>
          </div>
          <div><label style={label()}>Pets</label>
            <select style={select()} value={p.pets} onChange={(e) => set('pets', e.target.value)}><option value="allowed">Allowed</option><option value="not_allowed">Not allowed</option><option value="on_request">On request</option></select>
          </div>
          <div><label style={label()}>Smoking</label>
            <select style={select()} value={p.smoking} onChange={(e) => set('smoking', e.target.value)}><option value="no">No smoking</option><option value="designated">Designated areas</option></select>
          </div>
          <div><label style={label()}>Deposit / pre-authorisation (% of stay)</label><input style={input()} type="number" value={p.deposit_pct} onChange={(e) => set('deposit_pct', e.target.value)} /></div>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button style={btnPrimary()} onClick={() => setSaved(true)}>Save policies</button>
          {saved ? <Link href="/extranet/onboarding/go-live" style={{ ...btnPrimary(), textDecoration: 'none' }}>Continue → Go-live checklist</Link> : null}
        </div>
        {saved ? <p style={{ color: '#15803d', fontSize: '0.85rem', marginTop: '0.5rem' }}>Policies saved.</p> : null}
      </Card>
    </div>
  );
}
