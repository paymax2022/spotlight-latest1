// Both standings pages read the DB directly and, until now, rendered tallies and
// ranking regardless of `sponsor_assets.voting.leaderboardVisible` /
// `voteCountPublic` — so `/open-mic/[slug]/entries` kept showing the standings that
// step #05 of the programme page declared private, and an artist's shared entry link
// printed the live count and rank chip that the admin had just turned off.
// Vitest here resolves `@/…` to `src/…`, and `src/components/openmic` is a separate
// tree from the app-root `components/`, so these two pages cannot be imported and
// rendered in a unit test. The components they mount are covered behaviourally
// (entries-board-display.spec.ts, artist-voting-card-display.spec.ts); these guards
// pin the wiring that the browser pass then checks end to end.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('Open Mic entries page enforces the standings switches', () => {
  const SRC = read('app/open-mic/[slug]/entries/page.tsx');

  it('reads the switches from the shared module, not a local restatement', () => {
    expect(SRC).toContain('standings-visibility');
    expect(SRC).toContain('standingsSwitches(contest.votingConfig)');
  });

  it('replaces the board with the private-standings note, and the note comes first', () => {
    expect(SRC.indexOf('{showLeaderboard ? (')).toBeLessThan(SRC.indexOf('<OpenMicEntriesBoard'));
    expect(SRC).toContain('This edition keeps its standings private');
  });

  it('hands the count switch down to the board it does render', () => {
    expect(SRC).toContain('showVoteCounts={showVoteCounts}');
  });

  it('blanks the tallies before they cross into the board', () => {
    // The board is a client component, so its props are in the served HTML.
    expect(SRC).toContain('clientEntryRows(');
    expect(SRC.indexOf('clientEntryRows(')).toBeLessThan(SRC.indexOf('voteCount: e.voteCount'));
  });
});

describe('Open Mic artist voting page enforces the standings switches', () => {
  const SRC = read('app/open-mic/[slug]/entry/[artistSlug]/page.tsx');

  it('reads the switches and passes both to the card', () => {
    expect(SRC).toContain('standingsSwitches(contest.votingConfig)');
    expect(SRC).toContain('showVoteCounts={showVoteCounts}');
    expect(SRC).toContain('showLeaderboard={showLeaderboard}');
  });

  it('withholds the ranked runners-up and the leaderboard hand-off together', () => {
    expect(SRC).toContain('{showLeaderboard && others.length > 0 && (');
    expect(SRC).toContain('{showLeaderboard && (');
  });

  it('blanks rank and both tallies before they cross into the card', () => {
    // The card is a client component, so its props are in the served HTML:
    // this page published `"voteCount":412,"totalVotes":1337,"rank":1` there
    // with both switches off, because the numbers were only unrendered.
    expect(SRC).toContain('clientStandings(');
    expect(SRC).toContain('voteCount: standingsProps.voteCount');
    expect(SRC).toContain('rank={standingsProps.rank}');
    expect(SRC).toContain('totalVotes={standingsProps.totalVotes}');
  });

  it('withholds the runners-up tallies with the count switch', () => {
    expect(SRC).toContain('{showVoteCounts && (');
    expect(SRC).toMatch(/showVoteCounts && \(\s*<p[^>]*>\{o\.voteCount/);
  });
});
