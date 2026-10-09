/**
 * The dashboard's contract with GET /admin/overview: every queue with work shows
 * its count under "Needs attention" and links to where it is resolved; a queue
 * with no working screen shows its count and says so rather than linking to a
 * dead end; an unknown count is "—", never 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import type { AdminOverview, OverviewModule } from '@/types/adminOverview';

const mockGetAdminOverview = vi.fn();
const mockGetAdminMenuCounts = vi.fn();

vi.mock('@/services/adminApiClient', () => ({
  getAdminOverview: (...a: unknown[]) => mockGetAdminOverview(...a),
  getAdminMenuCounts: (...a: unknown[]) => mockGetAdminMenuCounts(...a),
}));
vi.mock('@/config/stemAccess', () => ({
  useStemRoles: () => [],
  canReadStem: () => false,
  canManageStem: () => false,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { AdminDashboard } from './AdminDashboard';

const queue = (
  key: string,
  label: string,
  attention: { label: string; value: number | null; href: string; severity?: 'critical' | 'warn'; note?: string },
): OverviewModule => ({
  key,
  label,
  group: 'Commerce',
  href: `/admin/${key}`,
  volume: { label: 'Approved', value: 4 },
  attention: { severity: 'critical', ...attention },
});

const serve = (modules: OverviewModule[]) => {
  const overview: AdminOverview = { generated_at: '2026-10-08T09:00:00Z', modules };
  mockGetAdminOverview.mockResolvedValue(overview);
  mockGetAdminMenuCounts.mockResolvedValue(null);
};

const needsAttention = async () => {
  const heading = await screen.findByRole('heading', { name: 'Needs attention' });
  await waitFor(() => expect(screen.queryByText('Reading queues…')).toBeNull());
  return within(heading.closest('section') as HTMLElement);
};

describe('AdminDashboard — awaiting approval', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a pending business verification with its count and a link to resolve it', async () => {
    serve([
      queue('restaurant-kyb', 'Restaurant business verification', {
        label: 'Submitted, awaiting verification', value: 3, href: '/admin/restaurant/onboarding',
      }),
    ]);
    render(<AdminDashboard />);

    const section = await needsAttention();
    const link = section.getByRole('link', { name: /Restaurant business verification/ });
    expect(link.getAttribute('href')).toBe('/admin/restaurant/onboarding');
    expect(link.textContent).toContain('3');
    expect(link.textContent).toContain('Open queue');
  });

  it('shows a queue that has no review screen as count + note, never as a link', async () => {
    const note = 'No review screen yet — the stays KYB page is not connected to the API';
    serve([
      queue('stays-kyb', 'Stays hotelier business verification', {
        label: 'Submitted, awaiting verification', value: 2, href: '', note,
      }),
    ]);
    const { container } = render(<AdminDashboard />);

    const section = await needsAttention();
    expect(section.getByText(note)).toBeTruthy();
    expect(section.getByText('2')).toBeTruthy();
    // Nothing in the page may link the queue to a dead end: the only anchor for
    // this module is its module-card title, and the queue row itself is not one.
    const anchorsWithQueueLabel = Array.from(container.querySelectorAll('a')).filter((a) =>
      (a.textContent ?? '').includes('Submitted, awaiting verification'),
    );
    expect(anchorsWithQueueLabel).toHaveLength(0);
    expect(section.queryByText('Open queue →')).toBeNull();
  });

  it('leaves empty queues out of "Needs attention"', async () => {
    serve([
      queue('merchant-onboarding', 'Merchant onboarding', { label: 'Applications to review', value: 0, href: '/admin/merchant-onboarding' }),
      queue('business', 'Business registry', { label: 'Verifications awaiting review', value: 5, href: '/admin/business' }),
    ]);
    render(<AdminDashboard />);

    const section = await needsAttention();
    expect(section.getByText('Business registry')).toBeTruthy();
    expect(section.queryByText('Merchant onboarding')).toBeNull();
  });

  it('renders an unreadable count as an em dash and never counts it as work', async () => {
    serve([
      queue('mkt-verification', 'Marketplace seller verification', { label: 'Verification requests', value: null, href: '/admin/marketplace/users' }),
    ]);
    render(<AdminDashboard />);

    const section = await needsAttention();
    expect(section.queryByText('Marketplace seller verification')).toBeNull();
    // ...but it is named, so an admin can tell "could not look" from "nothing to do".
    expect(screen.getAllByText(/could not be read|—/).length).toBeGreaterThan(0);
  });
});
