'use client';

import { useCallback, useEffect, useState } from 'react';
import { getProviderHealth, runReconciler } from '@/services/cryptoOpsService';
import type { CryptoProviderHealth, CryptoProviderStatus, CryptoReconcileRunResult } from '@/types/cryptoAdmin';
import { CryptoTabs, Kpi, StateBlock, DisclosureNote, AuditNote, PermissionBanner, fmtAge, fmtDate, CRYPTO_PERMS, useCryptoPermission } from '../_ui';
import { Page, PageHeader, Card, Button, colors, tint } from '@/components/ui/vuexy';

// Provider health (workplan QDX-ADM-011) from MEASURED telemetry: every call the Quidax client
// makes is timed and classified server-side; nothing here is estimated. Manual sync
// (QDX-ADM-012) runs one reconcile pass, which re-reads provider state through the normal settle
// path and cannot edit a balance.

const STATUS: Record<CryptoProviderStatus, { fg: string; headline: (p: string) => string }> = {
  ok: { fg: colors.success, headline: (p) => `${p} is healthy` },
  degraded: { fg: colors.warning, headline: (p) => `${p} is degraded` },
  down: { fg: colors.danger, headline: (p) => `${p} is failing` },
  idle: { fg: colors.secondary, headline: (p) => `No calls to ${p} in the last 15 minutes` },
  unknown: { fg: colors.secondary, headline: (p) => `${p} reports no telemetry` },
};

const pct = (r = 0) => `${(r * 100).toFixed(r > 0 && r < 0.01 ? 2 : 1)}%`;

export default function CryptoHealthPage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);
  const [h, setH] = useState<CryptoProviderHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<CryptoReconcileRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setH(await getProviderHealth());
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  async function sync() {
    setRunning(true);
    setRun(null);
    setRunError(null);
    try {
      setRun(await runReconciler());
      await load();
    } catch (e) {
      setRunError(String(e instanceof Error ? e.message : e));
    } finally {
      setRunning(false);
    }
  }

  const s = h ? STATUS[h.status] ?? STATUS.unknown : null;
  const provider = h?.provider ? h.provider.charAt(0).toUpperCase() + h.provider.slice(1) : 'The provider';

  return (
    <Page>
      <PageHeader
        title="Crypto — Provider health"
        subtitle="Measured from every call this backend made to the crypto provider in the last 15 minutes. Refreshes every 30 seconds."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />
      <CryptoTabs active="health" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/provider-health</code>. Figures come from the replica that answered: each replica
        times its own calls. Webhook lag is read from the database, so it is the same on every replica.
      </DisclosureNote>
      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}

      <StateBlock loading={loading && !h} error={error} empty={!loading && !h && !error} emptyText="Provider health is unavailable: the swap pipeline is not running on this environment.">
        {h && s && (
          <>
            <div data-testid="health-headline" style={{ borderLeft: `6px solid ${s.fg}`, background: tint(s.fg, 0.07), borderRadius: '0.5rem', padding: '1rem 1.2rem', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '1.45rem', fontWeight: 800, color: s.fg }}>{s.headline(provider)}</div>
              <div style={{ fontSize: '0.85rem', color: colors.text, marginTop: '0.2rem' }}>
                {h.calls ? `${h.calls} calls, ${h.failures ?? 0} failed, ${h.throttled ?? 0} throttled.` : 'Nothing to measure yet.'}
                {h.last_failure ? ` Last problem: ${h.last_failure} (${fmtDate(h.last_failure_at)}).` : ''}
                {' '}Checked {fmtDate(h.checked_at)}.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div data-testid="kpi-latency"><Kpi label="Latency p50 / p95" value={h.calls ? `${h.p50_ms ?? 0} / ${h.p95_ms ?? 0} ms` : '—'} sub="per call, including retries" /></div>
              <div data-testid="kpi-failures"><Kpi label="Failure rate" value={h.calls ? pct(h.failure_rate) : '—'} sub="transport errors and 5xx" accent={(h.failure_rate ?? 0) > 0.05 ? colors.danger : undefined} /></div>
              <div data-testid="kpi-throttled"><Kpi label="Throttled" value={String(h.throttled ?? 0)} sub="429 / 444 responses" accent={(h.throttled ?? 0) > 0 ? colors.warning : undefined} /></div>
              <div data-testid="kpi-webhook"><Kpi label="Webhook lag" value={h.webhook_lag_seconds == null ? 'none received' : h.webhook_lag_seconds < 60 ? 'under 1 min' : fmtAge(h.webhook_lag_seconds)} sub={h.webhook_last_received_at ? `last ${fmtDate(h.webhook_last_received_at)}` : 'no deliveries recorded'} /></div>
              <div><Kpi label="Last success" value={h.last_success_at ? fmtDate(h.last_success_at) : '—'} /></div>
            </div>

            <Card title="Manual sync">
              <p style={{ fontSize: '0.85rem', color: colors.text, marginTop: 0, maxWidth: 760 }}>
                Runs one reconcile pass now: open swaps are re-read from the provider and settled through the normal path, stale
                quotes expire, and anything uncertain is parked for review. It never edits a balance.
              </p>
              <Button variant="primary" disabled={!canAdmin || running} onClick={() => void sync()}>{running ? 'Syncing…' : 'Sync now'}</Button>
              {runError && <p role="alert" style={{ color: colors.danger, fontSize: '0.85rem' }}>{runError}</p>}
              {run && (
                <AuditNote>
                  Sync finished: {run.resolved} settled, {run.released} released, {run.parked} parked for review, {run.expired} expired, {run.errors} errors. Recorded in the audit log.
                </AuditNote>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
