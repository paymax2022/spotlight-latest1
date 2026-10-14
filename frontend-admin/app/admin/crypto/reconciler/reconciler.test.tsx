/**
 * Swap reconciler tab. Read-only: it answers "is the repair loop alive, and is money stuck?".
 * The money shown (held kobo) is the NGN held for swaps that are not finished.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CryptoReconcilerStatus } from '@/types/cryptoAdmin';

const mockGet = vi.fn();
vi.mock('@/services/cryptoAdminService', async () => ({
  ...(await vi.importActual<typeof import('@/services/cryptoAdminService')>('@/services/cryptoAdminService')),
  adminGetReconcilerStatus: (...a: unknown[]) => mockGet(...a),
}));

import ReconcilerPage from './page';

const NOW = new Date('2026-10-14T08:07:00Z');

function status(over: Partial<CryptoReconcilerStatus['replica']> = {}, backlog?: CryptoReconcilerStatus['backlog']): CryptoReconcilerStatus {
  return {
    success: true,
    note: 'replica is the in-process state of the replica that answered; only the elected leader does work.',
    replica: {
      started_at: '2026-10-14T08:00:00Z', runs: 14, led_runs: 14, skipped_runs: 0,
      last_run_at: '2026-10-14T08:06:30Z', last_led_at: '2026-10-14T08:06:30Z', last_led: true, last_error: '',
      last_result: { resolved: 1, released: 0, parked: 0, expired: 2, errors: 0, clearing_negative: false },
      totals: { resolved: 3, released: 0, parked: 1, expired: 5, errors: 0, clearing_negative_runs: 0 },
      recent_alerts: [],
      ...over,
    },
    backlog: backlog ?? [
      { state: 'needs_review', count: 0, held_kobo: 0, oldest_age_seconds: 0 },
      { state: 'confirming', count: 0, held_kobo: 0, oldest_age_seconds: 0 },
      { state: 'processing', count: 1, held_kobo: 503_750, oldest_updated_at: '2026-10-14T08:06:00Z', oldest_age_seconds: 60 },
      { state: 'quoted', count: 4, held_kobo: 0, oldest_updated_at: '2026-10-14T08:00:00Z', oldest_age_seconds: 420 },
    ],
  };
}

async function mounted(s: CryptoReconcilerStatus | null) {
  mockGet.mockResolvedValue(s);
  render(<ReconcilerPage />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
}

beforeEach(() => {
  mockGet.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Reconciler tab — health', () => {
  it('reports a healthy leader', async () => {
    await mounted(status());
    expect(await screen.findByTestId('health')).toBeTruthy();
    expect(screen.getByTestId('health').textContent).toMatch(/leading|healthy/i);
    expect(screen.queryByTestId('health-alert')).toBeNull();
  });

  it('explains a follower instead of calling it broken', async () => {
    await mounted(status({ last_led: false, led_runs: 0, skipped_runs: 14, last_led_at: '' }));
    expect((await screen.findByTestId('health')).textContent).toMatch(/follower/i);
    expect(screen.queryByTestId('health-alert')).toBeNull();
  });

  it('raises the alarm when the last pass failed', async () => {
    await mounted(status({ last_error: 'cryptosvc: leader lock: lock db down' }));
    const a = await screen.findByTestId('health-alert');
    expect(a.textContent).toMatch(/lock db down/);
  });

  it('raises the alarm when the clearing balance is negative', async () => {
    await mounted(status({ last_result: { resolved: 0, released: 0, parked: 0, expired: 0, errors: 0, clearing_negative: true } }));
    expect((await screen.findByTestId('health-alert')).textContent).toMatch(/clearing/i);
  });

  it('warns when no pass has run recently', async () => {
    await mounted(status({ last_run_at: '2026-10-14T07:50:00Z' })); // 17 minutes ago
    expect((await screen.findByTestId('health-alert')).textContent).toMatch(/no pass|17 minutes|stale/i);
  });

  it('says so when the reconciler has not run yet', async () => {
    await mounted(status({ runs: 0, led_runs: 0, last_run_at: '', last_led_at: '', last_led: false }));
    expect((await screen.findByTestId('health')).textContent).toMatch(/no pass recorded/i);
  });
});

describe('Reconciler tab — backlog', () => {
  it('shows every open state with count, NGN held and age', async () => {
    await mounted(status());
    const proc = await screen.findByTestId('backlog-processing');
    expect(proc.textContent).toContain('1');
    expect(proc.textContent).toContain('5,037.50'); // 503_750 kobo
    expect(proc.textContent).toMatch(/1m/);
    expect(screen.getByTestId('backlog-quoted').textContent).toContain('4');
    expect(screen.getByTestId('backlog-needs_review')).toBeTruthy();
    expect(screen.getByTestId('backlog-confirming')).toBeTruthy();
  });

  it('flags parked swaps and points at the review queue', async () => {
    await mounted(status({}, [{ state: 'needs_review', count: 2, held_kobo: 3_022_500, oldest_updated_at: '2026-10-14T06:00:00Z', oldest_age_seconds: 7200 }]));
    const row = await screen.findByTestId('backlog-needs_review');
    expect(row.textContent).toContain('30,225.00');
    expect(row.textContent).toMatch(/2h/);
    // The tab bar has a Review queue link too; the call-to-action sits inside the warning sentence.
    const links = screen.getAllByRole('link', { name: /review queue/i }) as HTMLAnchorElement[];
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const l of links) expect(l.getAttribute('href')).toBe('/admin/crypto/review');
    expect(screen.getByText(/swap\(s\) are parked with/i).textContent).toContain('30,225.00');
  });

  it('shows a calm line when nothing is waiting', async () => {
    await mounted(status({}, [
      { state: 'needs_review', count: 0, held_kobo: 0, oldest_age_seconds: 0 },
      { state: 'processing', count: 0, held_kobo: 0, oldest_age_seconds: 0 },
    ]));
    expect(await screen.findByText(/nothing is waiting/i)).toBeTruthy();
  });
});

describe('Reconciler tab — activity', () => {
  it('shows counters and the recent alerts newest first', async () => {
    await mounted(status({
      recent_alerts: [
        { at: '2026-10-14T08:05:00Z', kind: 'swap_parked', message: 'swap abc parked in needs_review' },
        { at: '2026-10-14T07:40:00Z', kind: 'reconcile_error', message: 'list processing swaps: timeout' },
      ],
    }));
    expect(await screen.findByText(/swap abc parked/)).toBeTruthy();
    const rows = screen.getAllByTestId('alert-row');
    expect(rows[0].textContent).toContain('swap_parked');
    expect(rows[1].textContent).toContain('reconcile_error');
    expect(screen.getByTestId('totals').textContent).toMatch(/resolved/i);
  });

  it('says there are no alerts rather than showing an empty table', async () => {
    await mounted(status());
    expect(await screen.findByText(/no alerts/i)).toBeTruthy();
  });

  it('states the per-replica caveat', async () => {
    await mounted(status());
    expect(await screen.findByText(/answered; only the elected leader does work\./)).toBeTruthy(); // the server's own note, shown verbatim
  });
});

describe('Reconciler tab — states', () => {
  it('explains when the status is not available', async () => {
    await mounted(null);
    expect(await screen.findByText(/Reconciler status is unavailable/i)).toBeTruthy();
  });

  it('shows a load error', async () => {
    mockGet.mockRejectedValue(new Error('forbidden'));
    render(<ReconcilerPage />);
    expect(await screen.findByText(/forbidden/)).toBeTruthy();
  });

  it('refetches on Refresh', async () => {
    await mounted(status());
    await screen.findByTestId('health');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});
