'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Layout from '@/components/layout/Layout';

export default function OpenMicRegisterPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const search = useSearchParams();
  const next = search?.get('next') || '/open-mic/profile';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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
    return message || fallback;
  }

  async function signUp() {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) throw new Error('Email is required.');
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');
      if (password !== confirmPassword) throw new Error('Passwords do not match.');

      const { data, error: signUpError } = await supabase.auth.signUp({ email: normalizedEmail, password });
      if (signUpError) throw signUpError;
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('This email already has an account. Please sign in instead.');
      }

      if (data?.session?.access_token) {
        router.push(next);
        return;
      }

      setSuccess('Account created. Please sign in to continue.');
      router.push(`/open-mic/login?next=${encodeURIComponent(next)}&email=${encodeURIComponent(normalizedEmail)}&registered=1`);
    } catch (err) {
      setError(toReadableAuthError(err, 'Sign up failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Create Open Mic Account"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section
        className="about-section section-padding fix bg-cover"
        style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}
      >
        <div className="container">
          <h1>Create Open Mic Account</h1>
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
              <input
                className="form-input"
                style={inputStyle}
                type="password"
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <div className="d-flex gap-2">
                <button type="button" className="btn-primary py-2 px-3 text-xs" disabled={busy} onClick={() => void signUp()}>
                  {busy ? 'Please wait...' : 'Create Account'}
                </button>
                <Link href={`/open-mic/login?next=${encodeURIComponent(next)}`} className="btn-outline py-2 px-3 text-xs">
                  Back to Login
                </Link>
              </div>
              {error ? <p className="text-sm text-red-500 mb-0">{error}</p> : null}
              {success ? <p className="text-sm text-green-700 mb-0">{success}</p> : null}
            </div>
          </section>
        </div>
      </section>
    </Layout>
  );
}
