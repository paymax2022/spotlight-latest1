'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listModules,
  setModuleLifecycle,
  setModuleVisibility,
  ModuleApiError,
} from '@/services/modulesService';
import {
  MODULE_ENVIRONMENTS,
  effectiveVisibility,
  type ModuleEnvironment,
  type ModuleRegistry,
  type ModuleStatus,
  type PlatformModule,
} from '@/types/modules';
import { useToasts, ToastStack, ConfirmDialog } from '@/components/rbac';

/** Human copy for confirmations and toasts — 'coming_soon' reads badly in a sentence. */
const STATUS_LABEL: Record<ModuleStatus, string> = {
  hidden: 'hidden',
  coming_soon: 'coming soon (visible but not usable)',
  visible: 'live',
};
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

/** A publish/hide action awaiting confirmation. */
type PendingVisibility = {
  kind: 'visibility';
  module: PlatformModule;
  environment: ModuleEnvironment;
  next: ModuleStatus;
};
type PendingLifecycle = { kind: 'lifecycle'; module: PlatformModule; next: 'active' | 'archived' };
type Pending = PendingVisibility | PendingLifecycle;

export default function ModulesPage() {
  const { toasts, toast, dismiss } = useToasts();

  const [registry, setRegistry] = useState<ModuleRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; status: number } | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  // Keys with a write in flight — guards double-submit per row rather than
  // freezing the whole table while one toggle resolves.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRegistry(await listModules());
    } catch (e) {
      const err = e as ModuleApiError;
      setLoadError({ message: err.message, status: err.status ?? 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set((registry?.modules ?? []).map((m) => m.category));
    return ['all', ...Array.from(set).sort()];
  }, [registry]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (registry?.modules ?? []).filter((m) => {
      if (category !== 'all' && m.category !== category) return false;
      if (!q) return true;
      return (
        m.key.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [registry, query, category]);

  const markBusy = (key: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  /** Replace one module in place, so a write never re-orders or drops the table. */
  const replaceModule = (updated: PlatformModule) =>
    setRegistry((prev) =>
      prev ? { ...prev, modules: prev.modules.map((m) => (m.key === updated.key ? updated : m)) } : prev,
    );

  const applyPending = async () => {
    if (!pending) return;
    const { module } = pending;
    setPending(null);
    markBusy(module.key, true);
    // Snapshot for rollback: the server is the authority, so on failure we restore
    // exactly what we had rather than guessing at the true state.
    const snapshot = module;
    try {
      const updated =
        pending.kind === 'visibility'
          ? await setModuleVisibility(module.key, pending.environment, pending.next)
          : await setModuleLifecycle(module.key, pending.next);
      replaceModule(updated);
      toast.success(
        pending.kind === 'visibility'
          ? `${module.name} is now ${STATUS_LABEL[pending.next as ModuleStatus] ?? pending.next} in ${pending.environment}.`
          : `${module.name} ${pending.next === 'archived' ? 'archived' : 'restored'}.`,
      );
    } catch (e) {
      replaceModule(snapshot);
      toast.error((e as ModuleApiError).message);
    } finally {
      markBusy(module.key, false);
    }
  };

  // ─── States ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Page>
        <PageHeader title="Modules" subtitle="Loading the module registry…" />
        <Card>
          <p style={{ color: colors.muted, margin: 0 }} role="status" aria-live="polite">
            Loading…
          </p>
        </Card>
      </Page>
    );
  }

  if (loadError) {
    const forbidden = loadError.status === 403;
    return (
      <Page>
        <PageHeader title="Modules" />
        <Card>
          <p style={{ margin: '0 0 12px', color: colors.text }}>
            {forbidden
              ? 'You do not have permission to view the module registry (platform.modules.read).'
              : loadError.message}
          </p>
          {/* Not a dead end: an operator without the permission is told who to ask;
              everyone else gets a retry. */}
          {forbidden ? (
            <p style={{ margin: 0, color: colors.muted, fontSize: 13 }}>
              Ask a super-admin to grant <code>platform.modules.read</code>.
            </p>
          ) : (
            <Button onClick={() => void load()}>Try again</Button>
          )}
        </Card>
      </Page>
    );
  }

  const liveEnv = registry?.environment;

  return (
    <Page>
      <PageHeader
        title="Modules"
        subtitle="Publish a module to an environment, or archive it. The code stays in the tree either way."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />

      <Card>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <label htmlFor="module-search" style={{ fontSize: 13, color: colors.muted }}>
            Search
          </label>
          <Input
            id="module-search"
            placeholder="Name, key or description…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <label htmlFor="module-category" style={{ fontSize: 13, color: colors.muted }}>
            Category
          </label>
          <select
            id="module-category"
            className="vx-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: colors.muted }}>
            This console is served by the <strong>{liveEnv}</strong> backend
          </span>
        </div>

        {rows.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>No modules match that filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <caption className="sr-only">
                Modules and their publication status in each environment
              </caption>
              <thead>
                <tr>
                  <th style={thCell} scope="col">Module</th>
                  <th style={thCell} scope="col">Ops flag</th>
                  {MODULE_ENVIRONMENTS.map((e) => (
                    <th key={e} style={thCell} scope="col">
                      {e}
                    </th>
                  ))}
                  <th style={thCell} scope="col">Lifecycle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const rowBusy = busy.has(m.key);
                  const archived = m.lifecycle === 'archived';
                  return (
                    <tr key={m.key} style={{ opacity: archived ? 0.6 : 1 }}>
                      <td style={tdCell}>
                        <div style={{ fontWeight: 600 }}>{m.name}</div>
                        <div style={{ fontSize: 12, color: colors.muted }}>
                          <code>{m.key}</code> · {m.category}
                        </div>
                        {m.description ? (
                          <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{m.description}</div>
                        ) : null}
                      </td>

                      <td style={tdCell}>
                        {m.env_flag ? (
                          <Badge
                            text={m.env_flag_enabled ? 'on' : 'off'}
                            color={m.env_flag_enabled ? colors.primary : colors.muted}
                          />
                        ) : (
                          <span style={{ fontSize: 12, color: colors.muted }}>none</span>
                        )}
                      </td>

                      {MODULE_ENVIRONMENTS.map((envName) => {
                        const st = m.environments[envName];
                        const current: ModuleStatus = st?.status ?? 'hidden';
                        const isVisible = current === 'visible';
                        const eff = effectiveVisibility(m, envName);
                        // Three explicit choices rather than a cycling toggle: an
                        // operator changing production visibility should pick the state
                        // they want, not tap through the other two to reach it.
                        const CHOICES: { value: ModuleStatus; label: string; hint: string }[] = [
                          { value: 'hidden', label: 'Hidden', hint: 'not shown in the app' },
                          { value: 'coming_soon', label: 'Coming soon', hint: 'shown, but not tappable' },
                          { value: 'visible', label: 'Live', hint: 'shown and fully usable' },
                        ];
                        return (
                          <td key={envName} style={tdCell}>
                            <div role="group" aria-label={`${m.name} in ${envName}`} style={{ display: 'flex', gap: 4 }}>
                              {CHOICES.map((c) => (
                                <Button
                                  key={c.value}
                                  sm
                                  variant={current === c.value ? 'primary' : 'outline'}
                                  disabled={rowBusy || archived || current === c.value}
                                  title={c.hint}
                                  aria-label={`Set ${m.name} to ${c.label} in ${envName}`}
                                  aria-pressed={current === c.value}
                                  onClick={() =>
                                    setPending({
                                      kind: 'visibility',
                                      module: m,
                                      environment: envName,
                                      next: c.value,
                                    })
                                  }
                                >
                                  {c.label}
                                </Button>
                              ))}
                            </div>
                            {/* Explains a published-but-dark row instead of leaving
                                the operator to conclude the toggle is broken. */}
                            {isVisible && !eff.visible ? (
                              <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{eff.reason}</div>
                            ) : null}
                          </td>
                        );
                      })}

                      <td style={tdCell}>
                        <Button
                          sm
                          variant={archived ? 'secondary' : 'danger'}
                          disabled={rowBusy}
                          onClick={() =>
                            setPending({ kind: 'lifecycle', module: m, next: archived ? 'active' : 'archived' })
                          }
                        >
                          {archived ? 'Restore' : 'Archive'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={confirmTitle(pending)}
        level={confirmLevel(pending)}
        reasons={confirmReasons(pending)}
        confirmLabel={pending?.kind === 'lifecycle' && pending.next === 'archived' ? 'Archive module' : 'Confirm'}
        onConfirm={() => void applyPending()}
        onCancel={() => setPending(null)}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </Page>
  );
}

function confirmTitle(p: Pending | null): string {
  if (!p) return '';
  if (p.kind === 'lifecycle') {
    return p.next === 'archived' ? `Archive ${p.module.name}?` : `Restore ${p.module.name}?`;
  }
  return p.next === 'visible'
    ? `Publish ${p.module.name} to ${p.environment}?`
    : `Hide ${p.module.name} in ${p.environment}?`;
}

/** Production changes and archiving are the ones users feel immediately. */
function confirmLevel(p: Pending | null): 'warning' | 'critical' {
  if (!p) return 'warning';
  if (p.kind === 'lifecycle') return p.next === 'archived' ? 'critical' : 'warning';
  return p.environment === 'production' ? 'critical' : 'warning';
}

function confirmReasons(p: Pending | null): string[] {
  if (!p) return [];
  if (p.kind === 'lifecycle') {
    return p.next === 'archived'
      ? [
          'Hides the module in every environment, including production.',
          'The source code is untouched — this only removes the surface.',
          'Per-environment publication is remembered, so restoring returns it to exactly this state.',
        ]
      : ['Returns the module to the publication state it had before it was archived.'];
  }
  if (p.environment === 'production' && p.next === 'visible') {
    return [
      'Every production user will be able to see and use this module.',
      'It takes effect on the next visibility fetch — no deploy required.',
      'The ops FEATURE_ flag still applies; if that is off the module stays dark.',
    ];
  }
  if (p.environment === 'production') {
    return ['Production users will immediately stop seeing this module.'];
  }
  return [`Affects the ${p.environment} environment only.`];
}
