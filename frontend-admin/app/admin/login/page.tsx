'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInAdmin } from '@/features/auth/adminAuth';
import { syncAdminSession } from '@/features/auth/adminSession';
import { AdminSignupPanel } from '@/features/auth/AdminSignupPanel';

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // Drop a dead session's leftovers on arrival.
  //
  // middleware.ts (ADR-047) is the real gate and redirects here server-side, so
  // AdminRouteGuard's effect — the only thing that clears expired keys — never
  // runs on that path. The identity therefore outlived the session in
  // localStorage, and roughly two dozen screens read it straight from there.
  //
  // syncAdminSession() is the safe way to do this: it clears the token and the
  // user record ONLY when Supabase has no recoverable session. Wiping them
  // unconditionally would sign out anyone who merely visited /admin/login with
  // a valid session, and the guard would then bounce them straight back here
  // for want of the record it reads first.
  useEffect(() => { void syncAdminSession(); }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInAdmin(username, password);
      router.push('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420 }}>
      <h1>Admin Login</h1>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
        />
        {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
        <button type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
      </form>

      <hr style={{ margin: '24px 0', border: 0, borderTop: '1px solid #ddd' }} />

      {/* The same panel has its own page at /admin/admins/new, linked from the
          sidebar — signing in is not the only reason to be here, and a signed-in
          operator never sees this screen. */}
      {!panelOpen ? (
        <button type="button" onClick={() => setPanelOpen(true)}>
          Create admin account
        </button>
      ) : (
        <AdminSignupPanel
          title="Create admin account"
          onCancel={() => setPanelOpen(false)}
          onCreated={setUsername}
        />
      )}
    </div>
  );
}
