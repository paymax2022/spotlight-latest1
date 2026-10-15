// Renders the public contests list to static HTML (the repo's test runner is
// plain Node) to pin what a visitor sees: Active contests by default with closed
// ones hidden, a dropdown offering Active / Closed, and each contest's logo and
// banner when the admin set them.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ContestsExplorer from '@/src/components/contests/ContestsExplorer';
import type { PublicContest } from '@/src/lib/contests/contest-filter';

const contest = (over: Partial<PublicContest>): PublicContest => ({
  id: 'x', slug: 'x', title: 'X', description: '', status: 'active',
  opensAt: null, closesAt: null, bannerImageUrl: '', logoUrl: '', ...over,
});

const contests: PublicContest[] = [
  contest({ id: 'a', title: 'Star Search', status: 'active', logoUrl: 'https://cdn.test/star-logo.png', bannerImageUrl: 'https://cdn.test/star-banner.jpg', closesAt: '2026-12-01T00:00:00Z' }),
  contest({ id: 'b', title: 'Dance Off', status: 'active' }),
  contest({ id: 'c', title: 'Old Finals', status: 'closed', logoUrl: 'https://cdn.test/old-logo.png', closesAt: '2026-01-15T00:00:00Z' }),
];

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(ContestsExplorer, { contests, ...props }));

describe('ContestsExplorer', () => {
  it('defaults to Active: shows active contests and hides closed ones', () => {
    const html = render();
    expect(html).toContain('Star Search');
    expect(html).toContain('Dance Off');
    expect(html).not.toContain('Old Finals');
  });

  it('offers exactly Active contests and Closed contests, with Active selected', () => {
    const html = render();
    expect(html).toContain('Active contests');
    expect(html).toContain('Closed contests');
    expect(html).toMatch(/<option value="active" selected="">Active contests<\/option>/);
    expect(html).toMatch(/<option value="closed">Closed contests<\/option>/);
  });

  it('shows the contest logo and banner when set', () => {
    const html = render();
    expect(html).toContain('src="https://cdn.test/star-banner.jpg"');
    expect(html).toContain('src="https://cdn.test/star-logo.png"');
    expect(html).toContain('alt="Star Search logo"');
  });

  it('draws no logo image for a contest without one, and a placeholder instead of a banner', () => {
    const html = render({ contests: [contests[1]] });
    expect(html).not.toContain('Dance Off logo');
    expect(html).toContain('data-testid="contest-banner-placeholder"');
  });

  it('can start on Closed: shows closed contests only', () => {
    const html = render({ initialFilter: 'closed' });
    expect(html).toContain('Old Finals');
    expect(html).not.toContain('Star Search');
    expect(html).toMatch(/<option value="closed" selected="">Closed contests<\/option>/);
  });

  it('says so when a filter has nothing to show', () => {
    expect(render({ contests: [contests[2]] })).toContain('No contests are open right now');
    expect(render({ contests: [contests[0]], initialFilter: 'closed' })).toContain('No closed contests yet');
  });

  it('dates in Lagos time so the server and browser render the same text', () => {
    const html = render({ contests: [contests[0]] });
    expect(html).toContain('Closes 1 Dec 2026');
  });
});
