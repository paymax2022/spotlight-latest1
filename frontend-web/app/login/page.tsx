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

  useEffect(() => {
    if (emailHint) setEmail(emailHint);
    if (registered) setInfo('Account created! Please sign in.');
  }, [emailHint, registered]);

  async function signIn() {
    setBusy(true);
    setError('');
    try {
      const { error: e } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
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
      const { error: e } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { full_name: name.trim() || email } },
      });
      if (e) throw e;
      setInfo('Account created! Please check your email to confirm, then sign in.');
      setTab('signin');
    } catch (err) {
      setError(toReadableAuthError(err, 'Sign up failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    try {
      // signInWithOAuth is only available on the real Supabase client, not the dev fallback.
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

  const inputCls =
    'w-full bg-gray-800 border border-gray-700 focus:border-amber-500 focus:outline-none rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 transition-colors';

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="text-2xl font-bold text-white">Spotlight</span>
            <span className="text-amber-500 text-2xl font-bold">.</span>
          </Link>
          <p className="text-gray-400 text-sm mt-2">Sign in to vote, compete, and explore</p>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 shadow-2xl">
          {/* Tabs */}
          <div className="flex gap-1 bg-gray-800 rounded-xl p-1 mb-6">
            <button
              onClick={() => { setTab('signin'); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === 'signin' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setTab('signup'); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === 'signup' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          <div className="space-y-3">
            {tab === 'signup' && (
              <input
                type="text"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
              />
            )}
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (tab === 'signin' ? signIn() : signUp())}
              className={inputCls}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (tab === 'signin' ? signIn() : signUp())}
              className={inputCls}
            />

            {error && <p className="text-red-400 text-sm bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
            {info && <p className="text-green-400 text-sm bg-green-500/10 rounded-lg px-3 py-2">{info}</p>}

            <button
              onClick={tab === 'signin' ? signIn : signUp}
              disabled={busy || !email || !password}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold py-3 rounded-xl transition-all text-sm"
            >
              {busy ? 'Please wait…' : tab === 'signin' ? 'Sign In' : 'Create Account'}
            </button>

            <div className="relative flex items-center gap-2">
              <div className="flex-1 h-px bg-gray-700" />
              <span className="text-gray-600 text-xs">or</span>
              <div className="flex-1 h-px bg-gray-700" />
            </div>

            <button
              onClick={signInWithGoogle}
              disabled={busy}
              className="w-full border border-gray-700 hover:border-gray-500 text-white py-3 rounded-xl text-sm flex items-center justify-center gap-2 transition-all"
            >
              <GoogleIcon />
              Continue with Google
            </button>
          </div>

          {tab === 'signin' && (
            <p className="text-center text-xs text-gray-600 mt-4">
              <Link href="/forgot-password" className="text-amber-500 hover:text-amber-400 underline">
                Forgot password?
              </Link>
            </p>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-4">
          By signing in you agree to Spotlight's{' '}
          <Link href="/terms" className="text-gray-500 underline">Terms of Service</Link>
          {' '}and{' '}
          <Link href="/privacy" className="text-gray-500 underline">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
