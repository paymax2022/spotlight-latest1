/**
 * Risk dashboard: the arithmetic that was never sourced.
 *
 * risk.Handler.Dashboard answers four integers (repo.go:596 DashboardCounts) and
 * risk.Handler.Alerts answers the alert rows. Fraud rate, amount-at-risk,
 * blocked-in-24h, 30-day clawbacks and the burn series were fixture arithmetic,
 * so the live page printed ₦0 and 0.0% for numbers no handler computes — the
 * operator reads "0% fraud" as an all-clear the backend never gave. The service
 * now passes through only what the endpoints return; this pins what the page does
 * with the gap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const { getRiskDashboard } = vi.hoisted(() => ({ getRiskDashboard: vi.fn() }));
vi.mock('@/services/referralAdminOpsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/referralAdminOpsService')>()),
  getRiskDashboard,
}));

import RiskDashboardPage from './page';

beforeEach(() => { getRiskDashboard.mockReset(); });

// What the two live routes actually answer: four counts plus alert rows.
const countsOnly = {
  open_cases: 7,
  alerts: [
    {
      id: 'al_1',
      kind: 'velocity',
      severity: 'high',
      subject_id: 'usr_5',
      detail: 'burst above corridor baseline',
      status: 'open',
      created_at: new Date().toISOString(),
    },
  ],
};

const kpiValue = (label: string) => (screen.getByText(label).parentElement as HTMLElement).textContent ?? '';

describe('referral risk dashboard', () => {
  it('keeps the four sourced counts and dashes the rest', async () => {
    getRiskDashboard.mockResolvedValue(countsOnly);
    render(<RiskDashboardPage />);

    await waitFor(() => expect(screen.getByText('velocity')).toBeTruthy());
    expect(kpiValue('Open cases')).toContain('7');
    for (const label of ['Fraud rate', 'Amount at risk', 'Blocked (24h)', 'Clawbacks (30d)']) {
      expect(kpiValue(label)).toContain('—');
    }
    // The invented readings this replaces: a zero fraud rate and a zero amount.
    expect(document.body.textContent).not.toMatch(/0\.0%/);
    expect(document.body.textContent).not.toMatch(/undefined/);
  });

  it('dashes an alert row with no amount column, because risk.Alert has none', async () => {
    getRiskDashboard.mockResolvedValue(countsOnly);
    render(<RiskDashboardPage />);

    await waitFor(() => expect(screen.getByText('velocity')).toBeTruthy());
    const row = screen.getByText('velocity').closest('tr') as HTMLElement;
    expect(within(row).getByText('—')).toBeTruthy();
    expect(row.textContent).not.toMatch(/₦0\.00/);
  });

  it('says the burn series is not reported rather than drawing an empty chart', async () => {
    getRiskDashboard.mockResolvedValue(countsOnly);
    render(<RiskDashboardPage />);

    await waitFor(() => expect(screen.getByText(/not reported by the backend/i)).toBeTruthy());
  });

  it('still draws the chart when a trend is supplied', async () => {
    getRiskDashboard.mockResolvedValue({
      ...countsOnly,
      fraud_rate: 0.041,
      amount_at_risk_kobo: 9_000_000,
      blocked_24h: 3,
      clawbacks_30d_kobo: 1_500_000,
      burn_anomaly_trend: [
        { date: '2026-11-18', expected_kobo: 1_000_000, actual_kobo: 1_800_000 },
        { date: '2026-11-19', expected_kobo: 1_000_000, actual_kobo: 1_100_000 },
      ],
    });
    render(<RiskDashboardPage />);

    await waitFor(() => expect(screen.getByText('4.1%')).toBeTruthy());
    expect(screen.getByText('₦90,000.00')).toBeTruthy();
    expect(screen.getByText('₦15,000.00')).toBeTruthy();
    expect(screen.getAllByText('11-18').length).toBeGreaterThan(0);
  });

  it('surfaces the backend sentence when the dashboard read fails', async () => {
    getRiskDashboard.mockRejectedValue(new Error('Request failed (404)'));
    render(<RiskDashboardPage />);

    await waitFor(() => expect(screen.getByText(/Request failed \(404\)/)).toBeTruthy());
  });
});
