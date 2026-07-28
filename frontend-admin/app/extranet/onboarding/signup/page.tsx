'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, btn, btnPrimary, input, label } from '../../_ui';

export default function HotelierSignupPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Become a Paymax Stays partner"
        subtitle="Sign in with your Paymax account (SSO) to add the Hotelier capability. Once approved you can list your property and start receiving bookings settled in Naira."
      />
      <ExtranetTabs active="onboarding" />
      <PropertyScopeNote propertyName="your new property" />

      <Card title="Step 1 of 6 — Hotelier sign-up">
        {done ? (
          <div>
            <p style={{ color: '#15803d', fontWeight: 600 }}>Hotelier capability requested.</p>
            <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>We have linked the Hotelier capability to your Paymax SSO account. Continue to register your property.</p>
            <Link href="/extranet/onboarding/property" style={{ ...btnPrimary(), textDecoration: 'none', display: 'inline-block', marginTop: '0.5rem' }}>Continue → Property registration</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 460 }}>
            <div>
              <label style={label()}>Full name</label>
              <input style={input()} value={name} onChange={(e) => setName(e.target.value)} placeholder="Adebayo Okonkwo" />
            </div>
            <div>
              <label style={label()}>Work email (linked to your Paymax SSO)</label>
              <input style={input()} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourhotel.ng" />
            </div>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: 0 }}>
              Sign-up uses Paymax single sign-on. Adding the Hotelier capability does not change your existing wallet or KYC tier.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button style={btnPrimary()} onClick={() => setDone(true)} disabled={!email || !name}>Continue with Paymax SSO</button>
              <button style={btn()} onClick={() => { setEmail(''); setName(''); }}>Reset</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
