// Phone identity is an AUTH path: a mismatch with the backend's NormalizePhone
// presents to the user as a wrong password. These pin the rules against the Go
// implementation in backend/internal/services/phone_identifier.go.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  digitsOnly, toNsn, isValid, toE164, toIdentity, formatNsn, placeholderFor,
  countryByIso2, COUNTRIES, DEFAULT_COUNTRY,
} from '../phone.ts';

const NG = countryByIso2('NG');
const US = countryByIso2('US');

test('digitsOnly strips everything that is not a digit', () => {
  assert.equal(digitsOnly('+234 (801) 234-5678 ext.9'), '23480123456789');
  assert.equal(digitsOnly(''), '');
  assert.equal(digitsOnly('no digits here'), '');
});

test('toNsn accepts every way a Nigerian number is commonly typed', () => {
  for (const input of ['+2348012345678', '2348012345678', '08012345678', '8012345678',
                       '+234 801 234 5678', '0801-234-5678']) {
    assert.equal(toNsn(input, NG), '8012345678', `failed for ${input}`);
  }
});

test('toNsn caps at the NSN length so a pasted suffix cannot slip through', () => {
  assert.equal(toNsn('08012345678 (work)', NG), '8012345678');
  assert.equal(toNsn('801234567899999', NG), '8012345678');
});

test('isValid requires a COMPLETE national number', () => {
  assert.equal(isValid('0801234567', NG), false);
  assert.equal(isValid('08012345678', NG), true);
  assert.equal(isValid('', NG), false);
});

test('toE164 returns the API form, or "" when incomplete', () => {
  assert.equal(toE164('08012345678', NG), '+2348012345678');
  assert.equal(toE164('0801234', NG), '');
  assert.equal(toE164('2015550123', US), '+12015550123');
});

test('toIdentity mirrors the backend NormalizePhone', () => {
  assert.equal(toIdentity('+2348159491618'), '8159491618');
  assert.equal(toIdentity('08159491618'),    '8159491618');
  assert.equal(toIdentity('8159491618'),     '8159491618');
  assert.equal(toIdentity('+234 815 949 1618'), '8159491618');
  assert.equal(toIdentity('815949161'),   '');
  assert.equal(toIdentity('81594916180'), '');
  assert.equal(toIdentity(''),            '');
});

test('toIdentity collapses across countries — why non-NG cannot sign in', () => {
  // A US number WITH its country code is 11 digits and the backend refuses it
  // outright, so it can never sign in at all.
  assert.equal(toIdentity('+12015550123'), '');
  // The real hazard is narrower and worse: stored as a bare national number —
  // which is exactly what toNsn produces — a US number is indistinguishable
  // from the Nigerian subscriber holding the same ten digits.
  assert.equal(toNsn('+12015550123', US), '2015550123');
  assert.equal(toIdentity('2015550123'), toIdentity('08012345678'.replace('8012345678', '2015550123')));
  assert.deepEqual(COUNTRIES.filter((c) => c.identity).map((c) => c.iso2), ['NG']);
});

test('formatNsn groups for display only', () => {
  assert.equal(formatNsn('08012345678', NG), '801 234 5678');
  assert.equal(formatNsn('0801', NG), '801');
  assert.equal(formatNsn('', NG), '');
});

test('placeholder is built from the country sample, so it cannot mislead', () => {
  assert.equal(placeholderFor(NG), '801 234 5678');
  assert.equal(placeholderFor(US), '201 555 0123');
  assert.equal(DEFAULT_COUNTRY.iso2, 'NG');
});

test('countryByIso2 falls back to the default rather than throwing', () => {
  assert.equal(countryByIso2('ZZ').iso2, 'NG');
});
