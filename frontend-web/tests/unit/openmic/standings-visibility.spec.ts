/**
 * The two Open Mic display switches have one definition.
 *
 * Before this, `sponsor_assets.voting.leaderboardVisible` and
 * `voteCountPublic` were read in exactly one place (`active-edition.ts`), so
 * every other surface that shows standings — `/entries`, the board, the SSE
 * snapshot — decided for itself. An admin who turned standings private still
 * had the whole ranked board served to them at a second URL, with the numbers
 * streaming underneath it.
 *
 * The rule the surfaces share: a switch defaults to ON, and only an explicit
 * `false` turns it off. That asymmetry is deliberate — rows written before the
 * admin form existed carry no `voting` block at all, and treating "absent" as
 * "off" would silently hide the standings of every contest nobody configured.
 *
 * `clientStandings` and `clientEntryRows` cover the second channel: props
 * crossed into a client component are serialised into the served HTML, so a
 * number that is merely unrendered is still published.
 */
import { describe, expect, it } from 'vitest';
import {
  clientEntryRows,
  clientStandings,
  standingsSwitches,
  streamCountsVisible,
} from '@/src/features/openmic/standings-visibility';

describe('standingsSwitches', () => {
  it('leaves both switches on when the contest carries no voting block', () => {
    expect(standingsSwitches(undefined)).toEqual({
      showLeaderboard: true,
      showVoteCounts: true,
    });
  });

  it('keeps the board visible when only the counts are private', () => {
    expect(standingsSwitches({ leaderboardVisible: true, voteCountPublic: false })).toEqual({
      showLeaderboard: true,
      showVoteCounts: false,
    });
  });

  it('keeps the counts visible when only the board is private', () => {
    expect(standingsSwitches({ leaderboardVisible: false, voteCountPublic: true })).toEqual({
      showLeaderboard: false,
      showVoteCounts: true,
    });
  });

  it('treats an absent switch as on rather than off', () => {
    // A `{}` voting block is what a contest written by an older admin build
    // carries; neither key was ever set.
    expect(standingsSwitches({})).toEqual({ showLeaderboard: true, showVoteCounts: true });
  });
});

describe('streamCountsVisible', () => {
  it('redacts counts for a publicly listed contest whose counts are private', () => {
    // The exposure this closes: `visibility: 'public'` used to be the only
    // signal, so marking counts private changed nothing on the wire.
    expect(
      streamCountsVisible({
        visibility: 'public',
        sponsor_assets: { voting: { voteCountPublic: false } },
      }),
    ).toBe(false);
  });

  it('sends counts for a public contest that leaves them public', () => {
    expect(
      streamCountsVisible({
        visibility: 'public',
        sponsor_assets: { voting: { voteCountPublic: true } },
      }),
    ).toBe(true);
  });

  it('keeps redacting counts for a contest that is not publicly listed', () => {
    // The pre-existing rule must survive: this is the contract the gated
    // /api/v2/votes/stream already honours.
    expect(
      streamCountsVisible({
        visibility: 'hidden',
        sponsor_assets: { voting: { voteCountPublic: true } },
      }),
    ).toBe(false);
  });
});

describe('clientStandings', () => {
  const DATA = { voteCount: 412, totalVotes: 1337, rank: 1 };

  it('withholds rank and both tallies when neither switch is on', () => {
    // What the props of a client component become: the serialised payload
    // inside the served HTML. Rendering the number conditionally left
    // `"voteCount":412` readable in the page source with the switch off.
    expect(clientStandings({ showLeaderboard: false, showVoteCounts: false }, DATA)).toEqual({
      showLeaderboard: false,
      showVoteCounts: false,
      voteCount: null,
      totalVotes: null,
      rank: null,
    });
  });

  it('keeps the rank when only the counts are private', () => {
    expect(clientStandings({ showLeaderboard: true, showVoteCounts: false }, DATA)).toMatchObject({
      rank: 1,
      voteCount: null,
      totalVotes: null,
    });
  });

  it('keeps the tallies when only the board is private', () => {
    expect(clientStandings({ showLeaderboard: false, showVoteCounts: true }, DATA)).toMatchObject({
      voteCount: 412,
      totalVotes: 1337,
      rank: null,
    });
  });

  it('passes the numbers through when both switches are on', () => {
    expect(clientStandings({ showLeaderboard: true, showVoteCounts: true }, DATA)).toEqual({
      showLeaderboard: true,
      showVoteCounts: true,
      ...DATA,
    });
  });
});

describe('clientEntryRows', () => {
  const ROWS = [
    { id: 'e1', stageName: 'Adaeze Okonkwo', voteCount: 412 },
    { id: 'e2', stageName: 'Bello Miracle', voteCount: 388 },
  ];

  it('nulls every tally the counts switch hides and keeps the rest', () => {
    const rows = clientEntryRows(ROWS, standingsSwitches({ voteCountPublic: false }));
    expect(rows.map((r) => r.voteCount)).toEqual([null, null]);
    expect(rows.map((r) => r.stageName)).toEqual(['Adaeze Okonkwo', 'Bello Miracle']);
  });

  it('leaves the rows alone when counts are public', () => {
    expect(clientEntryRows(ROWS, standingsSwitches({ voteCountPublic: true }))).toEqual(ROWS);
  });
});
