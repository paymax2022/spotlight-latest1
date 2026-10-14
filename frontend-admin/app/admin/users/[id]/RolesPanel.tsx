'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminUsersRequestError, assignUserRole, getUserRoles, removeUserRole } from '@/services/usersService';
import { listRoles } from '@/services/rbacAdminService';
import type { Role } from '@/types/rbac';
import { Card, Button, colors } from '@/components/ui/vuexy';

type Held = { slug: string; id: string | null; name: string };

/**
 * Roles panel for the admin user profile. Self-contained: owns its own
 * loading/empty/error/403 state so a failure never affects sibling panels.
 * Management controls are always shown; the backend enforces
 * `users.roles.assign` and failures are surfaced inline.
 */
export default function RolesPanel({ userId }: { userId: string }) {
  const [slugs, setSlugs] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const [s, c] = await Promise.all([getUserRoles(userId), listRoles()]);
      setSlugs(s);
      setCatalog(c);
    } catch (err) {
      if (err instanceof AdminUsersRequestError && err.status === 403) {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : 'Loading roles failed.');
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const held: Held[] = useMemo(
    () =>
      slugs.map((slug) => {
        const r = catalog.find((c) => c.slug === slug);
        return { slug, id: r?.id ?? null, name: r?.name || slug };
      }),
    [slugs, catalog],
  );
  const catalogMissing = catalog.length === 0 && slugs.length > 0;
  const available = useMemo(() => catalog.filter((r) => !slugs.includes(r.slug)), [catalog, slugs]);

  const run = async (fn: () => Promise<boolean>, failMsg: string) => {
    setBusy(true);
    setActionError(null);
    try {
      if (!(await fn())) {
        setActionError(failMsg);
        return;
      }
      setSelected('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : failMsg);
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (loading) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>Loading roles…</p>;
  } else if (forbidden) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>You don&apos;t have permission to view this.</p>;
  } else if (error) {
    body = (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{error}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </div>
    );
  } else {
    body = (
      <div style={{ display: 'grid', gap: 12 }}>
        {held.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>No roles assigned</p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {held.map((h) => (
              <span
                key={h.slug}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 12, fontSize: 12, border: `1px solid ${colors.info}`, color: colors.info }}
              >
                {h.name}
                <button
                  type="button"
                  aria-label={`Remove ${h.name}`}
                  disabled={busy || !h.id}
                  title={h.id ? undefined : 'Role catalog unavailable'}
                  onClick={() => h.id && void run(() => removeUserRole(userId, h.id as string), 'Removing role failed. Check permissions.')}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 12 }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            aria-label="Assign role"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={busy}
            style={{ padding: '6px 8px', fontSize: 13 }}
          >
            <option value="">Select a role…</option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <Button
            variant="primary"
            sm
            disabled={busy || !selected}
            onClick={() => void run(() => assignUserRole(userId, selected), 'Assigning role failed. Check permissions.')}
          >
            Assign
          </Button>
        </div>
        {catalogMissing ? (
          <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>Role catalog unavailable — management disabled</p>
        ) : null}
        {actionError ? <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{actionError}</p> : null}
      </div>
    );
  }

  return (
    <Card title="Roles">
      <div style={{ marginTop: 8 }}>{body}</div>
    </Card>
  );
}

export { RolesPanel };
