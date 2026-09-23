'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInAdmin } from '@/features/auth/adminAuth';
import { syncAdminSession } from '@/features/auth/adminSession';
import { createAdminAccount, fetchAdminSignupOptions, type AdminSignupOptions } from '@/features/auth/adminSignup';

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Create-admin panel ────────────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false);
  const [options, setOptions] = useState<AdminSignupOptions | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [roleSlug, setRoleSlug] = useState('');
  const [permissionSlugs, setPermissionSlugs] = useState<string[]>([]);
  const [permFilter, setPermFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [created, setCreated] = useState<{ email: string; roleSlug: string; extra: string[] } | null>(null);

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

  // Options are fetched on first open, not on mount: the panel's role and
  // permission catalog is server data, and most visitors are here to sign in.
  useEffect(() => {
    if (!panelOpen || options || optionsError) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await fetchAdminSignupOptions();
        if (cancelled) return;
        setOptions(loaded);
        const first = loaded.roles[0]?.slug ?? '';
        setRoleSlug((current) => current || first);
      } catch (err) {
        if (!cancelled) setOptionsError(err instanceof Error ? err.message : 'Could not load the signup form.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [panelOpen, options, optionsError]);

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, AdminSignupOptions['permissions']>();
    for (const perm of options?.permissions ?? []) {
      const list = groups.get(perm.module);
      if (list) list.push(perm);
      else groups.set(perm.module, [perm]);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [options]);

  const filter = permFilter.trim().toLowerCase();
  const visibleGroups = filter
    ? permissionGroups
        .map(([module, list]) => [
          module,
          list.filter(
            (p) =>
              p.slug.toLowerCase().includes(filter) ||
              p.name.toLowerCase().includes(filter) ||
              module.toLowerCase().includes(filter),
          ),
        ] as const)
        .filter(([, list]) => list.length > 0)
    : permissionGroups;

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

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (!options) return;
    if (newPassword !== confirmPassword) {
      setCreateError('The two passwords do not match.');
      return;
    }
    setCreating(true);
    try {
      const result = await createAdminAccount({
        email: newEmail,
        password: newPassword,
        fullName: newName,
        roleSlug,
        permissionSlugs,
        setupCode,
      });
      setCreated({ email: result.user.email, roleSlug: result.roleSlug, extra: result.extraPermissions });
      setUsername(result.user.email);
      setNewEmail('');
      setNewName('');
      setNewPassword('');
      setConfirmPassword('');
      setSetupCode('');
      setPermissionSlugs([]);
      setPermFilter('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'The account could not be created.');
    } finally {
      setCreating(false);
    }
  };

  const togglePermission = (slug: string) => {
    setPermissionSlugs((current) =>
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    );
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

      {!panelOpen ? (
        <button type="button" onClick={() => setPanelOpen(true)}>
          Create admin account
        </button>
      ) : (
        <section>
          <h2 style={{ fontSize: 18 }}>Create admin account</h2>

          {optionsError ? <p style={{ color: 'crimson' }}>{optionsError}</p> : null}
          {!options && !optionsError ? <p style={{ color: '#666' }}>Loading…</p> : null}

          {created ? (
            <p style={{ color: 'seagreen' }}>
              Created <strong>{created.email}</strong> with the {created.roleSlug} role
              {created.extra.length > 0 ? ` (+${created.extra.length} extra permission${created.extra.length === 1 ? '' : 's'})` : ''}.
              They can sign in above now.
            </p>
          ) : null}

          {options ? (
            options.enabled ? (
              <form onSubmit={onCreate} style={{ display: 'grid', gap: 12 }}>
                <p style={{ color: '#666', margin: 0 }}>{options.message}</p>

                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Full name (optional)"
                />
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="email@example.com"
                  required
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={`password (min ${options.minPasswordLength} chars)`}
                  required
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="confirm password"
                  required
                />

                {options.requiresCode ? (
                  <input
                    type="password"
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value)}
                    placeholder="setup code"
                    required
                  />
                ) : null}

                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 13, color: '#444' }}>Privilege</span>
                  <select value={roleSlug} onChange={(e) => setRoleSlug(e.target.value)} required>
                    {options.roles.map((role) => (
                      <option key={role.slug} value={role.slug}>{role.name}</option>
                    ))}
                  </select>
                </label>

                {options.permissions.length > 0 ? (
                  <details>
                    <summary style={{ cursor: 'pointer' }}>
                      Extra permissions {permissionSlugs.length > 0 ? `(${permissionSlugs.length} selected)` : '(optional)'}
                    </summary>
                    <p style={{ color: '#666', fontSize: 12, margin: '8px 0' }}>
                      The role already carries its own permissions. Anything ticked here is granted on top of it.
                    </p>
                    <input
                      value={permFilter}
                      onChange={(e) => setPermFilter(e.target.value)}
                      placeholder="Filter permissions"
                    />
                    <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 8 }}>
                      {visibleGroups.map(([module, list]) => (
                        <div key={module} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#888' }}>{module}</div>
                          {list.map((perm) => (
                            <label key={perm.slug} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                              <input
                                type="checkbox"
                                checked={permissionSlugs.includes(perm.slug)}
                                onChange={() => togglePermission(perm.slug)}
                              />
                              <span>{perm.name}</span>
                            </label>
                          ))}
                        </div>
                      ))}
                      {visibleGroups.length === 0 ? <p style={{ color: '#666', fontSize: 13 }}>No matches.</p> : null}
                    </div>
                  </details>
                ) : null}

                {createError ? <p style={{ color: 'crimson' }}>{createError}</p> : null}
                <button type="submit" disabled={creating}>
                  {creating ? 'Creating...' : 'Create account'}
                </button>
                <button type="button" onClick={() => setPanelOpen(false)} disabled={creating}>
                  Cancel
                </button>
              </form>
            ) : (
              <p style={{ color: '#666' }}>{options.message}</p>
            )
          ) : null}
        </section>
      )}
    </div>
  );
}
