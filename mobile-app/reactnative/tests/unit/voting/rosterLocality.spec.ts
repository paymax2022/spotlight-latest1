// Pure-logic tests for how the phone's roster shows and narrows locality.
//
// Locality enforcement for a local contest is display + filter, never eligibility:
// nobody is blocked from entering or voting over which quarter they live in. So the
// whole job on this side is (a) say where a contestant is from, most specific part
// first, and (b) let a voter narrow the grid to the village that is actually on the
// roster.
//
// The filter runs on the rows already fetched, because Go's roster endpoint answers
// the whole roster and ignores query filters (only /connect/villages reads params).
// Sending locality as a query string would therefore look wired while doing nothing —
// which is exactly how the search box on this screen came to be inert.
//
// The option lists are derived from the roster rather than from the Nigeria dataset
// for the same reason: a filter panel that offers a ward with zero contestants in it
// produces an empty grid and reads as "nobody from here entered", when the truth is
// the contest has no one from there.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardLocality,
  filterRoster,
  hasActiveLocality,
  localityChoices,
  localityLine,
  selectLocality,
} from '@/features/voting/utils/rosterLocality';
import { mapContestant, type BackendRosterEntry } from '@/features/voting/api/connectVoting.mapper';
import type { Contestant } from '@/features/voting/types/voting.types';

function contestant(over: Partial<Contestant>): Contestant {
  return {
    id: over.id ?? `c-${Math.random().toString(36).slice(2, 7)}`,
    contestId: 'contest-1',
    name: 'Chidi Okeke',
    rank: 1,
    votes: 10,
    status: 'ACTIVE',
    ...over,
  } as Contestant;
}

const ROSTER = [
  contestant({ id: 'a', name: 'Ada Umeh', village: 'Ogbendida', lga: 'Onitsha North', state: 'Anambra' }),
  contestant({ id: 'b', name: 'Bode Ade', village: 'Ogbendida', lga: 'Onitsha North', state: 'Anambra' }),
  contestant({ id: 'c', name: 'Chi Oka', village: 'Isiokwe', lga: 'Onitsha North', state: 'Anambra' }),
  contestant({ id: 'd', name: 'Duns Oga', lga: 'Awka South', state: 'Anambra' }),
  contestant({ id: 'e', name: 'Efe Bassey', state: 'Lagos' }),
  contestant({ id: 'f', name: 'Femi Tal', village: '', lga: '', state: '' }),
];

describe('roster locality — the line a voter reads', () => {
  it('spells the locality most specific first', () => {
    assert.equal(
      localityLine({ village: 'Ogbendida', lga: 'Onitsha North', state: 'Anambra' }),
      'Ogbendida · Onitsha North · Anambra',
    );
  });

  it('skips the levels nobody filled in instead of leaving empty separators', () => {
    assert.equal(localityLine({ village: '', lga: 'Onitsha North', state: 'Anambra' }), 'Onitsha North · Anambra');
    assert.equal(localityLine({ state: 'Lagos' }), 'Lagos');
    assert.equal(localityLine({}), '');
    assert.equal(localityLine({ village: '  ', lga: '', state: undefined }), '');
  });

  it('keeps the card line short enough to read on a two-column grid', () => {
    // The card is roughly half the screen wide; three parts plus the category push the
    // name onto a second line. The village is the interesting part on a local contest,
    // so the card keeps the two most specific ones it has.
    assert.equal(cardLocality({ village: 'Ogbendida', lga: 'Onitsha North', state: 'Anambra' }), 'Ogbendida · Onitsha North');
    assert.equal(cardLocality({ lga: 'Onitsha North', state: 'Anambra' }), 'Onitsha North · Anambra');
    assert.equal(cardLocality({ state: 'Lagos' }), 'Lagos');
    assert.equal(cardLocality({}), '');
  });
});

describe('roster locality — what the filter panel may offer', () => {
  it('lists only the states that have contestants, once each, sorted', () => {
    assert.deepEqual(localityChoices(ROSTER, 'state', {}), ['Anambra', 'Lagos']);
  });

  it('narrows the LGA list to the state already picked', () => {
    assert.deepEqual(localityChoices(ROSTER, 'lga', {}), ['Awka South', 'Onitsha North']);
    assert.deepEqual(localityChoices(ROSTER, 'lga', { state: 'Lagos' }), []);
    assert.deepEqual(localityChoices(ROSTER, 'lga', { state: 'Anambra' }), ['Awka South', 'Onitsha North']);
  });

  it('narrows the village list to the LGA already picked', () => {
    assert.deepEqual(localityChoices(ROSTER, 'village', { state: 'Anambra', lga: 'Onitsha North' }), ['Isiokwe', 'Ogbendida']);
    assert.deepEqual(localityChoices(ROSTER, 'village', {}), ['Isiokwe', 'Ogbendida']);
  });

  it('never offers a blank as a choice', () => {
    assert.ok(!localityChoices(ROSTER, 'state', {}).includes(''));
    assert.ok(!localityChoices(ROSTER, 'village', {}).includes(''));
  });
});

describe('roster locality — narrowing the grid', () => {
  it('shows everyone when nothing is chosen', () => {
    assert.deepEqual(filterRoster(ROSTER, {}, '').map((c) => c.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('filters to one village', () => {
    assert.deepEqual(filterRoster(ROSTER, { village: 'Ogbendida' }, '').map((c) => c.id), ['a', 'b']);
  });

  it('filters to a whole LGA, including the contestants with no village', () => {
    // An uncurated LGA still has rows; "Onitsha North" means the LGA, and a contestant
    // who never gave a quarter is still from it.
    const ids = filterRoster(ROSTER, { lga: 'Onitsha North' }, '').map((c) => c.id);
    assert.deepEqual(ids, ['a', 'b', 'c']);
  });

  it('filters by state, and by the pair when both are set', () => {
    assert.deepEqual(filterRoster(ROSTER, { state: 'Lagos' }, '').map((c) => c.id), ['e']);
    assert.deepEqual(filterRoster(ROSTER, { state: 'Anambra', lga: 'Awka South' }, '').map((c) => c.id), ['d']);
    assert.deepEqual(filterRoster(ROSTER, { state: 'Lagos', lga: 'Onitsha North' }, '').map((c) => c.id), []);
  });

  it('matches the search box against the name and the stage name, any case', () => {
    assert.deepEqual(filterRoster(ROSTER, {}, 'ada').map((c) => c.id), ['a']);
    assert.deepEqual(
      filterRoster(ROSTER.map((c) => contestant({ ...c, stageName: c.id === 'b' ? 'Ada' : c.stageName })), {}, 'ada').map((c) => c.id),
      ['a', 'b'],
    );
  });

  it('combines the search box with the locality filter', () => {
    assert.deepEqual(filterRoster(ROSTER, { lga: 'Onitsha North' }, 'chi').map((c) => c.id), ['c']);
  });

  it('reports whether a locality filter is on, so the chip and the clear button agree', () => {
    assert.equal(hasActiveLocality({}), false);
    assert.equal(hasActiveLocality({ state: '', lga: '', village: '' }), false);
    assert.equal(hasActiveLocality({ village: 'Ogbendida' }), true);
  });

  it('treats an empty string the same as an absent level', () => {
    // The panel clears a level by setting '', and a filter that treated '' as a value
    // would match only contestants with a blank locality and empty the grid.
    assert.deepEqual(filterRoster(ROSTER, { state: '', lga: '', village: '' }, '').map((c) => c.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('roster locality — the panel picks', () => {
  it('sets a level and leaves the others alone', () => {
    assert.deepEqual(selectLocality({}, 'state', 'Anambra'), { state: 'Anambra' });
  });

  it('clears the levels below the one picked', () => {
    // Picking a different state while a village is chosen would otherwise leave the
    // grid filtered on "Ogbendida" in a state that has no such quarter — an empty list
    // with no visible reason.
    assert.deepEqual(
      selectLocality({ state: 'Anambra', lga: 'Onitsha North', village: 'Ogbendida' }, 'state', 'Lagos'),
      { state: 'Lagos' },
    );
    assert.deepEqual(
      selectLocality({ state: 'Anambra', lga: 'Onitsha North', village: 'Ogbendida' }, 'lga', 'Awka South'),
      { state: 'Anambra', lga: 'Awka South' },
    );
  });

  it('tapping the value that is already on turns that level off, and drops what hung under it', () => {
    assert.deepEqual(
      selectLocality({ state: 'Anambra', lga: 'Onitsha North', village: 'Ogbendida' }, 'lga', 'Onitsha North'),
      { state: 'Anambra' },
    );
    assert.deepEqual(selectLocality({ state: 'Anambra' }, 'state', 'Anambra'), {});
  });
});

describe('roster locality — the fields the backend sends', () => {
  const raw = (over: Partial<BackendRosterEntry>): BackendRosterEntry => ({
    contestant_id: 'x1',
    name: 'Ada Umeh',
    stage_name: '',
    category: '',
    state: 'Anambra',
    bio: '',
    photo_url: '',
    media_url: '',
    status: 'approved',
    is_active: true,
    free_votes: 0,
    paid_votes: 0,
    total_votes: 3,
    rank: 1,
    ...over,
  });

  it('carries the LGA and the village onto the contestant', () => {
    const c = mapContestant(raw({ lga: 'Onitsha North', village: 'Ogbendida' }), 'contest-1');
    assert.equal(c.lga, 'Onitsha North');
    assert.equal(c.village, 'Ogbendida');
    assert.equal(cardLocality(c), 'Ogbendida · Onitsha North');
  });

  it('turns a blank level into nothing rather than an empty segment', () => {
    const c = mapContestant(raw({ lga: 'Onitsha North', village: '' }), 'contest-1');
    assert.equal(c.village, undefined);
    assert.equal(localityLine(c), 'Onitsha North · Anambra');
  });

  it('still maps a roster from a backend that predates the village tier', () => {
    // Optional on the wire type for this reason: an older deployed Go answers these
    // rows without either key, and the card has to fall back to the state instead of
    // rendering "· Anambra".
    const c = mapContestant(raw({}), 'contest-1');
    assert.equal(c.lga, undefined);
    assert.equal(c.village, undefined);
    assert.equal(cardLocality(c), 'Anambra');
  });
});
