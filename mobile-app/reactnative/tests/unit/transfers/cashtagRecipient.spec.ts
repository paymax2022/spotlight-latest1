// Paying someone by cashtag has to survive the trip from the wire to the
// screen the sender approves on. contracts/openapi.yaml says the resolve
// preview (TransferRecipient) carries `handle` for a `@`/`$` send and omits it
// for a phone/email send; two things go wrong on a change like this, and both
// are pinned here:
//   1. the client maps the response field by field, so an added field is
//      silently dropped and the screen never sees it (this is exactly what the
//      mapper exists to make testable), and
//   2. the review line used to print the masked phone unconditionally — so a
//      sender who typed `@ada_9` approved a transfer while the screen showed a
//      number they had never entered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaymaxRecipient } from '@/api/mappers/paymaxRecipient.mapper';
import { recipientAddressLine } from '@/features/transfers/recipientDisplay';

/** One resolve-endpoint `recipient` object, as the server sends it. */
const wire = (over: Record<string, unknown> = {}) => ({
  user_id: 'u-7',
  display_name: 'Bisi Adeyemi',
  masked_phone: '0801****678',
  avatar_url: null,
  ...over,
});

test('the handle the server echoes survives the client mapping', () => {
  assert.equal(toPaymaxRecipient(wire({ handle: '@bisi_2' })).handle, '@bisi_2');
});

test('a phone or email preview has no handle, not an empty one', () => {
  // Absent on the wire → null in the domain, so callers can test for it
  // instead of comparing against '' and printing a blank line.
  assert.equal(toPaymaxRecipient(wire()).handle, null);
});

test('a cashtag send is confirmed with the handle the sender typed', () => {
  assert.equal(
    recipientAddressLine(toPaymaxRecipient(wire({ handle: '@bisi_2' }))),
    '@bisi_2',
  );
});

test('a phone send is still confirmed with the masked phone', () => {
  // The fallback is the existing behaviour for every send that is not a
  // cashtag; the extraction above must not change it.
  assert.equal(recipientAddressLine(toPaymaxRecipient(wire())), '0801****678');
});
