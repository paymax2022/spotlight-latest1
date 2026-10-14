'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { adminGetReconcilerStatus, formatKobo } from '@/services/cryptoAdminService';
import type { CryptoReconcilerStatus } from '@/types/cryptoAdmin';
import { CryptoTabs, Kpi, StateBlock, DisclosureNote, fmtAge, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

// The reconciler runs every 30 s by default; this many minutes without a pass means it is not running.
const STALE_AFTER_MINUTES = 5;

const STATE_LABEL: Record<string, string> = {
  needs_review: 'Needs review (parked)',
  confirming: 'Confirming',
  processing: 'Processing at provider',
  quoted: 'Quoted (unconfirmed)',
};

const minutesSince = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / 60_000);

export default function CryptoReconcilerPage() {
  const [data, setData] = useState<CryptoReconcilerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminGetReconcilerStatus());
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const r = data?.replica;
  const now = Date.now();

  // What a human needs to see first: is the repair loop alive, and is anything wrong?
  const alerts: string[] = [];
  let health = '';
  if (r) {
    if (r.runs === 0 || !r.last_run_at) {
      health = 'No pass recorded yet on this replica (it has just started, or the reconciler is not running).';
    } else {
      const stale = minutesSince(r.last_run_at, now);
      health = r.last_led
        ? `This replica is leading: ${r.led_runs} pass(es) led, last at ${fmtDate(r.last_run_at)}.`
        : `This replica is a follower: another replica leads, so it skips passes (${r.skipped_runs} skipped). That is normal.`;
      if (stale >= STALE_AFTER_MINUTES) alerts.push(`No pass has run on this replica for ${stale} minutes (expected about every 30 seconds).`);
    }
    if (r.last_error) alerts.push(`The last pass failed: ${r.last_error}`);
    if (r.last_result.clearing_negative) alerts.push('The crypto clearing balance is negative: treasury must fund clearing.');
  }

  const open = (data?.backlog ?? []);
  const parked = open.find((b) => b.state === 'needs_review');
  const anyWaiting = open.some((b) => b.count > 0);

  return (
    <Page>
      <PageHeader
        title="Crypto — Swap Reconciler"
        subtitle="The safety net that repairs swaps a crash or a lost webhook left behind, and the swaps still waiting on it."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />
      <CryptoTabs active="reconciler" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/reconciler</code> (RBAC <code>crypto.admin</code>), read-only. Open swaps and
        the NGN held for them come from the database, so they are the same whichever replica answers. The activity
        below is in-process state of the replica that answered: only the elected leader does work, and the counters
        reset when it restarts.
      </DisclosureNote>

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <StateBlock loading={loading && !data} error={null} empty={!loading && !data && !error} emptyText="Reconciler status is unavailable: the swap pipeline is not enabled here, or this replica runs no reconciler.">
        {r && data && (
          <>
            <div data-testid="health" style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.7rem 0.9rem', marginBottom: '0.75rem', fontSize: '0.85rem', background: colors.card }}>
              {health}
            </div>
            {alerts.length > 0 && (
              <div data-testid="health-alert" style={{ border: `1px solid ${tint(colors.danger, 0.4)}`, background: tint(colors.danger, 0.08), color: colors.danger, borderRadius: '0.5rem', padding: '0.7rem 0.9rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                {alerts.map((a) => <div key={a}>{a}</div>)}
              </div>
            )}

            <Card title="Swaps waiting">
              {!anyWaiting && <p style={{ color: colors.muted, margin: '0 0 0.75rem', fontSize: '0.85rem' }}>Nothing is waiting: no open swaps are holding money.</p>}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={thCell}>State</th><th style={thCell}>Swaps</th><th style={thCell}>NGN held</th><th style={thCell}>Oldest</th>
                </tr></thead>
                <tbody>
                  {open.map((b) => (
                    <tr key={b.state} data-testid={`backlog-${b.state}`} style={b.state === 'needs_review' && b.count > 0 ? { background: tint(colors.danger, 0.08) } : undefined}>
                      <td style={tdCell}>{STATE_LABEL[b.state] ?? b.state}</td>
                      <td style={tdCell}><strong>{b.count}</strong></td>
                      <td style={tdCell}>{formatKobo(b.held_kobo)}</td>
                      <td style={tdCell}>{b.count > 0 ? fmtAge(b.oldest_age_seconds) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parked && parked.count > 0 && (
                <p style={{ margin: '0.75rem 0 0', fontSize: '0.85rem', color: colors.danger }}>
                  {parked.count} swap(s) are parked with {formatKobo(parked.held_kobo)} held. Decide them in the{' '}
                  <Link href="/admin/crypto/review">review queue</Link>.
                </p>
              )}
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Passes (this replica)" value={String(r.runs)} sub={`${r.led_runs} led · ${r.skipped_runs} skipped`} />
              <Kpi label="Last pass" value={r.last_run_at ? fmtDate(r.last_run_at) : '—'} />
              <Kpi label="Last pass did" value={`${r.last_result.resolved} resolved`} sub={`${r.last_result.released} released · ${r.last_result.parked} parked · ${r.last_result.expired} expired · ${r.last_result.errors} errors`} />
              <div data-testid="totals">
                <Kpi label="Since restart" value={`${r.totals.resolved} resolved`} sub={`${r.totals.released} released · ${r.totals.parked} parked · ${r.totals.expired} expired · ${r.totals.errors} errors`} />
              </div>
            </div>

            <Card title="Recent alerts">
              <StateBlock loading={false} error={null} empty={r.recent_alerts.length === 0} emptyText="No alerts since this replica started.">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>When</th><th style={thCell}>Kind</th><th style={thCell}>Message</th></tr></thead>
                  <tbody>
                    {r.recent_alerts.map((a, i) => (
                      <tr key={`${a.at}-${i}`} data-testid="alert-row">
                        <td style={tdCell}>{fmtDate(a.at)}</td>
                        <td style={tdCell}><code>{a.kind}</code></td>
                        <td style={tdCell}>{a.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StateBlock>
            </Card>

            <p style={{ color: colors.muted, fontSize: '0.75rem' }}>{data.note}</p>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
