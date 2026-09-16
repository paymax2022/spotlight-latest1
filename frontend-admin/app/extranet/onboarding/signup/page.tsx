'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, btn, btnPrimary, input, label } from '../../_ui';
import { signUpHotelier, signInHotelier, HotelierAuthError } from '@/features/auth/hotelierAuth';

const DEFAULT_NEXT = '/extranet/onboarding/property';

function HotelierAuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || DEFAULT_NEXT;

  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') {
        const result = await signUpHotelier(name, email, password);
        if (result.signedIn) {
          router.push(next);
        } else {
          setAwaitingConfirmation(true);
        }
      } else {
        await signInHotelier(email, password);
        router.push(next);
      }
    } catch (e) {
      setError(e instanceof HotelierAuthError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (awaitingConfirmation) {
    return (
      <div>
        <p style={{ color: '#15803d', fontWeight: 600 }}>Almost there — check your email.</p>
        <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>
          We sent a confirmation link to {email}. Once confirmed, sign in below to continue.
        </p>
        <button style={btnPrimary()} onClick={() => { setAwaitingConfirmation(false); setMode('signin'); setPassword(''); }}>
          I&apos;ve confirmed — sign in
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 460 }}>
      {mode === 'signup' ? (
        <div>
          <label style={label()}>Full name</label>
          <input style={input()} value={name} onChange={(e) => setName(e.target.value)} placeholder="Adebayo Okonkwo" />
        </div>
      ) : null}
      <div>
        <label style={label()}>Work email</label>
        <input style={input()} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourhotel.ng" />
      </div>
      <div>
        <label style={label()}>Password</label>
        <input style={input()} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'At least 8 characters' : ''} />
      </div>
      {error ? <p style={{ color: '#b91c1c', fontSize: '0.82rem', margin: 0 }}>{error}</p> : null}
      <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: 0 }}>
        {mode === 'signup'
          ? 'Creating an account adds the Hotelier capability to your Paymax identity. It does not change your existing wallet or KYC tier.'
          : 'Sign in with the account you used to register your property.'}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button
          style={btnPrimary()}
          onClick={submit}
          disabled={busy || !email || !password || (mode === 'signup' && !name)}
        >
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
        <button
          type="button"
          style={btn()}
          onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); }}
        >
          {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </div>
    </div>
  );
}

export default function HotelierSignupPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Become a Paymax Stays partner"
        subtitle="Sign in or create your Paymax hotelier account to list your property and start receiving bookings settled in Naira."
      />
      <ExtranetTabs active="onboarding" />
      <PropertyScopeNote propertyName="your new property" />

      <Card title="Step 1 of 6 — Hotelier sign-up">
        <Suspense fallback={null}>
          <HotelierAuthForm />
        </Suspense>
      </Card>
    </div>
  );
}
