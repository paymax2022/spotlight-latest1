'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Layout from '@/components/layout/Layout';

export default function OpenMicLoginPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const search = useSearchParams();
  const next = search?.get('next') || '/open-mic/profile';
  const emailHint = search?.get('email') || '';
  const registered = search?.get('registered') === '1';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const inputStyle: React.CSSProperties = {
    height: 44,
    color: '#111827',
    backgroundColor: '#FFFFFF',
    border: '1px solid #D1D5DB',
    borderRadius: 8,
    padding: '0 12px',
  };

  function toReadableAuthError(err: unknown, fallback: string): string {
    const message = err instanceof Error ? err.message : '';
    const lowered = message.toLowerCase();
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? Number((err as { status?: number }).status)
        : undefined;
    if (lowered.includes('failed to fetch') || lowered.includes('err_connection_refused')) {
      return 'Authentication service is currently unreachable. Please ensure local Supabase/Docker is running and try again.';
    }
    if (status === 422 || lowered.includes('unprocessable')) {
      return message || 'Sign up request is invalid. This email may already be registered, or password format is not accepted.';
    }
    if (lowered.includes('already registered') || lowered.includes('user already registered')) {
      return 'This email already has an account. Please sign in instead.';
    }
    if (lowered.includes('invalid login credentials')) {
      return 'Invalid email or password. If you just created this account, use the same password you registered with.';
    }
    return message || fallback;
  }

  useEffect(() => {
    if (emailHint && !email) {
      setEmail(emailHint);
    }
    if (registered) {
      setInfo('Account created successfully. Please sign in.');
    }
  }, [emailHint, email, registered]);

  async function signIn() {
    setBusy(true);
    setError('');
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (signInError) throw signInError;
      router.push(next);
    } catch (err) {
      setError(toReadableAuthError(err, 'Sign in failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Open Mic Login"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section
        className="about-section section-padding fix bg-cover"
        style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}
      >
        <div className="container">
          <h1>Open Mic Login</h1>
          <section className="p-4 border rounded bg-white mt-4">
            <div className="d-flex flex-column gap-2">
              <input
                className="form-input"
                style={inputStyle}
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                className="form-input"
                style={inputStyle}
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="d-flex gap-2">
                <button type="button" className="btn-primary py-2 px-3 text-xs" disabled={busy} onClick={() => void signIn()}>
                  {busy ? 'Please wait...' : 'Sign In'}
                </button>
                <Link href={`/open-mic/register?next=${encodeURIComponent(next)}`} className="btn-outline py-2 px-3 text-xs">
                  Create Account
                </Link>
              </div>
              {error ? <p className="text-sm text-red-500 mb-0">{error}</p> : null}
              {info ? <p className="text-sm text-green-700 mb-0">{info}</p> : null}
              <p className="text-sm mb-0">
                <Link href="/open-mic" className="underline">Back to Open Mic</Link>
              </p>
            </div>
          </section>
        </div>
      </section>
    </Layout>
  );
}
