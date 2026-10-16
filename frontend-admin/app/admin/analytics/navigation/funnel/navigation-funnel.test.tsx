import { describe, expect, it, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { AdminUsersRequestError } from '@/services/usersService';

const calls: any[] = [];
let impl: (a: unknown) => Promise<unknown> = async () => ({});
const svc = {
  reset() { calls.length = 0; impl = async () => ({}); },
  resolve(v: unknown) { impl = async () => v; },
  reject(e: Error) { impl = () => Promise.reject(e); },
};
vi.mock('@/services/analyticsService', () => ({
  getNavigationFunnel: (a: unknown) => { calls.push(a); return impl(a); },
}));

import NavigationFunnelPage from './page';

const inputs = () => screen.getAllByPlaceholderText('/route') as HTMLInputElement[];
const values = () => inputs().map((i) => i.value);
const run = () => screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement;
const fill = (a: string, b: string) => {
  fireEvent.change(inputs()[0], { target: { value: a } });
  fireEvent.change(inputs()[1], { target: { value: b } });
};

beforeEach(() => svc.reset());

describe('NavigationFunnelPage', () => {
  it('adds, removes and reorders steps', () => {
    render(<NavigationFunnelPage />);
    fill('/a', '/b');
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    fireEvent.change(inputs()[2], { target: { value: '/c' } });
    expect(values()).toEqual(['/a', '/b', '/c']);
    fireEvent.click(screen.getByRole('button', { name: 'Move step 3 up' }));
    expect(values()).toEqual(['/a', '/c', '/b']);
    fireEvent.click(screen.getByRole('button', { name: 'Move step 1 down' }));
    expect(values()).toEqual(['/c', '/a', '/b']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }));
    expect(values()).toEqual(['/c', '/b']);
  });

  it('Run disabled below 2 non-empty steps', () => {
    render(<NavigationFunnelPage />);
    expect(run().disabled).toBe(true);
    fireEvent.change(inputs()[0], { target: { value: '/a' } });
    expect(run().disabled).toBe(true);
    fireEvent.change(inputs()[1], { target: { value: '/b' } });
    expect(run().disabled).toBe(false);
  });

  it('POSTs steps in current order and renders bars with drop-off', async () => {
    svc.resolve({
      enabled: true,
      data: { range: '30d', surface: 'all', gapMinutes: 30, steps: [{ route: '/b', users: 10 }, { route: '/a', users: 4 }] },
    });
    render(<NavigationFunnelPage />);
    fill('/a', '/b');
    fireEvent.click(screen.getByRole('button', { name: 'Move step 2 up' }));
    fireEvent.click(run());
    const bars = await screen.findAllByTestId('funnel-bar');
    expect(calls[0]).toEqual({ steps: ['/b', '/a'], range: '30d', surface: 'all', gapMinutes: 30 });
    expect(bars).toHaveLength(2);
    expect(within(bars[0]).getByText('10')).toBeTruthy();
    expect(within(bars[1]).getByTestId('funnel-drop').textContent).toBe('60%');
  });

  it('enabled:false -> not enabled', async () => {
    svc.resolve({ enabled: false, data: null });
    render(<NavigationFunnelPage />);
    fill('/a', '/b');
    fireEvent.click(run());
    expect(await screen.findByText('Navigation telemetry not enabled')).toBeTruthy();
  });

  it('403 -> permission placeholder', async () => {
    svc.reject(new AdminUsersRequestError(403, 'nope'));
    render(<NavigationFunnelPage />);
    fill('/a', '/b');
    fireEvent.click(run());
    expect(await screen.findByText(/do not have permission/)).toBeTruthy();
  });

  it('all-zero -> empty', async () => {
    svc.resolve({ enabled: true, data: { range: '30d', surface: 'all', gapMinutes: 30, steps: [{ route: '/a', users: 0 }, { route: '/b', users: 0 }] } });
    render(<NavigationFunnelPage />);
    fill('/a', '/b');
    fireEvent.click(run());
    expect(await screen.findByText('No funnel data')).toBeTruthy();
  });

  it('error -> inline error + Retry re-runs', async () => {
    svc.reject(new Error('boom'));
    render(<NavigationFunnelPage />);
    fill('/a', '/b');
    fireEvent.click(run());
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].steps).toEqual(['/a', '/b']);
  });
});
