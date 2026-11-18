// The artist page (`/open-mic/[slug]/entry/[artistSlug]`) is the link an artist
// shares when they rally votes, so it is the standings surface most readers actually
// land on. Before this, its card printed the live tally, the share of all votes and a
// rank chip regardless of the admin's two switches. Rendered through
// renderToStaticMarkup — vitest runs in the `node` environment here, so this covers
// the SSR payload; the client-only EventSource guard is verified in the browser.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// Relative: vitest maps `@` to `src/`, and the live card is in the app-root `components/`.
import OpenMicArtistVotingCard from '../../../components/openmic/OpenMicArtistVotingCard';

const ENTRY = {
  id: 'e1',
  stageName: 'Ada Rivers',
  songTitle: 'First Light',
  songUrl: '/a.mp3',
  voteCount: 412,
  status: 'published_for_voting',
};

function render(showVoteCounts: boolean, showLeaderboard: boolean) {
  return renderToStaticMarkup(
    createElement(OpenMicArtistVotingCard, {
      contestId: 'c1',
      contestSlug: 'open-mic-dev',
      entry: ENTRY,
      rank: 2,
      totalVotes: 800,
      votePriceNgn: 100,
      freeVoting: true,
      paidVoting: true,
      showVoteCounts,
      showLeaderboard,
    }),
  );
}

describe('Open Mic artist voting card respects the standings switches', () => {
  it('shows the rank, the tally and the share when both switches are on', () => {
    const html = render(true, true);
    expect(html).toContain('Rank #2');
    expect(html).toContain('Total Votes');
    expect(html).toContain('412');
    expect(html).toContain('% of all votes');
  });

  it('withholds every count while vote counts are private, and keeps the vote CTA', () => {
    const html = render(false, true);
    expect(html).toContain('Vote for Ada Rivers');
    expect(html).not.toContain('412');
    expect(html).not.toContain('Total Votes');
    expect(html).not.toContain('% of all votes');
  });

  it('withholds the ranking while the leaderboard is private, and keeps the counts', () => {
    const html = render(true, false);
    expect(html).not.toContain('Rank #2');
    expect(html).not.toContain('🥇');
    expect(html).toContain('412');
  });

  it('renders from blanked props, the shape the page sends when both switches are off', () => {
    // Props of a client component are serialised into the served HTML, so
    // `clientStandings` replaces the numbers with null instead of merely
    // hiding them — the card must survive that.
    const html = renderToStaticMarkup(
      createElement(OpenMicArtistVotingCard, {
        contestId: 'c1',
        contestSlug: 'open-mic-dev',
        entry: { ...ENTRY, voteCount: null },
        rank: null,
        totalVotes: null,
        votePriceNgn: 100,
        freeVoting: true,
        paidVoting: true,
        showVoteCounts: false,
        showLeaderboard: false,
      }),
    );
    expect(html).toContain('Vote for Ada Rivers');
    expect(html).not.toContain('412');
    expect(html).not.toContain('Rank #');
    expect(html).not.toContain('Total Votes');
  });
});
