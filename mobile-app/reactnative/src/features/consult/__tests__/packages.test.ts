import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nairaToKobo, packagePayload, validatePackageDraft } from '../packages.ts';

const OWNER = { ownerKind: 'doctor' as const, ownerId: 'user-1', vertical: 'telemedicine' as const };

test('nairaToKobo accepts grouped and decimal naira, and refuses nonsense', () => {
  assert.equal(nairaToKobo('2,000'), 200_000);
  assert.equal(nairaToKobo('₦2,000.50'), 200_050);
  assert.equal(nairaToKobo(' 1500 '), 150_000);
  assert.equal(nairaToKobo(''), 0);
  assert.equal(nairaToKobo('abc'), 0);
  assert.equal(nairaToKobo('0'), 0);
});

test('duration must be a whole number from 5 to 480 minutes', () => {
  assert.equal(validatePackageDraft({ mode: 'video', durationMinutes: 30, priceNaira: '2000' }), null);
  assert.match(
    validatePackageDraft({ mode: 'video', durationMinutes: 4, priceNaira: '2000' }) ?? '',
    /5 and 480/,
  );
  assert.match(
    validatePackageDraft({ mode: 'video', durationMinutes: 481, priceNaira: '2000' }) ?? '',
    /5 and 480/,
  );
  assert.match(
    validatePackageDraft({ mode: 'video', durationMinutes: 30.5, priceNaira: '2000' }) ?? '',
    /whole number/,
  );
});

test('price must be greater than zero', () => {
  assert.match(validatePackageDraft({ mode: 'chat', durationMinutes: 15, priceNaira: '' }) ?? '', /price/i);
  assert.match(validatePackageDraft({ mode: 'chat', durationMinutes: 15, priceNaira: '0' }) ?? '', /price/i);
});

test('packagePayload sends the engine snake_case body with kobo', () => {
  assert.deepEqual(
    packagePayload({ mode: 'voice', durationMinutes: 20, priceNaira: '1,500' }, OWNER),
    {
      ownerKind: 'doctor',
      ownerId: 'user-1',
      vertical: 'telemedicine',
      mode: 'voice',
      durationMinutes: 20,
      priceKobo: 150_000,
    },
  );
});
