/**
 * The dashboard's contract with GET /admin/overview: every queue with work shows
 * its count under "Needs attention" and links to where it is resolved; a queue
 * with no working screen shows its count and says so rather than linking to a
 * dead end; an unknown count is "—", never 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import type { AdminOverview, OverviewModule } from '@/types/adminOverview';

const mockLoadAdminOverview = vi.fn();
const mockGetAdminMenuCounts = vi.fn();

vi.mock('@/services/adminApiClient', () => ({
  loadAdminOverview: (...a: unknown[]) => mockLoadAdminOverview(...a),
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
  mockLoadAdminOverview.mockResolvedValue({ status: 'ok', overview });
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

describe('AdminDashboard — the registry owns the queue list', () => {
  beforeEach(() => vi.clearAllMocks());

  // The bug this pins: the console used to append programme rows whose attention
  // value it wrote by hand (`0`, or `null` labelled "Awaiting review"). The filter
  // that hoists work is `> 0`, so four real queues — Open Mic songs, Open Mic
  // applications, auditions, contest approvals — could never surface, and the page
  // reported an all-clear it had not read. See
  // docs/ops/admin-needs-attention-standard.md.
  it('reports nothing in "Needs attention" that the overview API did not return', async () => {
    // Deliberately no registry module uses the words "awaiting review": if they
    // reach the page, they came from the console itself.
    serve([queue('restaurant-kyb', 'Restaurant business verification', {
      label: 'Submitted, needing sign-off', value: 3, href: '/admin/restaurant/onboarding',
    })]);
    // Legacy menu counts present: they may add VOLUME rows, never a queue.
    mockGetAdminMenuCounts.mockResolvedValue({
      contestants: 41, open_mic: 12, auditions: 7, academy: 30, film_academy: 18,
    });
    const { container } = render(<AdminDashboard />);

    const section = await needsAttention();
    expect(section.getByText('Restaurant business verification')).toBeTruthy();
    // No programme queue may appear here…
    for (const label of ['Open Mic', 'Auditions', 'Contestants', 'Academy']) {
      expect(section.queryByText(new RegExp(`^${label}`, 'i'))).toBeNull();
    }
    // …and no queue label may be invented beside one. The old rows wrote
    // `label: 'Awaiting review', value: null` for Film Academy, so the page
    // claimed a queue it had never read — and then named it as unreadable in
    // Data status.
    expect(container.textContent).not.toMatch(/awaiting review/i);
    expect(screen.getByText(/all answered/i)).toBeTruthy();
  });

  it('keeps the programme tallies as volume, with no queue row invented beside them', async () => {
    serve([queue('registration', 'Registrations', {
      label: 'Awaiting review', value: 2, href: '/admin/registration',
    })]);
    mockGetAdminMenuCounts.mockResolvedValue({ contestants: 41, film_academy: 18, academy: 30 });
    render(<AdminDashboard />);

    await screen.findByText('Operations');
    const card = screen.getByText('Contestants').closest('div');
    expect(card?.textContent).toContain('41');
    // The card shows the count and nothing else — no "Awaiting review" line.
    expect(card?.textContent).not.toMatch(/awaiting/i);
  });

  it('does not render a second card for a module the registry already reports', async () => {
    const noise: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { noise.push(String(a[0])); });
    serve([queue('auditions', 'Audition registrations', {
      label: 'Registrations awaiting confirmation', value: 4, href: '',
    })]);
    mockGetAdminMenuCounts.mockResolvedValue({ auditions: 7, contestants: 41, academy: 30 });
    render(<AdminDashboard />);

    const section = await needsAttention();
    spy.mockRestore();
    // The fabricated rows used to reuse the registry's own keys, which React
    // reports as duplicate children — and which double-counted the module.
    expect(noise.filter((m) => /same key/i.test(m))).toHaveLength(0);
    expect(section.getByText('Audition registrations')).toBeTruthy();
    // Card + queue box, and no third copy.
    expect(screen.getAllByText('Audition registrations')).toHaveLength(2);
    expect(section.getByText('No review screen yet')).toBeTruthy();
  });
});

describe('AdminDashboard — the backend rejected the session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says the session was rejected and links to sign in, instead of blaming the backend', async () => {
    mockLoadAdminOverview.mockResolvedValue({ status: 'unauthorized' });
    mockGetAdminMenuCounts.mockResolvedValue(null);
    render(<AdminDashboard />);

    const section = await needsAttention();
    expect(section.getByText(/session is no longer valid/i)).toBeTruthy();
    expect(section.getByRole('link', { name: /sign in again/i }).getAttribute('href')).toBe('/admin/login');
    expect(section.queryByText(/did not answer/i)).toBeNull();
    expect(section.queryByText(/check the backend is running/i)).toBeNull();
    expect(screen.getByText('session rejected')).toBeTruthy();
    expect(screen.queryByText('unreachable')).toBeNull();
  });

  it('still blames the backend when it genuinely did not answer', async () => {
    mockLoadAdminOverview.mockResolvedValue({ status: 'unavailable' });
    mockGetAdminMenuCounts.mockResolvedValue(null);
    render(<AdminDashboard />);

    const section = await needsAttention();
    expect(section.getByText(/did not answer/i)).toBeTruthy();
    expect(section.queryByText(/session is no longer valid/i)).toBeNull();
  });

  it('tells a forbidden account to ask a super admin, not to sign in again', async () => {
    mockLoadAdminOverview.mockResolvedValue({ status: 'forbidden' });
    mockGetAdminMenuCounts.mockResolvedValue(null);
    render(<AdminDashboard />);

    const section = await needsAttention();
    expect(section.getByText(/not allowed to read the operations overview/i)).toBeTruthy();
    expect(section.getByText(/ask a super admin for access/i)).toBeTruthy();
    expect(section.queryByText(/session is no longer valid/i)).toBeNull();
    expect(section.queryByText(/check the backend is running/i)).toBeNull();
    expect(screen.getByText('access denied')).toBeTruthy();
    // Every failure banner is a live region so assistive tech and the e2e
    // suite can find it by role instead of by prose.
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
