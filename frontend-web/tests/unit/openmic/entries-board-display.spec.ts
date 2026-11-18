// Admins can mark vote counts private (`voting.voteCountPublic = false`) while
// leaving the leaderboard itself visible. `/open-mic/[slug]/entries` renders this
// board straight from the DB, so unless the board itself withholds the numbers,
// a "private" contest still prints them — the server fix in
// `app/api/open-mic/votes/stream` only stops the live updates, not the SSR payload.
// Rendered through renderToStaticMarkup: vitest here runs in the `node`
// environment with no jsdom, so this covers the markup the server sends. The
// client-only half (no EventSource when counts are private) is an effect and is
// verified in the browser instead.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// Relative, not `@/components/…`: vitest's alias maps `@` to `src/`, while
// tsconfig tries the project root first — the live board is the root copy.
import OpenMicEntriesBoard from '../../../components/openmic/OpenMicEntriesBoard';

const ENTRIES = [
  { id: 'e1', stageName: 'Ada Rivers', songTitle: 'First Light', songUrl: '/a.mp3', voteCount: 412, status: 'published_for_voting' },
  { id: 'e2', stageName: 'Kene Obi', songTitle: 'Upriver', songUrl: '/b.mp3', voteCount: 388, status: 'published_for_voting' },
];

function render(showVoteCounts: boolean) {
  return renderToStaticMarkup(
    createElement(OpenMicEntriesBoard, {
      contestId: 'c1',
      contestSlug: 'open-mic-dev',
      entries: ENTRIES,
      votePriceNgn: 100,
      paidVoting: true,
      freeVoting: true,
      showVoteCounts,
    }),
  );
}

describe('Open Mic entries board respects voteCountPublic', () => {
  it('shows tallies, share of votes and the aggregate when counts are public', () => {
    const html = render(true);
    expect(html).toContain('Ada Rivers');
    expect(html).toContain('412');
    expect(html).toContain('388');
    expect(html).toContain('Votes Cast');
    expect(html).toContain('% of votes');
  });

  it('names the artists but withholds every count when counts are private', () => {
    const html = render(false);
    expect(html).toContain('Ada Rivers');
    expect(html).toContain('Kene Obi');
    expect(html).not.toContain('412');
    expect(html).not.toContain('388');
    expect(html).not.toContain('Votes Cast');
    expect(html).not.toContain('% of votes');
  });

  it('only promises a live feed while there are counts to stream', () => {
    expect(render(true)).toContain('Connecting…');
    expect(render(false)).not.toContain('Connecting…');
  });

  it('renders the rows the page actually sends when counts are private', () => {
    // `clientEntryRows` nulls the tally before it crosses into this client
    // component: props of a client component are serialised into the served
    // HTML, so an unrendered number is still a published number.
    const html = renderToStaticMarkup(
      createElement(OpenMicEntriesBoard, {
        contestId: 'c1',
        contestSlug: 'open-mic-dev',
        entries: ENTRIES.map((e) => ({ ...e, voteCount: null })),
        votePriceNgn: 100,
        paidVoting: true,
        freeVoting: true,
        showVoteCounts: false,
      }),
    );
    expect(html).toContain('Ada Rivers');
    expect(html).not.toContain('412');
    expect(html).not.toContain('Votes Cast');
  });
});
