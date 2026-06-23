'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [ready, setReady]       = useState(false); // session verified
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [done, setDone]         = useState(false);

  // Supabase puts the recovery token in the URL hash as
  // #access_token=...&type=recovery after the user clicks the email link.
  // The JS client parses the hash automatically and fires PASSWORD_RECOVERY.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });

    // Also mark ready when the session is already live (e.g. page refresh after
    // Supabase has already processed the hash token).
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) setReady(true);
    })();

    return () => subscription.unsubscribe();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const { error: e } = await supabase.auth.updateUser({ password });
      if (e) throw e;
      setDone(true);
      setTimeout(() => router.replace('/login'), 2500);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update password. The link may have expired.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main style={page}>
        <div style={card}>
          <h1 style={heading}>Password updated</h1>
          <p style={sub}>Your password has been changed. Redirecting you to sign in…</p>
        </div>
      </main>
    );
  }

  if (!ready) {
    return (
      <main style={page}>
        <div style={card}>
          <h1 style={heading}>Checking reset link…</h1>
          <p style={sub}>
            If nothing happens, the link may have expired.{' '}
            <a href="/login" style={link}>Request a new one</a>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={page}>
      <div style={card}>
        <h1 style={heading}>Set new password</h1>
        <p style={sub}>Choose a password that's at least 8 characters.</p>

        <form onSubmit={handleSubmit} style={form}>
          <label style={label}>
            New password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Min. 8 characters"
              style={input}
            />
          </label>
          <label style={label}>
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              placeholder="Re-enter your password"
              style={input}
            />
          </label>

          {error && <p style={errorStyle}>{error}</p>}

          <button type="submit" disabled={busy} style={btnStyle}>
            {busy ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>
    </main>
  );
}

// ── Inline styles (no Tailwind dependency — page renders before CSS hydration) ──

const page: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f8f9ff',
  padding: '1.5rem',
};
const card: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '12px',
  padding: '2.5rem 2rem',
  width: '100%',
  maxWidth: '400px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
};
const heading: React.CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '1.5rem',
  fontWeight: 700,
  color: '#0b1c30',
};
const sub: React.CSSProperties = {
  margin: '0 0 1.5rem',
  fontSize: '0.9rem',
  color: '#4a4452',
};
const form: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '1rem' };
const label: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.375rem',
  fontSize: '0.85rem',
  fontWeight: 600,
  color: '#0b1c30',
};
const input: React.CSSProperties = {
  padding: '0.625rem 0.875rem',
  borderRadius: '8px',
  border: '1.5px solid #ccc3d4',
  fontSize: '0.95rem',
  outline: 'none',
};
const btnStyle: React.CSSProperties = {
  marginTop: '0.5rem',
  padding: '0.75rem',
  borderRadius: '8px',
  border: 'none',
  background: '#340075',
  color: '#ffffff',
  fontSize: '1rem',
  fontWeight: 600,
  cursor: 'pointer',
};
const errorStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  color: '#ba1a1a',
  margin: '0',
};
const link: React.CSSProperties = { color: '#340075' };
