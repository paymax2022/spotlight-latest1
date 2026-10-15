import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminUsersRequestError } from '@/services/usersService';
import { densify } from './Sparkline';

// Plain functions (not vi.fn) for rejections: vitest's result tracking leaves an unhandled derived rejection.
const calls: unknown[] = [];
let impl: (a: unknown) => Promise<unknown> = async () => ({});
const getNav = {
  mockReset() { calls.length = 0; impl = async () => ({}); },
  mockResolvedValue(v: unknown) { impl = async () => v; },
  rejectOnce(e: Error) { const prev = impl; impl = () => { impl = prev; return Promise.reject(e); }; },
  reject(e: Error) { impl = () => Promise.reject(e); },
};
vi.mock('@/services/analyticsService', () => ({
  getNavigationAnalytics: (a: unknown) => { calls.push(a); return impl(a); },
}));

import NavigationAnalyticsPage from './page';

const data = {
  range: '30d',
  surface: 'all',
  topScreens: [{ route: '/wallet', views: 42, users: 7 }, { route: '/home', views: 10, users: 3 }],
  timeseries: [
    { day: '2026-10-01', mobile: 1, web: 1, total: 2 },
    { day: '2026-10-04', mobile: 3, web: 2, total: 5 },
  ],
  surfaceSplit: { mobile: 31, web: 21, total: 52 },
};

beforeEach(() => getNav.mockReset());

describe('NavigationAnalyticsPage', () => {
  it('renders table, split cards and svg', async () => {
    getNav.mockResolvedValue({ enabled: true, data });
    const { container } = render(<NavigationAnalyticsPage />);
    expect(await screen.findByText('/wallet')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByTestId('split-mobile').textContent).toBe('31');
    expect(screen.getByTestId('split-web').textContent).toBe('21');
    expect(screen.getByTestId('split-total').textContent).toBe('52');
    expect(container.querySelector('svg polyline')).toBeTruthy();
  });
  it('refetches with new range', async () => {
    getNav.mockResolvedValue({ enabled: true, data });
    render(<NavigationAnalyticsPage />);
    await screen.findByText('/wallet');
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(calls[calls.length - 1]).toMatchObject({ range: '7d' }));
  });
  it('empty state', async () => {
    getNav.mockResolvedValue({
      enabled: true,
      data: { ...data, topScreens: [], timeseries: [], surfaceSplit: { mobile: 0, web: 0, total: 0 } },
    });
    render(<NavigationAnalyticsPage />);
    expect(await screen.findByText('No navigation data yet')).toBeTruthy();
  });
  it('not enabled', async () => {
    getNav.mockResolvedValue({ enabled: false, data: null });
    render(<NavigationAnalyticsPage />);
    expect(await screen.findByText('Navigation telemetry not enabled')).toBeTruthy();
  });
  it('403 permission placeholder', async () => {
    getNav.reject(new AdminUsersRequestError(403, 'no'));
    render(<NavigationAnalyticsPage />);
    expect(await screen.findByText(/do not have permission/)).toBeTruthy();
  });
  it('error + retry refetches', async () => {
    getNav.mockResolvedValue({ enabled: true, data });
    getNav.rejectOnce(new Error('boom'));
    render(<NavigationAnalyticsPage />);
    expect(await screen.findByText('boom')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('/wallet')).toBeTruthy();
    expect(calls.length).toBe(2);
  });
});

describe('densify', () => {
  it('zero-fills gaps, handles empty and single', () => {
    expect(densify([])).toEqual([]);
    expect(densify([{ day: '2026-10-01', total: 3 }])).toEqual([3]);
    expect(densify([{ day: '2026-10-01', total: 2 }, { day: '2026-10-04', total: 5 }])).toEqual([2, 0, 0, 5]);
  });
});
