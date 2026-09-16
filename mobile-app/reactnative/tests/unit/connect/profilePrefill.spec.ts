// Prefill only helps if what it writes is a value the picker can SHOW. A value
// the list has no option for renders as an empty control that still holds an
// answer — the user sees a blank, and submits something they never saw. These
// tests pin that boundary, plus the two-source precedence.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBasicsPrefill,
  matchOption,
  prefillDob,
  prefillName,
  prefillState,
} from '@/features/connect/lib/profilePrefill';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));
// Fixed, not derived from today: a test that drifts with the clock is no test.
const YEARS = Array.from({ length: 100 }, (_, i) => String(2008 - i));
const GENDERS = ['Female', 'Male'];
const STATES = ['Enugu', 'FCT - Abuja', 'Lagos', 'Rivers'];
const LISTS = { days: DAYS, months: MONTHS, years: YEARS, genders: GENDERS, states: STATES };

// ── name ────────────────────────────────────────────────────────────────────

test('prefers a first name — Connect shows a chosen name, not a legal one', () => {
  assert.equal(prefillName({ firstName: 'Amara', displayName: 'Amara Okafor' }), 'Amara');
});

test('takes the first word of a stored full name', () => {
  assert.equal(prefillName({ displayName: 'Amara Chi Okafor' }), 'Amara');
});

test('never opens a Connect profile pre-filled with the account email', () => {
  assert.equal(prefillName({ displayName: 'amara@example.com', email: 'amara@example.com' }), '');
});

test('missing name yields a blank to fill in', () => {
  assert.equal(prefillName({}), '');
  assert.equal(prefillName({ displayName: '   ' }), '');
});

// ── date of birth ───────────────────────────────────────────────────────────

test('splits a stored date into the three pickers, without a leading zero', () => {
  // The day list is '1'…'31', so '05' would match no option.
  assert.deepEqual(prefillDob('1995-03-05', LISTS), { day: '5', month: 'March', year: '1995' });
});

test('a birth year outside the list prefills nothing', () => {
  // The year list starts 18 years back, so an under-18 DOB has no option to show.
  assert.deepEqual(prefillDob('2015-06-10', LISTS), { day: '', month: '', year: '' });
});

test('rejects a stored date that is not a real calendar day', () => {
  assert.deepEqual(prefillDob('2000-02-31', LISTS), { day: '', month: '', year: '' });
});

test('rejects malformed or missing dates', () => {
  assert.deepEqual(prefillDob('10/06/1995', LISTS), { day: '', month: '', year: '' });
  assert.deepEqual(prefillDob(undefined, LISTS), { day: '', month: '', year: '' });
});

// ── state ───────────────────────────────────────────────────────────────────

test('matches a state case-insensitively', () => {
  assert.equal(prefillState('lagos', STATES), 'Lagos');
});

test('drops the "State" suffix profiles commonly carry', () => {
  assert.equal(prefillState('Lagos State', STATES), 'Lagos');
});

test('folds the well-known spellings of the capital onto the one option', () => {
  // The picker spells it 'FCT - Abuja'; profiles rarely do.
  for (const v of ['FCT', 'Abuja', 'Federal Capital Territory']) {
    assert.equal(prefillState(v, STATES), 'FCT - Abuja', `failed for ${v}`);
  }
});

test('an unknown state prefills nothing rather than an unshowable value', () => {
  assert.equal(prefillState('Kano', STATES), '');
  assert.equal(prefillState('', STATES), '');
});

// ── gender ──────────────────────────────────────────────────────────────────

test('only uses a gender the two-option picker can display', () => {
  assert.equal(matchOption('female', GENDERS), 'Female');
  assert.equal(matchOption('Non-binary', GENDERS), '');
  assert.equal(matchOption('prefer_not_to_say', GENDERS), '');
});

// ── precedence ──────────────────────────────────────────────────────────────

test('what the user already chose beats what the account holds', () => {
  const out = buildBasicsPrefill(
    { displayName: 'Amara Okafor', dateOfBirth: '1995-03-05', gender: 'Female', state: 'Lagos' },
    { displayName: 'Ama', dob: '1990-12-01', gender: 'Male', location: 'Enugu' },
    LISTS,
  );
  assert.deepEqual(out, {
    name: 'Ama', day: '1', month: 'December', year: '1990', gender: 'Male', location: 'Enugu',
  });
});

test('falls back to the account for anything the draft has not answered', () => {
  const out = buildBasicsPrefill(
    { displayName: 'Amara Okafor', dateOfBirth: '1995-03-05', gender: 'Female', state: 'Lagos' },
    { displayName: 'Ama' },
    LISTS,
  );
  assert.equal(out.name, 'Ama');
  assert.equal(out.year, '1995');
  assert.equal(out.gender, 'Female');
  assert.equal(out.location, 'Lagos');
});

test('the three date parts move together — never mixed across sources', () => {
  // A draft month with a profile year would compose a date neither ever held.
  const out = buildBasicsPrefill(
    { dateOfBirth: '1995-03-05' },
    { dob: '2015-06-10' }, // under-18: unusable
    LISTS,
  );
  assert.deepEqual(
    { d: out.day, m: out.month, y: out.year },
    { d: '5', m: 'March', y: '1995' },
  );
});

test('no profile and no draft yields all blanks', () => {
  assert.deepEqual(buildBasicsPrefill(null, null, LISTS), {
    name: '', day: '', month: '', year: '', gender: '', location: '',
  });
});
