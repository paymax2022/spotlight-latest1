import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredFieldsFor, optionalFieldsFor, missingRequired, detailKindFor, identityKeyFor, PROFESSIONAL_ROLES } from '../requirements.ts';

test('required fields per role match the Go MissingForSubmit keys', () => {
  assert.deepEqual(requiredFieldsFor('agent'), ['licenceNumber', 'operatingStates']);
  assert.deepEqual(requiredFieldsFor('developer'), ['companyName', 'cacNumber']);
  assert.deepEqual(requiredFieldsFor('estate_manager'), ['organisationName']);
});

test('optional fields per role', () => {
  assert.deepEqual(optionalFieldsFor('agent'), ['agencyName', 'bio', 'specialisations']);
  assert.deepEqual(optionalFieldsFor('developer'), ['website', 'projectSummary']);
  assert.deepEqual(optionalFieldsFor('estate_manager'), ['estatesManaged']);
});

test('requiredFieldsFor returns a copy', () => {
  const a = requiredFieldsFor('agent');
  a.push('x');
  assert.deepEqual(requiredFieldsFor('agent'), ['licenceNumber', 'operatingStates']);
});

test('missingRequired treats blank, empty array, null and undefined as missing', () => {
  assert.deepEqual(
    missingRequired('agent', { licenceNumber: '   ', operatingStates: [] }),
    ['licenceNumber', 'operatingStates'],
  );
  assert.deepEqual(missingRequired('developer', { companyName: null }), ['companyName', 'cacNumber']);
  assert.deepEqual(missingRequired('estate_manager', {}), ['organisationName']);
});

test('missingRequired accepts complete details', () => {
  assert.deepEqual(missingRequired('agent', { licenceNumber: 'L1', operatingStates: ['Lagos'] }), []);
  assert.deepEqual(missingRequired('developer', { companyName: 'A', cacNumber: 'RC1' }), []);
  assert.deepEqual(missingRequired('estate_manager', { organisationName: 'Org' }), []);
});

test('detailKindFor mirrors validate.go for every key', () => {
  const expected = {
    agent: { licenceNumber: 'string', agencyName: 'string', bio: 'string', specialisations: 'string', operatingStates: 'stringList' },
    developer: { companyName: 'string', cacNumber: 'string', website: 'string', projectSummary: 'string' },
    estate_manager: { organisationName: 'string', estatesManaged: 'count' },
  } as const;
  for (const [role, keys] of Object.entries(expected)) {
    for (const [k, kind] of Object.entries(keys)) {
      assert.equal(detailKindFor(role as never, k), kind, `${role}.${k}`);
    }
  }
});

test('every required/optional key has a kind', () => {
  for (const r of PROFESSIONAL_ROLES) {
    for (const k of [...requiredFieldsFor(r), ...optionalFieldsFor(r)]) {
      assert.ok(detailKindFor(r, k), `${r}.${k}`);
    }
  }
});

test('identityKeyFor is the single verification-resetting key', () => {
  assert.equal(identityKeyFor('agent'), 'licenceNumber');
  assert.equal(identityKeyFor('developer'), 'cacNumber');
  assert.equal(identityKeyFor('estate_manager'), 'organisationName');
});
