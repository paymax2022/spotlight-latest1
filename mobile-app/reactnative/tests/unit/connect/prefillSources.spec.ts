// `user_profiles` is near-empty for most users on this platform, so the Connect
// basics step would open blank for someone the platform can already describe.
// These pin the gap-filling: the profile always wins, and a value is only taken
// from another module where the profile has none.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fromAcademyApplication,
  fromAuthMetadata,
  fromRegistrationFormData,
  mergePrefillSources,
} from '@/features/connect/lib/prefillSources';

test('the profile wins over every other source', () => {
  const out = mergePrefillSources(
    { displayName: 'Patrick', gender: 'Female', state: 'Lagos' },
    { displayName: 'Patrick Chig', gender: 'Male', state: 'Enugu' },
  );
  assert.equal(out.displayName, 'Patrick');
  assert.equal(out.gender, 'Female');
  assert.equal(out.state, 'Lagos');
});

test('gaps in the profile are filled from the next source', () => {
  const out = mergePrefillSources(
    { displayName: 'Patrick' },                       // all the profile has
    { gender: 'Male', dateOfBirth: '1990-07-09' },    // an academy application
    { state: 'Enugu' },                               // a contest registration
  );
  assert.deepEqual(out, {
    displayName: 'Patrick', gender: 'Male', dateOfBirth: '1990-07-09', state: 'Enugu',
  });
});

test('the first source to answer wins among the fallbacks', () => {
  const out = mergePrefillSources({}, { state: 'Enugu' }, { state: 'Lagos' });
  assert.equal(out.state, 'Enugu');
});

test('empty strings do not count as answers', () => {
  // user_profiles stores "" rather than NULL for several of these columns, so a
  // blank must not block a real value from a later source.
  const out = mergePrefillSources({ gender: '', state: '   ' }, { gender: 'Male', state: 'Lagos' });
  assert.equal(out.gender, 'Male');
  assert.equal(out.state, 'Lagos');
});

test('a missing profile still merges the fallbacks', () => {
  const out = mergePrefillSources(null, { gender: 'Female' });
  assert.equal(out.gender, 'Female');
});

test('reads the fields a Film Academy application captured', () => {
  const out = fromAcademyApplication({
    full_name: 'Patrick Chig', gender: 'Male', date_of_birth: '1990-07-09', state: 'Lagos',
  });
  assert.deepEqual(out, {
    displayName: 'Patrick Chig', gender: 'Male', dateOfBirth: '1990-07-09', state: 'Lagos',
  });
});

test('an academy row with nothing useful contributes nothing', () => {
  // This is the common case: the row exists, but its optional columns are blank.
  const out = fromAcademyApplication({ full_name: '', gender: null, date_of_birth: null, state: '' });
  assert.deepEqual(out, { displayName: undefined, gender: undefined, dateOfBirth: undefined, state: undefined });
});

test('reads the personal.* answers a contest registration stored', () => {
  const out = fromRegistrationFormData({
    'personal.firstName': 'Patrick',
    'personal.lastName': 'Chig',
    'personal.dateOfBirth': '1990-07-09',
    'personal.gender': 'Male',
    'personal.stateOfResidence': 'Lagos',
    'contest.title': 'ignored',
  });
  assert.deepEqual(out, {
    firstName: 'Patrick', lastName: 'Chig', dateOfBirth: '1990-07-09', gender: 'Male', state: 'Lagos',
  });
});

test('reads the name sign-up recorded, under either spelling', () => {
  assert.equal(fromAuthMetadata({ fullName: 'Patrick' }).displayName, 'Patrick');
  assert.equal(fromAuthMetadata({ full_name: 'Patrick' }).displayName, 'Patrick');
  assert.equal(fromAuthMetadata({ name: 'Patrick' }).displayName, 'Patrick');
});

test('null and empty sources are safe', () => {
  assert.deepEqual(fromAcademyApplication(null), {});
  assert.deepEqual(fromRegistrationFormData(undefined), {});
  assert.deepEqual(fromAuthMetadata(null), {});
});
