// Pins the mobile receipt to the BFF's ballot-key contract (EST-UAT-0205/0221).
// A one_vote_per_unit election keys each sealed ballot `${positionId}:${unitId}`;
// a plain election keys by position alone. If the two key shapes are conflated, a
// household that voted on two units reads back as "one vote, one position".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ballotsForPosition, castBallotCount } from '@/features/election/utils/electionFormatters';

const POSITION = '11111111-1111-4111-8111-111111111111:main';
const UNIT_A = 'aaaa0000-0000-4000-8000-000000000001';
const UNIT_B = 'aaaa0000-0000-4000-8000-000000000002';
const CANDIDATE = 'cccc0000-0000-4000-8000-000000000009';

test('plain election: one sealed line keyed by the position', () => {
  const lines = ballotsForPosition({ [POSITION]: 'sealed' }, POSITION);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].unitId, undefined);
  assert.equal(lines[0].value, 'sealed');
});

test('weighted election: every unit ballot is its own line, with the unit resolved', () => {
  const choices = {
    [`${POSITION}:${UNIT_A}`]: 'sealed',
    [`${POSITION}:${UNIT_B}`]: 'sealed',
  };
  const lines = ballotsForPosition(choices, POSITION);
  assert.deepEqual(lines.map((l) => l.unitId).sort(), [UNIT_A, UNIT_B].sort());
  assert.equal(castBallotCount(choices), 2);
});

test('an abstention still casts a line — it is sealed, not absent', () => {
  const lines = ballotsForPosition({ [`${POSITION}:${UNIT_A}`]: 'sealed' }, POSITION);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].value, 'sealed');
});

test('a cast vote cached under a real candidate id survives the same mapping', () => {
  const lines = ballotsForPosition({ [POSITION]: CANDIDATE }, POSITION);
  assert.equal(lines[0].value, CANDIDATE);
});

test('another position\'s ballot is never counted here', () => {
  const other = '22222222-2222-4222-8222-222222222222:main';
  assert.deepEqual(ballotsForPosition({ [`${other}:${UNIT_A}`]: 'sealed' }, POSITION), []);
});
