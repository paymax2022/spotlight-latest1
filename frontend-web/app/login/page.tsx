'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function toReadableAuthError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  const lowered = message.toLowerCase();
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: number }).status)
      : undefined;
  if (lowered.includes('failed to fetch') || lowered.includes('err_connection_refused')) {
    return 'Authentication service is unreachable. Please try again shortly.';
  }
  if (status === 422 || lowered.includes('unprocessable')) {
    return message || 'This email may already be registered, or the password format is invalid.';
  }
  if (lowered.includes('already registered')) {
    return 'This email already has an account. Please sign in instead.';
  }
  if (lowered.includes('invalid login credentials')) {
    return 'Invalid email or password.';
  }
  return message || fallback;
}

export default function LoginPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams?.get('next') || '/user-dashboard';
  const emailHint = searchParams?.get('email') || '';
  const registered = searchParams?.get('registered') === '1';

  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (emailHint) setEmail(emailHint);
    if (registered) setInfo('Account created! Please sign in.');
  }, [emailHint, registered]);

  async function signIn() {
    setBusy(true);
    setError('');
    try {
      const normalized = email.trim().toLowerCase();
      const { error: e } = await supabase.auth.signInWithPassword({
        email: normalized,
        password,
      });
      // The password was RIGHT and only verification is missing — Supabase returns
      // this code ONLY when the credentials check out. Sending them to enter their
      // code beats showing a sign-in error they cannot act on, which is what an
      // unverified account used to get.
      if (e && (e as { code?: string }).code === 'email_not_confirmed') {
        router.push(`/verify-email?email=${encodeURIComponent(normalized)}&next=${encodeURIComponent(next)}`);
        return;
      }
      if (e) throw e;
      router.replace(next);
    } catch (err) {
      setError(toReadableAuthError(err, 'Sign in failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function signUp() {
    setBusy(true);
    setError('');
    try {
      const normalized = email.trim().toLowerCase();
      const { data, error: e } = await supabase.auth.signUp({
        email: normalized,
        password,
        options: { data: { full_name: name.trim() || email } },
      });
      if (e) throw e;

      // Confirmation is required on both cloud projects, so there is no session
      // here and the old advice — "confirm, then sign in" — was a dead end:
      // signing in before confirming fails. Send them to enter the code instead.
      if (data?.session?.access_token) {
        router.replace(next);
        return;
      }
      router.push(`/verify-email?email=${encodeURIComponent(normalized)}&next=${encodeURIComponent(next)}`);
    } catch (err) {
      setError(toReadableAuthError(err, 'Sign up failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    try {
      const auth = supabase.auth as unknown as {
        signInWithOAuth?: (o: { provider: string; options?: { redirectTo?: string } }) => Promise<void>;
      };
      if (typeof auth.signInWithOAuth === 'function') {
        await auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
      } else {
        setError('Google sign-in is not available in this environment.');
      }
    } catch {
      setError('Google sign-in failed. Please use email and password.');
    } finally {
      setBusy(false);
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    tab === 'signin' ? signIn() : signUp();
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <Link href="/" style={{ textDecoration: 'none', display: 'inline-block' }}>
            <span style={{ fontSize: '2rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>
              Spotlight
            </span>
            <span style={{ fontSize: '2rem', fontWeight: 800, color: '#f59e0b' }}>.</span>
          </Link>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '0.5rem', marginBottom: 0 }}>
            {tab === 'signin' ? 'Welcome back — sign in to continue' : 'Create your account to get started'}
          </p>
        </div>

        {/* Card */}
        <div
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '1.25rem',
            padding: '2rem',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
          }}
        >
          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: '0.75rem',
              padding: '0.25rem',
              marginBottom: '1.75rem',
              gap: '0.25rem',
            }}
          >
            {(['signin', 'signup'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(''); }}
                style={{
                  flex: 1,
                  padding: '0.6rem 1rem',
                  borderRadius: '0.5rem',
                  border: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  background: tab === t ? '#f59e0b' : 'transparent',
                  color: tab === t ? '#000000' : '#94a3b8',
                }}
              >
                {t === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {tab === 'signup' && (
              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Full Name
                </label>
                <input
                  type="text"
                  placeholder="Jane Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={inputStyle}
                />
              </div>
            )}

            <div>
              <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Email Address
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit(e as unknown as React.FormEvent)}
                autoComplete="email"
                style={inputStyle}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label style={{ color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Password
                </label>
                {tab === 'signin' && (
                  <Link href="/forgot-password" style={{ color: '#f59e0b', fontSize: '0.78rem', textDecoration: 'none' }}>
                    Forgot password?
                  </Link>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={tab === 'signup' ? 'Min. 8 characters' : 'Your password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit(e as unknown as React.FormEvent)}
                  autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                  style={{ ...inputStyle, paddingRight: '3rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  style={{
                    position: 'absolute',
                    right: '0.875rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#64748b',
                    padding: '0.25rem',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.4)',
                borderRadius: '0.625rem',
                padding: '0.75rem 1rem',
                color: '#fca5a5',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
              }}>
                <span style={{ flexShrink: 0, marginTop: '0.05rem' }}>⚠</span>
                {error}
              </div>
            )}

            {info && (
              <div style={{
                background: 'rgba(34,197,94,0.15)',
                border: '1px solid rgba(34,197,94,0.4)',
                borderRadius: '0.625rem',
                padding: '0.75rem 1rem',
                color: '#86efac',
                fontSize: '0.85rem',
              }}>
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !email || !password}
              style={{
                width: '100%',
                padding: '0.875rem',
                background: busy || !email || !password
                  ? 'rgba(245,158,11,0.4)'
                  : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: busy || !email || !password ? 'rgba(0,0,0,0.5)' : '#000000',
                border: 'none',
                borderRadius: '0.75rem',
                fontSize: '0.95rem',
                fontWeight: 700,
                cursor: busy || !email || !password ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                marginTop: '0.25rem',
                letterSpacing: '0.01em',
                boxShadow: busy || !email || !password ? 'none' : '0 4px 15px rgba(245,158,11,0.35)',
              }}
            >
              {busy
                ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <SpinnerIcon /> {tab === 'signin' ? 'Signing in…' : 'Creating account…'}
                  </span>
                : tab === 'signin' ? 'Sign In' : 'Create Account'
              }
            </button>
          </form>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.25rem 0' }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
            <span style={{ color: '#475569', fontSize: '0.8rem' }}>or continue with</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
          </div>

          <button
            onClick={signInWithGoogle}
            disabled={busy}
            style={{
              width: '100%',
              padding: '0.8rem',
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '0.75rem',
              color: '#e2e8f0',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.625rem',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
          >
            <GoogleIcon />
            Continue with Google
          </button>
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.78rem', color: '#475569', marginTop: '1.25rem' }}>
          By signing in you agree to Spotlight&apos;s{' '}
          <Link href="/terms" style={{ color: '#64748b', textDecoration: 'underline' }}>Terms of Service</Link>
          {' '}and{' '}
          <Link href="/privacy" style={{ color: '#64748b', textDecoration: 'underline' }}>Privacy Policy</Link>.
        </p>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.07)',
  border: '1.5px solid rgba(255,255,255,0.12)',
  borderRadius: '0.75rem',
  padding: '0.8rem 1rem',
  color: '#f1f5f9',
  fontSize: '0.95rem',
  outline: 'none',
  transition: 'border-color 0.2s, background 0.2s',
  boxSizing: 'border-box',
};

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      style={{ animation: 'spin 0.7s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
