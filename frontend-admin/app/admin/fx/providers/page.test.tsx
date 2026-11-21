/**
 * The Providers tab reads a surface the Go backend does not serve yet, so what
 * this page must do with a 404 is the whole test: show the backend's sentence.
 * Rendering an empty directory instead is a false all-clear on an FX screen —
 * "no providers" and "we could not ask the providers endpoint" look identical to
 * an operator, and the first one gets acted on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { getProviders } = vi.hoisted(() => ({ getProviders: vi.fn() }));
vi.mock('@/services/fxAdminService', () => ({
  getProviders,
  toggleProvider: vi.fn().mockResolvedValue({ ok: true }),
  setBreaker: vi.fn().mockResolvedValue({ ok: true }),
}));

import FxProvidersPage from './page';

const provider = (o: Record<string, unknown> = {}) => ({
  provider: 'eversend',
  displayName: 'Eversend',
  enabled: true,
  corridors: ['USD-NGN', 'EUR-NGN'],
  rails: ['bank_transfer', 'mobile_money'],
  exposureLimitUsdCents: 5_000_000_00,
  exposureUsedUsdCents: 2_482_690_00,
  latencyMsP95: 540,
  successRate: 98.7,
  breaker: 'closed',
  adapterStatus: 'live',
  ...o,
});

describe('FX providers page', () => {
  // Block body on purpose: an arrow here returns the mock itself, which Vitest
  // then treats as a hook teardown callback and reports the stored rejection as
  // the test's failure — the page renders the alert correctly regardless.
  beforeEach(() => { getProviders.mockReset(); });

  it('renders each provider the service returns', async () => {
    getProviders.mockResolvedValue([provider(), provider({ provider: 'vertofx', displayName: 'VertoFX' })]);
    render(<FxProvidersPage />);

    await waitFor(() => expect(screen.getByText('Eversend')).toBeTruthy());
    expect(screen.getByText('VertoFX')).toBeTruthy();
  });

  it('names the missing endpoint instead of showing an empty directory', async () => {
    getProviders.mockRejectedValue(new Error('No API route matches GET /api/finance/admin/fx/providers'));
    render(<FxProvidersPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/No API route matches GET \/api\/finance\/admin\/fx\/providers/);
  });

  it('stays silent when the read succeeds', async () => {
    getProviders.mockResolvedValue([provider()]);
    render(<FxProvidersPage />);

    await waitFor(() => expect(screen.getByText('Eversend')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
