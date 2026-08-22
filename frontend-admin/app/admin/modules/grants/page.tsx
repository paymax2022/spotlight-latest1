'use client';

/**
 * Per-user module grants.
 *
 * Opens a RESTRICTED module for one user who has not completed KYC — the common case,
 * since the large majority of profiles sit at KYC tier 0.
 *
 * The copy on this page deliberately repeats that a grant does NOT lift money limits.
 * An operator who believes this unlocks payments will hand it out for the wrong reason,
 * and the server would silently keep refusing the transaction — which reads as a bug
 * rather than as the control it is.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listModules,
  listUserGrants,
  grantUserModule,
  revokeUserModule,
  ModuleApiError,
  type UserModuleGrant,
} from '@/services/modulesService';
import type { ModuleRegistry, PlatformModule } from '@/types/modules';
import { useToasts, ToastStack } from '@/components/rbac';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function ModuleGrantsPage() {
  const { toasts, toast, dismiss } = useToasts();
  const [userId, setUserId] = useState('');
  const [loadedFor, setLoadedFor] = useState('');
  const [grants, setGrants] = useState<UserModuleGrant[]>([]);
  const [registry, setRegistry] = useState<ModuleRegistry | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    listModules().then(setRegistry).catch(() => setRegistry(null));
  }, []);

  // Only RESTRICTED modules are grantable. A 'general' module is already open to every
  // signed-in user, so offering to grant it would imply an effect it does not have.
  const grantable = useMemo<PlatformModule[]>(
    () => (registry?.modules ?? []).filter((m) => m.access_level === 'restricted'),
    [registry],
  );

  const load = useCallback(async (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await listUserGrants(trimmed);
      setGrants(res.grants ?? []);
      setLoadedFor(trimmed);
    } catch (e) {
      toast.error((e as ModuleApiError).message);
      setGrants([]);
      setLoadedFor('');
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await load(loadedFor);
    } catch (e) {
      toast.error((e as ModuleApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const activeKeys = new Set(grants.filter((g) => g.active).map((g) => g.module_key));

  return (
    <Page>
      <PageHeader
        title="Module grants"
        subtitle="Open a restricted module for a user who has not completed KYC."
      />
      <ToastStack toasts={toasts} onDismiss={dismiss} />

      <Card>
        <p style={{ margin: '0 0 12px', color: colors.muted, fontSize: 13, lineHeight: 1.5 }}>
          A grant controls <strong>module access only</strong>. It does <strong>not</strong> raise the
          user&apos;s KYC tier and does <strong>not</strong> lift wallet, transfer or escrow limits —
          those still follow the user&apos;s verification level. Use it to let someone browse and use
          a module&apos;s non-payment features while their verification is pending.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 340px' }}>
            <label htmlFor="grant-user" style={{ display: 'block', fontSize: 13, color: colors.muted, marginBottom: 4 }}>
              User ID
            </label>
            <Input
              id="grant-user"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void load(userId); }}
            />
          </div>
          <Button onClick={() => void load(userId)} disabled={busy || !userId.trim()}>
            Load grants
          </Button>
        </div>
      </Card>

      {loadedFor ? (
        <Card>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13 }}>User</strong>
            <code style={{ fontSize: 12, color: colors.muted }}>{loadedFor}</code>
          </div>

          <label htmlFor="grant-note" style={{ display: 'block', fontSize: 13, color: colors.muted, marginBottom: 4 }}>
            Note (recorded on the grant)
          </label>
          <Input
            id="grant-note"
            placeholder="e.g. support ticket 1234 — verification pending"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead>
              <tr>
                <th style={thCell}>Module</th>
                <th style={thCell}>Status</th>
                <th style={thCell}>Expires</th>
                <th style={thCell}>Action</th>
              </tr>
            </thead>
            <tbody>
              {grantable.length === 0 ? (
                <tr>
                  <td style={tdCell} colSpan={4}>
                    <span style={{ color: colors.muted, fontSize: 13 }}>
                      No restricted modules yet. Mark a module as restricted in the module registry
                      first — until then every module is open to all signed-in users and a grant
                      would have no effect.
                    </span>
                  </td>
                </tr>
              ) : grantable.map((m) => {
                const active = activeKeys.has(m.key);
                const row = grants.find((g) => g.module_key === m.key);
                return (
                  <tr key={m.key}>
                    <td style={tdCell}>
                      <div style={{ fontWeight: 600 }}>{m.name}</div>
                      <code style={{ fontSize: 11, color: colors.muted }}>{m.key}</code>
                    </td>
                    <td style={tdCell}>
                      {active
                        ? <Badge text="Granted" color={colors.primary} />
                        : row
                          ? <Badge text={row.revoked_at ? 'Revoked' : 'Expired'} color={colors.muted} />
                          : <Badge text="Not granted" color={colors.muted} />}
                    </td>
                    <td style={tdCell}>
                      <span style={{ fontSize: 12, color: colors.muted }}>
                        {row?.expires_at ? new Date(row.expires_at).toLocaleString() : '—'}
                      </span>
                    </td>
                    <td style={tdCell}>
                      {active ? (
                        <Button
                          sm
                          variant="danger"
                          disabled={busy}
                          onClick={() => void act(() => revokeUserModule(loadedFor, m.key), `${m.name} revoked.`)}
                        >
                          Revoke
                        </Button>
                      ) : (
                        <Button
                          sm
                          disabled={busy}
                          onClick={() => void act(
                            () => grantUserModule(loadedFor, m.key, { note: note.trim() || undefined }),
                            `${m.name} granted.`,
                          )}
                        >
                          Grant
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}
    </Page>
  );
}
