'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function AdminLoginPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams?.get('next') || '/admin';
  const isForbidden = searchParams?.get('error') === 'forbidden';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(isForbidden ? 'Your account does not have admin access.' : '');
  const [showPassword, setShowPassword] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authError) throw authError;

      // Role is embedded in app_metadata (set via service-role API).
      // RLS blocks the anon client from reading user_profiles directly,
      // so we rely on the JWT payload — no extra DB round-trip needed.
      const role =
        data.user.app_metadata?.role ||
        data.user.user_metadata?.role;

      if (role !== 'admin') {
        await supabase.auth.signOut();
        setError('This account does not have admin access. Contact the system administrator.');
        return;
      }

      router.replace(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('invalid login credentials')) {
        setError('Invalid email or password.');
      } else {
        setError(msg || 'Sign in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.root}>
      <div style={styles.card}>
        <div style={styles.logoWrap}>
          <span style={styles.logo}>Spotlight</span>
          <span style={styles.logoDot}>.</span>
          <span style={styles.logoTag}>Admin</span>
        </div>
        <p style={styles.sub}>Sign in to access the admin dashboard</p>

        <form onSubmit={signIn} style={styles.form}>
          <div>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@spotlight.internal"
              autoComplete="username"
              required
              style={styles.input}
            />
          </div>

          <div style={{ position: 'relative' }}>
            <label style={styles.label}>Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your admin password"
              autoComplete="current-password"
              required
              style={{ ...styles.input, paddingRight: '3rem' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              style={styles.eyeBtn}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>

          {error && <div style={styles.errorBox}>{error}</div>}

          <button
            type="submit"
            disabled={busy || !email || !password}
            style={{
              ...styles.submitBtn,
              opacity: busy || !email || !password ? 0.5 : 1,
              cursor: busy || !email || !password ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
    padding: '1.5rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '1.25rem',
    padding: '2rem',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
  },
  logoWrap: { display: 'flex', alignItems: 'baseline', gap: '0.2rem', marginBottom: '0.25rem' },
  logo: { fontSize: '1.8rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' },
  logoDot: { fontSize: '1.8rem', fontWeight: 800, color: '#f59e0b' },
  logoTag: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.15)',
    border: '1px solid rgba(245,158,11,0.4)',
    borderRadius: '0.375rem',
    padding: '0.1rem 0.4rem',
    marginLeft: '0.25rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  sub: { color: '#94a3b8', fontSize: '0.88rem', marginTop: 0, marginBottom: '1.75rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  label: {
    display: 'block',
    color: '#cbd5e1',
    fontSize: '0.78rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: '0.4rem',
  },
  input: {
    width: '100%',
    background: 'rgba(255,255,255,0.07)',
    border: '1.5px solid rgba(255,255,255,0.12)',
    borderRadius: '0.75rem',
    padding: '0.8rem 1rem',
    color: '#f1f5f9',
    fontSize: '0.95rem',
    outline: 'none',
    boxSizing: 'border-box',
  },
  eyeBtn: {
    position: 'absolute',
    right: '0.875rem',
    bottom: '0.7rem',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1rem',
    lineHeight: 1,
  },
  errorBox: {
    background: 'rgba(239,68,68,0.15)',
    border: '1px solid rgba(239,68,68,0.4)',
    borderRadius: '0.625rem',
    padding: '0.75rem 1rem',
    color: '#fca5a5',
    fontSize: '0.85rem',
  },
  submitBtn: {
    width: '100%',
    padding: '0.875rem',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: '#000',
    border: 'none',
    borderRadius: '0.75rem',
    fontSize: '0.95rem',
    fontWeight: 700,
    letterSpacing: '0.01em',
    marginTop: '0.25rem',
    boxShadow: '0 4px 15px rgba(245,158,11,0.35)',
    transition: 'opacity 0.2s',
  },
};
