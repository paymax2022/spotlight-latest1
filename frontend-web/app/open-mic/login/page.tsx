'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function OpenMicLoginPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const search = useSearchParams();
  const next = search?.get('next') || '/open-mic/profile';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn() {
    setBusy(true);
    setError('');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  async function signUp() {
    setBusy(true);
    setError('');
    try {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;
      await signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
      setBusy(false);
    }
  }

  return (
    <main className="container py-5">
      <h1>Open Mic Login</h1>
      <section className="p-4 border rounded bg-white mt-4">
        <div className="d-flex flex-column gap-2">
          <input className="form-input h-[44px]" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="form-input h-[44px]" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="d-flex gap-2">
            <button type="button" className="btn-primary py-2 px-3 text-xs" disabled={busy} onClick={() => void signIn()}>
              {busy ? 'Please wait...' : 'Sign In'}
            </button>
            <button type="button" className="btn-outline py-2 px-3 text-xs" disabled={busy} onClick={() => void signUp()}>
              Create Account
            </button>
          </div>
          {error ? <p className="text-sm text-red-500 mb-0">{error}</p> : null}
          <p className="text-sm mb-0">
            <Link href="/open-mic" className="underline">Back to Open Mic</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
